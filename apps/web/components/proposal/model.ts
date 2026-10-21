import {
  canonicalJson,
  proposalDocumentContent,
  type AcceptanceRecord,
  type ContractType,
  type ProposalRecord,
} from "@aircon/domain";

/**
 * Pure helpers behind the customer's acceptance, shared by the accept API
 * route (lib/proposal-server.ts) and the proposal page, and tested on their
 * own (tests/proposal.test.ts). No I/O: Web Crypto only, which runs the
 * same in Node and the browser.
 */

/** JSON with object keys sorted at every level, so equal content hashes equally (the domain's, re-exported). */
export { canonicalJson };

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The fingerprint of what the customer is accepting: sha256 of the
 * canonical JSON of the customer-safe proposal content (no costs, margins
 * or status fields). The page embeds it; the accept route recomputes it and
 * refuses when they differ, so nobody accepts a version they didn't see,
 * and the stored hash proves which one they did.
 */
export function proposalDocumentHash(p: ProposalRecord): Promise<string> {
  return sha256Hex(canonicalJson(proposalDocumentContent(p)));
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The client's address for the acceptance record: the first hop of
 * x-forwarded-for (Vercel writes the true client there; see
 * lib/rate-limit.ts), else x-real-ip. Anything that doesn't look like an
 * IPv4 or IPv6 address is dropped rather than stored.
 */
export function clientIp(headers: Pick<Headers, "get">): string | undefined {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = first || headers.get("x-real-ip")?.trim() || "";
  const bare = candidate.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  return IP_RE.test(bare) ? bare : undefined;
}

/** The user agent, trimmed to a sane length for storage. */
export function clipUserAgent(ua: string | null | undefined): string | undefined {
  const v = (ua ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return v ? v.slice(0, 300) : undefined;
}

/** Collapse whitespace, trim and cap a typed name. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** What the customer submits from the accept flow. */
export interface AcceptanceForm {
  optionId: string;
  name: string;
  earlyStartRequested: boolean;
  acknowledgedCancellationInfo: boolean;
  acknowledgedLossOfRight: boolean;
  documentHash: string;
}

/**
 * The acceptance record, exactly as it will be stored, from what the
 * customer sent plus what only the server knows (the time, their address,
 * the versions of the wording they were shown). The option's label and
 * total come from the proposal, never from the browser; acceptanceErrors
 * then checks the whole thing. Pure.
 */
export function buildAcceptanceRecord(input: {
  proposal: ProposalRecord;
  form: AcceptanceForm;
  at: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  cancellationNoticeVersion: string;
  earlyStartWordingVersion: string;
  documentsByEmailConsentAt?: string;
  /** The documents-by-email agreement in full, copied into the acceptance. */
  documentsByEmailConsent?: AcceptanceRecord["documentsByEmailConsent"];
  /** sha256 of the frozen terms text they were shown (termsHash). */
  termsHash?: string;
}): AcceptanceRecord {
  const { proposal, form } = input;
  const option = proposal.options.find((o) => o.id === form.optionId);
  const contractType: ContractType = proposal.contractType ?? "supply-and-install";
  const email = input.email?.trim();
  return {
    optionId: form.optionId,
    optionLabel: option?.label ?? "",
    totalPence: option?.pricing.totalPence ?? 0,
    name: cleanName(form.name),
    ...(email ? { email } : {}),
    termsVersion: proposal.termsVersion,
    cancellationNoticeVersion: input.cancellationNoticeVersion,
    acknowledgedCancellationInfo: form.acknowledgedCancellationInfo as true,
    earlyStartRequested: form.earlyStartRequested === true,
    acknowledgedLossOfRight: form.acknowledgedLossOfRight === true,
    at: input.at,
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    documentHash: form.documentHash,
    proposalVersion: proposal.version,
    contractType,
    earlyStartWordingVersion: input.earlyStartWordingVersion,
    ...(input.documentsByEmailConsentAt ? { documentsByEmailConsentAt: input.documentsByEmailConsentAt } : {}),
    ...(input.documentsByEmailConsent ? { documentsByEmailConsent: { ...input.documentsByEmailConsent } } : {}),
    ...(input.termsHash ? { termsHash: input.termsHash } : {}),
  };
}

/** The fingerprint of the terms text a proposal carries (undefined when it carries none). */
export async function termsHash(p: Pick<ProposalRecord, "termsText">): Promise<string | undefined> {
  return p.termsText?.length ? sha256Hex(canonicalJson(p.termsText)) : undefined;
}

/** The record without its timestamp, as acceptanceErrors takes it. */
export function withoutAt(a: AcceptanceRecord): Omit<AcceptanceRecord, "at"> {
  const { at: _at, ...rest } = a;
  return rest;
}
