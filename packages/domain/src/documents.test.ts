import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  ELECTRICAL_CERT_DUE_DAYS,
  MAINTENANCE_INFO_DUE_DAYS,
  documentCompany,
  documentCustomer,
  documentRef,
  fgasRecord,
  handoverDeadlines,
  mergeSettings,
  projectShortId,
} from "./index.ts";

test("documentRef: versions of one document, instances of a repeatable kind", () => {
  const short = projectShortId("7f3a91c2-0000-4000-8000-000000000001");
  assert.equal(short, "7F3A91C2");
  assert.equal(documentRef("proposal", short, 2), "DIH-PR-7F3A91C2-v2");
  // Two invoices on one project never share a ref: the instance tells them apart.
  const first = documentRef("invoice", short, 1, "0001");
  const second = documentRef("invoice", short, 1, "0002");
  assert.notEqual(first, second);
  assert.equal(second, "DIH-IN-7F3A91C2-0002-v1");
});

test("handoverDeadlines: certificate 30 days, maintenance information 5 days after completion", () => {
  assert.equal(ELECTRICAL_CERT_DUE_DAYS, 30);
  assert.equal(MAINTENANCE_INFO_DUE_DAYS, 5);
  assert.deepEqual(handoverDeadlines("2026-10-08"), {
    electricalCertDueBy: "2026-11-07",
    maintenanceInfoDueBy: "2026-10-13",
  });
  // A datetime works too, and month ends roll over.
  assert.deepEqual(handoverDeadlines("2026-12-30T16:00:00.000Z"), {
    electricalCertDueBy: "2027-01-29",
    maintenanceInfoDueBy: "2027-01-04",
  });
});

test("fgasRecord: factory plus added charge, tCO2e at R32's GWP", () => {
  const r = fgasRecord({ system: "System", factoryChargeKg: 1.25, additionalChargeG: 300 });
  assert.equal(r.refrigerant, "R32");
  assert.equal(r.gwp, 675);
  assert.equal(r.additionalChargeKg, 0.3);
  assert.equal(r.totalKg, 1.55);
  assert.equal(r.tco2e, 1.046); // 1.55 × 0.675 = 1.04625
  // The research figure: 2.72 kg of R32 is 1.836 t.
  assert.equal(fgasRecord({ system: "S", factoryChargeKg: 2.72, additionalChargeG: 0 }).tco2e, 1.836);
  // Nothing negative reaches a label.
  assert.equal(fgasRecord({ system: "S", factoryChargeKg: -1, additionalChargeG: -5 }).totalKg, 0);
});

test("documentCompany: from settings, blanks left out, VAT number only when registered", () => {
  const blank = documentCompany(DEFAULT_SETTINGS);
  assert.equal(blank.tradingName, DEFAULT_SETTINGS.company.tradingName);
  assert.equal("geographicAddress" in blank, false);
  assert.equal("vatNumber" in blank, false);

  const set = mergeSettings({
    company: {
      geographicAddress: " DEMO, 1 Demo Street, London ",
      vatNumber: "GB000000000",
      fgasCompanyCert: { body: "DEMO body", number: "DEMO-FG-1" },
    },
  });
  const c = documentCompany(set);
  assert.equal(c.geographicAddress, "DEMO, 1 Demo Street, London");
  assert.equal("vatNumber" in c, false, "not VAT registered: no VAT number printed");
  assert.deepEqual(c.fgasCompanyCert, { body: "DEMO body", number: "DEMO-FG-1" });
  const registered = documentCompany(mergeSettings({ company: { vatNumber: "GB000000000" }, tax: { vatRegistered: true } }));
  assert.equal(registered.vatNumber, "GB000000000");
});

test("documentCustomer: name and address from the project", () => {
  assert.deepEqual(
    documentCustomer({ customer: { name: "Sam (DEMO)", addressLine: "1 Demo Street", postcode: "SW16 9ZZ", email: "x@example.com" } }),
    { name: "Sam (DEMO)", addressLine: "1 Demo Street", postcode: "SW16 9ZZ" },
  );
});
