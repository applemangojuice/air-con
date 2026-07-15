import { NextResponse } from "next/server";
import { z } from "zod";
import type { ProjectAction } from "@aircon/domain";
import { applyAndSave, loadProject } from "@/lib/projects-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer actions only. ops-* actions never come through the public API;
 * they run as server actions behind the /ops basic-auth wall.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve-floor-plan") }),
  z.object({ type: z.literal("accept-final-quote") }),
  z.object({
    type: z.literal("book-site-visit"),
    scheduledFor: z.string().datetime(),
    mode: z.enum(["video", "in-person"]),
  }),
  z.object({ type: z.literal("pay-site-visit") }),
  z.object({
    type: z.literal("reschedule-site-visit"),
    scheduledFor: z.string().datetime(),
  }),
  z.object({
    type: z.literal("book-installation"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal("reschedule-installation"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal("set-delivery-date"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal("toggle-prep"),
    itemId: z.string().max(60),
    done: z.boolean(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = await loadProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await applyAndSave(id, parsed.data as ProjectAction);
  if ("error" in result) {
    if (result.error === "demo") return NextResponse.json({ ok: true, demo: true });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, project: result.project });
}
