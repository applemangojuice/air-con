import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { headerStateOf, signCommissioning } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/commissioning { notes?, seen? }
 * The tech lead signs: the record goes on the job, the install completes,
 * commissioning is signed on the project and the certificate is issued.
 * Answers with the record, the certificate and the job's header as it now
 * stands, so the screen shows them at once (`already` when it was signed
 * before: a retry is safe). Refusals
 * come back with the reason (and the gate's blockers).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "commissioning.sign");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "commissioning.sign" }))) return notFound();
  const body = z
    .object({
      notes: z.string().max(2000).optional(),
      // Every evidence id the signer's screen had from the server: a capture that arrived since is refused.
      seen: z.array(z.string().min(1).max(100)).max(5000).optional(),
    })
    .safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request" }, 400);
  return answer(async () => {
    const { certificate, record, already, project } = await signCommissioning(projectId, staff, body.data.notes, body.data.seen);
    return { ok: true, certificate, record, already, header: headerStateOf(project) };
  });
}
