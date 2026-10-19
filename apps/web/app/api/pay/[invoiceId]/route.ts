import { invoiceOutstanding, type Invoice } from "@aircon/domain";
import { requireProjectAccess } from "@/lib/auth/server";
import { appUrl } from "@/lib/brand";
import { loadProject } from "@/lib/project-service";
import { createCheckoutSession, expireCheckoutSession, retrieveCheckoutSession, stripeConfigured } from "@/lib/providers/stripe";
import { mutateRow } from "@/lib/purchasing-server";
import { priorSession } from "./prior-session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/repo/base";
import * as invoicesRepo from "@/lib/repo/invoices";
import * as paymentsRepo from "@/lib/repo/payments";

/**
 * POST /api/pay/<invoiceId>: start a card payment for what's left on one
 * invoice. The project's customer (or staff on the job) only; anything else
 * is a 404. Answers with a 303 to Stripe's hosted Checkout, or back to the
 * payment page with a calm reason when card payment isn't possible.
 *
 * Nothing is recorded here: the payment exists once Stripe's signed webhook
 * (or Stripe's own API, read back on the return page) says it's paid.
 *
 * One payable Checkout page per bill: the invoice remembers its latest
 * session. Still open for the same amount, it's reused; open for another
 * amount, it's closed (expired at Stripe) before a new one is made; already
 * paid, the customer goes to the return page, which records it, instead of
 * being sent to pay again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });

function origin(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ? appUrl() : new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }): Promise<Response> {
  const limited = enforceRateLimit(request, "pay", 10, 60_000);
  if (limited) return limited;
  const { invoiceId } = await params;
  if (!isUuid(invoiceId)) return notFound();
  const invoice = await invoicesRepo.get(invoiceId);
  if (!invoice) return notFound();
  const access = await requireProjectAccess(invoice.projectId, { allowCustomer: true, customerSide: true });
  if (!access) return notFound();

  const base = origin(request);
  const back = (reason: string) => Response.redirect(`${base}/p/${invoice.projectId}/pay?card=${reason}`, 303);
  if (!stripeConfigured()) return back("unavailable");
  if (invoice.status === "void" || invoice.status === "draft" || invoice.kind === "credit-note") return back("not-payable");
  const all = await invoicesRepo.listForProject(invoice.projectId);
  const owed = invoiceOutstanding(invoice, all);
  if (owed <= 0) return back("nothing-due");

  const project = await loadProject(invoice.projectId);
  // A cancelled contract takes no more money (reg 34): anything paid is refunded.
  if (project?.closure.reason === "cancelled") return back("cancelled-contract");
  const prior = invoice.checkoutSessionId;
  if (prior) {
    const seen = await retrieveCheckoutSession(prior);
    if (!seen.ok) {
      console.error(`[pay] reading the last checkout for ${invoice.number} failed:`, seen.error);
      return back("failed");
    }
    const answer = await priorSession(seen.value, owed, {
      expire: expireCheckoutSession,
      retrieve: retrieveCheckoutSession,
      recorded: async (id) => Boolean(await paymentsRepo.getByProviderRef(id)),
    });
    // Paid already: the return page reads it back from Stripe and records it.
    if (answer === "paid") return Response.redirect(`${base}/p/${invoice.projectId}/pay?session=${encodeURIComponent(prior)}`, 303);
    if (answer === "failed") return back("failed");
    if (typeof answer === "object") return Response.redirect(answer.url, 303);
  }

  const session = await createCheckoutSession({
    // Charge what's still owed after payments and credit notes, never more.
    invoice: { ...invoice, paidPence: invoice.totalPence - owed },
    successUrl: `${base}/p/${invoice.projectId}/pay?session={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/p/${invoice.projectId}/pay?card=cancelled`,
    ...(project?.customer.email ? { customerEmail: project.customer.email } : {}),
    ...(project ? { description: [project.customer.addressLine, project.customer.postcode].filter(Boolean).join(", ") } : {}),
    // Two taps at once open the same page (the same key while the last one is the same); after that, the stored session decides.
    idempotencyKey: `checkout:${invoice.id}:${owed}:${prior ?? "first"}:${new Date().toISOString().slice(0, 10)}`,
  });
  if (!session.ok) {
    console.error(`[pay] checkout for ${invoice.number} failed:`, session.error);
    return back("failed");
  }
  if (session.value.id !== prior) {
    const saved = await mutateRow<Invoice>("invoices", invoice.id, invoicesRepo, (cur) => ({ ok: true, value: { ...cur, checkoutSessionId: session.value.id } }));
    if (!saved.ok) console.error(`[pay] couldn't remember checkout ${session.value.id} on ${invoice.number}: ${saved.error}`);
  }
  return Response.redirect(session.value.url, 303);
}
