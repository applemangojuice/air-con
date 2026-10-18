import { z } from "zod";
import { requireStaffApi } from "@/lib/auth/server";
import { updateIssueFromField } from "@/lib/field-server";
import { answer, json, notFound, readJson } from "../../_lib/http";

/**
 * PATCH /api/field/issues/<id> { to: "in-progress" | "resolved", note }
 * An installer's update on an issue. Project access is checked inside
 * (an issue on a job you're not on is "not found").
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ to: z.enum(["in-progress", "resolved"]), note: z.string().max(2000) });

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return notFound();
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request" }, 400);
  return answer(async () => ({ issue: await updateIssueFromField(staff, id, body.data.to, body.data.note) }));
}
