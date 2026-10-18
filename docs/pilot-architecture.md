# Pilot platform: architecture contract

The binding technical contract for the pilot build described in
[pilot-build-plan.md](./pilot-build-plan.md). Every agent and human building
this follows it. When code and this document disagree, fix one of them in the
same change. Research inputs live in [research/](./research/).

---

## A. Rules for everyone

1. **Follow the house style.** Pure, deterministic, JSON-serialisable domain
   code in `packages/domain` (no I/O, no clocks: `now` / `today` are always
   parameters). The server is the authority; the browser previews. Match the
   surrounding code's naming, comment density and idiom. Tailwind 4 with the
   existing tokens in `apps/web/app/globals.css` (`cream`, `surface`, `line`,
   `ink-*`, `accent-*`, `sage-*`); `font-display` for headings; rounded-2xl
   cards; pill buttons.
2. **No new npm dependencies.** Everything is buildable with next, react,
   zod, `@supabase/supabase-js` and platform APIs: Web Crypto, IndexedDB,
   canvas/SVG, fetch for the Stripe/Twilio REST APIs, `print` for PDFs.
3. **Money is integer pence** (`…Pence`) in all new code. Legacy quote fields
   stay integer GBP (`…Gbp`); convert at the boundary (`gbp * 100`).
4. **Dates.** ISO strings. Dates-only are `yyyy-mm-dd`. Appointment
   datetimes use the existing convention: UK wall-clock encoded as UTC
   (`2026-11-03T10:00:00.000Z` means 10:00 in London). Format with
   `lib/format.ts` helpers, never `toLocaleDateString` (hydration drift).
5. **Honest states only.** Nothing is "paid" without a verified payment
   record, "delivered" without someone recording delivery, "sent" without a
   provider acknowledgement, or "approved" without an identified, qualified
   approver. Demo and sandbox modes say so on screen.
6. **Privacy.** No real customer data in code, seeds, fixtures, docs or
   tests. Demo data is fictional and labelled DEMO.
7. **Permissions are server-side.** Every page, server action and API route
   that reads or writes pilot data checks the session (§C). Hiding a button
   is not a permission check.
8. **Tests.**
   - Every new domain module ships a `*.test.ts` (`node --test`,
     `--experimental-strip-types`).
   - Web helpers that are pure (tokens, signatures, local DB) get tests in
     `apps/web/tests/`.
   - Before declaring done: `pnpm -r typecheck`, `pnpm test`, and
     `pnpm --filter @aircon/web build` must pass.
9. **Mobile first.** All field and portal screens work at 375 px. Field
   screens have touch targets ≥ 48 px and high contrast. Use `ink-500`
   (not `ink-300`) for secondary text on cream; it passes AA.
10. **Copy.** Brand voice is cheeky in marketing, but calm, specific and
    plain at serious moments: money, contracts, safety, commissioning. Every
    customer screen has one obvious next action.

## B. Data backend: Supabase or local, same code

`getServiceClient()` (in `apps/web/lib/supabase-server.ts`) returns, in order:
1. a real Supabase client when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   are set;
2. else the **local client** when `DATA_BACKEND` is `file` or `memory`, or
   when `NODE_ENV !== "production"` (file by default in dev);
3. else `null` (legacy demo mode: public demo pages still work, nothing
   persists).

The local client (`apps/web/lib/db/local-client.ts`) implements the subset
of the supabase-js API used in this repo and returns the same
`{ data, error, count }` shapes. It's typed so callers see a
`SupabaseClient`.

**Tables:** `from(table)` with:
- `select(cols?, { count?: "exact", head?: boolean })`. Column lists
  project top-level keys; `*` returns all.
- Filters: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is` (null),
  `not(col, "is", null)`, `like`, `ilike`, `match`, `or` (simple
  `a.eq.x,b.eq.y` form).
- Modifiers: `order(col, { ascending, nullsFirst })`, `limit`, `range`,
  `single`, `maybeSingle`.
- Writes: `insert(row|rows)` with optional `.select()`, `update(patch)`
  with filters, `upsert(row, { onConflict })`, `delete()` with filters.
- Defaults: `id` → `crypto.randomUUID()` unless provided; `created_at` /
  `updated_at` → now.
- Unique constraints are declared in a small registry (e.g.
  `projects.quote_id`, `messages.idempotency_key`, `payments.provider_ref`,
  `staff.email`, `install_evidence.id`) and produce a PostgREST-style error
  `{ code: "23505" }`.
- Concurrency: a per-process mutex.

**Persistence:** `file` mode writes JSON per table under `apps/web/.data/`
(gitignored) atomically (write temp file, then rename). `memory` mode keeps
an in-process Map.

**Storage:** `storage.from(bucket)` with `createSignedUploadUrl(path)`,
`createSignedUrl(path, expiresIn)`, `createSignedUrls(paths, expiresIn)`,
`upload`, `download`, `remove`, `list`.
- Signed URLs point at `/api/local-files/<bucket>/<path>?exp=…&sig=…`,
  HMAC-signed with `SESSION_SECRET` (dev fallback secret). PUT uploads and
  GET reads.
- Files are stored under `.data/storage/<bucket>/<path>`.
- The existing browser upload code does `fetch(signedUrl, { method: "PUT" })`
  and must work unchanged.

`requireDb()` throws a clear error when the client is null. Use it in new
code, where demo mode is not meaningful.

Buckets: `survey-photos` (existing, customer funnel), `survey-videos`
(existing), and **`project-media`** (new, private; all staff and field
photos, signatures, documents).

## C. Identity, sessions, roles

**Sessions:**
- Cookie `dih_session`: HMAC-SHA256-signed JSON (`base64url(payload).sig`)
  via Web Crypto, httpOnly, `SameSite=Lax`, `Secure` in production, 30-day
  expiry.
- Secret: `SESSION_SECRET`. Without it, dev uses a fixed fallback and logs a
  warning; production refuses to sign.
- Code: `apps/web/lib/auth/session.ts` (Edge-safe, used by middleware) and
  `lib/auth/server.ts` (Node).

```ts
type Session =
  | { kind: "staff"; staffId: string; email: string; name: string; roles: StaffRole[]; external: boolean; exp: number }
  | { kind: "customer"; customerId: string; email: string; name: string; projectIds: string[]; exp: number };
