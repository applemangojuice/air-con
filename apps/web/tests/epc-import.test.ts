import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const {
  CsvRecordStream,
  epcCandidate,
  epcColumnProblems,
  epcRowFromFields,
  mapEpcColumns,
  mergeEpc,
  newestPerHome,
  outcodePrefilter,
  parseOutcodes,
  splitCsvRecord,
  syntheticId,
  tidyPostcode,
} = await import("../lib/epc-import.ts");

const HEADER = "LMK_KEY,ADDRESS1,ADDRESS2,POSTCODE,PROPERTY_TYPE,BUILT_FORM,CURRENT_ENERGY_RATING,TOTAL_FLOOR_AREA,LODGEMENT_DATE,UPRN";

/** Feed text in fixed-size pieces, the way a file arrives, and collect everything. */
function feed(text: string, size: number, wanted?: (raw: string) => boolean) {
  const csv = new CsvRecordStream(wanted);
  let header: string[] | undefined;
  const records: string[][] = [];
  let scanned = 0;
  for (let i = 0; i < text.length; i += size) {
    const out = csv.push(text.slice(i, i + size));
    header ??= out.header;
    records.push(...out.records);
    scanned += out.scanned;
  }
  const last = csv.end();
  header ??= last.header;
  records.push(...last.records);
  scanned += last.scanned;
  return { header, records, scanned };
}

test("CSV streaming: the same records whatever size the pieces arrive in", () => {
  const text = [
    HEADER,
    'a1,"Flat 2, Rose Court",12 Example Road,SW16 1AD,Flat,Mid-Terrace,C,55,2019-03-04,100',
    'a2,"The ""Old"" Forge",Mill Lane,SW17 2FJ,House,Detached,D,120,2015-06-01,',
    'a3,"Line one\nline two",Hill Road,SW16 2BE,House,Semi-Detached,E,90,2012-01-01,300',
  ].join("\r\n");
  const whole = feed(text, text.length);
  for (const size of [1, 2, 3, 7, 64]) assert.deepEqual(feed(text, size), whole, `pieces of ${size}`);
  assert.equal(whole.header?.[3], "POSTCODE");
  assert.equal(whole.scanned, 3);
  assert.deepEqual(whole.records[0].slice(1, 4), ["Flat 2, Rose Court", "12 Example Road", "SW16 1AD"]);
  assert.equal(whole.records[1][1], 'The "Old" Forge');
  assert.equal(whole.records[2][1], "Line one\nline two");
});

test("CSV streaming: the pre-check skips records without splitting them, and still counts them", () => {
  const text = [HEADER, "a,1 A Road,,SW16 1AD,,,,,,", "b,2 B Road,,M1 1AA,,,,,,", "c,3 C Road,,SW17 2FJ,,,,,,"].join("\n");
  const out = feed(text, 5, outcodePrefilter(["SW16"]));
  assert.equal(out.scanned, 3);
  assert.deepEqual(out.records.map((r) => r[0]), ["a"]);
  assert.deepEqual(splitCsvRecord('x,"a,b",'), ["x", "a,b", ""]);
});

test("columns: the register's names, renamed ones, and a file that isn't EPC data", () => {
  const classic = mapEpcColumns(HEADER.split(","));
  assert.equal(classic.postcode, 3);
  assert.equal(classic.address1, 1);
  assert.equal(classic.lodged, 8);
  assert.deepEqual(epcColumnProblems(classic), []);

  const renamed = mapEpcColumns(["﻿address_line_1", "Address Line 2", "postcode", "uprn", "lodgement_datetime", "current-energy-rating"]);
  assert.equal(renamed.address1, 0);
  assert.equal(renamed.address2, 1);
  assert.equal(renamed.postcode, 2);
  assert.equal(renamed.lodged, 4);
  assert.equal(renamed.currentRating, 5);

  assert.deepEqual(epcColumnProblems(mapEpcColumns(["name", "email"])), [
    "no postcode column (looked for POSTCODE)",
    "no address column (looked for ADDRESS1 or ADDRESS)",
  ]);
});

test("outcodes and postcodes are tidied", () => {
  assert.deepEqual(parseOutcodes(" sw16, SW17;sw2  e1 nonsense SW16"), ["SW16", "SW17", "SW2", "E1"]);
  assert.equal(tidyPostcode("sw161ad"), "SW16 1AD");
  assert.equal(tidyPostcode("SW16  1AD"), "SW16 1AD");
});

const map = mapEpcColumns(HEADER.split(","));
const row = (line: string) => epcRowFromFields(splitCsvRecord(line), map);

test("a certificate becomes a property record, the same as the command-line importer", () => {
  const c = epcCandidate(row("a,12 Example Road,,sw16 1ad,House,Mid-Terrace,C,88.5,2019-03-04,10023456"), ["SW16"]);
  assert.ok(c);
  assert.equal(c.intel.id, "10023456");
  assert.deepEqual(c.intel.address, { line1: "12 Example Road", postcode: "SW16 1AD", outcode: "SW16" });
  assert.equal(c.intel.epc?.currentRating, "C");
  assert.equal(c.intel.epc?.totalFloorAreaM2, 88.5);
  assert.equal(c.intel.epc?.lodgedAt, "2019-03-04");
  assert.equal(c.key, "12 EXAMPLE ROAD SW161AD");

  // No UPRN: the importer script's synthetic id, so the two ways of loading agree.
  const noUprn = epcCandidate(row("a,Flat 1,3 Example Road,SW16 1AD,,,,,2010-01-01,"));
  assert.equal(noUprn?.intel.id, syntheticId("Flat 1, 3 Example Road", "SW16 1AD"));

  assert.equal(epcCandidate(row("a,12 Example Road,,M1 1AA,,,,,,"), ["SW16"]), null, "outside the outcodes");
  assert.equal(epcCandidate(row("a,,,SW16 1AD,,,,,,")), null, "no address");
  assert.equal(epcCandidate(row("a,1 Road,,,,,,,,")), null, "no postcode");
});

