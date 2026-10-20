/**
 * Pilot settings: the business's configuration in one JSON document.
 *
 * Everything that is a business decision rather than code lives here: tax
 * treatment, margins, labour rates, deposit policy, service area, warranty
 * wording, legal review state. The defaults are deliberately conservative
 * (no VAT claims, no warranty years, terms flagged unreviewed) so nothing
 * customer-facing overstates what's been decided.
 *
 * Stored as one row in the `settings` table and merged over these defaults
 * on read, so a new setting never needs a data migration.
 */

/* ------------------------------------------------------------------ */
/* Tax                                                                 */
/* ------------------------------------------------------------------ */

export type TaxCodeId = "standard-20" | "reduced-5" | "zero-esm" | "outside-scope";

/** Working summaries, not tax advice: the accountant confirms the code in use. */
export const TAX_CODES: Record<TaxCodeId, { label: string; ratePct: number; note: string }> = {
  "standard-20": {
    label: "Standard rate VAT (20%)",
    ratePct: 20,
    note: "The default for VAT-registered work that doesn't qualify for relief, including cooling-only units.",
  },
  "reduced-5": {
    label: "Reduced rate VAT (5%)",
    ratePct: 5,
    note: "Energy-saving materials in homes from 1 April 2027, when the zero rate ends. Accountant to confirm.",
  },
  "zero-esm": {
    label: "Zero-rated energy-saving materials (0%)",
    ratePct: 0,
    note: "Qualifying air-source heat pumps installed in homes, until 31 March 2027. Units used for cooling only don't qualify. Accountant to confirm.",
  },
  "outside-scope": {
    label: "No VAT (not VAT registered)",
    ratePct: 0,
    note: "We aren't VAT registered, so no VAT is charged and none is shown.",
  },
};

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export interface DiscountCode {
  code: string;
  label: string;
  pct?: number;
  amountPence?: number;
  reason: string;
  active: boolean;
}

export interface PilotSettings {
  company: {
    legalName: string;
    tradingName: string;
    companyNumber?: string;
    registeredAddress?: string;
    /**
     * Where we're established, for the pre-contract information (CCR Sch 2(c))
     * and the cancellation instructions. A real street address, not a PO box,
     * and not necessarily the registered office. "" until set: proposals can't
     * be issued without it (schedule2Missing).
     */
    geographicAddress: string;
    phone: string;
    email: string;
    /** How a customer complains and what we do then (CCR Sch 2(k)). "" until set. */
    complaintsProcess: string;
    /**
     * The out-of-court dispute scheme we're bound to use, and how to reach it
     * (CCR Sch 2(x), DMCC s308). Absent when there isn't one.
     */
    adr?: string;
    /** Our workmanship guarantee's conditions and how to claim (CCR Sch 2(q)), in plain words. */
    workmanshipGuarantee?: string;
    /**
     * Our page on an independent review platform (https only). The review
     * request is only ever sent while this is set.
     */
    reviewUrl?: string;
    vatNumber?: string;
    fgasCompanyCert?: { body: string; number: string; expiresOn?: string };
    insurance?: { provider: string; policy: string; expiresOn?: string };
    bank?: { accountName: string; sortCode: string; accountNumber: string };
  };
  tax: { vatRegistered: boolean; defaultTaxCode: TaxCodeId; accountantConfirmed: boolean; rationale: string };
  pricing: {
    minMarginPct: number;
    contingencyPct: number;
    overheadPerJobPence: number;
    quoteValidityDays: number;
    requireEngineerSignoff: boolean;
    labourRates: {
      installerDayPence: number;
      electricianDayPence: number;
      techLeadDayPence: number;
      surveyorHourPence: number;
    };
    premiumUpliftPct: number; // fallback uplift when a premium option is priced off the engine list price
  };
  discounts: DiscountCode[];
  payments: {
    depositPct: number;
    depositTiming: "on-acceptance" | "before-kit-order";
    balanceDueDays: number;
    methods: ("card" | "bank-transfer")[];
    invoicePrefix: string;
    nextInvoiceNumber: number;
  };
  scheduling: {
    installBlockDays: number;
    surveySlotTimes: string[];
    surveyDurationMinutes: number;
    surveyFeeGbp: number;
    cancellationDays: number;
    workingDays: number[] /* 1=Mon … 5=Fri */;
    /**
     * Schedule 2 (j): the time by which we undertake to complete the work,
     * in weeks from acceptance (dates are then agreed inside it). Frozen on
     * each proposal at issue, printed in the proposal, both contract emails
     * and the contract. Without a stated time, CRA s28's 30-day default for
     * delivering goods would apply.
     */
    installWithinWeeks: number;
  };
  serviceArea: { outcodes: string[] };
  sla: { enabled: boolean };
  warranty: { workmanshipYears: number | null; manufacturerSummary: string | null };
  legal: { termsVersion: string; termsReviewed: boolean; cancellationReviewed: boolean };
  comms: { smsSenderId: string; disabledEvents: string[] };
  finance: FinanceSettings;
  features: { showPrototypeNav: boolean };
}

