# Third-party services and running costs

Researched 2026-10-18 for Dang, It's Hot (4 pilot installs a month). The budget target is about **$20 to $50 a month** for third-party services. Machine-readable version: [`data/services.json`](data/services.json).

## 1. Recommendation

| Need | Service and plan | Fixed $/month | At pilot volume (per month) | Status of the figures |
|---|---|---|---|---|
| Hosting, functions, cron | **Vercel Pro** (Hobby is not allowed for commercial use) | **20** | $20 of usage credit included; pilot traffic should stay inside it | Price: Vercel-authored repo [V1]. Hobby ban: secondary [V3] |
| Database, storage, auth | **Supabase Pro**, one project on Micro compute | **25** | Covered by the plan. The $10 compute credit pays for the Micro project | Verified, Supabase's own source [S1][S5] |
| Transactional email | **Resend Free** | 0 | 300 emails, against 3,000 a month and 100 a day | Secondary [R1] |
| SMS | **Twilio**, pay as you go, alphanumeric sender `DangItsHot` | 0 | 60 SMS. **Price per message not verified** (see §4.4). Budget an allowance of $5 | Unverified |
| Card payments | **Stripe Checkout / Payment Links** | 0 (not verified) | 4 payments of about £3,000. **Fees not verified** (see §4.5) | Unverified |
| Large payments | **Direct bank transfer** to the business account (the default for £3,000 balances) | 0 | No processor fee. Your own bank's tariff applies | No third party involved |
| Address lookup | **Own EPC address table + postcodes.io**, with getAddress.io only for misses | 0 | About 200 lookups. **getAddress free-tier limits not verified** | postcodes.io verified [A1]; getAddress unverified |
| Error monitoring | **Sentry Developer (free)** | 0 | Free quota of 5k errors and 1 user (secondary) | Plan exists: verified [E1]. Quota: secondary [E2] |
| Uptime and backup cron | **GitHub Actions** (existing `health-check.yml`) | 0 | About 31 to 186 minutes a month, depending on schedule | Verified, GitHub docs [G1][G2] |
| **Total** | | **45 fixed** | **+ up to $5 SMS, so ≤ $50** | `recommendedMonthlyUsd = 50` (upper bound) |

What the total leaves out:

- Card-processing fees. These are charged per transaction and will be the biggest cost if customers pay £3,000 balances by card.
- The domain name.
- UK VAT. It may be added to US-billed SaaS if the business isn't VAT-registered. The rate was not checked in this session.
- The GBP/USD exchange rate.

### Leaner variant (about $20 + SMS)

Vercel Pro plus **Supabase Free**. This is only acceptable while all of these hold:

- No uploaded file is larger than **50 MB**. That is the Free plan's maximum upload size, and phone video surveys can go over it [S2].
- Total stored files stay under **1 GB** [S1].
- The database stays under **500 MB**, or it becomes **read-only** [S7]. Measure it after the EPC import with `select pg_database_size(current_database())`.
- A nightly `pg_dump` runs from GitHub Actions. The Free plan has **no automatic backups** [S2][S4].
- The project gets database traffic every day, so it isn't **paused after a week of low activity** [S3].

Switch to Supabase Pro before the first real customer's photos and videos are uploaded.

## 2. Keeping it under $50

1. **Turn the Supabase spend cap on** (Pro plan feature) [S8].
   - With the cap on, once a usage item goes over quota, further use is blocked until the next billing cycle instead of being billed.
   - It covers disk size, egress, storage size, MAU, Edge Function invocations, Realtime and logs.
   - It does **not** cover compute, custom domains, IPv4, PITR or log drains, so don't turn those on.
   - Use one Pro project only. Each extra Micro project costs about $10 a month [S5].
