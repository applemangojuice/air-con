import assert from "node:assert/strict";
import { test } from "node:test";
import { documentRef, projectShortId, DOCUMENT_KIND_CODE, DOCUMENT_KIND_LABEL, type DocumentKind } from "./documents.ts";
import { ISSUE_KIND_LABEL, isOpen, type Issue, type IssueStatus } from "./issues.ts";
import { ANNOTATION_STYLE, PHOTO_TAG_LABEL, PHOTO_TAGS } from "./media.ts";
import { invoiceNumber } from "./money.ts";
import { LEARNING_PROMPTS } from "./pilots.ts";
import { PD_CHECKS } from "./survey-visit.ts";

/**
 * The small foundation-owned pieces of modules whose logic belongs to the
 * feature agents: labels, registries, numbering. Each feature adds its own
 * `<module>.test.ts` for the logic it implements.
 */

test("documentRef: kind code, short id, version", () => {
  assert.equal(documentRef("proposal", "7f3a", 2), "DIH-PR-7F3A-v2");
  assert.equal(documentRef("commissioning-certificate", "ab-12", 1), "DIH-CC-AB12-v1");
  assert.equal(documentRef("invoice", "", 0), "DIH-IN-X-v1");
  const kinds = Object.keys(DOCUMENT_KIND_CODE) as DocumentKind[];
  assert.equal(new Set(kinds.map((k) => DOCUMENT_KIND_CODE[k])).size, kinds.length); // codes are unique
  for (const k of kinds) assert.ok(DOCUMENT_KIND_LABEL[k]);
});

test("documentRef: an instance key keeps several documents of one kind apart", () => {
  const short = projectShortId("7f3a91c2-0b1d-4e5f-8a9b-0c1d2e3f4a5b");
  assert.equal(short, "7F3A91C2");
  // A deposit and a balance invoice on one project, both first versions: different refs.
  const deposit = documentRef("invoice", short, 1, "0001");
  const balance = documentRef("invoice", short, 1, "0002");
  assert.equal(deposit, "DIH-IN-7F3A91C2-0001-v1");
  assert.notEqual(deposit, balance);
  assert.equal(documentRef("invoice", short, 2, "0001"), "DIH-IN-7F3A91C2-0001-v2"); // a revision of the same invoice
  assert.equal(documentRef("receipt", short, 1, "pay_3Ab-x"), "DIH-RC-7F3A91C2-PAY3ABX-v1");
  assert.equal(documentRef("proposal", short, 1, ""), "DIH-PR-7F3A91C2-v1"); // empty instance: none
  assert.equal(projectShortId("--"), "X");
  assert.equal(projectShortId("ab"), "AB");
});

test("invoiceNumber pads to four digits and keeps counting past them", () => {
  assert.equal(invoiceNumber("DIH", 1), "DIH-0001");
  assert.equal(invoiceNumber("dih", 42), "DIH-0042");
  assert.equal(invoiceNumber("DIH", 12345), "DIH-12345");
  assert.equal(invoiceNumber("", 7), "0007");
});

test("isOpen: open, in progress and awaiting customer still need doing", () => {
  const issue = (status: IssueStatus) => ({ status }) as Issue;
  for (const s of ["open", "in-progress", "awaiting-customer"] as IssueStatus[]) assert.ok(isOpen(issue(s)), s);
  for (const s of ["resolved", "closed", "rejected"] as IssueStatus[]) assert.ok(!isOpen(issue(s)), s);
  assert.equal(Object.keys(ISSUE_KIND_LABEL).length, 10);
});

test("every photo tag and annotation tool has a label", () => {
  for (const tag of PHOTO_TAGS) assert.ok(PHOTO_TAG_LABEL[tag], tag);
  for (const key of ["indoor-unit", "outdoor-unit", "core-hole", "pipe", "condensate", "cable", "obstacle", "measure", "note"]) {
    assert.match(ANNOTATION_STYLE[key]?.colour ?? "", /^#[0-9a-f]{6}$/i, key);
  }
});

test("the permitted development checklist covers every Class G check once", () => {
  assert.deepEqual(PD_CHECKS.map((c) => c.id), [
    "heating-use",
    "not-listed",
    "not-conservation-front",
    "volume-ok",
    "unit-count-ok",
    "noise-ok",
    "siting-minimises-impact",
    "article4-checked",
  ]);
  for (const c of PD_CHECKS) assert.ok(c.label.length > 10 && c.help.length > 20, c.id);
  assert.match(PD_CHECKS.find((c) => c.id === "noise-ok")!.label, /42 dB\(A\)/);
  assert.match(PD_CHECKS.find((c) => c.id === "volume-ok")!.label, /1\.5 m³/);
});

test("the eight learning prompts, with stable unique ids", () => {
  assert.equal(LEARNING_PROMPTS.length, 8);
  assert.equal(new Set(LEARNING_PROMPTS.map((p) => p.id)).size, 8);
  assert.ok(LEARNING_PROMPTS.every((p) => p.question.endsWith("?")));
  assert.equal(LEARNING_PROMPTS[0]!.question, "What took longer than expected?");
  assert.equal(LEARNING_PROMPTS[7]!.question, "Which checklist step was unclear?");
});

test("canonicalJson ignores key order; jsonbKeyOrder matches Postgres jsonb (length, then bytes)", async () => {
  const { canonicalJson, jsonbKeyOrder, sameJson } = await import("./json.ts");
  const a = { b: 1, a: { y: [1, { q: 2, p: undefined }], x: null }, c: undefined };
  const b = { a: { x: null, y: [1, { q: 2 }] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.ok(sameJson(a, b));
  assert.ok(!sameJson({ a: 1 }, { a: 2 }));
  assert.equal(canonicalJson([undefined, () => 1]), "[null,null]");
  // Postgres: select '{"label":1,"id":2,"tier":3,"bom":4,"Zeta":5,"alpha":6}'::jsonb
  //   → {"id": 2, "bom": 4, "Zeta": 5, "tier": 3, "alpha": 6, "label": 1}
  assert.deepEqual(Object.keys(jsonbKeyOrder({ label: 1, id: 2, tier: 3, bom: 4, Zeta: 5, alpha: 6 })), ["id", "bom", "Zeta", "tier", "alpha", "label"]);
  // Byte length, not UTF-16 length: "é" is two bytes.
  assert.deepEqual(Object.keys(jsonbKeyOrder({ é: 1, ab: 2, z: 3 })), ["z", "ab", "é"]);
});