/** How we're allowed to promote someone else's credit (FSMA s21; research §F). */
export type FinanceArrangement = "authorised" | "appointed-rep" | "s21-approved";
export const FINANCE_ARRANGEMENTS: readonly FinanceArrangement[] = ["authorised", "appointed-rep", "s21-approved"];

/**
 * A credit promotion's facts, all or nothing: finance shows nowhere until
 * every one is set (`financeOffered`). The lender or broker providing the
 * credit and their FCA firm reference number; how we may promote it (our own
 * credit-broking permission, as an appointed representative, or a promotion
 * an authorised firm approved under s21); the reference for that (our FRN,
 * the register entry, or the approval reference and date); and the lender's
 * representative example, printed word for word. Nothing is ever worked out
 * by us: no APR, no monthly figure. Legal review required.
 */
export interface FinanceSettings {
  firmName?: string;
  frn?: string;
  arrangement?: FinanceArrangement;
  approvalRef?: string;
  representativeExample?: string;
}

/** A plausible FCA firm reference number: 6 or 7 digits. */
const isFrn = (v: string | undefined): boolean => /^\d{6,7}$/.test((v ?? "").trim());

/** Every credit-promotion fact is on record, so finance may be shown (and only then). */
export function financeOffered(settings: Pick<PilotSettings, "finance">): boolean {
  const f = settings.finance ?? {};
  return (
    Boolean(f.firmName?.trim()) &&
    isFrn(f.frn) &&
    FINANCE_ARRANGEMENTS.includes(f.arrangement as FinanceArrangement) &&
    Boolean(f.approvalRef?.trim()) &&
    (f.representativeExample?.trim().length ?? 0) >= 40
  );
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS: PilotSettings = {
  company: {
    legalName: "Dang It's Hot Ltd",
    tradingName: "Dang, It's Hot",
    // Business decisions, never guessed: proposals stay blocked until set.
    geographicAddress: "",
    phone: "0800 000 0000",
    email: "hello@dang.ac",
    complaintsProcess: "",
  },
  tax: {
    vatRegistered: false,
    defaultTaxCode: "outside-scope",
    accountantConfirmed: false,
    rationale: "Not VAT registered during the pilot, so no VAT is charged.",
  },
  pricing: {
    minMarginPct: 25,
    contingencyPct: 5,
    overheadPerJobPence: 0,
    quoteValidityDays: 30,
    requireEngineerSignoff: true,
    // Placeholders until the pilots tell us the real numbers.
    labourRates: {
      installerDayPence: 22_000,
      electricianDayPence: 25_000,
      techLeadDayPence: 28_000,
      surveyorHourPence: 4_000,
    },
    premiumUpliftPct: 18,
  },
  discounts: [
    { code: "PILOT15", label: "Pilot discount (15%)", pct: 15, reason: "Early pilot home", active: true },
    { code: "PILOT30", label: "Pilot discount (30%)", pct: 30, reason: "Founding pilot home", active: true },
    { code: "PILOTCUSTOM", label: "Pilot discount", amountPence: 0, reason: "Set per job, with a reason", active: true },
  ],
  payments: {
    depositPct: 0,
    depositTiming: "on-acceptance",
    balanceDueDays: 7,
    methods: ["bank-transfer", "card"],
    invoicePrefix: "DIH",
    nextInvoiceNumber: 1,
  },
  scheduling: {
    installBlockDays: 3,
    surveySlotTimes: ["10:00", "13:00", "16:00"],
    surveyDurationMinutes: 90,
    surveyFeeGbp: 0,
    cancellationDays: 14,
    workingDays: [1, 2, 3, 4, 5],
    installWithinWeeks: 8,
  },
  serviceArea: {
    outcodes: [
      "SW2", "SW4", "SW11", "SW12", "SW16", "SW17", "SW18", "SW19",
      "SE19", "SE25", "SE27", "CR0", "CR2", "CR4", "CR7", "CR8", "E3",
    ],
  },
  sla: { enabled: false },
  // No warranty claims anywhere until these are set.
  warranty: { workmanshipYears: null, manufacturerSummary: null },
  legal: { termsVersion: "pilot-draft-2", termsReviewed: false, cancellationReviewed: false },
  comms: { smsSenderId: "DangItsHot", disabledEvents: [] },
  finance: {},
  features: { showPrototypeNav: false },
};

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Stored over default, key by key. Objects recurse, arrays replace whole,
 * primitives must match the default's type (a `null` default accepts a
 * number or string). Keys the defaults leave out (optional company details)
 * pass through as stored.
 */