2. **Staging is local or Free.** Run staging on the Supabase CLI locally, or in a separate Free-plan organisation. Plans can't be mixed inside one organisation, and you get two free projects [S6].
3. **Vercel**: one deploying seat. Viewer seats are free [V1]. Keep usage inside the $20 credit by sending photos and videos straight to Supabase Storage. Vercel functions accept at most 4.5 MB per request or response body [V2]. The current architecture already does this.
4. **Resend**: stay on Free while under 100 emails a day. The `GET /usage` endpoint returns daily and monthly used/limit figures [R2]. Show them on `/ops/status`. Note that the daily count is **sent + received**.
5. **SMS**: keep each message to **160 GSM characters or fewer**. A message of up to 306 characters counts as 2. Any non-GSM character (emoji, curly apostrophe) drops the single-message limit to **70** characters [N1]. Keep the prepaid balance small.
6. **GitHub Actions**: if the repo is private, the free quota is 2,000 minutes a month, and every job rounds **up to a whole minute** [G1][G3]. A health check every 4 hours uses about 186 minutes a month. Every 30 minutes uses about 1,488. Every 15 minutes uses about 2,976, which is **over** the quota. Public repos have no limit [G2].

## 3. Pilot month, line by line

Assumed volume: about 300 emails, 60 SMS, 4 payments of about £3,000, and 200 address lookups.

| Item | Volume | Included allowance | Cost | Notes |
|---|---|---|---|---|
| Vercel Pro | 1 project | $20 usage credit [V1] | $20 | Fluid Compute. Functions run up to 800 s on Pro, against a 300 s cap on Hobby [V2] |
| Supabase Pro | 1 project | 8 GB disk, 100 GB file storage, 250 GB egress, 100k MAU, daily backups kept 7 days [S1] | $25 | Overage: disk $0.125/GB, storage $0.0213/GB, egress $0.09/GB [S1] |
| Email | 300 | Resend Free: 3,000 a month, 100 a day, 1 domain [R1] | $0 | Fallbacks: Postmark Free at 100 a month [R1][R3] (too small); Brevo Free at 300 a day [R1] |
| SMS | 60 | none | not verified | At **any** price up to about 8 US cents per message, 60 single-part SMS cost under $5. Benchmark: GOV.UK Notify charges 2.4p + VAT from 1 April 2026, but **only public-sector services can use it** [N1][N2] |
| Card payments | 4 × £3,000 | n/a | not verified | Every 1 percentage point of fee costs **£30 per £3,000 payment**, or £120 a month across 4. See §4.5 |
| Bank transfer | 4 × £3,000 | n/a | £0 processor fee | Recommended default for balances |
| Address lookup | 200 | own table: unlimited; postcodes.io: free public API [A1] | $0 | getAddress is only used when a postcode isn't in our table |
| Sentry | low volume | Developer plan (free) [E1]; about 5k errors a month, 1 user [E2] | $0 | |
| GitHub Actions | about 31 to 186 min | 2,000 min a month (private repo, Free plan) [G1] | $0 | |
| **Total** | | | **$45 + SMS (≤ $5)** | |

## 4. Findings by service

### 4.1 Vercel

- **Pro** has a "$20/month platform fee, includes $20/month of usage credit". It comes with 1 deploying seat and unlimited free Viewer seats, 1 TB of Fast Data Transfer and 10M Edge Requests a month [V1].
  - *Status: Vercel-authored GitHub repo (vercel-labs/agent-skills, commit dated 2026-08-28), not the live pricing page.*
- **Hobby and commercial use.** Two pages of the community list *stack-on-a-budget* say the "Free tier does not allow commercial usage" [V3]. This matches Vercel's fair-use rules as I knew them before this session, but vercel.com couldn't be fetched to confirm it.
  - *Status: secondary.*
  - Treat Hobby as **not allowed** for a trading business.
- **Function limits** (Fluid Compute) [V2]:
  - Hobby: default and maximum duration are both 300 s; fixed 2 GB / 1 vCPU; single region.
  - Pro: up to 800 s (1,800 s in beta); configurable memory and CPU; up to 3 regions.
  - Both plans: 4.5 MB request/response body; auto-scaling to 30,000 concurrency.
  - *Status: Vercel-authored plugin repo.*
- **Cron limits.** **Not verified.** I couldn't reach vercel.com/docs/cron-jobs/usage-and-pricing. My recollection, *unverified*: Hobby crons can run at most once a day and only to within the hour, and Pro allows per-minute schedules. The repo currently has two daily crons (`apps/web/vercel.json`), which would work either way. If a more frequent outbox-retry cron is added, use Pro or the GitHub Actions fallback below.
- **Fallback scheduler.** GitHub Actions `schedule` runs at most every 5 minutes. It can be delayed at busy times, especially on the hour, and some queued jobs may be dropped. Scheduled workflows in a public repo are switched off after 60 days without repository activity [G4][G5][G6]. Good enough for retries and health probes, not for anything time-critical.

