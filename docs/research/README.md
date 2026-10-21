# Research index: Dang, It's Hot pilot build

Researched 18 October 2026 for four pilot installs of R32 split and multi-split air-to-air heat pumps in South London. Prices are in GBP, ex VAT unless stated. This page indexes the research files, lists the 15 findings that matter most for the build, and collects every open question for the owner.

## Read this first

- **The research had almost no live web access.** The shared search budget ran out early, WebFetch failed DNS on every host, and the proxy refused most vendor sites. Figures come from search-engine extracts of the cited pages, data already in this repo, vendor GitHub repos, or the legislation.gov.uk mirror on GitHub. **Nobody opened a manufacturer PDF, a retailer page or a gov.uk page directly.** The fact-check passes had no web access either.
- **"verified"** in the catalogue means the figure was read from the manufacturer's own page, label or manual through a search extract. **"provisional"** means secondary sources or conflicting data. Every Mitsubishi record is provisional. Spot-check against the PDF before quoting a customer.
- **Nothing was invented.** A value that could not be sourced is `null`. A figure from someone's memory appears only as a labelled `candidate`, never as a `value`.

## Files

| File | What it holds |
|---|---|
| [`data/catalogue-seed.json`](data/catalogue-seed.json) | **The merged seed for the app**: 71 equipment items (31 indoor, 40 outdoor), 13 multi-split compatibility rules, 51 material rows, 2 per-job material templates, 3 pair-kit costs, and the labour defaults |
| [`data/panasonic.json`](data/panasonic.json), [`data/daikin.json`](data/daikin.json), [`data/mitsubishi.json`](data/mitsubishi.json) | Per-brand model specs, sources, compatibility rules and open questions |
| [`data/equipment-prices.json`](data/equipment-prices.json) | 26 UK retail price observations and a summary table by series and size |
| [`data/materials.json`](data/materials.json) | 51 material and tool rows (all unpriced), per-job bills of materials, and the suppliers to check |
| [`commissioning-standards.md`](commissioning-standards.md) and [`data/commissioning-defaults.json`](data/commissioning-defaults.json) | Pressure, vacuum, torque, charge, F-gas, electrical, noise and planning defaults, plus labour |
| [`services-and-costs.md`](services-and-costs.md) and [`data/services.json`](data/services.json) | The third-party services stack and the monthly budget |
| [`uk-consumer-legal.md`](uk-consumer-legal.md) and [`data/cancellation-text.json`](data/cancellation-text.json) | Consumer contract, cancellation, pricing, marketing, building regs, planning and VAT rules, with an app checklist |
| [`customer-experience-benchmarks.md`](customer-experience-benchmarks.md) | The customer journey stage by stage, field-app patterns, 15 do's and 10 don'ts |

## The 15 findings that matter most

### Equipment

**1. Premium shortlist (all with built-in Wi-Fi, all usable on multi-split).** ([panasonic.json](data/panasonic.json), [daikin.json](data/daikin.json), [mitsubishi.json](data/mitsubishi.json))

| Brand / series | Sizes (cooling kW) | SEER | SCOP | Quietest indoor setting, by size | Confidence |
|---|---|---|---|---|---|
| Panasonic Etherea Z, CS-Z..CKEW + CU-Z..CKE (silver XZ variant too) | 2.5 / 3.5 / 5.0 / 7.1 | 9.5 / 9.5 / 8.5 / 6.5 | 5.2 / 5.2 / 4.8 / 4.2 | 19 / 19 / 30 / 30 dB(A) | verified |
| Daikin Perfera FTXM-A + RXM-A9/A | 2.5 / 3.5 / 5.0 | 9.47 / 9.25 / 7.8 | 5.2 / 5.2 / 4.8 | 19 / 21 / `null` dB(A) | provisional (indoor); 3.5 kW outdoor verified |
| Daikin Stylish FTXA-C + RXA-A8 | 2.5 / 3.4 / 5.0 | 8.74 / 8.73 / 7.33 | 5.15 / 5.15 / 4.6 | 19 / 19 / 24 dB(A) | 2.5 kW indoor verified, rest provisional |
| Mitsubishi LN, MSZ-LN..VG2W + MUZ-LN..VG2 | 2.5 / 3.5 / 5.0 | 10.5 / 9.5 / 8.5 | 5.2 / 5.1 / 4.6 | 19 / 19 / 25 dB(A) | provisional |

