import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth for internal ops pages. Set OPS_PASSWORD to enable.
 * (Interim measure, replaced by Supabase Auth roles when the portal lands.)
 */
export function middleware(request: NextRequest) {
  const password = process.env.OPS_PASSWORD;
  if (!password) return NextResponse.next(); // pages render a setup notice instead

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ops", charset="UTF-8"' },
  });
}

export const config = {
  matcher: [
    "/ops/quotes/:path*",
    "/ops/projects/:path*",
    "/ops/intel/:path*",
    "/ops/templates/:path*",
    "/ops/schedule/:path*",
    "/ops/procurement/:path*",
    "/ops/finance/:path*",
    "/ops/design/:path*",
    "/ops/install/:path*",
  ],
};
