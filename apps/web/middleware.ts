import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * The staff wall (contract §C): /ops and /field need a valid, unexpired,
 * correctly signed staff session, or the request goes to /login and comes
 * back afterwards. Edge-safe: the cookie's HMAC is checked here with Web
 * Crypto, no database.
 *
 * This only answers "is this a signed-in staff member?". What they may do
 * is checked in each page and action against the live staff record
 * (requireStaff), so a role change applies at once. The one coarse rule
 * here: subcontractors never see the ops console, only their field jobs.
 *
 * Customer pages check access in the page itself, not here.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session || session.kind !== "staff") {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    // 302, not Next's default 307: a 307 would replay a POST (a server
    // action on an expired session) at /login, body and all.
    return NextResponse.redirect(login, 302);
  }

  if (session.external && (pathname === "/ops" || pathname.startsWith("/ops/"))) {
    const field = request.nextUrl.clone();
    field.pathname = "/field";
    field.search = "";
    return NextResponse.redirect(field, 302);
  }

  // Pages read this to send a signed-out or under-permissioned visitor back
  // to the right place (lib/auth/server.ts). Always overwritten, never trusted
  // from the client.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-dih-path", `${pathname}${search}`);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ["/ops", "/ops/:path*", "/field", "/field/:path*"],
};
