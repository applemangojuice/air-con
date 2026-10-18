import {
  SLA_COMMITMENTS,
  TAX_CODES,
  cancellationSentence,
  effectiveTaxCode,
  isInServiceArea,
  mergeSettings,
  type ContractType,
  type PilotSettings,
  type TaxCodeId,
} from "@aircon/domain";
import { money } from "@/lib/format";

/**
 * What the public site is allowed to say, derived from the business's
 * settings. Every claim a visitor can read about warranty, F-gas
 * certification, VAT, install length, price validity, payment and coverage
 * comes through here, so a claim appears only once the setting behind it is
 * true (DMCC Sch 20 paras 1–4: no badge, approval or promise we don't hold).
 *
 * Pure and client-safe: the server reads settings once (lib/public-settings.ts)
 * and hands this public subset to pages and the quote funnel. Nothing private
 * (margins, labour rates, discounts, bank details, insurance policy numbers)
 * is in it.
 */

export interface PublicSettings {
  company: {
    legalName: string;
    tradingName: string;
    companyNumber: string | null;
    registeredAddress: string | null;
    /** Where we're established (CCR Sch 2(c)); null until an admin sets it. */
    geographicAddress: string | null;
    /** A real number, or null while settings still hold the placeholder. */
    phone: string | null;
    email: string;
    /** Shown only when VAT registered. */
    vatNumber: string | null;
    complaintsProcess: string | null;
    adr: string | null;
    workmanshipGuarantee: string | null;
  };
  /** The company F-gas certificate, only while it's held and in date. */
  fgas: { body: string; number: string; expiresOn: string | null } | null;
  /** Upper-case outcodes we install in. */
  serviceArea: string[];
  scheduling: {
    installBlockDays: number;
    surveyFeeGbp: number;
    surveyDurationMinutes: number;
    cancellationDays: number;
  };
  quoteValidityDays: number;
  sla: { enabled: boolean };
  warranty: { workmanshipYears: number | null; manufacturerSummary: string | null };
  tax: { vatRegistered: boolean; accountantConfirmed: boolean; code: TaxCodeId };
  payments: {
    depositPct: number;
    depositTiming: PilotSettings["payments"]["depositTiming"];
    balanceDueDays: number;
    methods: PilotSettings["payments"]["methods"];
  };
  finance: { lenderConfigured: boolean };
  legal: { termsVersion: string; termsReviewed: boolean; cancellationReviewed: boolean };
  showPrototypeNav: boolean;
}

const text = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A phone number fit to print, or null. The defaults ship "0800 000 0000" as
 * a stand-in, and printing a number nobody answers is worse than none.
 */
export function realPhone(phone: string | null | undefined): string | null {
  const t = text(phone);
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  if (/0{6,}$/.test(digits)) return null;
  return t;
}

/** The certificate only while it's complete and not past its expiry date. */
function currentCert(
  cert: PilotSettings["company"]["fgasCompanyCert"],
  todayIso: string,
): PublicSettings["fgas"] {
  if (!cert) return null;
  const body = text(cert.body);
  const number = text(cert.number);
  if (!body || !number) return null;
  const expiresOn = text(cert.expiresOn);
  if (expiresOn && /^\d{4}-\d{2}-\d{2}/.test(expiresOn) && expiresOn.slice(0, 10) < todayIso.slice(0, 10)) return null;
  return { body, number, expiresOn };
}

