import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { acceptanceErrors, customerSafeProposal, proposalDocumentContent, type ProposalRecord } from "@aircon/domain";
import {
  buildAcceptanceRecord,
  canonicalJson,
  cleanName,
  clientIp,
  clipUserAgent,
  proposalDocumentHash,
  sha256Hex,
  withoutAt,
  type AcceptanceForm,
} from "../components/proposal/model.ts";

/* A minimal issued DEMO proposal: one priced option. */
const PROPOSAL: ProposalRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  version: 2,
  status: "issued",
  designId: "d1",
  designVersion: 1,
  options: [
    {
      id: "v-std-option",
      label: "Standard",
      tier: "standard",
      designVariantId: "v-std",
      summary: "DEMO summary",
      highlights: ["Heats and cools"],
      roomCards: [{ roomId: "r1", roomName: "Bedroom", unitName: "DEMO unit", why: "DEMO", highlights: [], mediaIds: ["m1"] }],
      outdoorMediaIds: [],
      priceLines: [{ id: "l1", label: "Bedroom: supply and installation", amountPence: 250_000, kind: "system" }],
      costLines: [{ id: "c1", category: "equipment", label: "DEMO", qty: 1, unit: "each", unitCostPence: 90_000, totalPence: 90_000, verified: false }],
      labour: { crewSize: 2, installerDays: 3, electricianDays: 0.5, techLeadDays: 1 },
      pricing: {
        pricingBasis: "engine",
        listNetPence: 300_000,
        discount: { code: "PILOT15", label: "Pilot discount (15%)", reason: "Early pilot home", amountPence: 50_000 },
        netPence: 250_000,
        taxCode: "outside-scope",
        taxPence: 0,
        totalPence: 250_000,
        costPence: 90_000,
        unpricedCostLines: 0,
        grossMarginPct: 64,
        grossMarginPctBeforeDiscount: 70,
        contributionPence: 160_000,
        belowMinMargin: false,
      },
      installDays: 3,
      pricingInputs: { basis: "engine", discountCode: "PILOT15" },
    },
  ],
  inclusions: ["DEMO inclusion"],
  exclusions: ["DEMO exclusion"],
  assumptions: ["DEMO assumption"],
  warranty: null,
  validUntil: "2099-12-31",
  termsVersion: "pilot-draft-1",
  instantPriceGbp: 3_000,
  marginOverride: { reason: "secret reason", by: "DEMO", at: "2026-10-18T09:00:00.000Z" },
  internalNotes: "secret note",
  issuedAt: "2026-10-18T09:00:00.000Z",
  createdAt: "2026-10-18T08:00:00.000Z",
};

const FORM: AcceptanceForm = {
  optionId: "v-std-option",
  name: "  Alex   Morgan ",
  earlyStartRequested: true,
  acknowledgedCancellationInfo: true,
  acknowledgedLossOfRight: false,
  documentHash: "a".repeat(64),
};

const headers = (h: Record<string, string>) => new Headers(h);

test("canonicalJson: sorted keys at every level, undefined dropped, arrays kept in order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(canonicalJson([undefined, null, "x"]), '[null,null,"x"]');
  assert.equal(canonicalJson("£1,234"), JSON.stringify("£1,234"));
});

test("sha256Hex matches Node's own sha256", async () => {
  const text = canonicalJson({ hello: "world", pence: 250_000 });
  assert.equal(await sha256Hex(text), createHash("sha256").update(text).digest("hex"));
});

test("proposalDocumentHash: of the customer-safe content, stable across views and acceptance, changes with the content", async () => {
  const hash = await proposalDocumentHash(PROPOSAL);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const expected = createHash("sha256").update(canonicalJson(proposalDocumentContent(PROPOSAL))).digest("hex");
  assert.equal(hash, expected);
  // Same content, different bookkeeping: same hash.
  assert.equal(await proposalDocumentHash({ ...PROPOSAL, viewedAt: "2026-10-18T19:00:00.000Z" }), hash);
  assert.equal(await proposalDocumentHash({ ...PROPOSAL, status: "accepted" }), hash);
  // Internal fields aren't part of what the customer saw.
  assert.equal(await proposalDocumentHash({ ...PROPOSAL, internalNotes: "changed", marginOverride: undefined }), hash);
  // What they read is.
  assert.notEqual(await proposalDocumentHash({ ...PROPOSAL, validUntil: "2099-12-30" }), hash);
  assert.notEqual(await proposalDocumentHash({ ...PROPOSAL, inclusions: ["Something else"] }), hash);
  // And the content hashed carries nothing internal.
  const content = JSON.stringify(proposalDocumentContent(PROPOSAL));
  assert.doesNotMatch(content, /secret|PILOT15|300000|90000/);
  assert.deepEqual(customerSafeProposal(PROPOSAL).options[0]!.costLines, []);
});

