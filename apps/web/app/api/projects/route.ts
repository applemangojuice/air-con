import { NextResponse } from "next/server";
import { z } from "zod";
import { createProjectForQuote } from "@/lib/projects-server";

const bodySchema = z.object({ quoteId: z.string().uuid() });

/** Start (or resume) the project for a saved quote. Idempotent. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await createProjectForQuote(parsed.data.quoteId);
  if ("error" in result) {
    if (result.error === "demo") return NextResponse.json({ ok: true, demo: true });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, demo: false, id: result.id });
}