```

**Magic links:**
- `login_tokens` rows store `sha256(token)`, the subject, purpose `login`,
  `next` path and `expires_at`. Staff tokens expire in 20 minutes; links in
  customer operational emails last 30 days and are single-use.
- `GET /auth/verify?t=…` exchanges the token for a session and redirects to
  `next`.
- `issueMagicLink({ email, kind, next })` sends via the outbox
  (`magic-link` event). Where email isn't configured (dev, demo), the link
  is shown on screen.
- A customer email embeds a fresh token per send
  (`customerLink(projectId, path)` helper).

**Staff bootstrap:** `ADMIN_EMAILS` (comma list). The first sign-in from
such an email upserts an admin `staff` row. Break-glass: when
`OPS_PASSWORD` is set, `/login` also accepts an admin email plus that
password.

**Demo sign-in** (`/login` "Try as…" buttons for each role): enabled only
when `NODE_ENV !== "production"` or `ALLOW_DEMO_LOGIN=1`. It creates or
uses DEMO staff.

**Middleware** (`apps/web/middleware.ts`):
- `/ops/**` and `/field/**` require a valid staff session; otherwise
  redirect to `/login?next=…`.
- The legacy basic-auth wall is removed (break-glass replaces it).
- Customer pages check access in the page itself, not middleware.

**Guards** (`lib/auth/server.ts`):

```ts
getSession(): Promise<Session | null>
requireStaff(perm?: Permission): Promise<StaffMember>               // pages/actions: redirect /login, or 403 page
requireStaffApi(req, perm?): Promise<StaffMember | Response>        // API routes
requireProjectAccess(projectId, opts?: { perm?: Permission; allowCustomer?: boolean }):
  Promise<{ kind: "staff"; staff: StaffMember } | { kind: "customer"; customerId: string } | null>
```

External staff (subcontractors) may only access projects where they're the
assigned surveyor or crew. Customers may only access their own
`projectIds`. Anything else gets a 404, never a hint that the record
exists.

**Roles and permissions** live in the domain (`staff.ts`, §D2): `can(staff,
perm)` is the only check used anywhere.

## D. Domain contracts (`packages/domain/src`)

Foundation creates every file below with the types exactly as written, and
the functions marked **[F]**. Feature agents implement the functions marked
**[F#]** in the same file (they own those files' logic). Every file is
exported from `index.ts` by the foundation, so feature agents never edit
`index.ts`.

### D1 · `settings.ts` [F]

```ts
export type TaxCodeId = "standard-20" | "reduced-5" | "zero-esm" | "outside-scope";
export const TAX_CODES: Record<TaxCodeId, { label: string; ratePct: number; note: string }>;
export interface DiscountCode { code: string; label: string; pct?: number; amountPence?: number; reason: string; active: boolean }
export interface PilotSettings {
  company: {
    legalName: string; tradingName: string; companyNumber?: string; registeredAddress?: string;
    phone: string; email: string; vatNumber?: string;
    fgasCompanyCert?: { body: string; number: string; expiresOn?: string };
    insurance?: { provider: string; policy: string; expiresOn?: string };
    bank?: { accountName: string; sortCode: string; accountNumber: string };
  };
  tax: { vatRegistered: boolean; defaultTaxCode: TaxCodeId; accountantConfirmed: boolean; rationale: string };
  pricing: {
    minMarginPct: number; contingencyPct: number; overheadPerJobPence: number; quoteValidityDays: number;
    requireEngineerSignoff: boolean;
    labourRates: { installerDayPence: number; electricianDayPence: number; techLeadDayPence: number; surveyorHourPence: number };
    premiumUpliftPct: number; // fallback uplift when a premium option is priced off the engine list price
  };
  discounts: DiscountCode[];
  payments: { depositPct: number; depositTiming: "on-acceptance" | "before-kit-order"; balanceDueDays: number;
    methods: ("card" | "bank-transfer")[]; invoicePrefix: string; nextInvoiceNumber: number };
  scheduling: { installBlockDays: number; surveySlotTimes: string[]; surveyDurationMinutes: number;
    surveyFeeGbp: number; cancellationDays: number; workingDays: number[] /* 1=Mon … 5=Fri */ };
  serviceArea: { outcodes: string[] };
  sla: { enabled: boolean };
  warranty: { workmanshipYears: number | null; manufacturerSummary: string | null };
  legal: { termsVersion: string; termsReviewed: boolean; cancellationReviewed: boolean };
  comms: { smsSenderId: string; disabledEvents: string[] };
  finance: { lenderConfigured: boolean };
  features: { showPrototypeNav: boolean };
}
export const DEFAULT_SETTINGS: PilotSettings;
export function mergeSettings(stored: unknown): PilotSettings; // deep-merge stored JSON over defaults, tolerant of missing keys
export function isInServiceArea(settings: PilotSettings, postcode: string): boolean;
export function effectiveTaxCode(settings: PilotSettings): TaxCodeId; // outside-scope when not VAT registered
```

Defaults:
- Not VAT-registered (`outside-scope`), `accountantConfirmed: false`.
- `minMarginPct` 25, `contingencyPct` 5, validity 30 days,
  `requireEngineerSignoff` true.
- Labour: installer £220/day, electrician £250/day, tech lead £280/day,
  surveyor £40/h. These are placeholders; research may refine them.
- `premiumUpliftPct` 18.
- Discounts: `PILOT15` 15%, `PILOT30` 30%, `PILOTCUSTOM` (amount, set per
  job).
- Deposit 0%, `on-acceptance`, balance due 7 days, methods
  `["bank-transfer", "card"]`, prefix `DIH`, next 1.
- Install block 3 days; survey slots 10:00 / 13:00 / 16:00; survey 90
  minutes; survey fee £0; cancellation 14 days; working days Mon–Fri.
- Service area: `SW2 SW4 SW11 SW12 SW16 SW17 SW18 SW19 SE19 SE25 SE27 CR0
  CR2 CR4 CR7 CR8 E3` (editable; covers the pilot areas).
- SLA off; warranty `null` / `null` (no warranty claims until set); terms
  `pilot-draft-1`, unreviewed; SMS sender `DangItsHot`; lender `false`;
  prototype nav `false`.

### D2 · `staff.ts` [F]

```ts
export type StaffRole = "admin" | "surveyor" | "tech-lead" | "installer" | "electrician";
export type QualificationKind = "fgas-cat1" | "part-p" | "18th-edition" | "pasma" | "ipaf" | "asbestos-awareness" | "first-aid";
export const QUALIFICATION_LABEL: Record<QualificationKind, string>;
export interface Qualification { kind: QualificationKind; reference: string; issuer?: string; expiresOn?: string; mediaId?: string; verifiedAt?: string; verifiedBy?: string }
export interface StaffMember { id: string; email: string; name: string; phone?: string; roles: StaffRole[]; external: boolean; active: boolean; qualifications: Qualification[]; bio?: string; photoMediaId?: string; demo?: boolean }
export type Permission =
  | "projects.view-all" | "projects.edit" | "settings.edit" | "staff.edit" | "catalogue.edit" | "finance.view-margin"
  | "survey.conduct" | "design.edit" | "design.approve" | "proposal.edit" | "proposal.issue" | "schedule.edit"
  | "purchasing.edit" | "payments.record" | "compliance.review" | "install.work" | "install.review"
  | "commissioning.sign" | "messages.send" | "pilots.view";
export function permissionsFor(staff: Pick<StaffMember, "roles" | "external" | "active">): Set<Permission>;
export function can(staff: Pick<StaffMember, "roles" | "external" | "active">, perm: Permission): boolean;
export function hasCurrentQualification(staff: Pick<StaffMember, "qualifications">, kind: QualificationKind, onIso: string): boolean;
export type StepRequirement = "fgas" | "electrical" | "tech-lead";
export function meetsRequirement(staff: StaffMember, req: StepRequirement, onIso: string): boolean;
```

Matrix:
- **admin:** all.
- **tech-lead:** everything except `settings.edit` and `staff.edit`; holds
  `design.approve`, `compliance.review`, `install.review`,
  `commissioning.sign`.
- **surveyor:** view-all, edit, `survey.conduct`, `design.edit`,
  `proposal.edit`, `finance.view-margin`, `messages.send`, `pilots.view`.
- **installer:** `install.work`, `messages.send`.
- **electrician:** `install.work`.
- **`external: true`** removes `projects.view-all`,
  `finance.view-margin`, `settings.edit`, `staff.edit`, `pilots.view` and
  `catalogue.edit`.
- **Inactive** staff have nothing.

Requirements:
- `fgas` needs a current `fgas-cat1` qualification.
- `electrical` needs current `part-p` (or `18th-edition` for testing steps
  done under a scheme member; keep it simple: `part-p`).
- `tech-lead` needs the tech-lead or admin role **and** current
  `fgas-cat1`.

### D3 · `project.ts` (rewritten as v2) [F]

Stages and copy:

```ts
export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_STAGES = ["price", "survey", "proposal", "booking", "kit", "install", "handover", "aftercare"] as const;
export type ProjectStageId = (typeof PROJECT_STAGES)[number];
export interface StageInfo { id: ProjectStageId; label: string; title: string; strap: string; explainer: string[] }
export const STAGE_INFO: Record<ProjectStageId, StageInfo>;
```

Labels: Price · Survey · Proposal · Booking · Kit · Install · Handover ·
Aftercare. Rewrite the explainers for the new journey: the survey is an
in-person home visit; the proposal is designed on your own photos and signed
off by a qualified engineer; the install takes three days; handover includes
commissioning and your documents. Warranty copy must come from settings; the
domain copy never states years.

State:

```ts
export type ProjectActor = "customer" | "ops" | "field" | "system";
export interface ProjectEvent { at: string; type: string; label: string; actor: ProjectActor; actorName?: string; internal?: boolean; feeGbp?: number }
export interface CrewMember { staffId: string; name: string; role: StaffRole; external: boolean }
export interface InstallDay { n: number; date: string; status: "planned" | "in-progress" | "done"; startedAt?: string; endedAt?: string;
  summary?: string; customerUpdate?: { text: string; mediaIds: string[]; sentAt: string } }
export interface PrepItem { id: string; label: string; detail: string; confirmable: boolean; done: boolean } // unchanged from v1
export type ElectricsPlanStatus = "provisional" | "attention" | "validated"; // unchanged
export interface InstallerProfile { name: string; role: string; bio: string; yearsExperience: number } // kept for migration only

export interface Project {
  schemaVersion: 2;
  id: string; quoteId: string; createdAt: string;
  pilot?: { number: number; label: string };
  customer: { name: string; email?: string; phone?: string; postcode: string; addressLine: string; customerId?: string;
    accessNotes?: string; parkingNotes?: string };
  owner?: { staffId: string; name: string };
  nextAction?: { text: string; dueOn?: string; ownerRole?: StaffRole | "customer" };
  quoteSummary: { totalGbp: number; installDays: number; roomCount: number; confidenceBand: ConfidenceBand; systems: string[];
    roomDesigns: { name: string; floor: string; unitLabel: string }[] };
  roughPlan: { archetypeName?: string; pattern?: { label: string; summary: string; pipeRoute: string } };
  survey: { status: "not-booked" | "booked" | "in-progress" | "submitted"; mode: "in-person" | "video";
    scheduledFor?: string; durationMinutes: number; feeGbp: number; paymentStatus: "not-required" | "unpaid" | "paid";
    surveyor?: { staffId: string; name: string }; onMyWay?: { at: string; etaMinutes: number };
    startedAt?: string; submittedAt?: string; surveyRecordId?: string; rescheduleFeesGbp: number };
  electrics: { status: ElectricsPlanStatus; summary: string; surveyCondition: ElectricsCondition };
  design: { status: "not-started" | "draft" | "in-review" | "approved"; designId?: string; version?: number; approvedAt?: string; approvedBy?: string };
  proposal: { status: "not-issued" | "issued" | "changes-requested" | "accepted" | "declined" | "expired";
    proposalId?: string; version?: number; issuedAt?: string; viewedAt?: string; validUntil?: string; optionCount?: number;
    acceptedAt?: string; acceptedOptionLabel?: string; contractTotalPence?: number;
    earlyStartRequested?: boolean; cancellationEndsOn?: string; changeRequest?: string; declineReason?: string };
  booking: { status: "not-booked" | "booked"; startDate?: string; dates: string[]; installDays: number; crew: CrewMember[];
    depositStatus: "not-required" | "requested" | "paid"; rescheduleFeesGbp: number; prep: PrepItem[] };
  kit: { status: "not-ordered" | "ordered" | "confirmed" | "dispatched" | "delivered" | "inspected";
    expectedDate?: string; deliveredAt?: string; inspectedAt?: string; summary?: string; shortages: number };
  install: { status: "not-started" | "in-progress" | "complete"; days: InstallDay[]; startedAt?: string; completedAt?: string;
    onMyWay?: { at: string; etaMinutes: number; by: string } };
  handover: { status: "pending" | "commissioned" | "handed-over"; commissionedAt?: string; commissionedBy?: string; handedOverAt?: string;
    signoff?: { at: string; name: string; outcome: "all-good" | "snags"; snagCount: number };
    packDocumentId?: string; electricalCert: "pending" | "received" | "not-required"; warrantyRegistered: boolean; warrantyDueOn?: string };
  closure: { closed: boolean; closedAt?: string; reason?: string };
  aftercare: { checkIn7dSentAt?: string; feedbackRequestedAt?: string; feedback?: { at: string; score: number; comments?: string };
    serviceDueOn?: string };
  money: { contractTotalPence?: number; invoicedPence: number; paidPence: number; changeFeesPence: number };
  events: ProjectEvent[];
}
```

Gates, readiness and the reducer:

```ts
export type GateId = "survey-complete" | "proposal-issue" | "proposal-accept" | "booking" | "ready-to-install"
  | "install-complete" | "commissioned" | "handed-over" | "closed";
