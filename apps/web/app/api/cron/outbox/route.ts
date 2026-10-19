import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env-placeholders";
import { constantTimeEqual } from "@/lib/auth/session";
import { dispatchDue } from "@/lib/comms/outbox";

/**
 * The outbox cron: send queued messages whose time has come and retry
 * failed ones (up to the outbox's attempt limit). The daily-ops cron does
 * this too; this route lets a more frequent schedule drain the queue
 * between daily runs. Bearer CRON_SECRET, like the other crons.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = cronSecret(); // a template value (.env.example) is no secret
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await dispatchDue(new Date().toISOString());
    return NextResponse.json({ ok: summary.errors === 0, ...summary });
  } catch (err) {
    console.error("[cron] outbox failed:", err);
    return NextResponse.json({ ok: false, error: "outbox run failed; see the server log" }, { status: 500 });
  }
}