### 4.2 Supabase (all verified from supabase/supabase, commit dated 2026-10-17)

| | Free | Pro |
|---|---|---|
| Price | $0 | from $25/month, which includes one project on Micro compute [S1] |
| Database | 500 MB database size; shared CPU, 500 MB RAM. Goes read-only above 500 MB [S1][S7] | 8 GB disk per project, then $0.125/GB [S1] |
| File storage | 1 GB, max upload 50 MB [S1][S2] | 100 GB, then $0.0213/GB, max upload 500 GB [S1][S2] |
| Egress | 5 GB + 5 GB cached [S1] | 250 GB (then $0.09/GB) + 250 GB cached (then $0.03/GB) [S1] |
| Auth MAU | 50,000 [S1] | 100,000, then $0.00325/MAU [S1] |
| Edge Function invocations | 500,000 [S2] | 2M, then $2 per 1M [S2] |
| Pausing | Paused after **1 week of low activity**. "A few user requests to the database each day" is typically enough to prevent it. Restorable for 1 year [S3] | Never paused [S3] |
| Backups | **None automatic**. Supabase recommends `supabase db dump` off-site [S4] | Daily, last 7 days. PITR add-on costs $100/month per 7 days retention [S2][S4] |
| Projects | 2 free projects across orgs you own or administer [S6] | $10/month compute credit covers one Micro project; a Micro project is about $10/month [S5] |

Other points from the same source:

- **Backups don't include Storage objects** (photos, PDFs). Restoring a database backup won't bring back deleted files [S4]. So: never hard-delete customer media, and export buckets from time to time.
- **The built-in Supabase Auth SMTP isn't for production.** It sends **2 emails an hour**, and only to project team members [S9]. If Supabase Auth emails are ever used, point Auth at Resend's SMTP.

### 4.3 Email: Resend, with alternatives

- **Resend Free**: 3,000 emails a month, 100 a day, one custom domain [R1].
  - *Status: secondary (free-for-dev list, commit dated 2026-10-18). resend.com couldn't be reached.*
- **Resend's paid plans**: prices **not verified**. Check resend.com/pricing before upgrading.
- **Resend's own docs** [R2][R4]:
  - The `GET /usage` endpoint returns the plan's daily and monthly caps. A `null` daily limit means the plan only has a monthly cap.
  - Daily usage counts sent + received mail.
  - The default rate limit is 2 requests a second. Your account's actual limit is in the `/usage` response.
  - Batch sends take at most 100 emails.
  - A new domain should be warmed up from about 150 messages on day 1. Irrelevant at pilot volume.
- **Postmark Free**: 100 emails a month [R1][R3]. That's too small for 300 a month. Paid prices were **not verified**.
- **Brevo Free**: 300 emails a day (9,000 a month) [R1].

### 4.4 SMS to UK mobiles

- **Prices: none verified.** I couldn't reach any of these sites in this session: twilio.com, thesmsworks.co.uk, textlocal.com, clicksend.com, vonage.co.uk. Every per-message price and monthly fee is `null` in the JSON. Compare before going live (§6).
- **What is verified, from GOV.UK Notify's open-source code (UK benchmark)** [N1][N2][N3]:
  - A single message is 160 characters; up to 306 counts as 2; 459 as 3.
  - Any non-GSM character limits a single message to 70 characters.
  - A sender ID can be "up to 11 characters, letters, numbers and spaces".
  - A text-message sender ID (name) is one that "no one can reply to".
  - Notify's rate is 2.4p + VAT per message from 1 April 2026. Going live there needs a responsible **public-sector body**, so it isn't an option for us.
- **Sender name**: use **`DangItsHot`** (10 characters). "Dang Its Hot" is 12 characters with the spaces and too long. Leave out the apostrophe.
  - Alphanumeric senders are one-way, so put a phone number or link in the message body for replies.
  - With an alphanumeric sender, Twilio shouldn't need a rented phone number. That saves the number's monthly rental. *Unverified: check Twilio's GB sender-ID guidelines.*