export interface Blocker { gate: GateId; code: string; message: string; severity: "block" | "warn";
  owner: StaffRole | "customer" | "ops"; action?: string }
export interface ReadinessContext {
  today: string;
  settings: PilotSettings;
  actor?: StaffMember;                                  // the person doing the action (gates that need qualifications)
  surveyCompleteness?: { pct: number; missing: string[] };
  design?: { status: string; approvedBy?: string; compatibilityErrors: string[] };
  proposalCheck?: { belowMinMargin: boolean; marginOverride: boolean; taxConfirmed: boolean; taxOverride: boolean; expired: boolean };
  compliance: { key: string; label: string; status: ComplianceStatus; statutory: boolean; gate: GateId }[];
  crew: StaffMember[];                                  // full records of booking.crew
  kit?: { requiredLines: number; deliveredLines: number; inspectedLines: number; damaged: number };
  openIssues: { id: string; title: string; kind: string; severity: string; blocking: boolean; gate?: GateId }[];
  runsheet?: { complete: boolean; openExceptions: number; missing: number; blocked: number; walkthroughDone: boolean };
  commissioning?: { signed: boolean; signedBy?: string };
  money?: { depositDuePence: number; depositPaidPence: number; outstandingPence: number };
}
export function readiness(project: Project, ctx: ReadinessContext): Blocker[];          // all gates
export function blockersFor(project: Project, ctx: ReadinessContext, gate: GateId): Blocker[];
export function nextGate(project: Project): GateId | null;
export function isStageComplete(project: Project, stage: ProjectStageId): boolean;
export function currentStage(project: Project): ProjectStageId;
export function stageState(project: Project, stage: ProjectStageId): "complete" | "current" | "upcoming";
export function projectTimeline(project: Project, todayIso: string): TimelineEntry[];  // same TimelineEntry shape as v1
export function migrateProject(raw: unknown): Project;                                  // v1 → v2, idempotent on v2
export function createProject(input: CreateProjectInput): Project;                      // same input as v1 (+ optional customer email/phone)
export function applyProjectAction(project: Project, action: ProjectAction, now: string, ctx?: ReadinessContext): ApplyResult;
export function projectFees(project: Project): { changeFeesGbp: number; surveyPaidGbp: number };
export function customerNextAction(project: Project): { label: string; href?: string } | null; // the ONE thing the customer should do now
export const DEFAULT_PREP_ITEMS: Omit<PrepItem, "done">[];   // keep v1 list
export function rescheduleFeeGbp(kind: "survey" | "installation", daysNotice: number): number; // keep v1 fee table (site-visit → survey)
```

Stage completion:

| Stage | Complete when |
| --- | --- |
| price | survey booked |
| survey | survey submitted |
| proposal | proposal accepted |
| booking | booking status `booked` |
| kit | kit delivered or inspected |
| install | install complete |
| handover | handed over |
| aftercare | closure closed |

Gate rules (`block` unless noted):

| Gate | Rules |
| --- | --- |
| **survey-complete** | `surveyCompleteness.missing` is empty |
| **proposal-issue** | Design approved (if `requireEngineerSignoff`), with no compatibility errors. Tax confirmed (`!vatRegistered`, or `accountantConfirmed`, or `taxOverride`). Not below minimum margin (or `marginOverride`). Terms unreviewed → **warn**. |
| **proposal-accept** | Proposal issued and not expired |
| **booking** | Proposal accepted. At least one crew member meets `fgas`. Someone meets `electrical`; if nobody does → **block**, owner ops, "assign a Part P electrician". Deposit paid when `depositPct > 0` and timing `on-acceptance`. Dates chosen. |
| **ready-to-install** | Booking complete. Kit delivered (`deliveredLines >= requiredLines` and `requiredLines > 0`); not yet inspected → **warn**. Every statutory compliance item for gates ≤ ready-to-install `approved` or `not-applicable`; non-statutory ones → **warn**. No open blocking issues. Cancellation period ended (`today >= cancellationEndsOn`) or `earlyStartRequested`. |
| **install-complete** | `runsheet.complete` and `openExceptions === 0` |
| **commissioned** | `commissioning.signed` |
| **handed-over** | Commissioned, pack published, signoff recorded, walkthrough done |
| **closed** | `money.outstandingPence === 0`; electrical cert received or not required; warranty registered; no open high or critical issues |

Actions (one discriminated union, `ProjectAction`). Each appends a
customer-facing `ProjectEvent`; ops-only events set `internal: true`.

| Action | Payload | Guard (reducer) |
| --- | --- | --- |
| `book-survey` (customer) / `ops-book-survey` | `{ scheduledFor, mode, surveyor? }` | survey not submitted; slot in future |
| `reschedule-survey` | `{ scheduledFor }` | survey booked; fee by notice |
| `assign-surveyor` | `{ staffId, name }` | – |
| `surveyor-on-my-way` | `{ etaMinutes, by }` | survey booked |
| `survey-started` | `{ by }` | survey booked |
| `survey-submitted` | `{ surveyRecordId }` | `ctx` survey-complete gate clear |
| `design-updated` | `{ designId, version, status: "draft" \| "in-review" }` | survey submitted |
| `design-approved` | `{ designId, version, by }` | `ctx.actor` can `design.approve` and meets `tech-lead` |
| `proposal-issued` | `{ proposalId, version, validUntil, optionCount }` | proposal-issue gate clear (`ctx`) |
| `proposal-viewed` | `{ proposalId }` | issued; sets `viewedAt` once |
| `proposal-changes-requested` | `{ text }` | issued |
| `proposal-declined` | `{ reason }` | issued |
| `proposal-accepted` | `{ proposalId, version, optionLabel, contractTotalPence, earlyStartRequested }` | proposal-accept gate; sets `cancellationEndsOn = date(now) + settings.cancellationDays`, `money.contractTotalPence` |
| `proposal-expired` | `{}` | issued and `validUntil < today` |
| `install-dates-set` (customer or ops) | `{ startDate, dates }` | proposal accepted; dates are working days; length = `booking.installDays`; start ≥ today+5 (lead); install not started |
| `crew-assigned` | `{ crew: CrewMember[] }` | – |
| `booking-confirmed` | `{}` | booking gate clear |
| `deposit-requested` / `deposit-paid` | `{ amountPence }` | – |
| `kit-updated` | `{ status, expectedDate?, summary?, shortages }` | booking confirmed. Customer label is conservative: ordered / supplier confirmed for {date} / delivered / checked by your installer |
| `installer-on-my-way` | `{ etaMinutes, by }` | booking confirmed |
| `install-day-started` | `{ n, by }` | n=1 requires ready-to-install gate (`ctx`); n>1 requires day n−1 started |
| `install-day-ended` | `{ n, summary, customerUpdate? }` | day n started |
| `install-completed` | `{}` | install-complete gate |
| `commissioning-signed` | `{ by }` | install complete; `ctx.actor` meets `tech-lead` and has `commissioning.sign` |
| `handover-pack-published` | `{ documentId }` | commissioned |
| `handover-signed` | `{ name, outcome, snagCount }` | pack published; status → handed-over; `warrantyDueOn`; `serviceDueOn` = +12 months |
| `electrical-cert-updated` | `{ status }` | – |
| `warranty-registered` | `{}` | – |
| `invoice-issued` | `{ amountPence }` | updates `money.invoicedPence` |
| `payment-recorded` | `{ amountPence }` | updates `money.paidPence` (only ever called after a verified payment record) |
| `prep-toggled` | `{ itemId, done }` | – |
| `aftercare-checkin-sent` / `feedback-requested` | `{}` | – |
| `feedback-submitted` | `{ score, comments? }` | 0–10 |
| `set-next-action` | `{ text, dueOn?, ownerRole? }` | – |
| `set-pilot` | `{ number, label }` | – |
| `set-customer-contact` | `{ email?, phone?, accessNotes?, parkingNotes? }` | – |
| `project-closed` | `{ reason? }` | closed gate (`ctx`), unless reason is "cancelled" |
| `note` | `{ text }` | internal |

`ApplyResult = { ok: true; project } | { ok: false; error: string; blockers?: Blocker[] }`.
When a gate fails, return its blockers so the UI can show exactly what's
missing.

`migrateProject` mapping:
- `floorPlan` → `roughPlan`.
- `siteVisit` → `survey`:
  - `completed` → `submitted`, `scheduledFor` kept, `mode` mapped
    (`video` / `in-person`);
  - fee and payment as-is (paid stays paid; unpaid with fee 0 →
    `not-required`).
- `finalQuote` → `proposal`: `issued` → `issued` (no proposalId), `accepted`
  → `accepted` with `contractTotalPence = totalGbp * 100`.
- `installation` → `booking`: `booked` → `booked`, start date, dates =
  `installDays` consecutive working days, `installer` → crew entry
  (`role: "installer"`, `staffId: "legacy"`).
- `delivery` → `kit`: scheduled → `ordered`; `dispatched` / `delivered` as-is.
- `installation.completed` → install complete, handover pending.
- `events` kept.

### D4 · Entity types (types-only in foundation, logic by features)

Each file below is created by the foundation with these exact types, plus
stub functions that throw `new Error("not implemented")` where a feature
owns them. Feature agents replace the stubs and add tests.

**`survey-visit.ts`** (logic: F2)

```ts
export type WallConstruction = "solid-brick" | "cavity" | "timber-frame" | "stone" | "concrete" | "plasterboard" | "unknown";
export type PdCheckId = "heating-use" | "not-listed" | "not-conservation-front" | "volume-ok" | "unit-count-ok" | "noise-ok" | "siting-minimises-impact" | "article4-checked";
export const PD_CHECKS: { id: PdCheckId; label: string; help: string }[];
export interface MeasuredRoom {
  id: string; name: string; type: RoomType; floor: FloorLevel; include: boolean;
  lengthM?: number; widthM?: number; areaM2?: number; ceilingHeightM?: number;
  glazing: GlazingLevel; orientation: Orientation; occupancy?: "low" | "normal" | "high"; gainsNote?: string;
  hasExternalWall: boolean; wallConstruction?: WallConstruction;
  pipeRunM?: number; heightDropM?: number;
  route?: "through-wall" | "external-trunking" | "internal-concealed" | "via-loft" | "other"; routeNote?: string;
  condensate: "gravity" | "pump" | "tbc"; condensateNote?: string; obstacles?: string;
  priority?: "quiet" | "discreet" | "fast-cooling" | "heating"; mediaIds: string[]; selfSurveyRoomId?: string;
}
export interface OutdoorPosition { id: string; label: string; location: OutdoorLocation; mediaId?: string; distanceToNeighbourWindowM?: number;
  base: "ground-feet" | "wall-bracket" | "slab" | "roof-frame" | "other"; heightM?: number;
  accessEquipment: "none" | "ladder" | "tower" | "scaffold"; defrostDrainage?: string; chosen: boolean; note?: string }