test("the newest certificate wins, in a batch and against what's already saved", () => {
  const older = epcCandidate(row("a,12 Example Road,,SW16 1AD,House,,E,,2012-05-01,77"))!;
  const newer = epcCandidate(row("b,12 Example Road,,SW16 1AD,House,,C,,2021-08-09,77"))!;
  assert.deepEqual(newestPerHome([newer, older]).map((c) => c.intel.epc?.currentRating), ["C"]);
  assert.deepEqual(newestPerHome([older, newer]).map((c) => c.intel.epc?.currentRating), ["C"]);

  // Year files arrive in any order: an older certificate never replaces a newer saved one.
  assert.equal(mergeEpc(older, { id: "77", intel: newer.intel }), null);

  // A newer certificate replaces the EPC part but keeps what we learned and the record's id.
  const saved = {
    ...older.intel,
    id: "addr-old",
    planning: { loftConversion: true, rearExtension: false, sideExtension: false, garageConversion: false },
    marketing: { leadStatus: "mailed" as const, campaign: "Spring" },
    audit: { difficulty: "easy" as const, confidence: 80, auditedAt: "2026-01-01", auditor: "M" },
  };
  const merged = mergeEpc(newer, { id: "addr-old", intel: saved });
  assert.ok(merged);
  assert.equal(merged.id, "addr-old");
  assert.equal(merged.epc?.currentRating, "C");
  assert.equal(merged.planning.loftConversion, true);
  assert.equal(merged.marketing.campaign, "Spring");
  assert.equal(merged.audit?.auditor, "M");

  assert.equal(mergeEpc(newer, undefined), newer.intel, "a new home is saved as it is");
});

test("the 2026 bulk download's real columns (lower case) map, and its recommendations files don't", () => {
  const header =
    "certificate_number,address1,address2,address3,postcode,posttown,address,constituency,constituency_label,local_authority,local_authority_label,built_form,co2_emiss_curr_per_floor_area,co2_emissions_current,co2_emissions_potential,construction_age_band,current_energy_efficiency,current_energy_rating,energy_consumption_current,energy_consumption_potential,energy_tariff,environment_impact_current,environment_impact_potential,extension_count,fixed_lighting_outlets_count,flat_storey_count,flat_top_storey,floor_description,floor_energy_eff,floor_height,floor_level,glazed_area,glazed_type,heat_loss_corridor,heating_cost_current,heating_cost_potential,hot_water_cost_current,hot_water_cost_potential,hot_water_energy_eff,hot_water_env_eff,hotwater_description,inspection_date,lighting_cost_current,lighting_cost_potential,lighting_description,lighting_energy_eff,lighting_env_eff,lodgement_date,lodgement_datetime,low_energy_lighting,low_energy_fixed_lighting_outlets_count,main_fuel,mainheat_description,mainheat_energy_eff,mainheat_env_eff,mainheatc_energy_eff,mainheatc_env_eff,mainheatcont_description,main_heating_controls,mains_gas_flag,mechanical_ventilation,multi_glaze_proportion,number_habitable_rooms,number_heated_rooms,number_open_fireplaces,photo_supply,potential_energy_efficiency,potential_energy_rating,property_type,report_type,roof_description,roof_energy_eff,roof_env_eff,secondheat_description,sheating_energy_eff,sheating_env_eff,solar_water_heating_flag,tenure,total_floor_area,transaction_type,unheated_corridor_length,walls_description,walls_energy_eff,walls_env_eff,wind_turbine_count,windows_description,windows_energy_eff,windows_env_eff,floor_env_eff,region,country,uprn,uprn_source".split(",");
  const map = mapEpcColumns(header);
  const at = (name: string) => header.indexOf(name);
  assert.deepEqual(epcColumnProblems(map), []);
  assert.equal(map.postcode, at("postcode"));
  assert.equal(map.address1, at("address1"));
  assert.equal(map.address2, at("address2"));
  assert.equal(map.uprn, at("uprn"));
  assert.equal(map.lodged, at("lodgement_date"), "the date, not lodgement_datetime");
  assert.equal(map.currentRating, at("current_energy_rating"));
  assert.equal(map.potentialRating, at("potential_energy_rating"));
  assert.equal(map.floorArea, at("total_floor_area"));
  assert.equal(map.rooms, at("number_habitable_rooms"));
  assert.equal(map.windows, at("windows_description"));
  assert.equal(map.heating, at("mainheat_description"));

  const recommendations = mapEpcColumns(
    "certificate_number,improvement_item,improvement_id,improvement_summary_text,improvement_descr_text,indicative_cost".split(","),
  );
  assert.equal(epcColumnProblems(recommendations).length, 2);
});
