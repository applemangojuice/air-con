import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { headerStateOf, publishHandoverPack, signHandover } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/handover
 *   { action: "publish", requestId? }   publish the handover pack (emails the
 *       customer). The same requestId again answers with the same pack
 *       (`replayed`), so a retry never publishes twice.
 *   { action: "sign", name, outcome, snags: [{ id, text }], signatureMediaId? }
 *       the customer's sign-off on the installer's phone; each snag becomes
 *       a customer-visible issue before the sign-off is recorded. Answers
 *       with the sign-off on record (`already` when it was signed before).
 *
 * Both answer with the job's header as it now stands (`header`), so the
 * screen shows the result at once (components/field/handover.tsx doesn't
 * wait for a page refresh).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), requestId: z.string().uuid().optional() }),
  z.object({
    action: z.literal("sign"),
    name: z.string().trim().min(2).max(120),
    outcome: z.enum(["all-good", "snags"]),
    snags: z.array(z.object({ id: z.string().uuid(), text: z.string().trim().min(3).max(1000) })).max(20),
    signatureMediaId: z.string().uuid().optional(),
  }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.work" }))) return notFound();
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Check the name and any snags, then try again." }, 400);
  const b = body.data;
  if (b.action === "publish") {
    return answer(async () => {
      const r = await publishHandoverPack(projectId, staff, b.requestId ? { requestId: b.requestId } : {});
      return { ok: true, document: r.document, email: r.email, replayed: r.replayed, header: headerStateOf(r.project) };
    });
  }
  return answer(async () => {
    const r = await signHandover(projectId, staff, {
      name: b.name,
      outcome: b.outcome,
      snags: b.snags,
      ...(b.signatureMediaId ? { signatureMediaId: b.signatureMediaId } : {}),
    });
    return { ok: true, snagCount: r.snagCount, signoff: r.signoff, already: r.already, header: headerStateOf(r.project) };
  });
}
