import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/server";
import { sendSignInLink } from "@/lib/portal-server";
import { createProjectForQuote } from "@/lib/project-service";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Start (or resume) the project for a saved quote: the /q page's "Start my
 * installation plan" (components/project/start-project.tsx). Idempotent:
 * one project per quote.
 *
 *   POST /api/projects { quoteId } → { ok: true, demo: false, id, canOpen, linkSent, devLink? }   (unchanged shape, plus these)
 *                                  → { ok: true, demo: true }                   (no database: the demo hub)
 *
 * The project page is private. The browser that saved the quote holds its
 * quote-owner cookie (lib/auth/quote-owner.ts), which opens this project
 * (and only this one) straight away, so `canOpen` is true for the customer
 * booking from /q. Anyone else (a shared /q link, another device) gets a
 * sign-in link emailed to the address on the quote, and the page they land
 * on says so and can send another. In development the link comes back as
 * `devLink`, since nothing is emailed there.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ quoteId: z.string().uuid() });

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "projects", 20, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await createProjectForQuote(parsed.data.quoteId.toLowerCase());
  if ("error" in result) {
    if (result.error === "demo") return NextResponse.json({ ok: true, demo: true });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Already signed in as this project's customer (or staff who can see it): straight in.
  const canOpen = Boolean(await requireProjectAccess(result.id, { allowCustomer: true }));
  let linkSent = false;
  let devLink: string | undefined;
  if (result.created && !canOpen) {
    const link = await sendSignInLink({ kind: "project", projectId: result.id });
    linkSent = true;
    devLink = link.devLink;
  }
  return NextResponse.json({ ok: true, demo: false, id: result.id, canOpen, linkSent, ...(devLink ? { devLink } : {}) });
}