- Panasonic Etherea lists heating down to −20 °C. That limit comes only from a secondary (Costco) source.
- The Stylish 5.0 kW outdoor (RXA50B) and the Daikin Emura (FTXJ25A, UK availability unconfirmed) have no outdoor record.

**2. Standard shortlist.** (same files)

| Brand / series | Sizes (cooling kW) | SEER | SCOP | Multi-split | Notes |
|---|---|---|---|---|---|
| Panasonic TZ, CS-TZ..CKEW + CU-TZ..CKE | 2.5 / 3.5 / 5.0 / 7.1 | 7.3 / 7.3 / 6.9 / 6.3 | 4.6 / 4.6 / 4.5 / 4.1 | yes | Wi-Fi built in; heating to −15 °C; 7.1 kW provisional |
| Daikin Sensira FTXF-F + RXF-F | 2.5 / 3.3 (sold as 3.5) / 5.0 | 6.5 | 4.2 / 4.2 / 4.1 | **no** (MXM) | Wi-Fi built in vs adapter is disputed |
| Mitsubishi Elegance AY, MSZ-AY..VGK + MUZ-AY..VG | 2.5 / 3.5 / 5.0 | 8.7 / 8.7 / 7.5 | 4.8 / 4.7 / 4.7 | yes | Current UK Elegance range; many outdoor fields `null` |
| Mitsubishi Classic HR, MSZ-HR..VF + MUZ-HR..VF | 2.5 / 3.4 / 5.0 | 6.2 / 6.2 / 6.5 | 4.3 | MXZ-HA only, not MXZ-F | No built-in Wi-Fi; heating only to −10 °C |
| Mitsubishi Elegance AP, MSZ-AP..VGK | 2.5 / 3.5 / 5.0 | 8.6 / 8.6 / 7.4 | 4.8 / 4.7 / 4.7 | yes | **Superseded by AY** at 2.5–5.0 kW; kept because it is the only Mitsubishi model with a price |

All records use R32 (GWP 675), so the GB ban on single splits with GWP ≥ 750 does not apply ([commissioning-standards.md](commissioning-standards.md)).

**3. Multi-split outdoor units and their rules are provisional.** ([catalogue-seed.json](data/catalogue-seed.json) `compatibility`)

| Brand | Outdoor units (rooms) | Total pipe / per room | Connected capacity |
|---|---|---|---|
| Panasonic | CU-2Z50CBE (2), CU-3Z68CBE (3), CU-4Z80CBE (4) | 30/20, 60/25, 70/25 m | 3.2–7.7, 4.5–11.2, 4.5–14.7 kW |
| Daikin | 2MXM40/50, 3MXM52/68, 4MXM68/80, 5MXM90 (2–5) | 30/20 m up to 75/25 m | ≤ 8.5 to ≤ 15.6 kW; the 2MXM40 limit is not known |
| Mitsubishi | MXZ-2F42VF4 (2), 3F54VF4 (3), 4F72VF4 (4) | 30/20, 50/25, 60/25 m | official min/max not found |

- The lists of connectable models were partly derived by the researchers from capacity ranges, port sizes or retailer bundles. None is an official combination table.
- 14 model codes named in the rules have no catalogue record (they are listed per rule in `uncataloguedIndoorModels`).
- Daikin's 4MXM68 has a rule but no outdoor record.
- **Gate multi-split designs behind tech-lead sign-off** until the official tables are checked.
- Multi-split SEER and SCOP depend on which indoor units are connected.

**4. Warranty depends on accreditation and registration, and none is confirmed for air-to-air.** ([commissioning-defaults.json](data/commissioning-defaults.json), brand files)

| Brand | Standard | Extended | Registration |
|---|---|---|---|
| Panasonic | 3 years | Up to 5 years as a Panasonic Accredited Installer registering on PRO Club; 7 years not confirmed for splits | On PRO Club; time limit not found |
| Daikin | "1 or 3 years" | Up to 5 years as a Certified Installer, 7 years for D1/D1+ | Stand By Me, within 90 days of commissioning (third-party copy of the July 2025 policy) |
| Mitsubishi | 3 years | Up to 5 years as an Accredited Installer | Secondary sources only; window not found |

### Costs

**5. Typical buy costs are thin and retail-only.** ([equipment-prices.json](data/equipment-prices.json))

Observed pair kits (ex VAT, public retail):

| Pair kit | Price | Observations |
|---|---|---|
| Daikin Sensira 3.5 kW | £530–£587 | n=2 |
| Daikin Perfera previous-generation R, 2.5 kW | £890.83 | n=1 |
| Daikin Perfera previous-generation R, 3.5 kW | £912.88–£1,029.17 | n=3 |
| Daikin Perfera previous-generation R, 5.0 kW | £1,179.15–£1,370.83 | n=3 |
| Mitsubishi MSZ-AP 3.5 kW | £690.83–£924.89 | n=5 |

