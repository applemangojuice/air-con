import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSameOrigin, signInCodeLimits } from "@/lib/auth/access";
import { consumeSignInCode } from "@/lib/auth/magic";
import { sessionCookie } from "@/lib/auth/server";
import { signInSubject } from "@/lib/auth/sign-in";
import { codeTargetEmail, type LinkTarget } from "@/lib/portal-server";
import { clientKey, rateLimitIdentity } from "@/lib/rate-limit";
import { sharedRateLimits } from "@/lib/rate-limit-shared";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * A family's sign-in code (§K45):
 *
 *   POST /auth/code  { email, code }       from /portal (the address they typed)
 *                    { projectId, code }   from a project page (the address we hold for it)
 *                    { documentId, code }  from a document page (the same)
 *
 * The code from the newest sign-in email for that address, typed in
 * whichever browser they want to be signed in on. It signs in exactly as
 * that email's link would (lib/auth/sign-in) and spends it. The answer never
 * says why a code didn't work, or whether the address or project exists.
 * Every attempt counts against the address and the network
 * (`signInCodeLimits`, shared by every instance) before anything is checked.
 *
 * JSON from our own pages only: a cross-site form can't send JSON, and the
 * Origin check refuses a cross-site fetch, so nobody can sign a visitor into
 * their own account (login CSRF), as /auth/verify refuses too.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const code = z.string().trim().max(20);
const bodySchema = z.union([
  z.object({ email: z.string().trim().toLowerCase().email().max(254), code }).strict(),
  z.object({ projectId: z.string().uuid(), code }).strict(),
  z.object({ documentId: z.string().uuid(), code }).strict(),
]);

const WRONG_CODE = "That code didn't work. Check it against the newest email we sent (codes last 15 minutes and work once), or tap the link in it instead.";
const TOO_MANY = "Too many tries for now. Tap the link in the email instead, or wait 15 minutes and ask for a new one.";

const answer = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.nextUrl.host)) return answer({ ok: false, error: "Forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return answer({ ok: false, error: "Send JSON" }, 415);
  }
  if (!getServiceClient()) return answer({ ok: false, error: "Signing in isn't available on this demo site." }, 503);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return answer({ ok: false, error: WRONG_CODE }, 400);
  const body = parsed.data;
  const target: LinkTarget =
    "email" in body
      ? { kind: "email", email: body.email }
      : "projectId" in body
        ? { kind: "project", projectId: body.projectId.toLowerCase() }
        : { kind: "document", documentId: body.documentId.toLowerCase() };

  const email = await codeTargetEmail(target);
  // Counted before anything is checked, against the address (or, with none, the target) and the network.
  const who = email ?? `target:${target.kind === "project" ? target.projectId : target.kind === "document" ? target.documentId : target.email}`;
  const limited = await sharedRateLimits(signInCodeLimits(rateLimitIdentity(clientKey(request)), "customer", who));
  if (!limited.ok) {
    return NextResponse.json({ ok: false, error: TOO_MANY }, { status: 429, headers: { ...NO_STORE, "retry-after": String(limited.retryAfterSeconds) } });
  }
  if (!email) return answer({ ok: false, error: WRONG_CODE }, 400);

  let subject;
  try {
    subject = await consumeSignInCode({ email, kind: "customer", code: body.code });
  } catch (err) {
    console.error("[auth] sign-in code check failed:", err);
    return answer({ ok: false, error: "Signing in isn't working right now. Please try the link in the email." }, 503);
  }
  if (!subject) return answer({ ok: false, error: WRONG_CODE }, 400);

  const signIn = await signInSubject(subject, "code");
  if (!signIn.ok) return answer({ ok: false, error: WRONG_CODE }, 400);
  let cookie;
  try {
    cookie = await sessionCookie(signIn.session);
  } catch (err) {
    console.error("[auth] could not sign a session:", err);
    return answer({ ok: false, error: "Signing in isn't working right now. Please try the link in the email." }, 503);
  }
  const res = answer({ ok: true, next: signIn.landing });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  await signIn.record();
  return res;
}
