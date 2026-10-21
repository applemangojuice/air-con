# Planning costs for the price check (researched 21 October 2026)

These are the equipment and materials costs behind `PLANNING_COSTS` in
`packages/domain/src/quote-cost.ts`, which the office's price check
(`/ops/price-check`) uses to show the cost and margin under every online
price. They are **budgeting figures, not supplier quotes**. Replace them with
your own trade prices as soon as you have them: change the numbers in that
file (or price the units in the Catalogue for proposals) and every home's
margin updates at once.

## How they were gathered

- Search-engine extracts of UK online AC retailers' listings, observed on
  21 October 2026. No retailer page was opened directly, several listings were
  out of stock, and some were one to two years old. Treat each figure as
  roughly ±15%.
- Retailers seen: Basildon ACR, Airconditioning World, Cooling Company,
  Carlton Services, Orion Air Sales, SWAT Engineering, AC Vent, Buy Air
  Conditioning, HVAC-Sanitary, PHC Parts, City Plumbing, Wolseley, Kooltech.
- Prices shown including VAT were divided by 1.2. Every figure below is
  **ex VAT**. The cost model adds the 20% VAT back as a cost while the
  business isn't VAT registered.
- Trade-account prices (a Daikin, Mitsubishi or Panasonic distributor
  account) are usually lower than these retail figures.

## Single-split pair kits (indoor + outdoor), ex VAT

| Capacity | Standard | Premium (quiet) | Standard models seen | Premium models seen |
| --- | --- | --- | --- | --- |
| 2.5 kW | £565 | £840 | Daikin Sensira FTXF25, Mitsubishi MSZ-HR25, Panasonic TZ25 | Daikin Perfera FTXM25, Mitsubishi MSZ-LN25 / AY25, Panasonic Etherea Z25 |
| 3.5 kW | £675 | £945 | Daikin Sensira FTXF35, Comfora FTXP35, Mitsubishi MSZ-HR35, Panasonic TZ35 | Daikin Perfera FTXM35, Mitsubishi MSZ-LN35 / AY35, Panasonic Etherea Z35 |
| 5.0 kW | £865 | £1,335 | Daikin Sensira FTXF50, Mitsubishi MSZ-HR50, Panasonic TZ50 | Daikin Perfera FTXM50, Mitsubishi MSZ-LN50 / AY50, Panasonic Etherea Z50 |
| 7.1 kW | £1,355 | £1,880 | Daikin Sensira FTXF71, Mitsubishi MSZ-AP71, Panasonic TZ71 | Daikin Perfera FTXM71, Panasonic Etherea Z71 |

Ranges seen: standard 2.5 kW £429–636, 3.5 kW £496–926, 5.0 kW £649–1,067,
7.1 kW £1,031–2,184; premium 2.5 kW £726–1,143, 3.5 kW £799–1,356, 5.0 kW
£1,127–1,951. Mitsubishi has no MSZ-HR at 7.1 kW and no MSZ-LN above 6.0 kW.

## Multi-split, ex VAT

| Item | Cost | Models seen |
| --- | --- | --- |
| 2-port outdoor | £1,295 | Daikin 2MXM50, Mitsubishi MXZ-2F42 / 2F53, Panasonic CU-2Z50 |
| 3-port outdoor | £1,745 | Daikin 3MXM52 / 3MXM68, Mitsubishi MXZ-3F54 / 3F68, Panasonic CU-3Z68 |
| 4-port outdoor | £2,555 | Daikin 4MXM80, Mitsubishi MXZ-4F72 / 4F83, Panasonic CU-4Z80 |
| Indoor head 2.5 kW | £255 | Daikin FTXM25, Panasonic CS-TZ25, Mitsubishi MSZ-HR25 / AY25 |
| Indoor head 3.5 kW | £285 | Daikin FTXM35, Panasonic CS-TZ35, Mitsubishi MSZ-AY35 |
| Indoor head 5.0 kW | £365 | Daikin FTXM50, Panasonic CS-TZ50 (two data points only) |
| Indoor head 7.1 kW | £520 | No listing found: an estimate, 5.0 kW × 1.4 |

## Materials per room, ex VAT

| Item | Cost | Note |
| --- | --- | --- |
| Pipe, bracket, trunking, isolator, interconnect, sundries | £190 | 5–7 m pre-insulated pair coil about £50, bracket £25, 3 m trunking and fittings about £50, isolator £11, 10 m interconnect £15, plus a £40 sundries allowance (an estimate) |
| Condensate pump (a room with no gravity drain) | £84 | Sauermann Si-30 |

Benchmarks for the whole job: Costco UK sells a fitted 2.5 kW single split at
£1,850 and a fitted Daikin Perfera 3.5 kW at £2,300 (including VAT). One
retailer quotes install labour from £385 (2.5–3.5 kW) to £485 (7.1 kW).