export interface MeasuredSurvey {
  version: 1;
  site: { confirmedAddress: boolean; decisionMaker?: string; ownerConfirmed: boolean; tenure: "owner" | "leaseholder" | "tenant" | "unknown";
    accessNotes?: string; parkingNotes?: string; petsKids?: string; siteContactPhone?: string };
  wishes: { priorities: ("quiet" | "discreet" | "heating" | "cooling" | "smart-control" | "budget")[];
    heatingUse: "main" | "supplementary" | "cooling-only-intent" | "unsure"; timing?: string; notes?: string };
  house: { type: PropertyType; era: PropertyEra; wallConstruction: WallConstruction; storeys: number; loftAccess: boolean;
    listedOrConservation: "no" | "yes" | "unknown"; asbestosRisk: "none-suspected" | "possible" | "suspected" | "not-assessed";
    asbestosNote?: string; notes?: string };
  rooms: MeasuredRoom[];
  outdoor: { positions: OutdoorPosition[] };
  electrics: { boardType: "modern-rcbo" | "modern-rcd" | "older-fuse-box" | "unknown"; spareWays?: number;
    earthing?: "TN-C-S" | "TN-S" | "TT" | "unknown"; cableRouteM?: number; cableRouteNote?: string;
    asbestosFlashGuard: "no" | "possible" | "yes" | "n/a"; mediaIds: string[]; notes?: string };
  permissions: { pd: Partial<Record<PdCheckId, "yes" | "no" | "unsure">>; notes?: string };
  risks: { workingAtHeight: boolean; structuralConcern: boolean; concealedServicesConcern: boolean; notes?: string };
  assumptions: string[]; unknowns: string[];
}
export interface SurveyRecord { id: string; projectId: string; version: number; status: "draft" | "submitted"; data: MeasuredSurvey;
  surveyor?: { staffId: string; name: string }; startedAt?: string; submittedAt?: string; minutes?: number }
export interface SurveyCompleteness { pct: number; missing: { section: string; item: string }[] }
export interface SelfSurveyDiffRow { room: string; field: string; customerSaid: string; measured: string; match: boolean | null; note?: string }
export function emptyMeasuredSurvey(selfSurvey?: Survey): MeasuredSurvey;          // [F2] prefill from the customer's survey
export function surveyCompleteness(m: MeasuredSurvey): SurveyCompleteness;         // [F2]
export function measuredToEngineSurvey(m: MeasuredSurvey, base: Survey): Survey;   // [F2] for pricing/design engines (areaM2 etc.)
export function diffSelfSurvey(self: Survey, m: MeasuredSurvey): SelfSurveyDiffRow[]; // [F2]
```

**`media.ts`** (logic: F2)

```ts
export const PHOTO_TAGS = ["room-overview", "indoor-wall", "external-wall", "outdoor-location", "pipe-route", "electrical-supply",
  "fuse-board", "drainage", "access", "obstruction", "existing-condition", "progress", "completed", "kit", "serial", "gauge",
  "signature", "document", "other"] as const;
export type PhotoTag = (typeof PHOTO_TAGS)[number];
export const PHOTO_TAG_LABEL: Record<PhotoTag, string>;
export interface Point { x: number; y: number } // normalised 0..1 of the image box
export type Annotation =
  | { id: string; type: "indoor-unit" | "outdoor-unit"; x: number; y: number; w: number; h: number; label?: string }
  | { id: string; type: "core-hole"; x: number; y: number; label?: string }
  | { id: string; type: "route"; kind: "pipe" | "condensate" | "cable"; points: Point[]; label?: string }
  | { id: string; type: "obstacle"; x: number; y: number; label: string }
  | { id: string; type: "measure"; from: Point; to: Point; label: string }
  | { id: string; type: "note"; x: number; y: number; text: string };
export const ANNOTATION_STYLE: Record<string, { label: string; colour: string }>; // keys: indoor-unit, outdoor-unit, core-hole, pipe, condensate, cable, obstacle, measure, note
export interface MediaItem { id: string; projectId: string; bucket: string; storagePath: string; contentType: string; tag: PhotoTag;
  roomId?: string; caption?: string; source: "customer" | "survey" | "install" | "handover" | "ops";
  takenBy?: { kind: "staff" | "customer"; id?: string; name?: string }; takenAt: string; customerVisible: boolean;
  width?: number; height?: number; annotations: Annotation[]; annotationsVersion: number; locked: boolean }
export function validateAnnotations(input: unknown): Annotation[];  // [F2] zod-free manual validation, clamps to 0..1, drops junk
```

**`catalogue.ts`** (logic: F3)

```ts
export type CatalogueKind = "indoor" | "outdoor" | "material" | "labour" | "tool" | "service";
export interface EquipmentSpecs { coolingKw: number | null; heatingKw: number | null; seer: number | null; scop: number | null;
  energyClassCooling: string | null; energyClassHeating: string | null; soundPressureLowDb: number | null; soundPressureHighDb: number | null;
  soundPowerDb: number | null; dimensionsMm: { w: number; h: number; d: number } | null; weightKg: number | null; refrigerant: string | null;
  liquidPipeMm: number | null; gasPipeMm: number | null; maxPipeM: number | null; maxHeightDiffM: number | null; prechargedPipeM: number | null;
  additionalChargeGPerM: number | null; powerSupply: string | null; recommendedBreakerA: number | null; wifi: string | null;
  operatingRangeCoolingC: string | null; operatingRangeHeatingC: string | null }
export interface CatalogueItem { id: string; kind: CatalogueKind; manufacturer?: string; series?: string; model?: string; label: string;
  tier?: "standard" | "premium"; multiSplitCapable?: boolean; ports?: number | null; pairedWith?: string | null;
  specs?: Partial<EquipmentSpecs>; unit?: string; category?: string; customerBlurb?: string;
  costPence: number | null; costSource?: { url?: string; supplier?: string; observedAt?: string; vatIncluded?: boolean; note?: string };
  supplier?: string; status: "available" | "uncertain" | "discontinued"; confidence: "verified" | "provisional" | "stale";
  verifiedAt?: string; sources: { url: string; title?: string }[]; warranty?: string | null; notes?: string; active: boolean }
export interface CompatibilityRule { id: string; outdoorModel: string; maxIndoorUnits: number; connectableIndoorSeries: string[];
  connectableIndoorModels: string[]; minConnectedKw: number | null; maxConnectedKw: number | null; maxTotalPipeM: number | null;
  maxPipePerRoomM: number | null; source: { url: string; title?: string } | null; confidence: "verified" | "provisional" }
