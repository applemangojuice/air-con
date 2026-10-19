# Test results

The latest real results of every automatic check, run on **19 October
2026** on branch `claude/pilot-ops` (on top of commit `78303fe`, with the
fixes from the founder's walk below). Every person, home and price the
browser walks use is fictional and labelled DEMO.

**Summary: everything passed.** 855 unit tests, the type check, the
production build, every database migration check, 191 end-to-end pilot
checks and 23 quote-form checks, plus a by-hand walk of
[START-HERE-TOMORROW.md](../START-HERE-TOMORROW.md) on a fresh production
build ([below](#the-founders-walk-start-here-followed-literally)).

| Check | Command | Result | When (UTC) |
| --- | --- | --- | --- |
| Type check (domain, web, mobile) | `pnpm -r typecheck` | **Pass** (3 of 3 projects) | 14:49 |
| Domain unit tests | `pnpm test` | **457 of 457 pass**, 0 fail (29 test files) | 14:49 to 14:50 |
| Web unit tests | `pnpm test` | **398 of 398 pass**, 0 fail (47 test files) | 14:49 to 14:50 |
| Production build | `pnpm --filter @aircon/web build` | **Pass**: compiled, 34 of 34 static pages generated | 14:50 to 14:52 |
| Database migrations | `bash supabase/tests/run-migrations.sh` | **Pass**: 14 migrations and the pilot upgrade bundle; 108 sanity assertions | 14:52 |
| End-to-end pilot walk | `pnpm --filter @aircon/web test:e2e:pilot` | **191 of 191 pass** | 14:52 to 14:57 |
| End-to-end quote form walk | `pnpm --filter @aircon/web test:e2e` | **23 of 23 pass** | 14:57 |

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

## The founder's walk (START-HERE, followed literally)

Before the checks above, someone with fresh eyes followed
[START-HERE-TOMORROW.md](../START-HERE-TOMORROW.md) steps 5 to 11 word for
word, on a production build with an empty local database, the way the live
site will look before email works: no demo sign-in, `ADMIN_EMAILS` set to
one address, `SESSION_SECRET` and `OPS_PASSWORD` set, no email, texts or
card payments. Everything typed was fictional (example.com addresses, DEMO
names).

| Step | What happened | Result |
| --- | --- | --- |
| 5 Sign in | The email link can't go without email; **Admin break-glass** with the admin address and `OPS_PASSWORD` signed in and created the admin account | Pass, after the guide fix below |
| 6 Launch checklist | Red rows for the database, email and `CRON_SECRET` (expected locally); everything the founder controls went green by step 9 | Pass |
| 7 Settings | Every field the guide names was where it said; saving turned the red box green | Pass |
| 8 Staff | A technical lead (F-gas), an electrician (Part P) and a surveyor added; evidence uploaded and ticked; both launch rows green | Pass |
| 9 Catalogue | **Load researched catalogue** added 122 items; four units given a DEMO trade price, confidence verified | Pass |
| 10 New pilot | Pilot 1 set up; the app said plainly that no link went (no email) | Pass |
| 11 The family | Their sign-in link opened **Continue as …**, then their page; they booked a survey at home and agreed to documents by email; the office saw it on the project, the calendar and in Messages | Pass |

What got in the way, and what changed:

- **No way in while the email domain verifies.** Step 4 didn't mention
  `OPS_PASSWORD`. It's now in the table, and step 5 says how to use
  **Admin break-glass** meanwhile.
- **"You land on the Board"**: you land on **Today**. Fixed in the guide.
- **Contradictory database instructions** on the login page, `/ops/status`
  and `/ops/launch` ("run every migration 0001 to 0013", "0001 → 0007"). They
  now all say the same as step 3: paste `supabase/pilot-upgrade.sql`, then
  `check-schema.sql`.
- **The launch page's headline counted the wrong things**: "4/8 automated
  checks green" sat above "3 to fix", and counted property intelligence,
  which the pilots don't need. The headline now follows the pilot checklist;
  property intelligence and analytics are marked optional.
- **The catalogue row went green on research prices alone.** Loading the
  researched catalogue prices six units from public retail websites (some
  approximate), which made both tiers look priced. The row now stays amber
  until someone types their own price in each tier (new unit test).
- **A family set up before email worked could never get their link** except
  by booking their survey. The project's **Admin** box now has **Email them
  a sign-in link** (to the address on the project only; refused, with the
  reason, while email isn't set up).
- **Message previews show "[[link added when sent]]"** where the sign-in
  button goes. That's deliberate (links are never stored); the preview now
  says so and points to **Customer view**.
- Guide clarifications: the phone and email settings start as placeholders;
  the service area starts with 17 districts; after **Add to the team** you're
  already on the person's page; rename your own staff record; how to split a
  pair price between indoor and outdoor units; the family sees the starting
  price; **Customer view**; the **Continue as …** page.

Not walked by hand: the surveyor, crew and proposal steps (the pilot walk
above covers them), and anything needing real email, Supabase or Stripe.

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

Earlier on 19 October (14:00 UTC, before the previous version of this
page) one of three pilot walks failed 1 of 191 checks: its "no page errors"
check caught a React hydration warning (#418) when the technical lead opened
a project's compliance checklist in phase J. Every other check in that walk
passed, and every walk since (14:07, 14:12, 14:20 and today's 14:52 run)
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
