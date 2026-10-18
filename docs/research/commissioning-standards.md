# Commissioning standards and app defaults: R32 split and multi-split

Researched 18 October 2026 for the Dang, It's Hot pilot installs. Machine-readable copy:
[`data/commissioning-defaults.json`](data/commissioning-defaults.json).

## Read this first: what this research could and could not reach

This pass ran with almost no live web access:

- **Web search:** the workflow's shared search budget (200 calls) was already used up by the
  equipment, price and materials research before this task started. Every search returned
  "budget used up".
- **WebFetch:** every host failed DNS (`getaddrinfo ENOTFOUND`), including daikin.eu,
  daikin.co.uk, daikin.es, manualslib.com, mitsubishielectric.com.au, oceanairuk.com and
  en.wikipedia.org.
- **Shell egress:** the proxy refused daikin.eu, library.mitsubishielectric.co.uk,
  mcscertified.com, refcom.org.uk, legislation.gov.uk and gov.uk. Only GitHub and package
  registries were reachable.

So every figure below comes from one of four places:

1. Search-engine extracts that other research agents in this workflow had already gathered
   earlier today (Daikin, Mitsubishi Electric and Panasonic model research, the price research,
   and the orchestrator's own planning, VAT, F-gas and Part P searches). These are cited by the
   URL of the page that was extracted. Nobody opened those pages directly.
2. Data already committed in this repo (`docs/research/data/*.json`), which carries its own
   source URLs.
3. Computation: CoolProp 8.0.0 for R32 properties, or plain arithmetic on sourced inputs.
4. My own recall of the named manuals and standards. **This is not a source.** A recalled
   number never goes in a `value` field. It appears only as a clearly labelled *candidate*,
   with the document where the tech lead should confirm it.

The biggest gap is the core manufacturer test parameters: nitrogen test pressure, vacuum
target, decay test and flare torque. They could not be retrieved, so their `value` is `null`.
To close the gap, re-run this task with web access: send a follow-up message, or raise
`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`. Or have the tech lead read the specific
installation manual for each pilot model, which is what F-gas practice and the manufacturer
warranties expect anyway.

### Evidence grades

| Grade | Meaning |
|---|---|
| **M** | Manufacturer installation manual, installer guide or official product page, read through a search-engine extract (not opened directly). |
| **O** | Legislation or a scheme body's own document (legislation.gov.uk, MCS), read through a search-engine extract. |
| **S** | Secondary: retailer, installer blog, trade press, council leaflet or job advert. |
| **C** | Computed here, either from CoolProp 8.0.0 or by arithmetic on sourced inputs. |
| **U** | Unverified: recall or general trade practice, with no source retrieved. Numeric U items are `null` in the JSON and appear only as `candidate`. |

## Recommended app defaults

"Per model" means the app should read the value from the outdoor-unit catalogue record. The
global default is only a fallback, and the tech lead must confirm it before Pilot 1.

| Field (key) | Value | Unit | Grade | Source | Unverified candidate (confirm first) |
|---|---|---|---|---|---|
| **Pressure test** | | | | | |
| Test gas (`pressure.testGas`) | Oxygen-free (dry) nitrogen | – | U | none retrieved | – |
| Strength/tightness test pressure (`pressure.testPressureBarG`) | `null`, per model | bar g | – | not retrieved | Daikin RAC installer guides: at least 2 bar, 30 bar recommended to find small leaks (recall, moderate confidence). Always below the nameplate PS. |
| Maximum test pressure (`pressure.maxTestPressureBarG`) | Nameplate PS (high side) of the outdoor unit | bar g | U | none retrieved | – |
| Hold duration (`pressure.holdMinutes`) | `null` | min | – | not retrieved | No manufacturer figure recalled with confidence. The repo placeholder is 15. |
| Acceptable drop (`pressure.maxDropBar`) | `null` | bar | – | not retrieved | 0 after allowing for temperature change (practice). |
| **Evacuation** | | | | | |
| Vacuum target (`vacuum.targetMicrons`) | `null` | micron | – | not retrieved | 500 micron (66.7 Pa) as a company standard (common practice). RAC manuals instead say "compound gauge at −0.1 MPa / −76 cmHg" (recall). |
| Decay hold (`vacuum.decayHoldMinutes`) | `null` | min | – | not retrieved | Daikin RAC guides: pump isolated, 4–5 min hold (recall, moderate). |
| Maximum rise in decay test (`vacuum.decayMaxRiseMicrons`) | `null` | micron | – | not retrieved | No figure recalled with confidence. |
| Micron gauge required (`vacuum.micronGaugeRequired`) | Yes | – | C | arithmetic: −0.1 MPa g ≈ 9,900 micron absolute (see §2) | – |
| **Flare torque** (per model; see §3) | | | | | |
| 6.35 mm, 1/4" (`torque.flare_6_35`) | `null` | N·m | – | not retrieved | Daikin 15–17; Mitsubishi 13.7–17.7; Panasonic 18 |
| 9.52 mm, 3/8" (`torque.flare_9_52`) | `null` | N·m | – | not retrieved | Daikin 33–39; Mitsubishi 34.3–41.2; Panasonic 42 |
| 12.7 mm, 1/2" (`torque.flare_12_7`) | `null` | N·m | – | not retrieved | Daikin 50–60; Mitsubishi 49.0–56.4; Panasonic 55 |
| 15.88 mm, 5/8" (`torque.flare_15_88`) | `null` | N·m | – | not retrieved | Daikin 62–75; Mitsubishi 73.5–78.4; Panasonic 65 |
| **Commissioning readings** | | | | | |
| Cooling air split (`commissioning.coolingSplitK`) | `null`: record only, no pass/fail | K | – | no manufacturer acceptance figure retrieved | The repo placeholder of 8–16 °C has no source. |
| Heating air split (`commissioning.heatingSplitK`) | `null`: record only | K | – | not retrieved | – |
| Readings per indoor unit (`commissioning.recordFields`) | Mode, set point, top fan speed, return and supply air °C, split, outdoor ambient, indoor RH, run current against the nameplate, error codes, app pairing | – | U | trade practice | – |
| Standing pressure check (`commissioning.standingPressureBarG`) | Equals R32 saturation pressure at ambient, e.g. 13.7 bar g at 20 °C | bar g | C | CoolProp 8.0.0 | – |
| Charge method (`commissioning.chargeMethod`) | By weight, per the outdoor-unit formula. Superheat and subcooling are recorded only. | – | U | none retrieved | – |
| **Refrigerant charge and F-gas** | | | | | |
| Additional charge rule (`charge.formula`) | max(0, one-way liquid length − chargeless length) × g/m, from the outdoor-unit record | g | M | Daikin RXF20-42F installer guide; Mitsubishi and Panasonic sources in §5 | – |
| Daikin RXF-F, RXM-A9, RXA-A8 (`charge.daikinSplit.chargelessM`, `.gPerM`) | 10 m chargeless, then 20 g/m | m, g/m | M | [Daikin RXF20-42F installer reference guide](https://www.daikin.es/content/dam/document-library/Installer-reference-guide/ac/split/rxf-f/RXF20-42F_Installer%20reference%20guide_4PES769827-15G_Spanish.pdf) | – |
| Daikin 3/4/5MXM multi (`charge.daikinMulti.chargelessM`, `.gPerM`) | 30 m total chargeless, then 20 g/m | m, g/m | M | [Daikin MXM installation manual 3PEN818734-2](https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/multisplit/2mxm-a8/2MXM68A8.3MXM-A8.4MXM-A8.5MXM-A8_Installation%20manual_3PEN818734-2_English.pdf) | – |
| Mitsubishi MUZ-AP, LN, HR25–35 (`charge.mitsubishiMSeries.chargelessM`, `.gPerM`) | 7 m chargeless, then 20 g/m | m, g/m | M (provisional) | [MUZ-AP service manual OBH789](http://www.mitsubishitech.co.uk/Data/M-Series/MSZ/2019/MUZ-AP-VG/MUZ-AP25-50VG_SM_OBH789.pdf) | – |
| Panasonic CU-Z/TZ25–35CKE (`charge.panasonicCKE_25_35.chargelessM`, `.gPerM`) | 7.5 m chargeless, then 10 g/m | m, g/m | M | [Panasonic KIT-Z25-CKE](https://www.aircon.panasonic.eu/GB_en/model/kit-z25-cke-cs-z25ckew-cu-z25cke/) | – |
| R32 GWP (`fgas.r32Gwp`) | 675 | – | M | Daikin installer guide extract; Panasonic page (2.72 kg = 1.836 t) | – |
| CO2e factor (`fgas.tco2ePerKgR32`) | 0.675 | tCO2e/kg | C | 675 / 1000 | – |
| F-gas label (`fgas.labelRequired`) | Yes: the label inside the outdoor unit records the total charge (factory plus added) in kg and tCO2e | – | M | Daikin installer guide extract (§5) | – |
| Leak-check threshold (`fgas.leakCheckThresholdTco2e`) | `null` | tCO2e | – | not retrieved | 5 tCO2e, which is 7.41 kg of R32 (recall of GB-retained Reg. 517/2014 Art. 4). Every pilot system is ≤ about 2.9 t (§5). |
| Company certificate (`fgas.companyCertRequired`) | Yes | – | S | [HF Group, REFCOM](https://hf-group.co.uk/accreditations/refcom-f-gas-certification/); [Trade2Base](https://www.trade2base.com/blog/fgas-certification-uk) | – |
| Engineer category (`fgas.engineerCategory`) | Category I (the trade's expectation) | – | S | [DWP Find a Job advert](https://findajob.dwp.gov.uk/details/16822375) | Whether Category II (under 3 kg) is enough is unverified. |
| GB single-split restriction (`fgas.singleSplitRestriction`) | Single splits with under 3 kg of F-gas at GWP ≥ 750 banned from the GB market since 1 January 2025 | – | S | [Refindustry](https://refindustry.com/news/great-britain-updates-guidance-on-2025-split-ac-f-gas-ban/) | – |
| **Condensate** | | | | | |
| Minimum drain fall (`condensate.minFallMmPerM`) | `null` | mm/m | – | not retrieved | 1/100 (10 mm/m) is often stated in ducted and cassette manuals (recall). The repo placeholder of 20 mm/m has no source. |
| Drain test (`condensate.drainTest`) | Water into the drain pan, free discharge at the termination, no leaks, filmed | – | U | none retrieved | – |
| Pump test (`condensate.pumpTest`) | Pump starts and discharges; the high-level switch stops the unit or raises an alarm | – | U | none retrieved | – |
| Defrost water (`condensate.defrostDrainage`) | Heating-mode defrost water goes to a drain or gravel, not onto a path, step or neighbour's land; an ice-path check is required | – | U | none retrieved | – |
| **Electrical** | | | | | |
| Part P (`electrical.partPNotifiable`) | Yes, for a new circuit | – | S | [IET Part P page](https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/); council leaflets (§7) | – |
| Certificate (`electrical.certificate`) | BS 7671 Electrical Installation Certificate (design, installation and test) with a schedule of test results | – | S | council leaflets (§7) | – |
| Signatory (`electrical.signatory`) | Electrician registered with a Part P competent-person scheme (e.g. NICEIC, NAPIT, ECA); otherwise Building Control or a registered third party | – | S | council leaflets (§7) | – |
| Insulation resistance (`electrical.insulationResistanceMinMOhm`) | `null` | MΩ | – | not retrieved | ≥ 1 MΩ at 500 V DC (BS 7671 Table 64, recall) |
| RCD trip at IΔn (`electrical.rcdTripMaxMs1x`) | `null` | ms | – | not retrieved | ≤ 300 ms (recall) |
| RCD trip at 5 × IΔn (`electrical.rcdTripMaxMs5x`) | `null` | ms | – | not retrieved | ≤ 40 ms for 30 mA additional protection (recall) |
| Earth continuity (`electrical.earthContinuity`) | Record R1+R2 and Zs against the maximum Zs for the protective device | Ω | U | none retrieved | The repo's "≤ 1 Ω" limit has no source. |
| Breaker or fuse rating (`electrical.breakerA`) | Per model: Panasonic 16 A (2.5–5 kW), 20 A (7.1 kW, 3Z68), 25 A (4Z80); Mitsubishi 10 A (AP/HR 25–35) | A | M/S | `panasonic.json`, `mitsubishi.json` | – |
| **Noise and planning** | | | | | |
| Permitted development noise limit (`noise.pdLimitDbA`) | 42 | dB(A) | O | [MCS 020 consultation response](https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf) | – |
| Noise standard (`noise.standard`) | MCS 020(a) (Class G now cites it; "or equivalent standards" removed) | – | O | [SI 2025/560](https://www.legislation.gov.uk/uksi/2025/560) | – |
| Calculation input (`noise.inputMetric`) | A-weighted sound power level (LWA) of the outdoor unit, not sound pressure | – | S | [Payaca guide](https://payaca.com/uk/blog/heat-pump-permitted-development-mcs-020) | – |
| Assessment position (`noise.assessmentPosition`) | Nearest habitable room of the neighbouring property | – | S | [Payaca guide](https://payaca.com/uk/blog/heat-pump-permitted-development-mcs-020) | 1 m from the centre of that window or door (recall) |
| Noise at commissioning (`noise.commissioningRecord`) | As-built recheck of the calculation inputs. Any measured sound level is a QA note, not PD compliance. | – | U | see §9 | – |
| Not solely cooling (`planning.notSolelyCooling`) | Yes (Class G condition G.3(aa)) | – | O | [SI 2025/560](https://www.legislation.gov.uk/uksi/2025/560) | – |
| Maximum outdoor unit volume (`planning.maxUnitVolumeM3`) | 1.5 for a dwellinghouse (0.6 for flats) | m³ | O | [SI 2025/560](https://www.legislation.gov.uk/uksi/2025/560) | – |
| 1 m boundary rule (`planning.oneMetreBoundaryRuleRemoved`) | Yes, removed from 29 May 2025 | – | S | [Planning Jungle](https://planningjungle.com/2025/05/18/important-new-legislation-amendments-to-other-parts-of-the-gpdo-29-05-2025/) | – |
| **Handover records** | | | | | |
| Daikin warranty registration (`warranty.daikinRegisterWithinDays`) | 90 days from commissioning (Stand By Me) | days | S | [Daikin UK policy, July 2025 (third-party copy)](https://discoveryhomesltd.uk/wp-content/uploads/2026/02/Daikin-UK-Residential-End-User-Warranty-Policy_July-2025_Final.pdf) | – |
| Mitsubishi warranty registration (`warranty.mitsubishiRegisterWithinMonths`) | `null` | months | – | air-to-air terms not found | 3 months (this is the Lossnay rule, not confirmed for splits) |
| Panasonic warranty registration (`warranty.panasonicRegistration`) | Register on PRO Club (time limit not found) | – | S | `panasonic.json` warranty note | – |

## How these defaults compare with `INSTALL_TARGETS` in `packages/domain/src/install.ts`

I did not edit any code. This is for whoever wires the defaults in.

| Current placeholder | Assessment |
|---|---|
| `pressureTestBar: 38` (minimum) | Unsourced. It is above the Daikin "30 bar recommended" candidate, and a fixed minimum can push the tester towards the nameplate PS. Make it per model, enforce a **maximum** equal to PS, and have the tech lead set the minimum. |
| `pressureHoldMinutes: 15` | Unsourced. Keep it as a company setting until it is confirmed. |
| `vacuumMicrons: 500`, `vacuumHoldRiseMicrons: 300` | A plausible company standard, stricter than the RAC manuals' compound-gauge check, but unsourced. Label it "company standard", not "manufacturer". |
| `tempSplitMinC: 8`, max 16 | Unsourced. Record the split. Don't fail a job on it until the fleet has a baseline per model. |
| `drainFallMinMmPerM: 20` | Unsourced and twice the 1/100 candidate. Confirm it from the indoor-unit manual. |
| Torque default `{ min: 33, max: 42 }` (gas line) | Fits only 9.52 mm gas lines, and only if the recalled tables are right. A 12.7 mm gas line (5 kW units) needs a different window, so take torque per pipe size. |
| "Terminal torque 1.2–2.8 N·m", "Earth continuity ≤ 1 Ω" | Unsourced. Terminal torque depends on the device; earth continuity is judged by R1+R2 and Zs, not a flat 1 Ω. |
| "Noise at the boundary, unit running ≤ 42 dB(A)" | Wrong test. The 42 dB(A) PD limit is a calculated level at the neighbour's assessment position under MCS 020(a), not a boundary measurement (§9). |
| "Distance to nearest neighbouring window, min 1 m" | The 2025 Order removed the old 1 m-from-boundary rule (§9). Keep the distance as an MCS 020 input, not a pass/fail test. |

---

## 1. Nitrogen strength and tightness test

**Retrieved:** nothing numeric. No manufacturer test pressure, hold time or allowed drop came
back in any gathered extract, and BS EN 378-2 and REFCOM guidance could not be reached.

**What the app should do:**

- Use oxygen-free nitrogen, applied through a regulator with a relief valve. This is grade U
  practice. The materials research already lists an "OFN nitrogen regulator (high outlet
  range, with relief)" in `docs/research/data/materials.json`.
- Treat the **nameplate maximum allowable pressure (PS)** of the outdoor unit as a hard
  ceiling. The engineer photographs the nameplate and the app compares readings against it.
  BS EN 378-2 ties test pressures to PS (U: I could not confirm the factors this session).
- Take the test pressure and hold time per model from the installation manual. Readings:
  pressure applied, pressure at the end of the hold, ambient temperature at start and end (a
  big temperature swing changes pressure without a leak), and a gauge photo at both points.
- **Candidate (U, moderate confidence):** Daikin's R32 split installer reference guides say
  to pressurise with nitrogen to at least 200 kPa (2 bar), recommend 3,000 kPa (30 bar) to find
  small leaks, then check joints with bubble solution. Confirm in the
  [RXM installer reference guide](https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/ac/split/arxm-a/ARXM25A.ARXM35A9.ARXM-A8.RXM(20.42)A.RXM(25.35)A9.RXM-A8.%20RXP-N8_Installer%20reference%20guide_4P769827-4C_English.pdf)
  or the
  [ARXM25-35A / RXM20-42A installation manual](https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/split/arxm-a/ARXM25-35A.RXM20-42A_Installation%20manual_3PEN645642-7N_English.pdf).
  No Mitsubishi or Panasonic split figure is recalled with enough confidence to list.

## 2. Evacuation and decay test

**Retrieved:** nothing numeric from manufacturers.

**Computed unit conversions (C)**, assuming a standard atmosphere of 101.325 kPa (1 micron =
1 mTorr = 0.1333 Pa):

| Reading | Absolute pressure | Microns |
|---|---|---|
| 250 micron | 33.3 Pa (0.33 mbar) | 250 |
| 500 micron | 66.7 Pa (0.67 mbar) | 500 |
| 1,000 micron | 133.3 Pa (1.33 mbar) | 1,000 |
| 1,500 micron | 200 Pa (2.0 mbar) | 1,500 |
| 5 Torr | 666.6 Pa | 5,000 |
| −0.1 MPa gauge (−100 kPa g) | 1.33 kPa | about 9,900 |
| −100.7 kPa gauge | 0.63 kPa | about 4,700 |

**Why this matters for the app:** a compound gauge reading of "−0.1 MPa" or "−76 cmHg"
can still mean about 10,000 micron absolute, and real atmospheric pressure varies by a few kPa.
A compound gauge cannot prove a deep vacuum or a decay test. The app should require a
**digital micron gauge reading** (the materials list already includes one) and a photo of it.

**Candidates (U):**

- *Target:* 500 micron as a company standard. This matches the repo placeholder and is common
  trade practice, but it is not sourced.
- *Daikin RAC guides* (recall, moderate): evacuate until the manifold reads −0.1 MPa (−1 bar),
  leave 4–5 minutes, and if the pressure rises there is moisture or a leak. They specify a pump
  able to reach −100.7 kPa (5 Torr). The 5 Torr figure is a pump requirement, not a target.
- *Mitsubishi and Panasonic RAC manuals* (recall, low to moderate): evacuate to −0.101 MPa /
  −76 cmHg for at least 10–15 minutes, then isolate and watch the gauge for 1–5 minutes. Too
  uncertain to list per brand.
- *Maximum rise:* no figure is known well enough to list. Record the start reading, the reading
  after the hold, the hold time and the pump-isolated photo. Flag anything above the tech
  lead's limit.

## 3. Flare nut torque

**Retrieved:** nothing. The only torque in the repo is the unsourced placeholder in
`install.ts`.

**Candidates (U).** These are recalled from the manufacturers' installation manuals. Confidence
is high for the Daikin and Mitsubishi tables and moderate for Panasonic. Confirm each against
the model's own manual before use:

| Pipe OD | Daikin R32 split (RXM/RXF manuals) | Mitsubishi Electric M Series (MSZ/MUZ) | Panasonic RAC (CU-Z/TZ) |
|---|---|---|---|
| 6.35 mm (1/4") | 15–17 N·m | 13.7–17.7 N·m (140–180 kgf·cm) | 18 N·m |
| 9.52 mm (3/8") | 33–39 N·m | 34.3–41.2 N·m (350–420 kgf·cm) | 42 N·m |
| 12.7 mm (1/2") | 50–60 N·m | 49.0–56.4 N·m (500–575 kgf·cm) | 55 N·m |
| 15.88 mm (5/8") | 62–75 N·m | 73.5–78.4 N·m (750–800 kgf·cm) | 65 N·m |

Where to confirm:

- Daikin: [ARXM25-35A / RXM20-42A installation manual](https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/split/arxm-a/ARXM25-35A.RXM20-42A_Installation%20manual_3PEN645642-7N_English.pdf),
  [RXF50F installation manual](https://www.daikin.es/content/dam/document-library/installation-manuals/ac/split/rxf-f/RXF50F_Installation%20manual_3PEN748643-17H_English.pdf),
  [MXM multi installation manual 3PEN818734-2](https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/multisplit/2mxm-a8/2MXM68A8.3MXM-A8.4MXM-A8.5MXM-A8_Installation%20manual_3PEN818734-2_English.pdf).
- Mitsubishi: the indoor or outdoor installation manual in the
  [Mitsubishi Electric UK library](https://library.mitsubishielectric.co.uk/pdf/download_full/3405)
  (a service manual located by search, not opened).
- Panasonic: the installation instructions on each model page, for example
  [KIT-Z25-CKE](https://www.aircon.panasonic.eu/GB_en/model/kit-z25-cke-cs-z25ckew-cu-z25cke/).

Panasonic gives single values, not ranges. If a window is needed, the app should treat it as
"value as stated, wrench calibrated" rather than invent a tolerance. Flare torque applies to
every flare: indoor and outdoor ends, liquid and gas. On multi-splits every port is
separate, and adapters or reducers on ports add joints. A 12.7 mm gas line (typical on 5 kW
indoor units) needs the 12.7 mm window, not the 9.52 mm one.

## 4. Commissioning measurements

**Retrieved:** no manufacturer acceptance figure for the supply-to-return air split in either
mode. Panasonic gives outdoor sound pressure "at 1 m in front and 1 m at the rear" (M, see
`panasonic.json`), which matters for noise (§9), not for temperatures.

**Recommended record per indoor unit** (U, practice; record only, no pass/fail until the
fleet has data):

- Mode, set point, fan speed (highest), and whether the unit was in test or forced operation.
- Return air temperature and supply air temperature, giving the split in K. Use the same probe
  for both, measured at the grille after at least 10–15 minutes of steady running (U).
- Outdoor ambient dry-bulb. Indoor RH if the meter has it, because the cooling split depends
  heavily on humidity.
- Run current at the outdoor unit with a clamp meter, compared against the nameplate.
- Any error codes, and the controller and app pairing.

**Per system:**

- **Standing (static) pressure before start-up:** this should equal the R32 saturation
  pressure at ambient. It is a free sanity check that the gauge reads true and the right gas
  is in the system. CoolProp 8.0.0 (C):

| Ambient °C | 0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 |
|---|---|---|---|---|---|---|---|---|
| R32 saturation, bar abs | 8.13 | 9.51 | 11.07 | 12.81 | 14.75 | 16.90 | 19.28 | 21.90 |
| R32 saturation, bar g | 7.12 | 8.50 | 10.06 | 11.79 | 13.73 | 15.88 | 18.26 | 20.89 |

  At −10 °C it is 4.81 bar g, at 40 °C 23.77 bar g and at 50 °C 30.40 bar g. Source:
  [CoolProp](http://www.coolprop.org/), via [PyPI CoolProp 8.0.0](https://pypi.org/project/CoolProp/).

- **Running pressures, superheat and subcooling:** for inverter RAC splits with an electronic
  expansion valve, the charge is set **by weight** from the manufacturer's formula (§5), not
  by superheat (U). Superheat and subcooling are worth recording as a diagnostic when gauges
  are connected, but they should not be a pass/fail field. On most RAC outdoor units the only
  service port is on the gas stop valve: low pressure in cooling, high pressure in heating
  (U). Each connection of hoses to a small R32 system loses some charge, so record whether
  gauges were reconnected after the charge was released.

## 5. Refrigerant charge, labelling and F-gas records

**Additional charge (M; read through search extracts, see the repo JSON for each model).**
The formula is the same everywhere:
`additional g = max(0, one-way liquid line length − chargeless length) × g/m`. The inputs
differ by model:

| Family | Chargeless length | Rate | Source |
|---|---|---|---|
| Daikin RXF20-42F, RXM25/35A9, RXM50A, RXA-A8 | 10 m | 20 g/m (0.020 kg/m, rounded to 0.01 kg) | [RXF20-42F installer reference guide](https://www.daikin.es/content/dam/document-library/Installer-reference-guide/ac/split/rxf-f/RXF20-42F_Installer%20reference%20guide_4PES769827-15G_Spanish.pdf); `daikin.json` |
| Daikin older RXF-A/RXF-B (some models) | 10 m | 35 g/m | Daikin RXF-A/B installer guides via the same extract, so check the manual for each model |
| Daikin 3/4/5MXM-A8/A9 multi | 30 m (total) | 20 g/m | [MXM installation manual 3PEN818734-2](https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/multisplit/2mxm-a8/2MXM68A8.3MXM-A8.4MXM-A8.5MXM-A8_Installation%20manual_3PEN818734-2_English.pdf); `daikin.json` |
| Daikin 2MXM50A8 | 10 m or 20 m (sources conflict) | 20 g/m | `daikin.json` |
| Mitsubishi MUZ-AP, MUZ-LN, MUZ-HR25/35 | 7 m | 20 g/m | [MUZ-AP service manual OBH789](http://www.mitsubishitech.co.uk/Data/M-Series/MSZ/2019/MUZ-AP-VG/MUZ-AP25-50VG_SM_OBH789.pdf); `mitsubishi.json` (provisional) |
| Mitsubishi MXZ-2F42 multi | pre-charged for 30 m | not found | `mitsubishi.json` |
| Panasonic CU-Z/TZ 25–35 CKE | 7.5 m | 10 g/m | [KIT-Z25-CKE page](https://www.aircon.panasonic.eu/GB_en/model/kit-z25-cke-cs-z25ckew-cu-z25cke/) |
| Panasonic CU-Z50CKE / CU-TZ50CKE | 7.5 m / 10 m | 15 g/m | `panasonic.json` |
| Panasonic CU-Z/TZ71CKE | 10 m | 25 g/m | `panasonic.json` |
| Panasonic CU-2Z50 / 3Z68 / 4Z80 CBE | 20 / 30 / 45 m | 15 / 20 / 20 g/m | [CU-4Z80CBE page](https://www.aircon.panasonic.eu/GB_en/model/cu-4z80cbe/); `panasonic.json` |

The app should compute the additional charge from the measured one-way liquid length on the
as-built record (not the design length), show the formula, and record the weight actually
added from the scale.

**Labelling (M).** The Daikin R32 split installer guide extract says the total charge is the
nameplate factory charge plus the additional charge, and that the fluorinated-gas label
inside the outdoor unit must record the charge in kg and tonnes CO2 equivalent. The
app should capture: factory charge, additional charge, total charge, total tCO2e (= kg ×
0.675), and a photo of the completed label.

**CO2 equivalent (C).** R32 GWP is 675. Daikin quotes 0.95 kg as 0.65 tCO2e, and Panasonic
quotes 2.72 kg as 1.836 tCO2e for the CU-4Z80CBE, which confirms the 675 factor. Using repo
data, the largest pilot-relevant systems come to:

- Panasonic CU-4Z80CBE: 2.72 kg plus (70 − 45) m × 20 g/m = 3.22 kg, which is 2.17 tCO2e.
- Daikin 5MXM90A at its 75 m maximum: 3.3 kg (installer guide; a table gives 2.4 kg) plus
  (75 − 30) m × 20 g/m = 4.2 kg, which is 2.84 tCO2e.

**Leak checks and logs (U).** My recollection of the GB-retained F-gas Regulation (EU
517/2014 as retained, Articles 4 and 6) is that mandatory periodic leak checks, and the
equipment records that go with them, apply from 5 tCO2e (10 tCO2e if hermetically sealed).
For R32 that is 7.41 kg. If so, none of the systems above needs a statutory leak-check
schedule or log. I could not verify this, or any 2025/2026 GB amendments, this session.
Confirm on [legislation.gov.uk](https://www.legislation.gov.uk/eur/2014/517/contents) and the
Environment Agency/Defra F-gas guidance. Whatever the threshold, keep the commissioning record
anyway. Manufacturer warranty registration needs it (Daikin: within 90 days of commissioning,
S), and it is the evidence for a GB rule that restricts selling pre-charged split equipment to
end users without proof of certified installation (U; the price research also mentions this
as background).

**Certification.**

- *Company (S):* a company certificate is needed to install split systems. HF Group describes
  REFCOM as the UK's leading register of F-gas-competent companies and says it is a criminal
  offence for an uncertified company to work on F-gas systems
  ([HF Group](https://hf-group.co.uk/accreditations/refcom-f-gas-certification/)).
  [Trade2Base](https://www.trade2base.com/blog/fgas-certification-uk) cites the UK F-Gas
  Regulations 2015 and the Environment Agency as enforcer. Other GB company certification
  bodies (Quidos and BESCA are the ones I recall) are **U**, so confirm the current list of
  approved bodies on gov.uk.
- *Engineer (S):* UK AC-engineer job adverts list F-Gas Category 1 as essential
  ([DWP Find a Job](https://findajob.dwp.gov.uk/details/16822375)). My recollection that
  Category II covers installation of systems under 3 kg (under 6 kg hermetically sealed) is U.
  The app should require Category I unless the tech lead has confirmed otherwise.
- *Restriction (S):* single splits with under 3 kg of F-gas at GWP ≥ 750 have been banned from
  the GB market since 1 January 2025. Existing systems may keep running
  ([Refindustry](https://refindustry.com/news/great-britain-updates-guidance-on-2025-split-ac-f-gas-ban/)).
  R32 (GWP 675) is not affected.

## 6. Condensate and defrost water

**Retrieved:** nothing numeric. The only figures in the extracts are drain connection sizes:
16 mm (Daikin FTXM-A data book) and 18 mm (Daikin FTXF/FTXA), from `daikin.json` and the Daikin
research extracts. The materials list uses 16 mm ID drain hose.

**Recommended checks (U):**

- **Fall:** a continuous downward fall with no traps, sags or uphill sections, and an air
  break at the termination. *Candidate:* 1/100 (10 mm/m), which ducted and cassette manuals
  commonly state (recall). Wall units usually just say "slope downwards". The repo's 20 mm/m
  placeholder is unsourced. Confirm the figure from each indoor-unit manual and record the
  measured fall, plus a photo with a level.
- **Drain test:** pour water into the indoor drain pan (not just the hose end) and confirm it
  reaches the termination quickly with no leaks at joints or the wall sleeve. Film it.
- **Pump test (where fitted):** the pump starts on water, discharges at the termination, and
  the high-level safety switch is wired to stop the indoor unit or raise an alarm. Test it by
  overfilling. Record the pump model and where its alarm is wired.
- **Outdoor defrost water (heating mode):** in heating the outdoor coil defrosts and sheds
  water. Fit the drain socket where the manual allows (some manuals advise against it where it
  could freeze, U). Run or locate the water to a gully, gravel or soakaway, never onto a path,
  step, drive or neighbour's land. Raise the unit clear of standing water and snow. The pilot
  build plan already puts "drainage and ice-path check" into survey and commissioning, so
  record the route with a photo.

## 7. Electrical: Part P, certificate and tests

**Part P (S):** council guidance says work that adds a new circuit to a dwelling is
notifiable. It can be done by an installer registered with a Part P competent-person scheme,
who self-certifies, or notified to Building Control through a building regulations
application. Some councils say unregistered installers need a registered third party to sign
the work off. Building Control can accept a certificate from an electrician registered with a
body such as NICEIC, ECA or NAPIT, who tests the work and issues a "design, installation and
test certificate under BS 7671". Sources:
[IET: Part P England and Wales](https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/),
[Carlisle leaflet](https://www.carlisle.gov.uk/Portals/0/Documents/Residents/Building%20Control/PLAN_Part_P_Leaflet.pdf),
[Bolton guidance note](https://www.bolton.gov.uk/downloads/file/6360/electrical-safety-guidance-note),
[Lancaster guidance note](https://www.lancaster.gov.uk/assets/attach/737/Guidance-Note-Electrical-Safety.pdf).
The council leaflets date from about 2005 to 2023, so check them against the current Approved
Document P.

**Certificate:** for a new circuit, a BS 7671 **Electrical Installation Certificate (EIC)**
with a schedule of inspections and test results (S, as above). On the EIC, the designer,
the installer and the inspector/tester each sign; one person may sign all three if they did
all three (U). The competent-person scheme also notifies Building Control, and the customer
then receives a compliance certificate (U). The app should store the EIC PDF, the scheme
notification reference and the electrician's scheme registration number, and keep the job
open until all three are in.

**Tests to record (all U; the figures are recall of BS 7671 and Guidance Note 3, so confirm
against the current edition):**

| Test | Record | Candidate limit |
|---|---|---|
| Continuity of protective conductors | R1+R2 (Ω) | No flat limit. Check Zs below. |
| Continuity of ring final conductors | n/a for a radial AC circuit | – |
| Insulation resistance | MΩ at test voltage (500 V DC for 230 V circuits). Disconnect the unit's electronics if the manual says so. | ≥ 1 MΩ (BS 7671 Table 64) |
| Polarity | pass/fail | – |
| Earth fault loop impedance Zs | Ω | ≤ the maximum Zs for the protective device in BS 7671 tables |
| Prospective fault current | kA | ≤ the device's breaking capacity |
| RCD operation | ms at 1 × IΔn, and at 5 × IΔn where used for additional protection | ≤ 300 ms at IΔn; ≤ 40 ms at 5 × IΔn (30 mA) |
| Functional checks | isolator by the outdoor unit; correct breaker rating | – |

**Device rating:** take the protective device from the outdoor-unit record, not a global
default. The repo data gives Panasonic recommended fuses of 16 A (2.5–5 kW), 20 A (7.1 kW and
3Z68) and 25 A (4Z80, with 4.0 mm² cable), and Mitsubishi breaker capacity of 10 A for AP/HR
25–35 (provisional). See `panasonic.json` and `mitsubishi.json`.

## 8. Labour durations and day rates

**Retrieved:** no sourced installation durations and no sourced UK day rates for AC engineers
or electricians. The only labour-related figures in the gathered extracts are retail
"installed" prices. These are **customer prices**, not labour costs (all S, read through
search extracts):

| Item | Price | Source |
|---|---|---|
| Installation labour, Daikin Sensira 3.5 kW single split | from £385 | [Basildon ACR](https://www.basildonacr.co.uk/product/daikin-sensira-air-conditioning-ftxf35d-rxf35d-3-5kw-12000btu-wall-mounted-wifi-optional/) |
| Supply and install, Daikin FTXF35F/RXF35F, London | from £910 (conflicts with an £850 equipment-only price on the same site) | [Micro-Climate](https://micro-climate.co.uk/daikin-sensira-ftxf35f-rxf35f-3-5kw) |
| Supplied and fitted, typical 2.5–3.5 kW room | £1,500–£1,900 | [Air Con Adviser](https://airconadviser.co.uk/products/wall-mounted-split-systems/daikin-sensira-ftxf) |
| Costco UK fixed-price installed packages, members | £1,849.99 (2.5 kW); £1,899.99 (3.5 kW) | [Air Con Adviser](https://airconadviser.co.uk/products/wall-mounted-split-systems/daikin-sensira-ftxf) |
| Supply and install, Daikin FTXM35R + RXM35R9 | £2,549.99 (regular £2,699.99), "VAT-free for domestic customers" | [Rimy](https://rimy.co.uk/products/supply-installation-of-daikin-prefera-series-ftxm35r-rxm35r9-3-5-kw-wall-mounted-for-home-or-office-upto-25m-br-br-vat-free-for-domestic-customers) |

**Planning assumptions (U, low confidence; not sourced):**

- Single split, back-to-back, first floor, two-person crew: about one working day including
  pressure test, evacuation and commissioning. The electrician's new circuit is extra unless
  one of the crew is a Part P registered electrician.
- Multi-split with 2–3 rooms: about 2–3 working days for two people, depending on pipe runs,
  trunking and making good.
- The repo already defaults the install block to **3 days** and uses placeholder day rates of
  **installer £220, electrician £250, tech lead £280** (`docs/pilot-architecture.md`, "These are
  placeholders"). Nothing found this session confirms or refutes them. Keep them as editable
  settings, and replace them with each pilot's actual hours, which the runsheet timestamps
  already capture.

## 9. Noise: MCS 020 / MCS 020(a) and the 42 dB(A) limit

**Retrieved (O/S):**

- MCS 020 contains a calculation methodology "designed to allow installers to establish clearly
  whether an air source heat pump installation is compliant with the Permitted Development
  noise limit of 42 dB(A)"
  ([MCS 020 consultation response, Nov 2024](https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf), O).
- The calculation uses the unit's **sound power level**, not its sound pressure level, and the
  limit applies at the **nearest habitable room of the neighbouring property**
  ([Payaca guide](https://payaca.com/uk/blog/heat-pump-permitted-development-mcs-020), S).
  One page cited a 37 dB limit, which conflicts with the other sources and looks wrong or out
  of date.
- The GPDO Amendment Order 2025 (SI 2025/560, in force 29 May 2025) amends Class G of Part 14:
  the MCS reference now points to **MCS 020(a)** with "or equivalent standards" removed; a new
  condition G.3(aa) requires that the heat pump is **not used solely for cooling**; the volume
  limit for a dwellinghouse rose from 0.6 to **1.5 m³** (0.6 m³ for flats); a detached house can
  have up to two units. Several sources say the 1 m-from-boundary rule was removed
  ([SI 2025/560](https://www.legislation.gov.uk/uksi/2025/560), O via extract;
  [Planning Jungle](https://planningjungle.com/2025/05/18/important-new-legislation-amendments-to-other-parts-of-the-gpdo-29-05-2025/), S).
  Installer blogs claim a further change on 28 May 2026 (MCS 020(a) becoming the only accepted
  standard), but no primary source was found.
- Whether air-to-air units sit within Class G is asserted by one secondary source and was not
  confirmed in the legislative text. That is a design and survey question, not a commissioning
  one.

**Method summary (U: recall of MCS 020 (2019) and the general MCS 020(a) approach; confirm
every step and table value in the current MCS 020(a) before relying on it):**

1. Take the outdoor unit's A-weighted **sound power level** (LWA) from the manufacturer, for the
   operating mode the standard specifies.
2. Pick the **directivity factor Q** from the number of reflecting surfaces within about 1 m:
   Q2 (one, e.g. on the ground), Q4 (two, e.g. on a wall), Q8 (three, e.g. in a corner).
3. Measure the distance from the unit to the **assessment position**: 1 m from the centre of the
   nearest habitable-room window or door of the neighbouring dwelling.
4. Read the dB reduction for that distance and Q from the standard's table, and subtract it
   from LWA to get the sound pressure level at the assessment position.
5. Apply a barrier correction if a solid barrier blocks the line of sight (MCS 020 (2019):
   −5 dB if the unit is partly visible, −10 dB if fully hidden).
6. Combine with an assumed background level (40 dB(A) in MCS 020 (2019)) by logarithmic addition.
7. The result must be ≤ **42 dB(A)** at every assessment position for permitted development.
   Otherwise the job needs planning permission.

What changed in MCS 020(a), for example the treatment of background noise and which sound
power figure to use, could not be checked this session.

**What to record at commissioning:**

- The design-stage MCS 020(a) calculation (inputs and result), linked to the job.
- An **as-built recheck**: installed model and serial; the LWA used matches that model; the
  as-built distance to each assessment position, measured with a tape or laser and
  photographed; the reflecting surfaces (Q) and any barrier. Recalculate if anything moved.
  This replaces the current "noise at the boundary ≤ 42 dB(A)" field, because PD compliance
  rests on the calculation, not on a measurement.
- *Optional QA measurement (U):* LAeq at 1 m in front of the outdoor unit at maximum
  operation, with a Class 2 sound level meter, plus the ambient level with the unit off.
  Panasonic quotes outdoor sound pressure at 1 m front and rear (`panasonic.json`), so a reading
  far above the datasheet points to a mounting, vibration or fan fault. Record it as a defect
  check, not as PD compliance.

---

## Sources

Read through search-engine extracts gathered during this workflow on 18 October 2026. None of
these pages was opened directly in this session.

**Manufacturer (M)**

- Daikin RXF20-42F installer reference guide 4PES769827-15G: https://www.daikin.es/content/dam/document-library/Installer-reference-guide/ac/split/rxf-f/RXF20-42F_Installer%20reference%20guide_4PES769827-15G_Spanish.pdf
- Daikin RXM installer reference guide 4P769827-4C: https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/ac/split/arxm-a/ARXM25A.ARXM35A9.ARXM-A8.RXM(20.42)A.RXM(25.35)A9.RXM-A8.%20RXP-N8_Installer%20reference%20guide_4P769827-4C_English.pdf
- Daikin ARXM25-35A / RXM20-42A installation manual 3PEN645642-7N: https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/split/arxm-a/ARXM25-35A.RXM20-42A_Installation%20manual_3PEN645642-7N_English.pdf
- Daikin RXF50F installation manual 3PEN748643-17H: https://www.daikin.es/content/dam/document-library/installation-manuals/ac/split/rxf-f/RXF50F_Installation%20manual_3PEN748643-17H_English.pdf
- Daikin 2MXM68A8/3/4/5MXM-A8 installation manual 3PEN818734-2: https://www.daikin.eu/content/dam/document-library/installation-manuals/ac/multisplit/2mxm-a8/2MXM68A8.3MXM-A8.4MXM-A8.5MXM-A8_Installation%20manual_3PEN818734-2_English.pdf
- Mitsubishi Electric MUZ-AP25-50VG service manual OBH789: http://www.mitsubishitech.co.uk/Data/M-Series/MSZ/2019/MUZ-AP-VG/MUZ-AP25-50VG_SM_OBH789.pdf
- Mitsubishi Electric UK library (MUZ-LN service manual): https://library.mitsubishielectric.co.uk/pdf/download_full/3405
- Panasonic KIT-Z25-CKE: https://www.aircon.panasonic.eu/GB_en/model/kit-z25-cke-cs-z25ckew-cu-z25cke/
- Panasonic CU-4Z80CBE: https://www.aircon.panasonic.eu/GB_en/model/cu-4z80cbe/
- Per-model data and sources in this repo: `docs/research/data/daikin.json`, `mitsubishi.json`, `panasonic.json`

**Official and legislation (O)**

- MCS 020 consultation response (Nov 2024): https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf
- SI 2025/560, GPDO (England) (Amendment) Order 2025: https://www.legislation.gov.uk/uksi/2025/560

**Secondary (S)**

- Payaca, permitted development and MCS 020: https://payaca.com/uk/blog/heat-pump-permitted-development-mcs-020
- Planning Jungle, GPDO changes from 29 May 2025: https://planningjungle.com/2025/05/18/important-new-legislation-amendments-to-other-parts-of-the-gpdo-29-05-2025/
- HF Group, REFCOM F-gas certification: https://hf-group.co.uk/accreditations/refcom-f-gas-certification/
- Trade2Base, F-gas certification UK: https://www.trade2base.com/blog/fgas-certification-uk
- DWP Find a Job, AC engineer advert (F-Gas Cat 1 essential): https://findajob.dwp.gov.uk/details/16822375
- Refindustry, GB 2025 split AC F-gas restriction: https://refindustry.com/news/great-britain-updates-guidance-on-2025-split-ac-f-gas-ban/
- IET, Part P England and Wales: https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/
- Carlisle City Council, Part P leaflet: https://www.carlisle.gov.uk/Portals/0/Documents/Residents/Building%20Control/PLAN_Part_P_Leaflet.pdf
- Bolton Council, electrical safety guidance note: https://www.bolton.gov.uk/downloads/file/6360/electrical-safety-guidance-note
- Lancaster City Council, electrical safety guidance note: https://www.lancaster.gov.uk/assets/attach/737/Guidance-Note-Electrical-Safety.pdf
- Daikin UK residential end-user warranty policy, July 2025 (third-party copy): https://discoveryhomesltd.uk/wp-content/uploads/2026/02/Daikin-UK-Residential-End-User-Warranty-Policy_July-2025_Final.pdf
- Basildon ACR: https://www.basildonacr.co.uk/product/daikin-sensira-air-conditioning-ftxf35d-rxf35d-3-5kw-12000btu-wall-mounted-wifi-optional/
- Micro-Climate: https://micro-climate.co.uk/daikin-sensira-ftxf35f-rxf35f-3-5kw
- Air Con Adviser: https://airconadviser.co.uk/products/wall-mounted-split-systems/daikin-sensira-ftxf
- Rimy: https://rimy.co.uk/products/supply-installation-of-daikin-prefera-series-ftxm35r-rxm35r9-3-5-kw-wall-mounted-for-home-or-office-upto-25m-br-br-vat-free-for-domestic-customers

**Computed (C)**

- CoolProp 8.0.0, R32 saturation properties: http://www.coolprop.org/ and https://pypi.org/project/CoolProp/

**To verify next (not reached this session)**

- BS EN 378-2 and BS EN 378-4 (BSI); REFCOM guidance (refcom.org.uk); the GB F-gas Regulation
  text (https://www.legislation.gov.uk/eur/2014/517/contents) and Environment Agency/Defra
  guidance; BS 7671 and IET Guidance Note 3; the current MCS 020(a) standard
  (mcscertified.com); and the Panasonic and Mitsubishi installation manuals for each pilot
  model.
