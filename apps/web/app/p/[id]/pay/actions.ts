"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { invoiceOutstanding } from "@aircon/domain";
import { getSession, requireProjectAccess } from "@/lib/auth/server";
import { notify } from "@/lib/comms/outbox";
import { money } from "@/lib/format";
import { simulateCardPayment } from "@/lib/money-server";
import { rateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { isUuid } from "@/lib/repo/base";
import * as invoicesRepo from "@/lib/repo/invoices";
import type { ActionState } from "../../../ops/projects/[id]/booking/_f5/action-state";

/**
 * The customer's payment page actions. Each checks the visitor may open
 * this project (the customer, or staff on the job), is rate limited per
 * address, and never marks anything paid by itself: the demo simulator is
 * refused anywhere real, and "I've sent it" only tells the office to look.
 */

async function allowed(projectId: string, scope: string, limit: number): Promise<{ who: string } | ActionState> {
  const h = await headers();
  const ip = rateLimitIdentity(h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown");
  if (!rateLimit(`${scope}:${ip}`, limit, 60_000).ok) return { error: "Too many tries just now. Wait a minute and try again." };
  if (!isUuid(projectId)) return { error: "This page isn't available." };
  const access = await requireProjectAccess(projectId, { allowCustomer: true });
  if (!access) return { error: "This page isn't available. Try signing in again." };
  const session = await getSession();
  return { who: access.kind === "staff" ? access.staff.name : session?.name || "Customer" };
}

export async function simulatePaymentAction(projectId: string, invoiceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const ok = await allowed(projectId, "pay-simulate", 10);
  if (!("who" in ok)) return ok;
  const requestId = z.string().min(8).max(64).safeParse(form.get("requestId"));
  if (!requestId.success || !isUuid(invoiceId)) return { error: "The page wasn't ready. Try again." };
  const result = await simulateCardPayment(projectId, invoiceId, requestId.data, ok.who);
  if (!result.ok) return { error: result.error };
  return { ok: true, message: "DEMO payment recorded. No money moved." };
}

export async function sentTransferAction(projectId: string, invoiceId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const ok = await allowed(projectId, "pay-sent", 5);
  if (!("who" in ok)) return ok;
  const invoice = isUuid(invoiceId) ? await invoicesRepo.get(invoiceId) : null;
  if (!invoice || invoice.projectId !== projectId) return { error: "That invoice isn't available." };
  const owed = invoiceOutstanding(invoice, await invoicesRepo.listForProject(projectId));
  if (owed <= 0) return { ok: true, message: "There's nothing left to pay on this invoice." };
  const today = new Date().toISOString().slice(0, 10);
  await notify("team-alert", {
    projectId,
    data: {
      title: `Customer says they've sent a bank transfer: ${invoice.number}, ${money(owed)}`,
      lines: [
        `${ok.who} says it's on its way, with reference ${invoice.number}.`,
        "Check the bank account, then record it on the project's Money page. Nothing is marked paid until then.",
      ],
    },
    discriminator: `transfer-sent:${invoice.id}:${today}`,
  });
  return { ok: true, message: "Thanks for letting us know. We'll confirm by email once it reaches our account, usually within a working day." };
}
