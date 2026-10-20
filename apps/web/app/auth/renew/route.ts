import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/auth/access";
import { sessionCookie, staffForSession } from "@/lib/auth/server";
import { SESSION_COOKIE, renewedSession, sessionHardEnd, verifySession } from "@/lib/auth/session";

/**
 * Rolling staff sessions (§K45). `POST /auth/renew` (from the ops and field
 * shells' SessionRenewal, once a session is past half its life) re-signs the
 * signed-in staff member's cookie for another 30 days, never past 90 days
 * from their sign-in.
 *
 * Revocation is never weakened: the cookie must verify (a changed
 * SESSION_SECRET or an expired cookie renews nothing), and the person must
 * still be an active staff member in the database right now
 * (`staffForSession`, the check every page and action makes), so a
 * deactivated or removed account, a demo account with demo mode off, or a
 * break-glass session gets nothing. Name, roles and the subcontractor flag
 * come from that fresh row; the sign-in time (`auth`) never moves.
 */

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.nextUrl.host)) {
    return NextResponse.json({ renewed: false }, { status: 403, headers: NO_STORE });
  }
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.kind !== "staff") return NextResponse.json({ renewed: false }, { status: 401, headers: NO_STORE });
  let staff;
  try {
    staff = await staffForSession(session);
  } catch (err) {
    console.error("[auth] renewal lookup failed:", err);
    return NextResponse.json({ renewed: false }, { status: 503, headers: NO_STORE });
  }
  if (!staff) return NextResponse.json({ renewed: false }, { status: 401, headers: NO_STORE });
  const renewed = renewedSession({ ...session, email: staff.email, name: staff.name, roles: staff.roles, external: staff.external });
  if (!renewed) {
    return NextResponse.json({ renewed: false, exp: session.exp, hardEnd: sessionHardEnd(session) }, { headers: NO_STORE });
  }
  let cookie;
  try {
    cookie = await sessionCookie(renewed);
  } catch (err) {
    console.error("[auth] could not sign a renewed session:", err);
    return NextResponse.json({ renewed: false }, { status: 503, headers: NO_STORE });
  }
  const res = NextResponse.json({ renewed: true, exp: renewed.exp, hardEnd: sessionHardEnd(renewed) }, { headers: NO_STORE });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