export interface CombinationCheck { ok: boolean; errors: string[]; warnings: string[] }
export function validateCombination(rule: CompatibilityRule | undefined, outdoor: CatalogueItem, indoors: CatalogueItem[], pipeRunsM: number[]): CombinationCheck; // [F3]
export function singlePairFor(indoor: CatalogueItem, catalogue: CatalogueItem[]): CatalogueItem | undefined;                  // [F3]
export function catalogueToCsv(items: CatalogueItem[]): string;                                                              // [F3]
export function catalogueFromCsv(csv: string): { items: CatalogueItem[]; errors: string[] };                                // [F3]
export function isCustomerSafe(item: CatalogueItem): boolean; // [F3] provisional items may be designed with but are labelled
export const DEMO_CATALOGUE: CatalogueItem[];        // [F3] fictional-but-plausible DEMO-labelled items for demo mode + tests
export const DEMO_COMPATIBILITY: CompatibilityRule[]; // [F3]
```

**`design-record.ts`** (logic: F3)

```ts
export interface RoomDesignInput { roomId: string; roomName: string; floor: FloorLevel; preliminaryLoadW: number; suggestedKw: number;
  chosenKw: number; reason?: string; pipeRunM: number; heightDiffM: number; condensate: "gravity" | "pump"; layoutMediaIds: string[] }
export interface DesignBomLine { catalogueItemId?: string; sku: string; label: string; qty: number; unit?: string;
  category: "equipment" | "materials" | "consumables" }
export interface SystemSelection { id: string; topology: "single" | "multi"; outdoorItemId: string; roomIds: string[]; outdoorPositionId?: string;
  compatibility: CombinationCheck; electrical: { breaker: string; cableMm2: number; isolator: string; routeNote?: string };
  refrigerant: { totalPipeM: number; prechargedPipeM: number; additionalChargeG: number } }
export interface DesignVariant { id: string; label: string; tier: "standard" | "premium"; systems: SystemSelection[];
  roomUnits: { roomId: string; indoorItemId: string }[]; bom: DesignBomLine[]; rules: RuleResult[]; verdict: DesignVerdict; installDays: number }
export interface DesignOverride { field: string; from: string; to: string; reason: string; by: string; at: string }
export interface DesignRecord { id: string; projectId: string; version: number; status: "draft" | "in-review" | "approved" | "superseded";
  surveyRecordId?: string; rooms: RoomDesignInput[]; variants: DesignVariant[]; overrides: DesignOverride[]; notes?: string;
  approval?: { staffId: string; name: string; qualificationRef: string; at: string }; createdAt: string; createdBy?: string }
export function draftDesign(input: { projectId: string; id: string; version: number; measured: MeasuredSurvey; baseSurvey: Survey;
  catalogue: CatalogueItem[]; compatibility: CompatibilityRule[]; intel?: PropertyIntel; now: string }): DesignRecord; // [F3]
export function recomputeVariant(design: DesignRecord, variantId: string, catalogue: CatalogueItem[], compatibility: CompatibilityRule[]): DesignVariant; // [F3]
export function designApprovalErrors(design: DesignRecord): string[]; // [F3] e.g. compatibility errors, reasons missing on overrides, missing layout photos
```

**`costing.ts`** (logic: F4)

```ts
export type CostCategory = "equipment" | "materials" | "labour" | "subcontract" | "access" | "delivery" | "consumables" | "contingency" | "overhead";
export interface CostLine { id: string; category: CostCategory; label: string; qty: number; unit: string; unitCostPence: number | null;
  totalPence: number | null; source?: string; catalogueItemId?: string; verified: boolean }
export interface LabourPlan { crewSize: number; installerDays: number; electricianDays: number; techLeadDays: number }
export interface PriceLine { id: string; label: string; detail?: string; amountPence: number; kind: "system" | "room" | "extra" | "discount" | "fee" }
export interface OptionPricing { pricingBasis: "engine" | "cost-plus" | "manual"; manualReason?: string; listNetPence: number;
  discount?: { code: string; label: string; reason: string; amountPence: number }; netPence: number; taxCode: TaxCodeId; taxPence: number;
  totalPence: number; costPence: number; unpricedCostLines: number; grossMarginPct: number; grossMarginPctBeforeDiscount: number;
  contributionPence: number; belowMinMargin: boolean }
export function engineListNetPence(survey: Survey): number;           // [F4] round(generateQuote(survey).totalGbp * 100 / 1.2)
export function buildCostLines(input: { variant: DesignVariant; catalogue: CatalogueItem[]; labour: LabourPlan; settings: PilotSettings;
  extras?: CostLine[] }): CostLine[];                                  // [F4] includes unrecoverable input VAT when not VAT registered
export function priceOption(input: { costLines: CostLine[]; basis: OptionPricing["pricingBasis"]; engineNetPence: number; manualNetPence?: number;
  manualReason?: string; discountCode?: string; customDiscountPence?: number; discountReason?: string; settings: PilotSettings;
  tier: "standard" | "premium" }): OptionPricing;                      // [F4]
export function defaultLabourPlan(variant: DesignVariant, settings: PilotSettings): LabourPlan; // [F4]
```

**`proposal.ts`** (logic: F4)

```ts
export interface RoomCard { roomId: string; roomName: string; unitName: string; why: string; highlights: string[]; mediaIds: string[] }
export interface ProposalOption { id: string; label: string; tier: "standard" | "premium"; designVariantId: string; summary: string;
  highlights: string[]; roomCards: RoomCard[]; outdoorMediaIds: string[]; priceLines: PriceLine[]; costLines: CostLine[];
  labour: LabourPlan; pricing: OptionPricing; installDays: number }
export interface AcceptanceRecord { optionId: string; optionLabel: string; totalPence: number; name: string; email?: string;
  termsVersion: string; cancellationNoticeVersion: string; acknowledgedCancellationInfo: true; earlyStartRequested: boolean;
  acknowledgedLossOfRight: boolean; at: string; ip?: string; userAgent?: string }
export interface ProposalRecord { id: string; projectId: string; version: number;
  status: "draft" | "issued" | "accepted" | "declined" | "superseded" | "expired";
  designId: string; designVersion: number; options: ProposalOption[]; inclusions: string[]; exclusions: string[]; assumptions: string[];
  warranty: string | null; validUntil: string; termsVersion: string; instantPriceGbp: number; increaseReason?: string;
  marginOverride?: { reason: string; by: string; at: string }; taxOverride?: { reason: string; by: string; at: string };
  issuedAt?: string; issuedBy?: string; viewedAt?: string; acceptance?: AcceptanceRecord; declinedReason?: string; changeRequest?: string;
  supersededBy?: string; createdAt: string }
export const DEFAULT_INCLUSIONS: string[]; export const DEFAULT_EXCLUSIONS: string[]; export const DEFAULT_ASSUMPTIONS: string[]; // [F4]
export function proposalIssueErrors(p: ProposalRecord, settings: PilotSettings, todayIso: string): string[];           // [F4]
export function acceptanceErrors(p: ProposalRecord, a: Omit<AcceptanceRecord, "at">, todayIso: string): string[];      // [F4]
export function reviseProposal(p: ProposalRecord, newId: string, now: string): ProposalRecord;                         // [F4] new draft version, never mutates accepted
export function customerSafeProposal(p: ProposalRecord): ProposalRecord;  // [F4] strips costLines, margins, overrides for customer pages
```

**`compliance.ts`** (logic: F5)

```ts
export type ComplianceStatus = "not-started" | "evidence-required" | "under-review" | "approved" | "rejected" | "not-applicable";
export interface ComplianceTemplateItem { key: string; label: string; category: "permissions" | "planning" | "safety" | "electrical"
  | "refrigerant" | "design" | "commissioning" | "warranty" | "consumer"; statutory: boolean; gate: GateId; ownerRole: StaffRole;
  guidance: string; evidenceHint: string; auto?: "design-approved" | "commissioning-signed" | "warranty-registered" }
export const COMPLIANCE_TEMPLATE: ComplianceTemplateItem[]; // [F5]
export interface ComplianceItem { id: string; projectId: string; key: string; label: string; category: ComplianceTemplateItem["category"];
  statutory: boolean; gate: GateId; status: ComplianceStatus; mediaIds: string[]; note?: string; reviewedBy?: string; reviewedAt?: string;
  overrideReason?: string }
export function instantiateCompliance(projectId: string, makeId: () => string): ComplianceItem[]; // [F5]
export function reviewCompliance(item: ComplianceItem, to: ComplianceStatus, reviewer: StaffMember, note: string | undefined,
  overrideReason: string | undefined, now: string): { ok: true; item: ComplianceItem } | { ok: false; error: string }; // [F5] statutory items cannot be overridden to approved without evidence/qualified reviewer
```

Template keys: `ownership-authority`, `planning-pd`, `designations`
(listed / conservation / Article 4), `noise-assessment`, `outdoor-siting`,
`structural-fixings`, `asbestos`, `concealed-services`,
`electrical-scope`, `fgas-company`, `fgas-engineer`,
`manufacturer-requirements`, `working-at-height`, `rams`,
`equipment-compatibility`, `design-approval`, `commissioning-approval`,
`electrical-certificate`, `warranty-registration`,
`cancellation-and-consent`.

**`install.ts`** (extended, logic: F6). Keep every existing export working
(demo pages, tests). Add:

```ts
export type StepOutcome = "pass" | "fail" | "blocked" | "na";
// InstallStep gains optional: day?: 1 | 2 | 3; requires?: StepRequirement; critical?: boolean; allowNa?: boolean; guidance?: string
// EvidenceRecord gains optional: id?: string; byStaffId?: string; mediaId?: string
export interface StepStatusRecord { stepId: string; outcome: StepOutcome; reason?: string; at: string; by: string; byStaffId?: string; issueId?: string }
export interface ExceptionReview { specId: string; resolution: "accepted" | "recapture-required"; reason: string; by: string; at: string }
export interface CommissioningResult { system: string; strengthTestBar?: number; holdBar?: number; vacuumMicrons?: number; decayMicrons?: number;
  additionalChargeG?: number; coolingSplitC: Record<string, number>; heatingSplitC: Record<string, number>; noiseDb?: number;
  serials: { item: string; serial: string }[] }
