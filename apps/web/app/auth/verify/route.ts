import { NextResponse, type NextRequest } from "next/server";
import { deadLinkLanding, isSameOrigin, maskEmail, sameEmail, type DeadLinkReason } from "@/lib/auth/access";
import { consumeToken, deadTokenSubject, peekToken, type TokenSubject } from "@/lib/auth/magic";
import { sessionCookie } from "@/lib/auth/server";
import { signInSubject } from "@/lib/auth/sign-in";
import { SESSION_COOKIE, verifySession, type Session } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";
import { escapeHtml } from "@/lib/email";
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

/** The brand mark (components/site/logo.tsx's Mark), as plain SVG for a page outside React. */
const MARK_SVG = `<svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
<rect width="64" height="64" rx="16" fill="#1d212b"/>
<path d="M4 46c9 5 21 7.5 33 6.5 9.5-.8 17.5-3.6 23-8l1.6 6.2C55 56 46 59.4 36 60 24 60.7 12 58 4.8 52.6Z" fill="#f2711b"/>
<path d="M56.5 36.5c2.2-.8 4.4-1.8 6.3-3l.9 4.1c-2 1.3-4.3 2.4-6.6 3.2Z" fill="#f2711b" opacity="0.85"/>
<g transform="rotate(-4 32 30)">
<path d="M17.5 12.5h13c11.2 0 18.4 6.3 18.4 16.2S41.7 45 30.5 45h-13Zm9 7.6v17.2h3.8c5.9 0 10-3.2 10-8.6s-4.1-8.6-10-8.6Z" fill="#47698a" transform="translate(2.6 2.6)"/>
<path d="M17.5 12.5h13c11.2 0 18.4 6.3 18.4 16.2S41.7 45 30.5 45h-13Zm9 7.6v17.2h3.8c5.9 0 10-3.2 10-8.6s-4.1-8.6-10-8.6Z" fill="#f8f5ef"/>
</g>
<g stroke="#f8f5ef" stroke-width="1.7" stroke-linecap="round"><path d="M49 47v8M45.6 49l6.8 4M52.4 49l-6.8 4"/></g>
</svg>`;

/**
 * The confirm page: the first screen from every email, so it looks like us
 * (the mark, the brand faces from public/fonts, the site's colours and
 * focus ring), not like a phishing page. No script.
 */
function confirmPage(token: string, subject: TokenSubject, current: Session | null): string {
  const t = escapeHtml(token);
  const who = escapeHtml(maskEmail(subject.email));
  const replacing = current && isSomeoneElse(current, subject) ? escapeHtml(maskEmail(current.email)) : null;
  // Staff links come back to the team sign-in; a customer's "not you" is their own sign-in page.
  const notYou = subject.kind === "staff" ? "/login" : "/portal";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in · ${escapeHtml(BRAND.name)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
<style>
  @font-face{font-family:"Figtree";src:url("/fonts/figtree-variable.woff2") format("woff2");font-weight:300 900;font-display:swap}
  @font-face{font-family:"Caprasimo";src:url("/fonts/caprasimo.woff2") format("woff2");font-weight:400;font-display:swap}
  @font-face{font-family:"Permanent Marker";src:url("/fonts/permanent-marker.woff2") format("woff2");font-weight:400;font-display:swap}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f5ef;color:#1d212b;font-family:"Figtree",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:24px 16px;-webkit-font-smoothing:antialiased}
  main{width:100%;max-width:400px;text-align:center}
  .brand{display:inline-flex;align-items:center;gap:10px;margin:0 0 28px;color:#1d212b;text-decoration:none}
  .word{font-family:"Permanent Marker","Marker Felt",cursive;font-size:19px;line-height:1;transform:rotate(-2deg);white-space:nowrap}
  .word span{color:#a84508}
  .card{background:#fff;border:1px solid #ddd5c4;border-radius:24px;padding:28px 22px}
  h1{font-family:"Caprasimo","Figtree",Georgia,serif;font-weight:400;font-size:26px;line-height:1.15;margin:0 0 10px}
  p{color:#454b58;margin:0 0 20px;line-height:1.5;font-size:16px}
  p strong{color:#1d212b}
  .note{font-size:14px;color:#5d6371;margin:-8px 0 22px}
  .warn{background:#fef3ea;border:1px solid #fcdfc5;border-radius:16px;padding:12px 14px;color:#1d212b;text-align:left}
  button{font:inherit;min-height:48px;width:100%;padding:12px 24px;border:0;border-radius:999px;background:#a84508;color:#fff;font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(20,23,30,.12)}
  button:hover{background:#8f3a06}
  :focus-visible{outline:2px solid #a84508;outline-offset:3px}
  .back{display:inline-flex;align-items:center;min-height:44px;margin-top:18px;padding:0 8px;color:#454b58;font-weight:600;font-size:15px;text-underline-offset:3px}
  .back:hover{color:#1d212b}
</style>
</head>
<body>
<main>
  <a class="brand" href="/" aria-label="${escapeHtml(BRAND.name)}: home">${MARK_SVG}<span class="word" aria-hidden="true">DANG, <span>It's Hot</span></span></a>
  <div class="card">
    <h1>Sign in to ${escapeHtml(BRAND.name)}</h1>
    <p>This link signs you in as <strong>${who}</strong>.</p>
    <p class="note">We hide part of your email address for your security.</p>
    ${
      replacing
        ? `<p class="warn" role="alert">You're signed in as <strong>${replacing}</strong> on this device. Continuing signs you out of that account. If you didn't expect this link, don't continue.</p>`
        : ""
    }
    <form method="post" action="/auth/verify">
      <input type="hidden" name="t" value="${t}">
      <button type="submit">Continue as ${who}</button>
    </form>
  </div>
  <a class="back" href="${notYou}">Not you? Sign in with your own email</a>
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
const sameOrigin = (request: NextRequest) => isSameOrigin(request.headers.get("origin"), request.nextUrl.host);

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

  const signIn = await signInSubject(subject, "magic-link");
  if (!signIn.ok) return redirectTo(request, signIn.landing);
  const cookie = await signedCookie(signIn.session);
  if (!cookie) return redirectTo(request, subject.kind === "staff" ? "/login?error=unavailable" : "/portal?link=unavailable");
  const res = redirectTo(request, signIn.landing);
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  await signIn.record();
  return res;
}
