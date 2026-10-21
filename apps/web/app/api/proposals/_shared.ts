import type { ZodType } from "zod";
import { requireProjectAccess } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { projectIdOfProposal, type Result } from "@/lib/proposal-server";

/**
 * The shared front door of the customer's proposal routes
 * (/api/proposals/<proposalId>/accept|changes|decline|view): rate limit,
 * the proposal's project, the signed-in person's access to it, and the
 * body's schema. Every "no" about a proposal someone can't see is a 404.
 */

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export type Gate<T> =
  | { ok: true; proposalId: string; projectId: string; customerId: string | null; body: T }
  | { ok: false; response: Response };

export async function customerGate<T>(
  request: Request,
  params: Promise<{ id: string }>,
  opts: { scope: string; limit: number; schema: ZodType<T>; staffMessage?: string },
): Promise<Gate<T>> {
  const limited = enforceRateLimit(request, opts.scope, opts.limit, 60_000);
  if (limited) return { ok: false, response: limited };
  const { id } = await params;
  const projectId = await projectIdOfProposal(id);
  if (!projectId) return { ok: false, response: json({ error: "Not found" }, 404) };
  const access = await requireProjectAccess(projectId, { allowCustomer: true, customerSide: true });
  if (!access) return { ok: false, response: json({ error: "Not found" }, 404) };
  const raw = await request.json().catch(() => null);
  const parsed = opts.schema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, response: json({ error: "Please check the form and try again." }, 400) };
  if (access.kind !== "customer") {
    if (opts.staffMessage) return { ok: false, response: json({ error: opts.staffMessage }, 403) };
    return { ok: true, proposalId: id, projectId, customerId: null, body: parsed.data };
  }
  return { ok: true, proposalId: id, projectId, customerId: access.customerId, body: parsed.data };
}

/** A Result from proposal-server as the route's response. */
export function respond<T extends object>(result: Result<T>): Response {
  if (result.ok) return json(result);
  return json(
    { error: result.error, ...(result.errors ? { errors: result.errors } : {}), ...(result.blockers ? { blockers: result.blockers } : {}) },
    result.status,
  );
}