- **No GBP price was found for Panasonic** (the UK distributor needs a trade login), Daikin Stylish, Emura or MXM, or Mitsubishi HR, AY, LN or MXZ.
- Trade prices are usually lower and were not captured.

**6. The seed prices only 6 of 71 items.** ([catalogue-seed.json](data/catalogue-seed.json) `pairKitCosts`)

| Pair kit | Pair cost (ex VAT) | Source | Caveat |
|---|---|---|---|
| Daikin FTXF35F + RXF35F | £587.00 | Cooling Company | Listing was out of stock |
| Daikin FTXM25A + RXM25A9 | £830.00 | Aircon Spares | **Approximate**: from a "~£996 inc VAT" note |
| Mitsubishi MSZ-AP35VGK + MUZ-AP35VG | £729.17 | Air Conditioning World | Superseded model |

- Each pair is split **25% indoor / 75% outdoor**. The split comes from Air Conditioning World's indoor-only versus pair prices for Perfera R (25.2% and 24.7%).
- Cost a single split as the pair total.
- Every other item has `costPence: null`.

**7. Installed-price anchors for pricing the pilots.** These are customer prices, not costs. ([commissioning-standards.md §8](commissioning-standards.md))

| Offer | Price |
|---|---|
| Costco installed package, 2.5 kW (members) | £1,849.99 |
| Costco installed package, 3.5 kW (members) | £1,899.99 |
| Typical 2.5–3.5 kW room, supplied and fitted | £1,500–£1,900 |
| Rimy supply-and-install Perfera 3.5 kW | £2,549.99, "VAT-free for domestic customers" |
| Basildon ACR install labour | from £385 |

**8. Materials per job cannot be costed yet: 0 of 51 rows are priced.** ([materials.json](data/materials.json))

- **Templates in the seed:**
  - (a) single split, 5 m run: 21 lines, 10 of them unquantified;
  - (b) 3-room multi-split, 5/8/10 m runs: 22 lines, 12 unquantified, using 2 × 15 m pipe coils.
- **Refrigerant:** no top-up is expected for either job, because both runs are within the factory charge length.
- **Only cost signal:** Orion's "install kit" listing for MSZ-AP35VGK costs £203.21 ex VAT more than the plain system. What the kit contains is unknown.
- **Mismatch with the app:** `bomForJob` adds one 5 m pipe kit and one 3 m trunking pack per indoor unit whatever the run length, but trunking is sold in 2 m lengths.

**9. Labour: no sourced day rates or durations.** ([commissioning-defaults.json](data/commissioning-defaults.json) `labour`)

- The seed keeps the repo placeholders as editable settings:

  | Role | Placeholder rate |
  |---|---|
  | Installer | £220/day |
  | Electrician | £250/day |
  | Tech lead | £280/day |
  | Surveyor | £40/hour |

- Planning assumptions (low confidence): about 1 day for a single split, 2–3 days for a 2–3 room multi-split, both with a two-person crew. The repo's install block is 3 days.
- Replace these with actual hours from the runsheet timestamps after each pilot.

**10. Monthly services: $45 fixed + up to $5 SMS = at most $50.** ([services-and-costs.md](services-and-costs.md))

- **Recommended stack:**
  - Vercel Pro, $20 (Hobby is treated as not allowed for commercial use);
  - Supabase Pro, $25 (turn the spend cap on);
  - Resend Free (3,000 a month, 100 a day);
  - Twilio SMS with sender `DangItsHot` (price unverified; $5 allowance);
  - postcodes.io plus the repo's own EPC address table;
  - Sentry Developer;
  - GitHub Actions.
- **Lean variant, about $25:** Supabase Free. Only until the first customer photos are uploaded (50 MB upload cap, no backups, pauses when idle).
- **Payments:** take balances by **bank transfer**. Card fees on £3,000 balances would cost more than the whole SaaS stack. Stripe fees are unverified.

### Commissioning and compliance

**11. The core test parameters are `null` and need the tech lead.** ([commissioning-standards.md](commissioning-standards.md))

- No manufacturer value was retrieved for:
  - nitrogen test pressure and hold time;
  - vacuum target and decay test;
  - flare torque;
  - condensate fall.
