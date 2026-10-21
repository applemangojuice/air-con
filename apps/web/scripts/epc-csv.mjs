/**
 * The slim EPC CSV that fetch-epc.mjs and bulk-epc.mjs write and
 * import-intel.mjs reads: one row per home, the newest certificate's
 * columns that the property record keeps. Same column names as the EPC
 * register's own files, so the importer reads either.
 */

export const EPC_CSV_COLUMNS = [
  "CERTIFICATE_NUMBER",
  "ADDRESS1",
  "POSTCODE",
  "UPRN",
  "PROPERTY_TYPE",
  "BUILT_FORM",
  "CONSTRUCTION_AGE_BAND",
  "TOTAL_FLOOR_AREA",
  "NUMBER_HABITABLE_ROOMS",
  "WALLS_DESCRIPTION",
  "ROOF_DESCRIPTION",
  "WINDOWS_DESCRIPTION",
  "MAINHEAT_DESCRIPTION",
  "HOTWATER_DESCRIPTION",
  "CURRENT_ENERGY_RATING",
  "POTENTIAL_ENERGY_RATING",
  "LODGEMENT_DATE",
];

const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One home as a CSV line: its address, UPRN and the certificate's profile (PropertyIntel["epc"]). */
export function epcCsvLine({ certificateNumber, line1, postcode, uprn, epc = {}, band, lodgedAt }) {
  return [
    certificateNumber ?? epc.certificateNumber,
    line1,
    postcode,
    uprn,
    epc.propertyType,
    epc.builtForm,
    epc.constructionAgeBand,
    epc.totalFloorAreaM2,
    epc.habitableRooms,
    epc.wallDescription,
    epc.roofDescription,
    epc.glazingDescription,
    epc.mainHeatDescription,
    epc.hotWaterDescription,
    epc.currentRating ?? band,
    epc.potentialRating,
    epc.lodgedAt ?? lodgedAt,
  ]
    .map(cell)
    .join(",");
}

/**
 * Split one CSV record into fields (quotes, doubled quotes, commas inside
 * quotes). The caller joins physical lines until quotes balance.
 */
export function splitCsvRecord(line) {
  const out = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/** An odd number of quote characters means a quoted field carries on onto the next line. */
export const quotesOpen = (text) => (text.match(/"/g)?.length ?? 0) % 2 === 1;
