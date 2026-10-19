"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TAX_CODES, type TaxCodeId } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { dispatch } from "@/lib/project-service";
import { issueDraft, reviseFrom, saveDraft, setOverride, startDraft, type DraftPatch } from "@/lib/proposal-server";

/**
 * The proposal builder's server actions. Each one checks the session and the
 * permission itself (actions are reachable by id from anywhere), then the
 * project access (external staff only see their own jobs), validates its
 * input with zod and hands over to lib/proposal-server.ts.
 */

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; errors?: string[]; blockers?: { message: string; action?: string; severity: string; code: string }[] };

// Named result types: the route-guard test reads each action's body from its first "{", so return types stay brace-free.
type IdResult = ActionResult<{ proposalId: string }>;
type SaveResult = ActionResult<{ revision: number; pricingErrors: Record<string, string> }>;
type IssueResult = ActionResult<{ version: number }>;

const uuid = z.string().uuid();
const text = (max: number) => z.string().max(max);
const pence = z.number().int().min(0).max(100_000_000);

const costLineSchema = z.object({
  id: z.string().regex(/^extra:[a-z0-9-]{1,40}$/),
  category: z.enum(["equipment", "materials", "labour", "subcontract", "access", "delivery", "consumables", "contingency", "overhead"]),
  label: text(120).min(1),
  qty: z.number().min(0).max(10_000),
  unit: text(20),
  unitCostPence: pence.nullable(),
  totalPence: pence.nullable(),
  verified: z.boolean(),
});

const pricingSchema = z.object({
  basis: z.enum(["engine", "cost-plus", "manual"]),
  targetMarginPct: z.number().min(0).max(99).optional(),
  manualNetPence: pence.optional(),
  manualReason: text(500).optional(),
  discountCode: text(40).optional(),
  customDiscountPence: pence.optional(),
  discountReason: text(500).optional(),
  taxCode: z.enum(Object.keys(TAX_CODES) as [TaxCodeId, ...TaxCodeId[]]).optional(),
  costOverrides: z.record(z.string().max(160), z.object({ unitCostPence: pence, note: text(200).optional() })).optional(),
  extras: z.array(costLineSchema).max(20).optional(),
});

const patchSchema = z.object({
  revision: z.number().int().min(0),
  contractType: z.enum(["supply-and-install", "install-only"]),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  increaseReason: text(1000).optional(),
  internalNotes: text(4000).optional(),
  inclusions: z.array(text(400)).max(40),
  exclusions: z.array(text(400)).max(40),
  assumptions: z.array(text(400)).max(40),
  options: z
    .array(
      z.object({
        designVariantId: text(120).min(1),
        label: text(60),
        summary: text(600),
        highlights: z.array(text(160)).max(8),
        roomCards: z
          .array(
            z.object({
              roomId: text(120),
              unitName: text(120),
              why: text(1000),
              highlights: z.array(text(160)).max(8),
              pipeNote: text(600).optional(),
            }),
          )
          .max(12),
        installDays: z.number().int().min(1).max(10),
        labour: z.object({
          crewSize: z.number().int().min(1).max(6),
          installerDays: z.number().min(0).max(20),
          electricianDays: z.number().min(0).max(10),
          techLeadDays: z.number().min(0).max(10),
        }),
        pricingInputs: pricingSchema,
      }),
    )
    .max(4),
});

async function staffFor(projectId: string, perm: "proposal.edit" | "proposal.issue") {
  const staff = await requireStaff(perm);
  if (!uuid.safeParse(projectId).success) return null;
  const access = await requireProjectAccess(projectId, { perm });
  return access?.kind === "staff" ? staff : null;
}

const NOT_FOUND = { ok: false as const, error: "Project not found, or you don't have access to it." };

function done(projectId: string) {
  revalidatePath(`/ops/projects/${projectId}/proposal`);
}

