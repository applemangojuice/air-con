import { NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/auth/session";
import { runDailyOps } from "@/lib/ops-core-server";

/**
 * The daily-ops cron (contract §H, vercel.json): survey reminders, install
 * prep and day-before texts, the proposal nudge and expiry, the 7-day
 * check-in, 30-day feedback, review request, change-of-season check and
 * service reminders, then the outbox's due and failed messages.
 *
 * Idempotent: every message is keyed on its occurrence, so a retry or a
 * second run the same day sends nothing new. Admins can run the same code
 * from /ops/messages. Returns a JSON summary (project ids only, no
 * customer details).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorised(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!(await authorised(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runDailyOps();
    return NextResponse.json({ ok: summary.errors.length === 0, ...summary });
  } catch (err) {
    console.error("[cron] daily-ops failed:", err);
    return NextResponse.json({ ok: false, error: "daily-ops failed; see the server log" }, { status: 500 });
  }
}
