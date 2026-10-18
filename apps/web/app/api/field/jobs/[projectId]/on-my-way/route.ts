import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { onMyWayPreview, sendOnMyWay } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * GET  /api/field/jobs/<projectId>/on-my-way?eta=30   the SMS the customer would get, before it's sent
 * POST /api/field/jobs/<projectId>/on-my-way { etaMinutes }
 *      records "on my way" on the project, which sends the SMS through the
 *      outbox; answers with what really happened (sent, demo, failed, not sent).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };
const eta = z.number().int().min(1).max(240);

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.work" }))) return notFound();
  const minutes = eta.safeParse(Number(new URL(request.url).searchParams.get("eta")));
  if (!minutes.success) return json({ error: "Pick an ETA between 1 and 240 minutes." }, 400);
  return answer(() => onMyWayPreview(projectId, staff, minutes.data));
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.work" }))) return notFound();
  const body = z.object({ etaMinutes: eta }).safeParse(await readJson(request));
  if (!body.success) return json({ error: "Pick an ETA between 1 and 240 minutes." }, 400);
  return answer(() => sendOnMyWay(projectId, staff, body.data.etaMinutes));
}
