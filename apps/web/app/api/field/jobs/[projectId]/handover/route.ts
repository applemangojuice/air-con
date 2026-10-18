import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { publishHandoverPack, signHandover } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/handover
 *   { action: "publish" }   publish the handover pack (emails the customer)
 *   { action: "sign", name, outcome, snags: [{ id, text }], signatureMediaId? }
 *       the customer's sign-off on the installer's phone; each snag becomes
 *       a customer-visible issue before the sign-off is recorded.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }),
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
      const r = await publishHandoverPack(projectId, staff);
      return { ok: true, document: r.document, email: r.email };
    });
  }
  return answer(async () => {
    const r = await signHandover(projectId, staff, {
      name: b.name,
      outcome: b.outcome,
      snags: b.snags,
      ...(b.signatureMediaId ? { signatureMediaId: b.signatureMediaId } : {}),
    });
    return { ok: true, snagCount: r.snagCount };
  });
}