export interface CommissioningRecord { signedBy: { staffId: string; name: string; qualificationRef: string }; at: string;
  results: CommissioningResult[]; notes?: string }
export interface InstallJobV2 extends InstallJob { projectId: string; designId?: string; templateVersion: string;
  stepStatuses: StepStatusRecord[]; exceptionReviews: ExceptionReview[]; commissioning?: CommissioningRecord }
export const INSTALL_TEMPLATE_VERSION: string;                                                          // [F6]
export function runsheetFromDesign(design: DesignRecord, variantId: string, catalogue: CatalogueItem[], measured?: MeasuredSurvey): InstallStep[]; // [F6]
export function stepsForDay(steps: InstallStep[], day: number): InstallStep[];                           // [F6]
export function runsheetProgress(job: InstallJobV2): { complete: boolean; openExceptions: number; missing: number; blocked: number;
  walkthroughDone: boolean; byDay: { day: number; done: number; total: number }[] };                    // [F6]
export function canRecord(step: InstallStep, staff: StaffMember, onIso: string): { ok: boolean; reason?: string };      // [F6]
export function commissioningFromJob(job: InstallJobV2): CommissioningResult[];                          // [F6] derive results from evidence
```

**`issues.ts`** (logic: F6, with F5 for variations and payments)

```ts
export type IssueKind = "defect" | "snag" | "shortage" | "damage" | "safety" | "clarification" | "variation" | "customer-instruction" | "blocker" | "fault";
export type IssueStatus = "open" | "in-progress" | "awaiting-customer" | "resolved" | "closed" | "rejected";
export type Severity = "low" | "medium" | "high" | "critical";
export interface Issue { id: string; projectId: string; number: number; kind: IssueKind; title: string; detail?: string; severity: Severity;
  status: IssueStatus; blocking: boolean; gate?: GateId; ownerRole: StaffRole | "customer" | "ops"; ownerStaffId?: string; ownerName?: string;
  nextAction?: string; dueOn?: string; raisedBy: { kind: "staff" | "customer" | "system"; id?: string; name: string }; raisedAt: string;
  mediaIds: string[]; customerVisible: boolean;
  variation?: { description: string; priceDeltaNetPence: number; taxPence: number; totalDeltaPence: number;
    status: "proposed" | "accepted" | "declined"; decidedAt?: string; decidedBy?: string };
  resolution?: string; resolvedAt?: string; history: { at: string; by: string; note: string; status?: IssueStatus }[] }
export const ISSUE_KIND_LABEL: Record<IssueKind, string>;
export function defaultsForKind(kind: IssueKind): { severity: Severity; blocking: boolean; ownerRole: Issue["ownerRole"]; customerVisible: boolean }; // [F6]
export function transitionIssue(issue: Issue, to: IssueStatus, by: string, note: string, now: string): Issue;                                       // [F6]
export function isOpen(issue: Issue): boolean;                                                                                                      // [F]
```

**`money.ts`** (logic: F5)

```ts
export type InvoiceKind = "deposit" | "balance" | "variation" | "survey-fee" | "change-fee" | "credit-note";
export interface InvoiceLine { label: string; netPence: number; taxCode: TaxCodeId; taxPence: number; totalPence: number }
export interface Invoice { id: string; projectId: string; number: string; kind: InvoiceKind; status: "draft" | "issued" | "part-paid" | "paid" | "void";
  lines: InvoiceLine[]; netPence: number; taxPence: number; totalPence: number; paidPence: number; dueOn?: string; issuedAt?: string;
  documentId?: string; notes?: string }
export interface Payment { id: string; projectId: string; invoiceId?: string; method: "card" | "bank-transfer" | "cash" | "other";
  provider: "stripe" | "manual" | "demo"; providerRef: string; amountPence: number; status: "succeeded" | "pending" | "failed" | "refunded";
  receivedAt: string; recordedBy?: string }
export function invoiceNumber(prefix: string, n: number): string;                           // [F] "DIH-0001"
export function depositPence(contractTotalPence: number, settings: PilotSettings): number; // [F5]
export function buildBalanceInvoiceLines(input: { contractTotalPence: number; acceptedVariationsPence: number; changeFeesPence: number;
  alreadyInvoicedPence: number; taxCode: TaxCodeId }): InvoiceLine[];                       // [F5]
export function applyPayment(invoice: Invoice, amountPence: number): Invoice;               // [F5]
export function outstandingPence(invoices: Invoice[]): number;                              // [F5]
```

**`comms.ts`** (registry: F; templates live in web, §F)

```ts
export type CommsEventId = "magic-link" | "survey-booked" | "survey-reminder" | "surveyor-on-my-way" | "survey-complete" | "proposal-issued"
  | "proposal-reminder" | "proposal-accepted" | "proposal-changes-requested" | "invoice-issued" | "payment-received" | "install-booked"
  | "kit-update" | "install-prep" | "install-day-before" | "installer-on-my-way" | "install-day-update" | "variation-approval"
  | "issue-update" | "handover-ready" | "check-in-7d" | "feedback-30d" | "service-reminder" | "team-alert";
export interface CommsEventDef { id: CommsEventId; channels: ("email" | "sms")[]; audience: "customer" | "team" | "staff";
  trigger: "auto" | "manual" | "cron"; description: string; templateVersion: number }
export const COMMS_EVENTS: Record<CommsEventId, CommsEventDef>;
export function idempotencyKey(event: CommsEventId, projectId: string | null, discriminator: string, channel: "email" | "sms"): string;
export interface MessageRecord { id: string; idempotencyKey: string; projectId?: string; event: CommsEventId; channel: "email" | "sms";
  templateVersion: number; to: string; subject?: string; bodyText: string; bodyHtml?: string;
  status: "queued" | "sent" | "failed" | "demo" | "skipped"; provider?: string; providerRef?: string; error?: string; attempts: number;
  scheduledFor?: string; sentAt?: string; createdAt: string }
```

**`documents.ts`** [F]

```ts
export type DocumentKind = "proposal" | "contract" | "variation" | "invoice" | "receipt" | "commissioning-certificate" | "handover-pack" | "survey-report";
export interface DocumentRecord { id: string; projectId: string; kind: DocumentKind; version: number; ref: string; title: string;
  status: "draft" | "final" | "superseded"; customerVisible: boolean; snapshot: unknown; createdAt: string; createdBy?: string }
export function documentRef(kind: DocumentKind, projectShortId: string, version: number): string; // e.g. "DIH-PR-7F3A-v2"
```

**`pilots.ts`** (logic: F7)

```ts
export interface TimeEntry { id: string; projectId: string; staffId?: string; staffName: string;
  kind: "survey" | "design" | "proposal" | "travel" | "install" | "rework" | "commissioning" | "handover" | "admin";
  dayN?: number; startedAt: string; endedAt?: string; minutes?: number; note?: string }
export const LEARNING_PROMPTS: { id: string; question: string }[]; // the 8 prompts from the build plan
export interface Learning { id: string; projectId: string; dayN?: number; stage?: ProjectStageId; author: { staffId?: string; name: string };
  answers: { promptId: string; answer: string }[]; tags: string[]; status: "open" | "applied" | "wont-fix"; appliedNote?: string; createdAt: string }
export interface PilotMetrics { projectId: string; pilotNumber?: number; label: string; stage: ProjectStageId;
  instantPricePence: number; listPricePence: number | null; contractPricePence: number | null; revenuePence: number;
  equipmentCostPence: number; materialsCostPence: number; subcontractCostPence: number; estimatedCostPence: number | null; actualCostPence: number;
  grossProfitPence: number | null; grossMarginPct: number | null; estimatedLabourHours: number | null; actualLabourHours: number;
  labourHoursByPerson: Record<string, number>; labourHoursByKind: Record<string, number>; travelHours: number; reworkHours: number;
  plannedInstallDays: number; actualInstallDays: number | null; surveyMinutes: number | null; daysQuoteToSurvey: number | null;
  daysSurveyToProposal: number | null; daysAcceptanceToInstall: number | null; issuesByKind: Record<string, number>;
  unplannedMaterials: number; customerChanges: number; messagesSent: number; satisfaction: number | null; defects7d: number; defects30d: number;
  selfSurveyAccuracyPct: number | null }
export function pilotMetrics(input: { project: Project; proposal?: ProposalRecord; purchaseOrders: PurchaseOrder[]; time: TimeEntry[];
  issues: Issue[]; messagesSent: number; surveyDiff?: SelfSurveyDiffRow[] }): PilotMetrics; // [F7]
export function pilotsCsv(rows: PilotMetrics[]): string;                                  // [F7]
```

**`purchasing.ts`** (logic: F5)

```ts
export type PoStatus = "required" | "approved" | "ordered" | "confirmed" | "dispatched" | "delivered" | "inspected" | "cancelled";
export interface PoLine { id: string; catalogueItemId?: string; label: string; qty: number; unitCostPence: number | null;
  actualUnitCostPence?: number; receivedQty: number; inspectedQty: number; damagedQty: number; serials: string[]; required: boolean }
export interface PurchaseOrder { id: string; projectId: string; supplier: string; reference?: string; status: PoStatus;
  destination: "customer" | "storage" | "installer" | "subcontractor"; lines: PoLine[]; expectedTotalPence: number;
  actualTotalPence?: number; shippingPence: number; orderedOn?: string; eta?: string; trackingRef?: string; deliveredAt?: string;
  inspectedAt?: string; notes?: string; mediaIds: string[]; history: { at: string; by: string; note: string; status?: PoStatus }[] }