test("clientIp: the first forwarded hop, else x-real-ip; junk is dropped", () => {
  assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(headers({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIp(headers({ "x-forwarded-for": "<script>" })), undefined);
  assert.equal(clientIp(headers({})), undefined);
});

test("clipUserAgent and cleanName tidy what's stored", () => {
  assert.equal(clipUserAgent("Mozilla/5.0\n(evil)"), "Mozilla/5.0(evil)");
  assert.equal(clipUserAgent("x".repeat(500))!.length, 300);
  assert.equal(clipUserAgent(null), undefined);
  assert.equal(cleanName("  Alex \t  Morgan  "), "Alex Morgan");
});

test("buildAcceptanceRecord: the option's label and total come from the proposal, the rest from the server", () => {
  const record = buildAcceptanceRecord({
    proposal: PROPOSAL,
    form: FORM,
    at: "2026-10-18T20:14:00.000Z",
    email: "alex@example.com",
    ip: "203.0.113.7",
    userAgent: "DEMO browser",
    cancellationNoticeVersion: "ccr-2013-sch3-v2",
    earlyStartWordingVersion: "early-start-v1",
    documentsByEmailConsentAt: "2026-10-17T18:20:00.000Z",
  });
  assert.deepEqual(record, {
    optionId: "v-std-option",
    optionLabel: "Standard",
    totalPence: 250_000,
    name: "Alex Morgan",
    email: "alex@example.com",
    termsVersion: "pilot-draft-1",
    cancellationNoticeVersion: "ccr-2013-sch3-v2",
    acknowledgedCancellationInfo: true,
    earlyStartRequested: true,
    acknowledgedLossOfRight: false,
    at: "2026-10-18T20:14:00.000Z",
    ip: "203.0.113.7",
    userAgent: "DEMO browser",
    documentHash: "a".repeat(64),
    proposalVersion: 2,
    contractType: "supply-and-install",
    earlyStartWordingVersion: "early-start-v1",
    documentsByEmailConsentAt: "2026-10-17T18:20:00.000Z",
  });
  assert.deepEqual(acceptanceErrors(PROPOSAL, withoutAt(record), "2026-10-18"), []);
  assert.equal("at" in withoutAt(record), false);
});

test("buildAcceptanceRecord: an unknown option or missing acknowledgement is caught by acceptanceErrors, not hidden", () => {
  const bad = buildAcceptanceRecord({
    proposal: PROPOSAL,
    form: { ...FORM, optionId: "made-up", acknowledgedCancellationInfo: false, name: "Alex" },
    at: "2026-10-18T20:14:00.000Z",
    cancellationNoticeVersion: "ccr-2013-sch3-v2",
    earlyStartWordingVersion: "early-start-v1",
  });
  assert.equal(bad.totalPence, 0);
  assert.equal(bad.email, undefined);
  const errors = acceptanceErrors(PROPOSAL, withoutAt(bad), "2026-10-18");
  assert.ok(errors.some((e) => /Choose one of the options/.test(e)));
  assert.ok(errors.some((e) => /cancellation rights/.test(e)));
  assert.ok(errors.some((e) => /full name/.test(e)));
  const io = buildAcceptanceRecord({
    proposal: { ...PROPOSAL, contractType: "install-only" },
    form: FORM,
    at: "2026-10-18T20:14:00.000Z",
    cancellationNoticeVersion: "v",
    earlyStartWordingVersion: "v",
  });
  assert.equal(io.contractType, "install-only");
  assert.match(acceptanceErrors({ ...PROPOSAL, contractType: "install-only" }, withoutAt(io), "2026-10-18").join(" "), /lose the right to cancel/);
});

test("proposalNotReady: says what comes first, by where the project really is", async () => {
  const { proposalNotReady } = await import("../components/proposal/copy.ts");
  const at = (status: "not-booked" | "booked" | "in-progress" | "submitted", design: "not-started" | "draft" | "in-review" | "approved" = "not-started", scheduledFor?: string) =>
    proposalNotReady({ survey: { status, mode: "in-person", ...(scheduledFor ? { scheduledFor } : {}) }, design: { status: design } });
  const booked = at("booked", "not-started", "2026-10-22T10:00:00.000Z");
  assert.equal(booked.title, "Your proposal comes after your survey on Thu 22 Oct");
  assert.match(booked.body, /booked for Thu 22 Oct, 10:00/);
  assert.doesNotMatch(booked.body, /We're designing/);
  assert.match(at("not-booked").body, /first step is booking one/);
  assert.match(at("in-progress").title, /under way/);
  assert.match(at("submitted", "draft").body, /We're designing your system from your survey/);
  assert.match(at("submitted", "approved").body, /pricing it now/);
  assert.equal(
    proposalNotReady({ survey: { status: "booked", mode: "video", scheduledFor: "2026-10-22T10:00:00.000Z" }, design: { status: "not-started" } }).title,
    "Your proposal comes after your video survey on Thu 22 Oct",
  );
});
