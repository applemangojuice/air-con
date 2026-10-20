import { audit } from "@/lib/audit";
import * as customersRepo from "@/lib/repo/customers";
import { claimProjectOnSignIn } from "@/lib/project-service";
import { safeNextPath, staffLanding } from "./access";
import type { TokenSubject } from "./magic";
import { customerSession, staffForToken, staffSession } from "./server";
import type { Session } from "./session";

/**
 * What a spent sign-in token (its link at /auth/verify, or its code: §K45)
 * signs in as, and where they land. One path for both, so a code can never
 * do more or less than the link in the same email.
 *
 * Staff: the live, active staff row (or a first ADMIN_EMAILS sign-in), to
 * their landing page. Customers: their record, any project made under the
 * address joining them now it's proven, to the token's page or their home.
 * `landing` on a failure is where to send someone it couldn't sign in.
 * `record` audits the sign-in: the caller runs it once the cookie is signed.
 */
export type SubjectSignIn = { ok: true; session: Session; landing: string; record: () => Promise<void> } | { ok: false; landing: string };

export async function signInSubject(subject: TokenSubject, via: "magic-link" | "code"): Promise<SubjectSignIn> {
  if (subject.kind === "staff") {
    const staff = await staffForToken(subject);
    if (!staff) return { ok: false, landing: "/login?error=expired" };
    return {
      ok: true,
      session: staffSession(staff),
      landing: staffLanding(staff, subject.next),
      record: () => audit({ actor: staff, action: "auth.sign-in", entity: "staff", entityId: staff.id, detail: { via } }),
    };
  }
  const customer = subject.subjectId ? await customersRepo.get(subject.subjectId) : null;
  if (!customer) return { ok: false, landing: "/portal?link=expired" };
  // The address is proven now: a project made under it that wasn't theirs yet (funnel) joins them.
  await claimProjectOnSignIn(customer, subject.next);
  const projectIds = await customersRepo.projectIdsFor(customer.id);
  const fallback = projectIds.length === 1 ? `/p/${projectIds[0]}` : "/portal";
  return {
    ok: true,
    session: customerSession(customer, projectIds),
    landing: safeNextPath(subject.next, fallback),
    record: () =>
      audit({
        actor: { kind: "customer", id: customer.id, name: customer.name },
        action: "auth.sign-in",
        entity: "customer",
        entityId: customer.id,
        detail: { via },
      }),
  };
}
