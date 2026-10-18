import assert from "node:assert/strict";
import { test } from "node:test";
import { documentRef, DOCUMENT_KIND_CODE, DOCUMENT_KIND_LABEL, type DocumentKind } from "./documents.ts";
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
