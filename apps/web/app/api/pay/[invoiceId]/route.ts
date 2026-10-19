import { invoiceOutstanding } from "@aircon/domain";
import { requireProjectAccess } from "@/lib/auth/server";
import { appUrl } from "@/lib/brand";
import { loadProject } from "@/lib/project-service";
import { createCheckoutSession, stripeConfigured } from "@/lib/providers/stripe";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/repo/base";
import * as invoicesRepo from "@/lib/repo/invoices";

/**
 * POST /api/pay/<invoiceId>: start a card payment for what's left on one
 * invoice. The project's customer (or staff on the job) only; anything else
 * is a 404. Answers with a 303 to Stripe's hosted Checkout, or back to the
 * payment page with a calm reason when card payment isn't possible.
 *
 * Nothing is recorded here: the payment exists once Stripe's signed webhook
 * (or Stripe's own API, read back on the return page) says it's paid.
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
  const access = await requireProjectAccess(invoice.projectId, { allowCustomer: true });
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
  const session = await createCheckoutSession({
    // Charge what's still owed after payments and credit notes, never more.
    invoice: { ...invoice, paidPence: invoice.totalPence - owed },
    successUrl: `${base}/p/${invoice.projectId}/pay?session={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/p/${invoice.projectId}/pay?card=cancelled`,
    ...(project?.customer.email ? { customerEmail: project.customer.email } : {}),
    ...(project ? { description: [project.customer.addressLine, project.customer.postcode].filter(Boolean).join(", ") } : {}),
    // The same invoice and amount within a day returns the same Checkout page, so a double tap can't open two.
    idempotencyKey: `checkout:${invoice.id}:${owed}:${new Date().toISOString().slice(0, 10)}`,
  });
  if (!session.ok) {
    console.error(`[pay] checkout for ${invoice.number} failed:`, session.error);
    return back("failed");
  }
  return Response.redirect(session.value.url, 303);
}
