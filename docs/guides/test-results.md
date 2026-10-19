# Test results

The latest real results of every automatic check, run on **19 October
2026** on branch `claude/pilot-ops` (on top of commit `b3cf70c`, with this
change's copy fixes and guides). Every person, home and price the browser
walks use is fictional and labelled DEMO.

**Summary: everything passed.** 854 unit tests, the type check, the
production build, every database migration check, 191 end-to-end pilot
checks and 23 quote-form checks. One earlier pilot walk that day hit a
one-off browser warning; see [the note below](#one-intermittent-warning).

| Check | Command | Result | When (UTC) |
| --- | --- | --- | --- |
| Type check (domain, web, mobile) | `pnpm -r typecheck` | **Pass** (3 of 3 projects) | 14:17 |
| Domain unit tests | `pnpm test` | **456 of 456 pass**, 0 fail (29 test files) | 14:18 |
| Web unit tests | `pnpm test` | **398 of 398 pass**, 0 fail (47 test files) | 14:18 |
| Production build | `pnpm --filter @aircon/web build` | **Pass**: compiled, 34 of 34 static pages generated | 14:19 |
| Database migrations | `bash supabase/tests/run-migrations.sh` | **Pass**: 14 migrations and the pilot upgrade bundle; 108 sanity assertions | 14:20 |
| End-to-end pilot walk | `pnpm --filter @aircon/web test:e2e:pilot` | **191 of 191 pass** | 14:20 to 14:25 |
| End-to-end quote form walk | `pnpm --filter @aircon/web test:e2e` | **23 of 23 pass** | 14:25 to 14:26 |

Set-up for the browser walks: a production build (`next start`) on the local
file database, a fresh empty data folder for each walk, demo sign-in on,
`SESSION_SECRET` of 40 characters, headless Chromium 1194. Node 22.22.0,
pnpm 10.12.1, PostgreSQL 16.15 for the migration checks.

## The end-to-end pilot walk, phase by phase

One new pilot household taken from set-up to closed, in a real browser, by
each person on their own device: the admin at a desk (1280 × 800), the
family, the surveyor and the crew on phones (390 × 844).

| Phase | What it does | Checks | Passed |
| --- | --- | --- | --- |
| A | Admin signs in, sets up a new pilot (number typed in), owner and surveyor | 9 | 9 |
| B | The family opens their emailed link, books the survey, agrees to documents by email | 9 | 9 |
| C | Surveyor on a phone: on my way, start, every section (2 rooms measured, photos, a drawing), outdoor, electrics, planning checks, risks, submit at 100% | 16 | 16 |
| D | Catalogue loaded and priced from a CSV, design drafted, layout photos chosen, sent for review, approved and signed by the technical lead | 12 | 12 |
| E | Proposal with two options and PILOT15; issuing is refused until the Schedule 2 settings are filled in, then it issues | 12 | 12 |
| F | The family views it and accepts option 1 with an early start and their typed name; the contract renders | 10 | 10 |
| G | Office: early-start email on file (one from the wrong address is refused), dates, crew certificates, deposit invoice paid by bank transfer, booking confirmed, purchase order ordered, delivered and checked, compliance approved | 19 | 19 |
| H | Install days 1 to 3 on phones: on my way, every step's evidence, an issue, a variation the family approves on their page, end-of-day updates with photos, F-gas steps by the technical lead and electrical steps by the electrician | 31 | 31 |
| I | Technical lead sets the job's targets and signs commissioning; the certificate renders | 5 | 5 |
| J | Handover pack published, the family signs "All good", balance invoice paid (DEMO card simulator), electrical certificate and warranty in, issues resolved, project closed, all documents present | 30 | 30 |
| K | Every customer message logged; the Pilots page shows the pilot; the CSV downloads | 9 | 9 |
| L | Security: a duplicate pilot number, another family (pages, documents, invoices, photos), a subcontractor (office pages, other jobs, photos, margins), signed-out visitors, a forged sign-in cookie, a bad Stripe signature, the demo-data button | 29 | 29 |
| | **Total** | **191** | **191** |

## The quote form walk

The public website on a phone: home page, postcode, coverage confirmed, the
house and rooms steps with a price, the optional photo step, two separate
unticked consent boxes (saving without the required one is refused), the
result page ("confirmed at your survey", with its validity), **Book my home
survey** opening the project page, no placeholder phone number, and an
out-of-area postcode told the truth and its heads-up stored. **23 of 23
pass.**

## The database checks

`supabase/tests/run-migrations.sh` builds a throwaway PostgreSQL 16 database
and: applies every migration in order; re-applies the pilot migrations on an
empty and on a filled database (nothing changes); runs the sanity suite
(every table takes a row, the accepted-proposal guard refuses edits, the
public key can't read or write anything, the shared sign-in limit counts and
resets); runs the read-only production check ("All present: 30 tables, 10
columns, 3 photo stores, the sign-in counter, the proposal guard and 3
duplicate guards"); then, on a second database shaped like the live site
before the pilots (migrations 0001 to 0009), runs `supabase/pilot-upgrade.sql`
twice, checks it again, runs the sanity suite again, and proves a run that
stops part-way changes nothing. 108 assertions across both sanity runs, all
passed.

## One intermittent warning

Earlier the same day (14:00 UTC, before the final run above) one of three
pilot walks failed 1 of 191 checks: its "no page errors" check caught a
React hydration warning (#418) when the technical lead opened a project's
compliance checklist in phase J. Every other check in that walk passed, and
the next three walks on the same code (14:07, 14:12 and the final 14:20 run)
passed 191 of 191. It means the page drew slightly differently on the
server and in the browser that once; the page still worked. It's worth a
developer looking at before it confuses someone (see
`app/ops/projects/[id]/compliance/page.tsx`).

## Not covered by these checks

- The real outside services: these walks use demo email and texts (recorded,
  not sent) and the DEMO card simulator, not Resend, Twilio or Stripe.
  After going live, send yourself a test email and walk the quote form once
  on the live site (`/ops/launch` lists it).
- A real Supabase project: the walks use the local file database, which
  mirrors Supabase's behaviour; the migration checks run the real SQL on a
  real PostgreSQL.
- Real phones: the walks use a phone-sized Chromium, not Safari on an
  iPhone. Try the field app on each installer's own phone before day 1.

## Running them yourself (for a developer)

```bash
pnpm -r typecheck
pnpm test
pnpm --filter @aircon/web build
bash supabase/tests/run-migrations.sh

# Browser walks: start a production build on a fresh local data folder…
cd apps/web && DATA_BACKEND=file LOCAL_DATA_DIR=$(mktemp -d) ALLOW_DEMO_LOGIN=1 \
  SESSION_SECRET=<at least 32 characters> PORT=3330 npx next start
# …then, from the repository root, in another terminal:
BASE_URL=http://localhost:3330 pnpm --filter @aircon/web test:e2e:pilot
BASE_URL=http://localhost:3330 pnpm --filter @aircon/web test:e2e
```

Use a fresh `LOCAL_DATA_DIR` for each pilot walk. Against the live site, only
the quote form walk is safe to run (`BASE_URL=https://<your-domain>`).
