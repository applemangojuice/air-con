import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { deadLinkLanding, maskEmail, safeNextPath, sameEmail, staffLanding, type DeadLinkReason } from "@/lib/auth/access";
import { consumeToken, deadTokenSubject, peekToken, type TokenSubject } from "@/lib/auth/magic";
import { customerSession, sessionCookie, staffForToken, staffSession } from "@/lib/auth/server";
import { SESSION_COOKIE, verifySession, type Session } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";
import { escapeHtml } from "@/lib/email";
import * as customersRepo from "@/lib/repo/customers";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Magic-link exchange (contract §C).
 *
 * GET /auth/verify?t=… answers with a confirm page: "Continue as
 * j***@example.com", one tap, no script. Nothing is spent or signed in on the
 * GET, for two reasons:
 *  * mail scanners pre-open every link in an email, and would otherwise burn
 *    a single-use link before the customer ever taps it;
 *  * anyone holding a valid token (their own customer link, say) could send
 *    someone else to it and silently sign them in as the attacker, replacing
 *    their session (staff included), so whatever they then upload or sign
 *    lands in the attacker's account. The page says whose account it is, and
 *    warns first when it would replace a different signed-in account.
 *
 * POST exchanges the token for a session cookie and redirects to the
 * token's `next` path (same-origin only), or the person's home.
 *
 * A link that can't be used (used already, expired, cut short) never lands a
 * customer on the team sign-in page: someone still signed in goes where the
 * link was going, anyone else to a page that offers a fresh link
 * (deadLinkLanding).
 */

export const dynamic = "force-dynamic";

// The global strict-origin-when-cross-origin referrer policy already keeps the
// token (in the query string) from leaking off-site.
const NO_STORE = { "cache-control": "no-store" };

/** Is the signed-in session someone other than the token's subject? */
function isSomeoneElse(current: Session, subject: TokenSubject): boolean {
  if (current.kind !== subject.kind) return true;
  const currentId = current.kind === "staff" ? current.staffId : current.customerId;
  if (subject.subjectId) return subject.subjectId !== currentId;
  return !sameEmail(current.email, subject.email);
}

function confirmPage(token: string, subject: TokenSubject, current: Session | null): string {
  const t = escapeHtml(token);
  const who = escapeHtml(maskEmail(subject.email));
  const replacing = current && isSomeoneElse(current, subject) ? escapeHtml(maskEmail(current.email)) : null;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in · ${escapeHtml(BRAND.name)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f5ef;color:#1d212b;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:16px}
  main{max-width:380px;text-align:center}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#5b6170;margin:0 0 24px;line-height:1.5}
  .warn{background:#fff4e8;border:1px solid #f2c79b;border-radius:16px;padding:12px 14px;color:#1d212b;text-align:left}
  button{min-height:48px;padding:12px 32px;border:0;border-radius:999px;background:#d55a0a;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  button:hover{background:#a84508}
  a{display:inline-block;margin-top:20px;color:#5b6170}
</style>
</head>
<body>
<main>
  <h1>Sign in to ${escapeHtml(BRAND.name)}</h1>
  <p>This link signs you in as <strong>${who}</strong>.</p>
  ${
    replacing
      ? `<p class="warn" role="alert">You're signed in as <strong>${replacing}</strong> on this device. Continuing signs you out of that account. If you didn't expect this link, don't continue.</p>`
      : ""
  }
  <form method="post" action="/auth/verify">
    <input type="hidden" name="t" value="${t}">
    <button type="submit">Continue as ${who}</button>
  </form>
  <a href="/">Not you? Go back</a>
</main>
</body>
</html>`;
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), { status: 303, headers: NO_STORE });
}

/** The signed-in session on this request, if any. */
const currentSession = (request: NextRequest) => verifySession(request.cookies.get(SESSION_COOKIE)?.value);

/**
 * A link that didn't sign anyone in: still signed in, carry on; otherwise a
 * page that explains (the customer's own, unless it was a staff link).
 */
async function deadLink(request: NextRequest, reason: DeadLinkReason, raw: string | null, known?: TokenSubject | null): Promise<NextResponse> {
  let token: TokenSubject | null = known ?? null;
  if (token === null && raw && reason === "expired") {
    token = await deadTokenSubject(raw).catch(() => null);
  }
  return redirectTo(request, deadLinkLanding({ token, session: await currentSession(request), reason }));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) return deadLink(request, "missing", null);
  if (!getServiceClient()) return deadLink(request, "unavailable", null);
  let subject: TokenSubject | null;
  try {
    subject = await peekToken(token);
  } catch (err) {
    console.error("[auth] token lookup failed:", err);
    return deadLink(request, "unavailable", null);
  }
  if (!subject) return deadLink(request, "expired", token);
  const current = await currentSession(request);
  return new NextResponse(confirmPage(token, subject, current), {
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

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  if (!getServiceClient()) return deadLink(request, "unavailable", null);

  const form = await request.formData().catch(() => null);
  const field = form?.get("t");
  const raw = typeof field === "string" ? field : null;
  let subject;
  try {
    subject = await consumeToken(raw);
  } catch (err) {
    console.error("[auth] token exchange failed:", err);
    return deadLink(request, "unavailable", null);
  }
  // Used a moment ago (a double tap), or since: carry on if still signed in.
  if (!subject) return deadLink(request, raw ? "expired" : "missing", raw);

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
  if (!customer) return redirectTo(request, "/portal?link=expired");
  const projectIds = await customersRepo.projectIdsFor(customer.id);
  const cookie = await signedCookie(customerSession(customer, projectIds));
  if (!cookie) return redirectTo(request, "/portal?link=unavailable");
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
