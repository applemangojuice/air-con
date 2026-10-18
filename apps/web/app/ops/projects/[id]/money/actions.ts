"use server";

import { z } from "zod";
import { INVOICE_KINDS, type InvoiceKind, type StaffMember } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { finishIssue, finishPayment, issueInvoice, recordManualPayment, recordRefund } from "@/lib/money-server";
import { isUuid } from "@/lib/repo/base";
import * as invoicesRepo from "@/lib/repo/invoices";
import { invalid, poundsToPence, text, toState, type ActionState } from "../booking/_f5/action-state";

/**
 * Money actions (payments.record). Issuing recomputes the figure and refuses
 * if it moved; payments and refunds carry the form's one-off id, so a double
 * tap or a retry on a bad connection records them once.
 */

async function guard(projectId: string): Promise<StaffMember | null> {
  const staff = await requireStaff("payments.record");
  if (!isUuid(projectId)) return null;
  const access = await requireProjectAccess(projectId, { perm: "payments.record" });
  return access?.kind === "staff" ? staff : null;
}

const NOT_FOUND: ActionState = { error: "That project isn't available to you." };
const requestIdOf = (form: FormData) => z.string().min(8).max(64).safeParse(form.get("requestId"));
const METHODS = ["bank-transfer", "card", "cash", "other"] as const;

export async function issueAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const kind = z.enum(INVOICE_KINDS as [InvoiceKind, ...InvoiceKind[]]).safeParse(form.get("kind"));
  const requestId = requestIdOf(form);
  if (!kind.success || kind.data === "credit-note" || !requestId.success) return invalid();
  const expected = poundsToPence(form.get("expectedTotal"));
  const issueId = form.get("issueId");
  return toState(
    await issueInvoice(
      projectId,
      {
        kind: kind.data,
        ...(expected !== null ? { expectedTotalPence: expected } : {}),
        ...(typeof issueId === "string" && isUuid(issueId) ? { issueId } : {}),
        requestId: requestId.data,
        ...(text(form, "notes", 500) ? { notes: text(form, "notes", 500) } : {}),
      },
      staff,
    ),
    "Invoice issued and emailed.",
  );
}

export async function creditAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const requestId = requestIdOf(form);
  const amount = poundsToPence(form.get("amount"));
  const reason = text(form, "reason", 300);
  if (!requestId.success) return invalid();
  if (!amount) return invalid("Enter the amount to credit, in pounds.");
  if (!reason) return invalid("Say why: it's printed on the credit note.");
  const target = form.get("invoiceId");
  return toState(
    await issueInvoice(
      projectId,
      {
        kind: "credit-note",
        amountPence: amount,
        reason,
        requestId: requestId.data,
        ...(typeof target === "string" && isUuid(target) ? { creditsInvoiceId: target } : {}),
      },
      staff,
    ),
    "Credit note issued.",
  );
}

const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  method: z.enum(METHODS),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function paymentAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const requestId = requestIdOf(form);
  const parsed = paymentSchema.safeParse({ invoiceId: form.get("invoiceId"), method: form.get("method"), receivedOn: form.get("receivedOn") });
  const amount = poundsToPence(form.get("amount"));
  if (!requestId.success || !parsed.success) return invalid("Check the method and the date it arrived.");
  if (!amount) return invalid("Enter the amount that arrived, in pounds.");
  const result = await recordManualPayment(
    projectId,
    {
      ...parsed.data,
      amountPence: amount,
      requestId: requestId.data,
      ...(text(form, "reference", 120) ? { reference: text(form, "reference", 120) } : {}),
      ...(text(form, "note", 500) ? { note: text(form, "note", 500) } : {}),
    },
    staff,
  );
  if (result.ok && result.value.duplicate) return { ok: true, message: "That payment was already recorded." };
  return toState(result, "Payment recorded. The receipt has gone to the customer.");
}

export async function refundAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const requestId = requestIdOf(form);
  const parsed = z
    .object({ invoiceId: z.string().uuid(), method: z.enum(METHODS), refundedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse({ invoiceId: form.get("invoiceId"), method: form.get("method"), refundedOn: form.get("refundedOn") });
  const amount = poundsToPence(form.get("amount"));
  const reason = text(form, "reason", 300);
  if (!requestId.success || !parsed.success) return invalid("Check the method and the date.");
  if (!amount) return invalid("Enter the amount refunded, in pounds.");
  if (!reason) return invalid("Say why the money went back.");
  const result = await recordRefund(
    projectId,
    { ...parsed.data, amountPence: amount, reason, requestId: requestId.data, ...(text(form, "reference", 120) ? { reference: text(form, "reference", 120) } : {}) },
    staff,
  );
  if (result.ok && result.value.duplicate) return { ok: true, message: "That refund was already recorded." };
  return toState(result, "Refund recorded.");
}

export async function finishPaymentAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const paymentId = z.string().uuid().safeParse(form.get("paymentId"));
  if (!paymentId.success) return invalid();
  return toState(await finishPayment(projectId, paymentId.data, staff), "Done.");
}

export async function finishAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const invoiceId = z.string().uuid().safeParse(form.get("invoiceId"));
  if (!invoiceId.success) return invalid();
  const invoice = await invoicesRepo.get(invoiceId.data);
  if (!invoice || invoice.projectId !== projectId) return invalid("That invoice isn't on this project.");
  const done = await finishIssue(invoice, staff);
  return done.warning ? { ok: true, message: "Tried again.", warning: done.warning } : { ok: true, message: "All done: document, totals and email." };
}
