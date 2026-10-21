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
  assert.equal("phone" in blank, false, "the shipped 0800 000 0000 stand-in is never frozen into a document");

  const set = mergeSettings({
    company: {
      phone: " 020 7946 0123 ",
      geographicAddress: " DEMO, 1 Demo Street, London ",
      vatNumber: "GB000000000",
      fgasCompanyCert: { body: "DEMO body", number: "DEMO-FG-1" },
    },
  });
  const c = documentCompany(set);
  assert.equal(c.geographicAddress, "DEMO, 1 Demo Street, London");
  assert.equal(c.phone, "020 7946 0123", "a real number is printed");
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

test("health and safety file: only with more than one contractor; built from the job's records with the tech lead's line", async () => {
  const { healthSafetyFileFor, moreThanOneContractor } = await import("./documents.ts");
  const inHouse = [
    { name: "DEMO Tess", role: "tech-lead", external: false },
    { name: "DEMO Eli", role: "electrician", external: false },
  ];
  const withSub = [...inHouse.slice(0, 1), { name: "DEMO Sparks Ltd", role: "electrician", external: true }];
  assert.equal(moreThanOneContractor(inHouse), false);
  assert.equal(moreThanOneContractor(withSub), true);
  const base = {
    company: "DEMO Installs Ltd",
    runs: [
      { room: "Main bedroom", route: "internal-concealed", routeNote: "in the ceiling void above the landing", asBuiltM: 7.5 },
      { room: "Living room", route: "through-wall", asBuiltM: 3 },
    ],
    cable: { lengthM: 9, note: "under the stairs, out through the back wall" },
    fgas: [{ system: "System", refrigerant: "R32", gwp: 675, factoryChargeKg: 1.1, additionalChargeKg: 0.2, totalKg: 1.3, tco2e: 0.878 }],
    isolators: ["System: 20 A rotary isolator fitted by the outdoor unit."],
    equipment: [
      { room: "Main bedroom", label: "DEMO wall unit", model: "DEMO-FTX25", serial: "1" },
      { room: "Outdoor", label: "DEMO outdoor", model: "DEMO-RX25", serial: "2" },
    ],
  };
  assert.equal(healthSafetyFileFor({ ...base, crew: inHouse }), null, "one contractor: no file");
  const file = healthSafetyFileFor({ ...base, crew: withSub, roles: { principalContractor: "DEMO Installs Ltd" }, techLeadNote: " The bracket's top fixing is a resin anchor. ", techLead: "DEMO Tess" })!;
  assert.deepEqual([file.principalContractor, file.principalDesigner], ["DEMO Installs Ltd", "DEMO Installs Ltd"], "the company by default");
  assert.deepEqual(file.contractors, ["DEMO Installs Ltd (installation and refrigeration)", "DEMO Sparks Ltd (electrician, subcontractor)"]);
  assert.match(file.routes[0]!, /^Hidden: Main bedroom: .*hidden inside the walls, floor or ceiling \(in the ceiling void above the landing\), 7\.5 m as built\.$/);
  assert.doesNotMatch(file.routes[1]!, /^Hidden/);
  assert.match(file.routes[2]!, /supply cable .*under the stairs.*about 9 m/);
  assert.match(file.refrigerant[0]!, /R32 \(mildly flammable, A2L\), 1\.3 kg/);
  assert.match(file.refrigerant[1]!, /Only an F-gas certified engineer/);
  assert.deepEqual(file.isolators, base.isolators);
  assert.match(file.manuals[0]!, /DEMO-FTX25, DEMO-RX25/);
  assert.deepEqual([file.techLeadNote, file.techLead], ["The bracket's top fixing is a resin anchor.", "DEMO Tess"]);
  assert.equal(healthSafetyFileFor({ ...base, crew: withSub })!.techLeadNote, "", "nothing written: the pack says nothing further");
});