- The recalled candidates are only placeholders:
  - Daikin: at least 2 bar, 30 bar recommended;
  - vacuum: 500 micron as a company standard;
  - 4–5 minute decay hold;
  - torque per pipe size, e.g. Daikin 33–39 N·m for 3/8".
- Never exceed the nameplate PS.
- Repo placeholders to fix:
  - `pressureTestBar: 38` is unsourced;
  - the torque window `{33, 42}` only fits 3/8" lines;
  - "earth ≤ 1 Ω" is the wrong test;
  - "noise at the boundary ≤ 42 dB(A)" is the wrong test;
  - the 1 m boundary rule was removed in 2025.

**12. Sourced commissioning defaults the app can use now.** ([commissioning-defaults.json](data/commissioning-defaults.json))

- **Additional charge** = max(0, one-way liquid length − chargeless length) × g/m.

  | Range | Chargeless length | Then |
  |---|---|---|
  | Daikin splits | 10 m | 20 g/m |
  | Daikin 3/4/5MXM | 30 m | 20 g/m |
  | Mitsubishi M-series | 7 m | 20 g/m (provisional) |
  | Panasonic 2.5/3.5 kW | 7.5 m | 10 g/m |

- **F-gas:** R32 GWP 675 (0.675 tCO2e/kg). Complete the F-gas label with factory, added and total charge.
- **Electrical:** a new circuit is Part P notifiable. It needs a BS 7671 EIC signed by a competent-person-scheme electrician.
- **Breakers:** Panasonic 16 A (2.5–5 kW), 20 A (7.1 kW and CU-3Z68), 25 A (CU-4Z80).

**13. Noise and planning need the outdoor unit's sound power, which is mostly missing.** ([commissioning-standards.md §9](commissioning-standards.md), [uk-consumer-legal.md §7](uk-consumer-legal.md))