export async function startDraftAction(projectId: string): Promise<IdResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  const result = await startDraft(projectId, staff);
  if (result.ok) done(projectId);
  return result.ok ? { ok: true, proposalId: result.proposalId } : { ok: false, error: result.error };
}

export async function saveDraftAction(projectId: string, proposalId: string, patch: unknown): Promise<SaveResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: "Proposal not found" };
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Something in the form isn't valid${first ? ` (${first.path.join(" › ")}: ${first.message})` : ""}.` };
  }
  try {
    const result = await saveDraft(projectId, proposalId, parsed.data as DraftPatch, staff);
    return result.ok ? { ok: true, revision: result.revision, pricingErrors: result.pricingErrors } : { ok: false, error: result.error };
  } catch (err) {
    console.error("[proposal] save failed:", err);
    return { ok: false, error: "Couldn't save just now. Your changes are still here: try again in a moment." };
  }
}

export async function issueAction(projectId: string, proposalId: string): Promise<IssueResult> {
  const staff = await staffFor(projectId, "proposal.issue");
  if (!staff) return NOT_FOUND;
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: "Proposal not found" };
  try {
    const result = await issueDraft(projectId, proposalId, staff);
    if (result.ok) {
      done(projectId);
      return { ok: true, version: result.version };
    }
    return {
      ok: false,
      error: result.error,
      ...(result.errors ? { errors: result.errors } : {}),
      ...(result.blockers ? { blockers: result.blockers.map((b) => ({ message: b.message, severity: b.severity, code: b.code, ...(b.action ? { action: b.action } : {}) })) } : {}),
    };
  } catch (err) {
    console.error("[proposal] issue failed:", err);
    return { ok: false, error: "Couldn't issue the proposal just now. Nothing was sent: try again in a moment." };
  }
}

export async function reviseAction(projectId: string, proposalId: string): Promise<IdResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: "Proposal not found" };
  const result = await reviseFrom(projectId, proposalId, staff);
  if (result.ok) done(projectId);
  return result.ok ? { ok: true, proposalId: result.proposalId } : { ok: false, error: result.error };
}

export async function overrideAction(projectId: string, proposalId: string, kind: "margin" | "tax", reason: string | null): Promise<ActionResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  if (!uuid.safeParse(proposalId).success || (kind !== "margin" && kind !== "tax")) return { ok: false, error: "Invalid request" };
  const clean = reason === null ? null : z.string().trim().min(5, "Give a reason of a few words.").max(500).safeParse(reason);
  if (clean && !clean.success) return { ok: false, error: clean.error.issues[0]?.message ?? "Give a reason." };
  const result = await setOverride(projectId, proposalId, kind, clean ? clean.data : null, staff);
  if (result.ok) done(projectId);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** The customer told us (in person or by email) they're happy to get documents by email: recorded by staff. */
export async function recordConsentAction(projectId: string, channel: "in-person" | "email", evidence: string): Promise<ActionResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  if (channel !== "in-person" && channel !== "email") return { ok: false, error: "How did the customer agree?" };
  const note = z.string().trim().min(5, channel === "email" ? "Say where their email is (its date and subject), so it can be found again." : "Say how and when they agreed.").max(500).safeParse(evidence);
  if (!note.success) return { ok: false, error: note.error.issues[0]?.message ?? "Say how they agreed." };
  const result = await dispatch(projectId, { type: "documents-consent-recorded", channel, evidence: note.data }, staff);
  if ("error" in result) return { ok: false, error: result.error };
  done(projectId);
  return { ok: true };
}

export async function customerEmailAction(projectId: string, email: string): Promise<ActionResult> {
  const staff = await staffFor(projectId, "proposal.edit");
  if (!staff) return NOT_FOUND;
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(email);
  if (!parsed.success) return { ok: false, error: "That doesn't look like an email address." };
  const result = await dispatch(projectId, { type: "set-customer-contact", email: parsed.data }, staff);
  if ("error" in result) return { ok: false, error: result.error };
  done(projectId);
  return { ok: true };
}