- **UK SMS SenderID Protection Registry.** I know the registry exists (run by the Mobile Ecosystem Forum). Whether we have to register, and what it costs, was **not verified**.
  - Before go-live, check that the provider supports UK alphanumeric senders without pre-registration.
  - Check that `DangItsHot` doesn't clash with a protected name.
  - Consider registering it ourselves.
- **Pick on API simplicity.** The code already calls Twilio's REST API with `fetch` (`lib/providers/sms.ts`). At 60 SMS a month, a 5p difference in price is £3 a month. Switching provider would only be worth a new adapter if the price check shows a large gap or Twilio refuses the alphanumeric sender.

### 4.5 Payments: Stripe UK and bank transfer

- **Fees: none verified.** stripe.com couldn't be reached.
  - From memory, *unverified, don't quote*: Stripe's published UK rate for standard UK cards has been **1.5% + 20p**, which is about **£45.20 on a £3,000 payment** and **about £181 a month for four**. Higher rates apply to premium, EEA and international cards. Payment Links and Checkout have no monthly fee.
  - Confirm at stripe.com/gb/pricing. The **arithmetic** stands either way: card fees on £3,000 balances would cost far more than all the SaaS above put together.
- **Recommendation**:
  - **Bank transfer is the default for the balance.** Use Faster Payments to the business account, showing bank details in the customer portal and invoice PDF, and record the payment manually.
  - **Stripe Checkout** is for card deposits and for customers who insist on paying by card.
  - Ask a Stripe-hosted bank method (Pay by Bank / bank transfers) for its fee *before* turning it on. **Its pricing wasn't verified.**
- **Engineering rules from Stripe's own guidance** [P1]:
  - Prefer Payment Links or Checkout.
  - Don't hard-code `payment_method_types`. Let the methods enabled in the Dashboard decide.
  - Drive fulfilment from the webhook, not the success page.
  - Handle `checkout.session.completed` **and** `checkout.session.async_payment_succeeded` / `_failed`, because bank-based methods are delayed-notification.
  - Verify signatures.

  `lib/providers/stripe.ts` and the webhook should follow these rules.
- **Bank-transfer fraud risk** (redirected invoices). Always show bank details from the authenticated portal and PDF, never in plain email alone. Tell customers you will never change bank details by email.

### 4.6 Address lookup

