import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { safeNextPath, staffLanding } from "@/lib/auth/access";
import { consumeToken } from "@/lib/auth/magic";
import { customerSession, sessionCookie, staffForToken, staffSession } from "@/lib/auth/server";
import { BRAND } from "@/lib/brand";
import { escapeHtml } from "@/lib/email";
import * as customersRepo from "@/lib/repo/customers";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Magic-link exchange (contract §C).
 *
 * GET /auth/verify?t=… answers with a tiny page that POSTs the token back
 * (automatically, or with one tap without JavaScript). The token is only
 * spent on that POST: mail scanners that pre-open every link in an email
 * fetch the GET and would otherwise burn a single-use link before the
 * customer ever taps it.
 *
 * POST exchanges the token for a session cookie and redirects to the
 * token's `next` path (same-origin only), or the person's home.
 */

export const dynamic = "force-dynamic";

// The global strict-origin-when-cross-origin referrer policy already keeps the
// token (in the query string) from leaking off-site.
const NO_STORE = { "cache-control": "no-store" };

function confirmPage(token: string): string {
  const t = escapeHtml(token);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signing you in · ${escapeHtml(BRAND.name)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f5ef;color:#1d212b;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:16px}
  main{max-width:380px;text-align:center}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#6e7482;margin:0 0 24px;line-height:1.5}
  button{min-height:48px;padding:12px 32px;border:0;border-radius:999px;background:#d55a0a;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  button:hover{background:#a84508}
</style>
</head>
<body>
<main>
  <h1>Signing you in…</h1>
  <p>One moment. If nothing happens, tap the button.</p>
  <form method="post" action="/auth/verify">
    <input type="hidden" name="t" value="${t}">
    <button type="submit">Continue</button>
  </form>
</main>
<script>document.forms[0].submit();</script>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) return NextResponse.redirect(new URL("/login?error=missing", request.url), 303);
  return new NextResponse(confirmPage(token), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

/** Cross-site POSTs could sign someone into the wrong account, so only our own page may post here. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // very old browsers omit it on same-origin form posts
  if (origin === "null") return false; // sandboxed frames and the like
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

/** The signed cookie, or null when signing is impossible (production without SESSION_SECRET). */
async function signedCookie(session: Parameters<typeof sessionCookie>[0]) {
  try {
    return await sessionCookie(session);
  } catch (err) {
    console.error("[auth] could not sign a session:", err);
    return null;
  }
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  if (!getServiceClient()) return redirectTo(request, "/login?error=unavailable");

  const form = await request.formData().catch(() => null);
  const raw = form?.get("t");
  let subject;
  try {
    subject = await consumeToken(typeof raw === "string" ? raw : null);
  } catch (err) {
    console.error("[auth] token exchange failed:", err);
    return redirectTo(request, "/login?error=unavailable");
  }
  if (!subject) return redirectTo(request, "/login?error=expired");

  if (subject.kind === "staff") {
    const staff = await staffForToken(subject);
    if (!staff) return redirectTo(request, "/login?error=expired");
    const cookie = await signedCookie(staffSession(staff));
    if (!cookie) return redirectTo(request, "/login?error=unavailable");
    const res = redirectTo(request, staffLanding(staff, subject.next));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    await audit({ actor: staff, action: "auth.sign-in", entity: "staff", entityId: staff.id, detail: { via: "magic-link" } });
    return res;
  }

  const customer = subject.subjectId ? await customersRepo.get(subject.subjectId) : null;
  if (!customer) return redirectTo(request, "/login?error=expired");
  const projectIds = await customersRepo.projectIdsFor(customer.id);
  const cookie = await signedCookie(customerSession(customer, projectIds));
  if (!cookie) return redirectTo(request, "/login?error=unavailable");
  const fallback = projectIds.length === 1 ? `/p/${projectIds[0]}` : "/portal";
  const res = redirectTo(request, safeNextPath(subject.next, fallback));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  await audit({
    actor: { kind: "customer", id: customer.id, name: customer.name },
    action: "auth.sign-in",
    entity: "customer",
    entityId: customer.id,
    detail: { via: "magic-link" },
  });
  return res;
}