function mergeValue(def: unknown, stored: unknown): unknown {
  if (stored === undefined) return clone(def);
  if (def === undefined) return clone(stored);
  if (isPlainObject(def)) {
    if (!isPlainObject(stored)) return clone(def);
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(def), ...Object.keys(stored)])) {
      const v = mergeValue(def[key], stored[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  if (Array.isArray(def)) return Array.isArray(stored) ? clone(stored) : clone(def);
  if (def === null) {
    return stored === null || typeof stored === "number" || typeof stored === "string" ? stored : null;
  }
  if (typeof def === "number") return typeof stored === "number" && Number.isFinite(stored) ? stored : def;
  return typeof stored === typeof def ? stored : def;
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

const DEPOSIT_TIMINGS: readonly PilotSettings["payments"]["depositTiming"][] = ["on-acceptance", "before-kit-order"];
const PAYMENT_METHODS: readonly PilotSettings["payments"]["methods"][number][] = ["card", "bank-transfer"];

const isTaxCode = (v: unknown): v is TaxCodeId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(TAX_CODES, v);

/**
 * Keep the members of a list that pass `ok`, once each. A list that had
 * entries but none valid was junk, so it takes the default; an empty list
 * stays empty (that was a choice).
 */
function validList<T>(stored: unknown[], ok: (v: unknown) => v is T, fallback: readonly T[]): T[] {
  const kept = [...new Set(stored.filter(ok))];
  return kept.length > 0 || stored.length === 0 ? kept : [...fallback];
}

/**
 * The type check in mergeValue only knows primitives. Values that must be one
 * of a fixed set (union members, list items code reads without checking) are
 * checked here, so junk can't reach `TAX_CODES[code].ratePct` and the like.
 */
/** The performance window's bounds: past the 14-day cancellation period, inside a year. */
export const INSTALL_WITHIN_WEEKS_MIN = 3;
export const INSTALL_WITHIN_WEEKS_MAX = 52;

function sanitise(s: PilotSettings): PilotSettings {
  const d = DEFAULT_SETTINGS;
  const isStr = (v: unknown): v is string => typeof v === "string";
  if (!isTaxCode(s.tax.defaultTaxCode)) s.tax.defaultTaxCode = d.tax.defaultTaxCode;
  if (!DEPOSIT_TIMINGS.includes(s.payments.depositTiming)) s.payments.depositTiming = d.payments.depositTiming;
  s.payments.methods = validList(
    s.payments.methods,
    (v): v is PilotSettings["payments"]["methods"][number] => PAYMENT_METHODS.includes(v as never),
    d.payments.methods,
  );
  s.scheduling.workingDays = validList(
    s.scheduling.workingDays,
    (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 7,
    d.scheduling.workingDays,
  );
  s.scheduling.surveySlotTimes = validList(s.scheduling.surveySlotTimes, isStr, d.scheduling.surveySlotTimes);
  // Whole weeks, long enough to cover the cancellation period and the kit, never open-ended.
  const weeks = s.scheduling.installWithinWeeks;
  if (!Number.isInteger(weeks) || weeks < INSTALL_WITHIN_WEEKS_MIN || weeks > INSTALL_WITHIN_WEEKS_MAX) s.scheduling.installWithinWeeks = d.scheduling.installWithinWeeks;
  s.serviceArea.outcodes = validList(s.serviceArea.outcodes, isStr, d.serviceArea.outcodes);
  s.comms.disabledEvents = validList(s.comms.disabledEvents, isStr, d.comms.disabledEvents);
  s.discounts = validList(
    s.discounts,
    (v): v is DiscountCode => isPlainObject(v) && typeof v.code === "string" && v.code.length > 0,
    d.discounts,
  );
  // A null default accepts a number or a string in mergeValue; each of these takes one.
  if (s.warranty.workmanshipYears !== null && typeof s.warranty.workmanshipYears !== "number") s.warranty.workmanshipYears = null;
  if (s.warranty.manufacturerSummary !== null && typeof s.warranty.manufacturerSummary !== "string") {
    s.warranty.manufacturerSummary = null;
  }
  // Optional text the defaults leave out passes through mergeValue unchecked:
  // keep a real, non-blank string or nothing (a stored null means "not set").
  const company = s.company as unknown as Record<string, unknown>;
  for (const key of ["adr", "workmanshipGuarantee", "reviewUrl"] as const) {
    const v = company[key];
    if (typeof v !== "string" || !v.trim()) delete company[key];
  }
  // Finance: known keys only, real strings only, a listed arrangement (an old `lenderConfigured` switch is dropped).
  const f = (isPlainObject(s.finance) ? s.finance : {}) as Record<string, unknown>;
  const finance: FinanceSettings = {};
  for (const key of ["firmName", "frn", "approvalRef", "representativeExample"] as const) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) finance[key] = v.trim();
  }
  if (FINANCE_ARRANGEMENTS.includes(f.arrangement as FinanceArrangement)) finance.arrangement = f.arrangement as FinanceArrangement;
  s.finance = finance;
  // The review link goes in a customer email button: http(s) only.
  if (s.company.reviewUrl !== undefined && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.company.reviewUrl.trim())) {
    delete s.company.reviewUrl;
  }
  return s;
}

/** Deep-merge stored JSON over the defaults, tolerant of missing or junk keys. */
export function mergeSettings(stored: unknown): PilotSettings {
  return sanitise(mergeValue(DEFAULT_SETTINGS, isPlainObject(stored) ? stored : {}) as PilotSettings);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** "sw16 2be" → "SW16"; "SW16" → "SW16"; "SW162BE" → "SW16". */
function outcode(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  const spaced = clean.split(/\s+/)[0] ?? "";
  if (clean.includes(" ")) return spaced;
  // No space: strip a trailing inward code (digit + two letters) when present.
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(clean) ? clean.slice(0, -3) : clean;
}

/** Postcode or bare outcode against the configured list. An empty list covers nowhere. */
export function isInServiceArea(settings: PilotSettings, postcode: string): boolean {
  const oc = outcode(postcode);
  if (!oc) return false;
  return settings.serviceArea.outcodes.some((o) => o.toUpperCase().trim() === oc);
}

/**
 * The code proposals default to: outside-scope until VAT registered. A
 * registered business can't charge outside-scope on a home install, so a
 * leftover outside-scope default falls back to the standard rate.
 */
export function effectiveTaxCode(settings: PilotSettings): TaxCodeId {
  if (!settings.tax.vatRegistered) return "outside-scope";
  return settings.tax.defaultTaxCode === "outside-scope" ? "standard-20" : settings.tax.defaultTaxCode;
}

/**
 * What the pre-contract information (CCR 2013 Schedule 2) still lacks from
 * settings, in plain words, or [] when it's all there. Proposal issue is
 * blocked until it's empty: the issue email is the durable medium that
 * carries this information, so it can't go out with gaps.
 *
 * A guarantee statement may honestly say "none offered", but it has to say
 * something: no workmanship years (0 counts as an explicit "none") and no
 * manufacturer summary is missing. The ADR line is "where applicable", so
 * it's never required here.
 */
/**
 * Is this phone number unusable as a contact number: blank, the shipped
 * stand-in ("0800 000 0000"), or not a plausible UK number (10 to 13
 * digits)? Printing a number nobody answers is worse than printing none.
 */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return true;
  return /0{6,}$/.test(digits);
}

export function schedule2Missing(settings: PilotSettings): string[] {
  const c = settings.company;
  const blank = (v: string | null | undefined) => !v || !v.trim();
  const missing: string[] = [];
  if (blank(c.tradingName)) missing.push("trading name");
  if (blank(c.geographicAddress)) missing.push("geographic address");
  if (blank(c.phone) || isPlaceholderPhone(c.phone)) missing.push("phone");
  if (blank(c.email)) missing.push("email");
  if (blank(c.complaintsProcess)) missing.push("complaints process");
  if (settings.warranty.workmanshipYears === null && blank(settings.warranty.manufacturerSummary)) {
    missing.push("guarantee statement (or explicit 'none')");
  }
  return missing;
}
