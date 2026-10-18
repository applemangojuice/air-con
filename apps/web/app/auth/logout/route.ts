import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/access";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

/**
 * Sign out: clear the session cookie and go to `next` (same-origin only),
 * else the sign-in page. POST from a form; GET works too, so a plain link
 * can sign out (the worst a forged one can do is sign someone out).
 */

export const dynamic = "force-dynamic";

function signOut(request: NextRequest, next: string | null) {
  const target = safeNextPath(next, "/login?signedOut=1");
  const res = NextResponse.redirect(new URL(target, request.url), {
    status: 303,
    headers: { "cache-control": "no-store" },
  });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = form?.get("next");
  return signOut(request, typeof next === "string" ? next : request.nextUrl.searchParams.get("next"));
}

export async function GET(request: NextRequest) {
  return signOut(request, request.nextUrl.searchParams.get("next"));
}