- **postcodes.io** (Ideal Postcodes' open-source service, public API, self-hostable). It serves the ONS Postcode Directory and OS Open Names. It gives **postcode-level** data (validation, autocomplete, coordinates, admin areas), **not** full addresses [A1]. Use it to validate postcodes and to place them on a map.
- **The repo's own EPC-derived address table** (`docs/property-intelligence.md`) covers most addressed homes in the target boroughs at no cost. Try it before any paid API.
- **getAddress.io**: free-tier limits and paid tiers **not verified** (site unreachable). The existing code calls `https://api.getaddress.io/find/{postcode}` (`apps/web/app/api/addresses/route.ts`). Before relying on it, check that this endpoint is still supported.
- **Ideal Postcodes (PAF) and OS Places API**: prices **not verified**. OS Places needs an OS Data Hub premium account. Check the terms of any free allowance.

### 4.7 Error monitoring and uptime

- **Sentry**:
  - Plans: a free **Developer** plan, plus Team, Business and Enterprise. New accounts get a 14-day trial, then drop to Developer [E1].
  - Paid plans include 50k errors, 5M spans, 50 replays, 1 uptime monitor and 1 cron monitor [E1].
  - Developer quota: about 5k errors a month and **1 user** [E2].
  - Team plan price **not verified**.
- **GitHub Actions** [G1][G2][G3]:
  - Free for standard runners in public repos.
  - Private repos on GitHub Free get 2,000 minutes, 500 MB of artifacts and 10 GB of cache.
  - Linux 2-core overage costs $0.006 a minute.
  - Jobs round up to whole minutes.
  - The existing daily `health-check.yml` is fine. To keep a Supabase Free project awake, run it every 4 to 6 hours.
- **Other free uptime monitors** (secondary [R1]):
  - Better Stack: 10 monitors, 3-minute checks.
  - UptimeRobot: 50 monitors, 5-minute checks. Described as "for hobby projects", so check its commercial-use terms.
  - cron-job.org: free.

## 5. When to scale

| Trigger | Action | New cost |
|---|---|---|
| Any customer media, or the DB passes 400 MB, on Supabase Free | Upgrade to Supabase Pro | +$25 [S1] |
| More than 100 emails on any day, or over 3,000 a month | Resend paid plan, or Brevo Free (300 a day) as a stopgap | Resend price not verified |
| More than about 200 SMS a month | Compare UK providers on price per message (§6). Keep messages under 160 characters | Volume × price |
| A second person needs Sentry | Sentry Team | Price not verified |
| Usage over the $20 Vercel credit | Check large responses. Keep media direct-to-Storage | Pay-as-you-go above the credit [V1] |
| More frequent jobs (outbox retries) | Vercel Pro cron (limits not verified), or GitHub Actions every 30 min or slower in a private repo. Every 15 min is about 2,976 min a month, over the 2,000 free | $0 inside quotas [G1][G3] |
| Losing a day of data is no longer acceptable | Supabase PITR (needs Small compute or larger) | $100/month per 7 days, plus compute [S2][S4] |
| About 20+ installs a month | Re-run this research. Card fees, not SaaS, will dominate | n/a |

## 6. To verify before go-live

I couldn't verify these in this session. Each one is `null` in the JSON.

- [ ] Vercel Hobby fair-use wording and cron limits: vercel.com/docs/limits/fair-use-guidelines, vercel.com/docs/cron-jobs/usage-and-pricing
- [ ] Resend paid tiers: resend.com/pricing
- [ ] Postmark paid tiers: postmarkapp.com/pricing
- [ ] Twilio UK price per message, sender-ID rules, whether a number is needed: twilio.com/en-us/sms/pricing/gb, twilio.com/en-us/guidelines/gb/sms
- [ ] The SMS Works, Textlocal, ClickSend and Vonage UK prices and API auth
- [ ] UK SMS SenderID Protection Registry requirements (Mobile Ecosystem Forum)
- [ ] Stripe UK card fees, Pay by Bank and bank-transfer fees, and that there's no monthly fee: stripe.com/gb/pricing
- [ ] getAddress.io free and paid tiers, and the `/find` endpoint status: getaddress.io/pricing
- [ ] Ideal Postcodes and OS Places API prices
- [ ] Sentry Developer quota and Team price: sentry.io/pricing
- [ ] Whether UK VAT is charged on Vercel and Supabase invoices

## How this was researched, and its limits

- Every web-search call failed (the shared search budget was used up). WebFetch and direct HTTPS to vercel.com, supabase.com, resend.com, stripe.com, twilio.com, getaddress.io, sentry.io and others were **blocked by this session's network policy**.
- Figures marked "verified" come from the **vendors' own public GitHub repositories**, read at the commits listed below. Those repos generate the vendors' pricing pages and docs, but they can differ slightly from the live sites.
- "Vendor-authored" means a vendor's agent-skill or plugin repo, not its pricing page.
- "Secondary" means community-maintained lists that may lag behind price changes.
- Nothing labelled *unverified* should be quoted to anyone until it has been checked.

## Sources

- **[V1]** Vercel Labs, `vercel-cli-with-tokens` skill, "What Pro gives you": https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/vercel-cli-with-tokens/SKILL.md
- **[V2]** Vercel plugin, `vercel-functions` skill, plan limits: https://github.com/vercel/vercel-plugin/blob/137e9f44a243a939c5eaea30e4dff96aee744f64/skills/vercel-functions/SKILL.md
- **[V3]** stack-on-a-budget, Vercel entries: https://github.com/255kb/stack-on-a-budget/blob/268acebd6c8de3b9c87bd5209bcf2aa92b67252a/pages/app-hosting.md and https://github.com/255kb/stack-on-a-budget/blob/268acebd6c8de3b9c87bd5209bcf2aa92b67252a/pages/static-app-hosting.md
- **[S1]** Supabase plans data: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/packages/shared-data/plans.ts (live page: https://supabase.com/pricing)
- **[S2]** Supabase pricing feature matrix: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/packages/shared-data/pricing.ts
- **[S3]** Supabase free project pausing: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/free-project-pausing.mdx
- **[S4]** Supabase backups: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/backups.mdx
- **[S5]** Supabase compute and credits: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/manage-your-usage/compute.mdx
- **[S6]** Supabase billing: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/billing-on-supabase.mdx
- **[S7]** Supabase database size and read-only mode: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/database-size.mdx
- **[S8]** Supabase cost control and spend cap: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/platform/cost-control.mdx
- **[S9]** Supabase Auth SMTP: https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/apps/docs/content/guides/auth/auth-smtp.mdx and https://github.com/supabase/supabase/blob/7425d4930528931400fb3e656e860b1094cb224e/packages/shared-data/config.ts
- **[R1]** free-for-dev (Resend, Postmark, Brevo, Better Stack, UptimeRobot, cron-job.org, Sentry): https://github.com/ripienaar/free-for-dev/blob/e2f3fa6030bea82aca8233e705c1545aa8c0fd6d/README.md
- **[R2]** Resend usage endpoint: https://github.com/resend/resend-skills/blob/b2ae7b1798b70134faf679f35fc05b4331462988/skills/resend/references/usage.md
- **[R3]** stack-on-a-budget, emailing (Postmark): https://github.com/255kb/stack-on-a-budget/blob/268acebd6c8de3b9c87bd5209bcf2aa92b67252a/pages/emailing.md
- **[R4]** Resend sending overview (rate limit, batch, warm-up): https://github.com/resend/resend-skills/blob/b2ae7b1798b70134faf679f35fc05b4331462988/skills/resend/references/sending/overview.md
- **[N1]** GOV.UK Notify text message pricing: https://github.com/alphagov/notifications-admin/blob/d19509b1a0ec7e86ed9d3d541d060b31755c32a0/app/templates/views/guidance/pricing/text-message-pricing.html (live: https://www.notifications.service.gov.uk/pricing/text-messages)
- **[N2]** GOV.UK Notify go-live (public-sector body): https://github.com/alphagov/notifications-admin/blob/d19509b1a0ec7e86ed9d3d541d060b31755c32a0/app/templates/views/request-to-go-live.html
- **[N3]** GOV.UK Notify sender ID rules: https://github.com/alphagov/notifications-admin/blob/d19509b1a0ec7e86ed9d3d541d060b31755c32a0/app/templates/views/service-settings/sms-sender/edit.html and https://github.com/alphagov/notifications-admin/blob/d19509b1a0ec7e86ed9d3d541d060b31755c32a0/app/templates/views/service-settings/receive-text-messages-stop.html
- **[P1]** Stripe best practices, payments: https://github.com/stripe/ai/blob/24947f1632ee3440ba9f27f92404beea164517b9/skills/stripe-best-practices/references/payments.md
- **[A1]** postcodes.io README: https://github.com/ideal-postcodes/postcodes.io/blob/810eebaf0da419d4726268babaeb8a41f748b89c/README.md
- **[E1]** Sentry pricing docs: https://github.com/getsentry/sentry-docs/blob/290554a6da3e858067d4184b5220262a71a84421/docs/pricing/index.mdx
- **[E2]** Sentry free quota (secondary): [R1], and https://github.com/255kb/stack-on-a-budget/blob/268acebd6c8de3b9c87bd5209bcf2aa92b67252a/pages/error-reporting.md
- **[G1]** GitHub Actions included quotas: https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/data/reusables/billing/actions-included-quotas.md
- **[G2]** GitHub Actions billing (public repos free): https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/data/reusables/actions/actions-billing.md
- **[G3]** GitHub Actions runner pricing and rounding: https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/content/billing/reference/actions-runner-pricing.md and https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/data/reusables/billing/actions-standard-runner-prices.md
- **[G4]** GitHub schedule minimum interval: https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/data/reusables/repositories/actions-scheduled-workflow-example.md
- **[G5]** GitHub schedule delays: https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/data/reusables/actions/schedule-delay.md
- **[G6]** GitHub scheduled workflows disabled after 60 days (public repos): https://github.com/github/docs/blob/dae83f7d28f3b8e10015bd6b6d8b72267cedceca/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md
