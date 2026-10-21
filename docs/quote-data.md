# The quote flow: what data it needs, and where it comes from

This is the short answer to "if someone types their postcode, does it work,
and does their quote save?" It covers the customer's quote form (`/quote`),
the office's price check (`/ops/price-check`), and what to set up for each.

## What happens when someone types a postcode

1. **Coverage.** The postcode's outcode (SW16, CR0…) is checked against
   Settings → Service area. Outside it, they can ask to be emailed when you
   arrive. Nothing else is needed for this step.
2. **Finding their home.** The address picker lists the homes at the
   postcode:
   - from the **property database** (`properties` table), when that postcode
     has been loaded before;
   - otherwise **live from the EPC register**: one search returns every home
     with an energy certificate there. They're saved, so the next person from
     that postcode gets an instant list. Needs `EPC_BEARER_TOKEN`.
   - If neither finds anything, getAddress.io fills the list
     (`GETADDRESS_API_KEY`, optional), or they type their address.
3. **Filling in their home.** When they pick their home, its record is
   completed and saved, once per home:
   - **EPC certificate**: property type, built form (terrace, semi…), age
     band, floor area, habitable rooms, walls, glazing, heating, rating.
   - **postcodes.io**: the postcode's centre point and council (free, no key).
   - **planning.data.gov.uk**: conservation areas, Article 4 directions and
     listed-building outlines at that point (free, no key).
4. **The house step is pre-answered** from that record: type, age, bedrooms
   (habitable rooms less two) and floor area. They check it and carry on.
5. **Price.** The engine (`packages/domain/src/pricing.ts`) lays out the rooms,
   sizes a unit for each, and prices it. Same rules for every home.
6. **Saving.** With an email on the first step, a draft saves at once; the
   last step saves the quote (`quote_requests`), emails it to them, alerts the
   team, and marks the home "quoted" in the property database.

## What to set up

| What | Where | Needed for |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Saving anything at all: quotes, drafts, looked-up homes |
| Database tables | `supabase/migrations` 0001–0009, then `supabase/pilot-upgrade.sql` | The `properties` and `quote_requests` tables |
| `EPC_BEARER_TOKEN` | Vercel, and GitHub → Actions secrets | Finding homes at a postcode, and prefilling them. Free: register at [get-energy-performance-data.communities.gov.uk](https://get-energy-performance-data.communities.gov.uk/) and copy the API token from your account |
| Settings → Service area | `/ops/settings` | Which postcodes can get a price |
| `RESEND_API_KEY`, `EMAIL_FROM` | Vercel | Emailing the quote to the customer and the team alert |
| `GETADDRESS_API_KEY` | Vercel (optional) | An address list for postcodes with no EPCs |

The old EPC service (epc.opendatacommunities.org) closed on 30 May 2026. If
`EPC_API_EMAIL`, `EPC_API_KEY` or `EPC_API_TOKEN` are set anywhere, delete
them: they no longer do anything.

`/ops/status` lists every setting and whether it's set.

## Loading an area in advance

Live lookups mean you don't have to load anything for the quote form to work.
Loading in advance is for mailings (`/ops/intel`) and for pricing homes before
anyone asks:

- **GitHub → Actions → Load property data → Run workflow.** Put the
  postcodes you care about (the pilot homes', a street you're leafleting) in
  **postcodes**, or leave it empty to load whole councils.
- **Or in the office:** type a postcode on `/ops/price-check`. It looks the
  postcode up and saves every home there, the same as the quote form.

Details: [loading-data.md](./loading-data.md).

## Pricing the pilot homes (and every home like them)

`/ops/price-check` runs any home through the customer's engine and shows:

- what the public records say about it, and the planning constraints;
- the customer's answers, prefilled, with anything you know better changeable;
- each room's size, load and unit, and the models we'd fit;
- the price the customer would see, line by line;
- **our cost** (equipment and materials at researched prices, labour at
  your day rates, the VAT we can't reclaim, contingency) and **the margin**,
  for standard and premium units, with the price that would meet your
  minimum margin.

Every number comes from one rule set, so a correction made for one pilot home
corrects every home like it:

| To change | Edit |
| --- | --- |
| What a customer pays | `packages/domain/src/pricing.ts` (bump `ENGINE_VERSION`) |
| What equipment and materials cost us | `PLANNING_COSTS` in `packages/domain/src/quote-cost.ts` ([the research](./research/planning-costs.md)) |
| Day rates, contingency, overhead, minimum margin, premium uplift | Settings → Pricing |
| Unit sizes | `packages/domain/src/heatload.ts` |
| Which rooms a home gets | `packages/domain/src/defaultconfig.ts` |

The planning costs are researched **retail** prices. Your trade account will
usually be cheaper, so put your own prices in `PLANNING_COSTS` as soon as you
have them.