export function posFromDesign(design: DesignRecord, variantId: string, catalogue: CatalogueItem[], projectId: string, makeId: () => string): PurchaseOrder[]; // [F5] grouped by supplier, required lines
export function advancePo(po: PurchaseOrder, to: PoStatus, by: string, now: string, patch?: Partial<PurchaseOrder>): { ok: true; po: PurchaseOrder } | { ok: false; error: string }; // [F5] forward-only except cancel; "delivered" needs a deliveredAt recorded by a person
export function kitSummary(pos: PurchaseOrder[]): { requiredLines: number; deliveredLines: number; inspectedLines: number; damaged: number;
  status: Project["kit"]["status"]; expectedDate?: string; shortages: number };                                  // [F5]
```

### D5 · Unchanged engines

`pricing.ts`, `heatload.ts`, `confidence.ts`, `archetypes.ts`,
`defaultconfig.ts`, `intelligence.ts`, `operations.ts`, `finance.ts`,
`investor.ts` and `design.ts` (`designSystem`) keep their APIs.

`design.ts` gains an exported helper used by F3:
`designSystemWithCatalogue(...)` may live in `design-record.ts` instead,
so `design.ts` stays untouched.

`operations.ts` `ScheduledJob` is now built from v2 projects (F5 updates
`lib/ops-server.ts`).

## E. Database: migration `0010_pilot_platform.sql`

Foundation writes one migration creating everything below (`if not
exists`, RLS enabled, no policies: service role only, matching the
existing tables). It's tested against local Postgres 16 with stub `storage`
/ `auth` schemas.

**Columns on `projects`:**
- `schema_version int default 1`, `customer_id uuid`, `pilot_number int`.
- `owner_staff_id uuid`, `next_action text`, `next_action_at date`.
- `value_pence int`, `blocked boolean default false`.
- The `quote_id` foreign key stays.

**New tables:**
- **People and access**
  - `staff`: `id uuid pk`, `email unique`, `name`, `phone`,
    `roles text[]`, `external`, `active`, `qualifications jsonb`, `bio`,
    `photo_media_id`, `demo`, timestamps.
  - `customers`: `id`, `email unique`, `name`, `phone`,
    `ops_consent jsonb`, `marketing_consent jsonb`, timestamps.
  - `login_tokens`: `id`, `token_hash unique`, `subject_kind`,
    `subject_id`, `email`, `purpose`, `next_path`, `expires_at`,
    `used_at`, `created_at`.
- **Survey, design, proposal**
  - `media`: `id`, `project_id` → projects, `bucket`, `storage_path`,
    `content_type`, `tag`, `room_id`, `caption`, `source`,
    `taken_by jsonb`, `taken_at`, `customer_visible`, `width`, `height`,
    `annotations jsonb default '[]'`, `annotations_version int`,
    `locked`, timestamps.
  - `surveys`: `id`, `project_id`, `version`, `status`, `data jsonb`,
    `surveyor jsonb`, `started_at`, `submitted_at`, `minutes`,
    timestamps.
  - `designs`: `id`, `project_id`, `version`, `status`,
    `record jsonb`, timestamps; unique (`project_id`, `version`).
  - `proposals`: `id`, `project_id`, `version`, `status`,
    `record jsonb`, `issued_at`, `accepted_at`, timestamps; unique
    (`project_id`, `version`). Plus a **trigger** that rejects any
    update to a row whose status is `accepted`, except setting
    `status = 'superseded'` without changing `record->'options'`.
  - `catalogue_items`: `id text pk`, `kind`, `manufacturer`, `series`,
    `model`, `label`, `tier`, `cost_pence`, `status`, `confidence`,
    `active`, `item jsonb`, timestamps.
  - `catalogue_compatibility`: `id text pk`, `outdoor_model`,
    `rule jsonb`, timestamps.
- **Delivery**
  - `purchase_orders`: `id`, `project_id`, `supplier`, `status`,
    `po jsonb`, timestamps.
  - `compliance_items`: `id`, `project_id`, `key`, `status`,
    `statutory`, `item jsonb`, timestamps; unique (`project_id`, `key`).
  - `install_jobs`: `id`, `project_id unique`, `design_id`,
    `template_version`, `runsheet jsonb`, `step_statuses jsonb`,
    `exception_reviews jsonb`, `commissioning jsonb`, `qa jsonb`,
    timestamps.
  - `install_evidence`: `id text pk` (client-generated, so offline
    retries are idempotent), `project_id`, `spec_id`, `value numeric`,
    `ref`, `note`, `media_id`, `by_staff_id`, `by_name`, `at`,
    `gps jsonb`, `created_at`.
  - `issues`: `id`, `project_id`, `number int`, `kind`, `status`,
    `severity`, `blocking`, `issue jsonb`, timestamps.
  - `time_entries`: `id`, `project_id`, `staff_id`, `kind`,
    `started_at`, `ended_at`, `minutes`, `entry jsonb`, `created_at`.
- **Money**
  - `invoices`: `id`, `project_id`, `number unique`, `kind`, `status`,
    `total_pence`, `paid_pence`, `invoice jsonb`, timestamps.
  - `payments`: `id`, `project_id`, `invoice_id`,
    `provider_ref unique`, `provider`, `method`, `amount_pence`,
    `status`, `received_at`, `payment jsonb`, `created_at`.
- **Comms, records, learning**
  - `messages`: `id`, `idempotency_key unique`, `project_id`, `event`,
    `channel`, `to_address`, `status`, `provider_ref`,
    `scheduled_for`, `sent_at`, `message jsonb`, timestamps.
  - `documents`: `id`, `project_id`, `kind`, `version`, `ref unique`,
    `status`, `customer_visible`, `record jsonb`, `created_at`.
  - `learnings`: `id`, `project_id`, `status`, `learning jsonb`,
    timestamps.
- **System**
  - `settings`: `key text pk`, `value jsonb`, `updated_at`,
    `updated_by`.
  - `audit_log`: `id`, `at`, `actor_kind`, `actor_id`, `actor_name`,
    `action`, `entity`, `entity_id`, `detail jsonb`.
- **Storage:** bucket `project-media` (private).

**Pattern:** typed columns for filters, JSONB for the domain object, the
same "snapshot is truth, columns are denormalised" rule as `projects`.
Repositories (§F) map rows ↔ domain types in one place.

## F. Web foundation (`apps/web/lib`, `components/kit`)

| File | Exposes |
| --- | --- |
| `lib/db/local-client.ts` | §B |
| `lib/supabase-server.ts` | `getServiceClient`, `requireDb`, `MEDIA_BUCKET = "project-media"` |
| `lib/auth/session.ts`, `lib/auth/server.ts`, `lib/auth/magic.ts` | §C |
| `lib/settings-server.ts` | `getSettings(): Promise<PilotSettings>`, `saveSettings(next, actor)` (audited) |
| `lib/audit.ts` | `audit({ actor, action, entity, entityId, detail })` |
| `lib/repo/*.ts` | One module per table, typed: `get`, `list`, `insert`, `update`, plus entity-specific helpers (e.g. `proposals.latestForProject`, `evidence.appendIdempotent`, `issues.nextNumber`). They map rows to the D4 types. |
| `lib/project-service.ts` | `loadProject(id)` (migrates v1 on read), `saveProject`, `loadReadinessContext(projectId, actor?)`, `dispatch(projectId, action, actor)`. `dispatch` loads, applies the reducer with `ctx`, saves, audits, fires `notifyForAction`, and returns `{ project } \| { error, blockers }`. It **replaces** `lib/projects-server.ts` internals; keep the old exported names working (`loadProject`, `applyAndSave`, `createProjectForQuote`, `buildDemoProject`). |
| `lib/comms/templates.ts` | One renderer per `CommsEventId` → `{ subject, html, text, sms? }`, using `brandedEmail`. Every customer message names us, uses their name, mentions the property or appointment, says what happened and what happens next, links to the right portal screen (fresh magic link), and gives the support phone. No marketing in operational messages. |
| `lib/comms/outbox.ts` | `notify(event, { projectId?, to?, data, discriminator, scheduledFor? })`: resolves recipients from the project and settings, skips disabled events, is idempotent on the key, renders, inserts the message, and dispatches now unless scheduled. Also `dispatchDue(now)` (cron) and `resend(messageId)`. Demo mode (no provider) stores `status: "demo"` with the rendered body, visible in `/ops/messages`. |
| `lib/providers/sms.ts` | `smsConfigured()`, `sendSms(to, body)` (Twilio REST via fetch: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` sender id or number) → `{ ok, providerRef?, error? }`. UK number normalisation to E.164. |
| `lib/providers/stripe.ts` | `stripeConfigured()`, `stripeMode()` (`test` / `live` from key prefix), `createCheckoutSession({ invoice, successUrl, cancelUrl, customerEmail })` (REST via fetch, form-encoded, `metadata.invoice_id` / `project_id`), `verifyStripeSignature(rawBody, header, secret, toleranceSec=300)` (HMAC SHA-256 of `` `${t}.${body}` ``, constant-time compare). |
| `lib/env-mode.ts` | `appMode()` → `{ data: "supabase" \| "file" \| "memory" \| "demo", email: "live" \| "demo", sms: "live" \| "demo", payments: "live" \| "test" \| "demo" }` for the mode banner. |
| `lib/format.ts` | Add `money(pence)` → "£1,234" (pence shown only when non-zero), `fmtDate(iso)` → "3 Nov 2026" |
| `components/kit/*` | `Button`, `LinkButton`, `Card`, `Badge`, `StatusChip`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`, `Section`, `PageHeader`, `EmptyState`, `Stat`, `Tabs` (links), `BlockerList`, `ModeBanner`, `Money`, `Timeline` (portal, reuses the existing timeline component where possible) |
| `app/ops/layout.tsx` | Ops shell: top nav (Board, Calendar, Purchasing, Catalogue, Pilots, Messages, Staff, Settings, plus "More": Quotes, Intel, Analytics, Finance, Status), signed-in user menu, mode banner. Pages remain responsible for their own `requireStaff`. |
| `app/field/layout.tsx` | Field shell: sticky header (job title slot, offline/unsynced badge slot), bottom tab bar (Today, Jobs, Issues, Me), large type, no marketing chrome |
| `app/login/page.tsx`, `app/auth/verify/route.ts`, `app/auth/logout/route.ts` | Staff login (magic link, demo "Try as…", break-glass) |

`next.config.ts` Permissions-Policy becomes
`camera=(self), geolocation=(self)`: the field app uses camera input and
GPS for the arrival fix.

## G. Ownership map (feature phase)

Each feature agent owns only the files listed for it. It may add new files
inside its own directories, and add a migration only as its own numbered
file (F1 `0011`, F2 `0012`, … F8 `0018`). Cross-feature calls go through
the foundation APIs (`dispatch`, `notify`, repositories). If a feature
needs something another feature owns, it uses the contract types and
leaves a `// INTEGRATION:` note.

| Agent | Owns | Delivers |
| --- | --- | --- |
| **F1 Portal** | `app/p/[id]/**` (except `proposal`), `app/portal/**`, `components/portal/**`, `components/project/**` (rewrite for v2), `app/how-it-works/page.tsx` (demo embed only), `app/d/[id]/**`, `components/docs/**`, `lib/documents-server.ts` | Customer hub for v2: timeline, one next action, stage panels for all 8 stages (survey booking, kit status, install days with daily updates and photos, handover pack, aftercare feedback, report a problem → issue). Documents list. `/portal` sign-in and "your homes". Printable document renderers for every `DocumentKind`. `/p/demo` playable on v2 (client reducer, demo ctx). Access checks via `requireProjectAccess`. |
| **F2 Survey** | `packages/domain/src/survey-visit.ts`, `media.ts` (logic + tests), `app/field/survey/**`, `components/field/survey/**`, `components/annotate/**`, `app/api/media/**`, `lib/media-client.ts` | Phone survey flow (§3 Stage 2 of the plan), autosave, completeness meter, background photo upload, the annotation editor (reusable, also for ops and install), the self-survey diff component, survey submit → `dispatch(survey-submitted)` |
| **F3 Design** | `catalogue.ts`, `design-record.ts` (logic + tests), `app/ops/catalogue/**`, `app/ops/projects/[id]/design/**`, `components/ops/design/**`, `lib/catalogue-seed.ts` (loads `docs/research/data/catalogue-seed.json` into `catalogue_items` on demand) | Catalogue CRUD, CSV import and export, compatibility rules. Design from the measured survey, overrides with reasons, verdict lights, layout photos, submit for review, approve (tech lead only) → `dispatch(design-approved)` |
| **F4 Proposal** | `costing.ts`, `proposal.ts` (logic + tests), `app/ops/projects/[id]/proposal/**`, `components/ops/proposal/**`, `app/p/[id]/proposal/**`, `components/proposal/**`, `app/api/proposals/**` | Proposal builder (options, cost build-up, margin, discount, tax, inclusions), issue (with gate blockers), revisions. Customer proposal page with accept flow (cancellation info, early start, typed signature, acceptance record with IP/UA), request changes, decline. Contract and proposal documents created via `lib/documents-server.ts` |
| **F5 Booking & money** | `compliance.ts`, `money.ts`, `purchasing.ts` (logic + tests), `app/ops/calendar/**`, `app/ops/purchasing/**`, `app/ops/projects/[id]/kit/**`, `app/ops/projects/[id]/money/**`, `app/ops/projects/[id]/compliance/**`, `app/api/stripe/**`, `app/api/pay/**`, `app/p/[id]/pay/**`, `lib/ops-server.ts`, `app/ops/schedule/**`, `app/ops/procurement/**` | Install blocks and crew assignment with qualification checks, calendar (surveys, deliveries, installs, crew day view), POs from design, kit check, compliance checklist UI with review, invoices (deposit, balance, variation), Stripe Checkout and webhook (idempotent), bank transfer details plus manual payment recording, customer pay page, variations' price acceptance (customer side lives in F1's issue panel and calls F5's API) |
| **F6 Field install** | `install.ts` extensions, `issues.ts` (logic + tests), `app/field/**` (except `survey`), `components/field/**` (except `survey`), `app/api/field/**`, `lib/field-outbox.ts` (client, IndexedDB) | Today, job pack, day runsheet with evidence capture (camera photos via the F2 media API, readings, serials, signature canvas), role gating, Pass/Fail/Blocked/N/A, exceptions for tech lead review, issues and variations, time log (arrive / pause / resume / end), on-my-way SMS with preview, end-of-day customer update with photo picker, kit check, commissioning sign-off, handover walkthrough plus customer signature, offline outbox with unsynced badge |
| **F7 Ops core** | `pilots.ts` (logic + tests), `app/ops/page.tsx`, `app/ops/projects/page.tsx`, `app/ops/projects/[id]/page.tsx`, `app/ops/projects/[id]/actions.ts`, `app/ops/projects/new/**`, `app/ops/pilots/**`, `app/ops/messages/**`, `app/ops/staff/**`, `app/ops/settings/**`, `components/ops/board/**`, `components/ops/command/**`, `app/api/cron/daily-ops/**`, `app/api/cron/digest/route.ts`, `app/api/cron/outbox/**` | Board with search, command centre (readiness blockers, sections linking to design / proposal / kit / money / compliance / install, issues, time, learnings, documents, messages, activity), new pilot form, staff and qualifications admin, settings editor, messages log (preview, resend), pilots dashboard (comparison, CSV), daily-ops cron (survey reminders, install-day-before, install-prep, proposal reminder and expiry, day-7 check-in, day-30 feedback, service reminders, outbox retries), digest extended |
| **F8 Public & funnel** | `app/page.tsx`, `app/faq/**`, `app/about/**`, `app/terms/**`, `app/privacy/**`, `app/areas/**`, `app/guides/**`, `app/quote/**`, `app/q/**`, `components/quote/**`, `components/site/**`, `lib/brand.ts`, `app/api/quotes/**`, `lib/email.ts` (quote email copy only) | Every honesty fix from plan §1, service-area check from settings, consent ticks (operational vs marketing), terms and privacy links, heating-and-cooling framing, finance hidden unless the lender is configured, warranty and F-gas claims from settings, prototype nav hidden unless enabled, optional "lock your price" photos, accessibility fixes (fieldset/legend, contrast, progressbar, no autofocus keyboard pop), terms page with cancellation info and model form, `/q/[id]` "Book my home survey" CTA |

## H. Comms events: who fires what

| Event | Fired by |
| --- | --- |
| `survey-booked` | `dispatch` on `book-survey` / `ops-book-survey` / `reschedule-survey` |
| `surveyor-on-my-way` | `surveyor-on-my-way` (SMS) |
| `survey-complete` | `survey-submitted` |
| `proposal-issued` | `proposal-issued` |
| `proposal-accepted` | `proposal-accepted`: customer copy (contract and cancellation form, the durable medium) plus a team alert |
| `proposal-changes-requested` | `proposal-changes-requested` (team) |
| `install-booked` | `booking-confirmed` (and a dates change after confirmation) |
| `kit-update` | `kit-updated`, only for confirmed, delivered or inspected |
| `installer-on-my-way` | `installer-on-my-way` (SMS) |
| `install-day-update` | `install-day-ended` with a `customerUpdate` |
| `handover-ready` | `handover-pack-published` |
| `invoice-issued`, `payment-received` | F5 server code |
| `variation-approval` | F6 when a variation is proposed |
| `issue-update` | Manual from ops |
| `survey-reminder`, `install-prep`, `install-day-before`, `proposal-reminder`, `check-in-7d`, `feedback-30d`, `service-reminder` | F7 daily-ops cron |
| `magic-link` | Auth |
| `team-alert` | Any |

## I. Testing and the end-to-end walk

- Domain: unit tests per module, in the same style as the existing ones.
- Web: `apps/web/tests/*.test.ts` for the local client, session
  signing/verification, Stripe signature, outbox idempotency and
  permission guards. Use pure functions where possible.
- E2E: `apps/web/scripts/e2e-pilot.mjs` (playwright-core, Chromium at
  `/opt/pw-browsers`) against `next start` with `DATA_BACKEND=file`,
  `ALLOW_DEMO_LOGIN=1` and a temp data dir. It walks: demo sign-in as admin
  → new pilot → survey (rooms, a photo, an annotation) → submit → design →
  approve as tech lead → proposal → issue → customer magic link → accept
  (with early start) → dates and crew → kit delivered and inspected →
  compliance approved → field day 1–3 evidence → commissioning sign-off →
  handover pack and signature → balance invoice → demo payment → close →
  pilots dashboard shows the row. It also checks isolation: a second
  customer can't open the first project (404), and an external installer
  can't see margin.

## J. Out of scope (don't build)

Inventory and warehouse stock, supplier scraping, WhatsApp, recurring
billing, server-side PDF rendering, a native installer app, RLS policies,
multi-crew optimisation, AI heat load, LiDAR.