/** The public subset of settings. `todayIso` decides whether a certificate is still current. */
export function toPublicSettings(settings: PilotSettings, todayIso: string): PublicSettings {
  const s = mergeSettings(settings);
  const c = s.company;
  const years = s.warranty.workmanshipYears;
  return {
    company: {
      legalName: text(c.legalName) ?? "Dang It's Hot Ltd",
      tradingName: text(c.tradingName) ?? "Dang, It's Hot",
      companyNumber: text(c.companyNumber),
      registeredAddress: text(c.registeredAddress),
      geographicAddress: text(c.geographicAddress),
      phone: realPhone(c.phone),
      email: text(c.email) ?? "hello@dang.ac",
      vatNumber: s.tax.vatRegistered ? text(c.vatNumber) : null,
      complaintsProcess: text(c.complaintsProcess),
      adr: text(c.adr),
      workmanshipGuarantee: text(c.workmanshipGuarantee),
    },
    fgas: currentCert(c.fgasCompanyCert, todayIso),
    serviceArea: [...new Set(s.serviceArea.outcodes.map((o) => o.toUpperCase().trim()).filter(Boolean))],
    scheduling: {
      installBlockDays: Math.max(1, Math.round(s.scheduling.installBlockDays)),
      surveyFeeGbp: Math.max(0, s.scheduling.surveyFeeGbp),
      surveyDurationMinutes: Math.max(0, Math.round(s.scheduling.surveyDurationMinutes)),
      cancellationDays: Math.max(14, Math.round(s.scheduling.cancellationDays)),
    },
    quoteValidityDays: Math.max(1, Math.round(s.pricing.quoteValidityDays)),
    sla: { enabled: s.sla.enabled === true },
    warranty: {
      workmanshipYears: typeof years === "number" && Number.isFinite(years) && years >= 0 ? years : null,
      manufacturerSummary: text(s.warranty.manufacturerSummary),
    },
    tax: {
      vatRegistered: s.tax.vatRegistered,
      accountantConfirmed: s.tax.accountantConfirmed,
      code: effectiveTaxCode(s),
    },
    payments: {
      depositPct: Math.max(0, Math.min(100, s.payments.depositPct)),
      depositTiming: s.payments.depositTiming,
      balanceDueDays: Math.max(0, Math.round(s.payments.balanceDueDays)),
      methods: s.payments.methods,
    },
    finance: { lenderConfigured: s.finance.lenderConfigured === true },
    legal: {
      termsVersion: text(s.legal.termsVersion) ?? "pilot-draft-1",
      termsReviewed: s.legal.termsReviewed === true,
      cancellationReviewed: s.legal.cancellationReviewed === true,
    },
    showPrototypeNav: s.features.showPrototypeNav === true,
  };
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/** "sw16 2be" → "SW16"; "SW162BE" → "SW16"; "" for nothing usable. */
export function outcodeOf(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  if (!clean) return "";
  if (clean.includes(" ")) return clean.split(/\s+/)[0] ?? "";
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(clean) ? clean.slice(0, -3) : clean;
}

/**
 * Whether we install at this postcode, by the domain's own rule
 * (isInServiceArea) over the configured outcodes. Never true for an empty
 * list: no settings, no coverage claim.
 */
export function coverageFor(serviceArea: string[], postcode: string): { covered: boolean; outcode: string } {
  const outcode = outcodeOf(postcode);
  const covered = outcode !== "" && isInServiceArea(mergeSettings({ serviceArea: { outcodes: serviceArea } }), postcode);
  return { covered, outcode };
}

/** "SW16, SW17 and CR0": a readable list of the outcodes we cover. */
export function listOutcodes(outcodes: string[]): string {
  const sorted = [...outcodes].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** "up to three days" or "one day": the install block from settings, never "a single day" by default. */
export function installDaysPhrase(ps: PublicSettings): string {
  const n = ps.scheduling.installBlockDays;
  return n <= 1 ? "one day" : `up to ${numberWord(n)} days`;
}

/** "Installed over up to three days" / "Installed in one day". */
export function installDurationCopy(ps: PublicSettings): string {
  const n = ps.scheduling.installBlockDays;
  return n <= 1 ? "Installed in one day" : `Installed over up to ${numberWord(n)} days`;
}

/**
 * The warranty line, or null when settings hold no warranty facts (then the
 * site states no years at all). Zero workmanship years is an explicit "none",
 * which we don't advertise.
 */
export function warrantyCopy(ps: PublicSettings): { headline: string; body: string } | null {
  const years = ps.warranty.workmanshipYears;
  const maker = ps.warranty.manufacturerSummary;
  if (years && years > 0) {
    return {
      headline: `${years}-year workmanship guarantee`,
      body: maker
        ? `For our installation work. Equipment: ${maker}`
        : "For our installation work. Equipment warranty terms are in your proposal.",
    };
  }
  if (maker) return { headline: "Manufacturer's warranty", body: maker };
  return null;
}

/** F-gas company certification in plain words, only while it's held and current. */
export function fgasClaim(ps: PublicSettings): string | null {
  if (!ps.fgas) return null;
  return `Refrigerant work is done under our ${ps.fgas.body} F-gas company certificate (no. ${ps.fgas.number}).`;
}

/**
 * VAT in plain words. Nothing specific about 0% unless we're registered and
 * the accountant has confirmed the treatment; not registered means no VAT to
 * add, and the price is the price.
 */
export function vatCopy(ps: PublicSettings): { short: string | null; long: string } {
  if (!ps.tax.vatRegistered) {
    return { short: "No VAT to add", long: "We're not VAT registered, so there's no VAT to add to our prices." };
  }
  if (!ps.tax.accountantConfirmed) {
    return { short: null, long: "The VAT on your installation is set out in your proposal." };
  }
  const code = ps.tax.code;
  if (code === "zero-esm") {
    return {
      short: "0% VAT",
      long: "Heat pump installations in homes are currently zero-rated for VAT (0%), until 31 March 2027. Your proposal confirms the VAT on your job.",
    };
  }
  const rate = TAX_CODES[code]?.ratePct ?? 20;
  return { short: `Includes VAT at ${rate}%`, long: `Our prices include VAT at ${rate}%.` };
}

/** yyyy-mm-dd plus n days, in UTC (dates only, no clocks). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day a price stops being valid, from the day it was given. */
export function validUntil(ps: PublicSettings, createdIso: string): string {
  return addDaysIso(createdIso, ps.quoteValidityDays);
}

/** "Free" only when it genuinely costs nothing (DMCC Sch 20 para 23). */
export function surveyPriceCopy(ps: PublicSettings): string {
  const fee = ps.scheduling.surveyFeeGbp;
  return fee > 0 ? money(Math.round(fee * 100)) : "Free";
}

/** "about 90 minutes", from settings. */
export function surveyDurationCopy(ps: PublicSettings): string | null {
  const m = ps.scheduling.surveyDurationMinutes;
  return m > 0 ? `about ${m} minutes` : null;
}

/** When the money is due, from settings. */
export function paymentCopy(ps: PublicSettings): { deposit: string; balance: string; methods: string } {
  const p = ps.payments;
  const deposit =
    p.depositPct > 0
      ? `A ${p.depositPct}% deposit is due ${p.depositTiming === "on-acceptance" ? "when you accept your proposal" : "before we order your equipment"}.`
      : "No deposit.";
  const balance =
    p.balanceDueDays > 0
      ? `The balance is due within ${p.balanceDueDays} days of handover, once your system is installed, commissioned and explained.`
      : "The balance is due at handover, once your system is installed, commissioned and explained.";
  const names = p.methods.map((m) => (m === "bank-transfer" ? "bank transfer" : "card"));
  const methods = names.length ? `You can pay by ${names.join(" or ")}.` : "We'll agree how you pay in your proposal.";
  return { deposit, balance, methods };
}

/** The cancellation right before a contract exists, per contract type (domain wording). */
export function cancellationSummary(ps: PublicSettings, contractType: ContractType = "supply-and-install"): string {
  return cancellationSentence({ accepted: false, contractType }, ps.scheduling.cancellationDays);
}

/**
 * Service commitments, only when the business has switched them on. The
 * install-side promises carry over from the v1 list; the survey-fee and
 * final-quote ones no longer match the journey, so they're left out.
 */
export function slaCommitments(ps: PublicSettings): { promise: string; remedy: string }[] {
  if (!ps.sla.enabled) return [];
  const keep = new Set(["delivery-on-day", "install-on-day", "install-duration"]);
  return SLA_COMMITMENTS.filter((c) => keep.has(c.id)).map((c) => ({ promise: c.promise, remedy: c.remedy }));
}

/* ------------------------------------------------------------------ */
/* Consent wording (versioned: the stored record names the version)     */
/* ------------------------------------------------------------------ */

export const CONSENT_VERSION = "quote-consent-v1";

export const OPERATIONAL_CONSENT = {
  label: "Save my quote and keep me posted about it",
  hint: "We'll email you about this quote and, if you go ahead, your survey and installation. Add your mobile and we'll text appointment reminders too. No sales calls and no marketing. Needed to save your quote.",
} as const;

export const MARKETING_CONSENT = {
  label: "Send me occasional news and offers by email",
  hint: "Seasonal tips, new areas and offers from us. Unsubscribe from any email, any time.",
} as const;

export const AREA_LAUNCH_VERSION = "area-launch-v1";

export function areaLaunchConsentText(outcode: string): string {
  return `Email me once when you start installing in ${outcode || "my area"}. Nothing else.`;
}

export interface ConsentEntry {
  given: boolean;
  at: string;
  version: string;
  text: string;
  channels: ("email" | "sms")[];
  source: string;
}

/**
 * The consent record stored with a quote (UK GDPR Art 7(1): we must be able
 * to show who agreed to what, when, and in which words). Operational and
 * marketing are separate facts; marketing is never implied.
 */
export function quoteConsentRecord(input: {
  marketing: boolean;
  hasPhone: boolean;
  at: string;
  version?: string;
}): { operational: ConsentEntry; marketing: ConsentEntry } {
  const version = input.version ?? CONSENT_VERSION;
  return {
    operational: {
      given: true,
      at: input.at,
      version,
      text: `${OPERATIONAL_CONSENT.label}. ${OPERATIONAL_CONSENT.hint}`,
      channels: input.hasPhone ? ["email", "sms"] : ["email"],
      source: "quote-funnel",
    },
    marketing: {
      given: input.marketing,
      at: input.at,
      version,
      text: `${MARKETING_CONSENT.label}. ${MARKETING_CONSENT.hint}`,
      channels: input.marketing ? ["email"] : [],
      source: "quote-funnel",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Price confidence (the band, said honestly)                           */
/* ------------------------------------------------------------------ */

export const BAND_COPY = {
  high: {
    label: "High confidence",
    tone: "bg-sage-50 text-sage-800 border-sage-200",
    body: "Your answers and photos give us a clear picture. Your home survey confirms the price.",
  },
  medium: {
    label: "Good estimate",
    tone: "bg-amber-50 text-amber-900 border-amber-200",
    body: "A good estimate from your answers. A few photos would firm it up, and your home survey confirms it.",
  },
  low: {
    label: "Early estimate",
    tone: "bg-amber-50 text-amber-900 border-amber-200",
    body: "An early estimate: a few details are missing. Add them to firm it up; your home survey confirms the price.",
  },
} as const;

/** The one sentence that replaces "price locked / guaranteed" everywhere. */
export const PRICE_PROMISE =
  "Your price, confirmed at your home survey. It only changes if the survey finds something your answers didn't show, and your proposal will say exactly what changed and why, before you agree to anything.";