- **The rules (Class G, as amended by SI 2025/560 from 29 May 2025):**
  - noise must pass the MCS 020(a) calculation (42 dB(A) at the neighbour's nearest habitable room);
  - the unit must not be used solely for cooling;
  - outdoor unit volume ≤ 1.5 m³ (0.6 m³ for flats);
  - the 1 m boundary rule has been removed.
- **The gap:** the calculation needs the outdoor unit's **LWA**, and it is `null` for:
  - every Panasonic outdoor unit;
  - most Daikin units (only RXF25F 60, RXM25A9 58 and 2MXM40 60 dB(A) are known);
  - Mitsubishi AP50, AY35 and AY50.
- **Never output "no planning needed".** Whether air-to-air units fall under Class G is an inference, not stated in the legislation.

**14. Legal must-dos for the contract flow.** ([uk-consumer-legal.md checklist](uk-consumer-legal.md))

- **Treat every pilot contract as off-premises.**
  - Email the Schedule 2 information, the filled-in cancellation instructions and the cancellation form as a PDF **before acceptance**.
  - Record the customer's consent to receiving documents by email.
- **Acceptance:**
  - label the button "order with obligation to pay" or similar;
  - optional extras are never pre-ticked;
  - store an immutable acceptance record;
  - send confirmation before the install.
- **Cancellation:**
  - Supply-and-install is a sales contract, so the 14-day cancellation period runs from **possession of the last goods**. The current code (acceptance + 14 days) is wrong.
  - An early start needs an express request on a durable medium, ideally the customer's own email.
- **The model cancellation text in [cancellation-text.json](data/cancellation-text.json) is reconstructed, not copied.** It needs solicitor review against the official PDF.

**15. Marketing, reviews, building regulations and VAT.** ([uk-consumer-legal.md](uk-consumer-legal.md), [customer-experience-benchmarks.md](customer-experience-benchmarks.md))

- **Pricing and marketing:**
  - No "was £X" reference prices for a new trader; use "Pilot price £Y".
  - No undisclosed review incentives.
  - Ask every customer for a review. The current `feedback-30d` "only if happy" wording is review gating and must change.
  - No finance promotions without FCA cover.
  - Keep service-message and marketing consent separate.
- **Building regulations:**
  - Competent-person registration, or a building notice before work starts.
  - Compliance certificate to the occupier within **30 days**.
  - Operating and maintenance information within **5 days**.
- **VAT:**
  - If VAT-registered, supply-and-install of an air source heat pump is **0% before 1 April 2027 and 5% from then**.
  - If not registered, show no VAT line.
  - The registration threshold is £90,000.

## Open questions for the owner

**Equipment and suppliers**

1. Which brand or brands for the four pilots? Which UK distributor or trade account? Panasonic prices sit behind a trade login.
2. Get trade prices for every shortlisted model. Only 6 of 71 items have a price, and all are retail.
3. Confirm the model codes that can actually ship for the pilot dates:
   - Panasonic CKE vs ZKE/TBE, plus kit SKUs and colours;
   - Daikin FTXM-A vs FTXM-R; RXM50A5V1B vs B8/B9; RXM25/35 A9; FTXA-C vs FTXA-D; the RXA50B outdoor suffix; Emura UK availability; MXM A8 vs A9;
   - Mitsubishi HR VF vs VFK; MXZ VF3/VF4/VF5; AP vs AY; LN colour suffixes;
   - whether the 14 uncatalogued model codes in the multi-split rules exist (e.g. CS-TZ60CKEW, CS-Z42CKEW, MSZ-AY20VGK).
4. Get the official multi-split combination and port tables:
   - Panasonic Free Multi;
   - Daikin per-port class tables, including the 2MXM40 total-capacity limit and the 4MXM68 record;
   - Mitsubishi MXZ minimum and maximum connected capacity, port sizes and adaptors.
5. Pull the outdoor sound power (LWA) from the EPREL fiches or datasheets for every outdoor unit you might fit. MCS 020(a) cannot run without it.
6. Resolve these before ordering pipe or protection:
   - the 5 kW Mitsubishi gas pipe size (9.52 vs 12.7 mm);
   - the missing breaker ratings (all Daikin, some Mitsubishi);
   - Daikin Sensira Wi-Fi: built in, or an adapter needed?
7. Which capacity does the app show customers? Nominal vs label capacity (FTXF35F is 3.3 vs 3.5 kW), and nominal vs "UK-rated" for Mitsubishi.
8. Do any pilot homes need more than 5 kW? Daikin and Mitsubishi 7.1 kW units were not researched.

**Warranty, accreditation, certification**

9. Which manufacturer accreditation can you hold before Pilot 1, and what does it require (training, registration windows)?
   - Panasonic: PRO Club;
   - Daikin: Certified Installer and Stand By Me (90 days);
   - Mitsubishi: Accredited Installer.

   Get each brand's air-to-air warranty terms in writing.
10. F-gas:
    - company certification body (REFCOM, or another approved body);
    - engineer category (Category I assumed; is Category II enough?).
11. The electrician: is the Part P registered electrician in-house or subcontracted? Which competent-person scheme covers the AC installation itself (BESCA, NAPIT, Certsure)? If none, a building notice is needed.

**Materials, labour, commissioning**

12. Open trade accounts (RefNet, Wolseley, CEF and others) and price the 51 material rows, including R32 and OFN cylinder rental.
13. Fix the app's bill of materials so it follows run length and 2 m trunking lengths.
14. Confirm day rates (£220, £250 and £280 are placeholders) and install durations.
15. Tech lead, from each pilot model's installation manual:
    - test pressure (≤ PS) and hold time;
    - vacuum target and decay test;
    - flare torques by pipe size;
    - drain fall;
    - temperature-split acceptance window.

**Legal (solicitor), tax (accountant), planning**

16. Solicitor:
    - off-premises vs distance classification;
    - is supply-and-install a sales contract, and how is a cancellation after install handled;
    - is an early-start request made on our web page enough, or must it come from the customer's own email or signature?
    - approve the reconstructed Schedule 3 text;
    - pilot price presentation;
    - wording for incentivised case studies;
    - finance route, if any;
    - does the DMCC subscription regime apply to service plans?
    - complaint and ADR wording since 6 April 2026.
17. Business decision: on cancellation, do we collect removed units and pay the return cost? The research recommends yes.
18. Planning consultant: do air-to-air units fall under Class G? Confirm the current MCS 020(a) issue and the 42 dB(A) figure.
19. Accountant:
    - VAT registration strategy (voluntary registration while installs are zero-rated);
    - HMRC's view on zero-rating air-to-air units (VENSAV3080);
    - the 2026–27 threshold;
    - jobs that straddle 1 April 2027.

**Services and customer experience**

20. Supabase Pro from day one ($45) or the lean $25 variant until the first customer media?
21. Verify before go-live:
    - Twilio UK SMS price and sender-ID rules;
    - the UK SenderID registry;
    - Stripe UK fees;
    - getAddress.io tiers;
    - Resend paid tiers;
    - Vercel cron limits;
    - UK VAT on SaaS invoices.
22. Which review platform? Approve the "ask everyone, no incentive" review request that replaces the gated `feedback-30d` message.
