# Pilot platform: architecture contract

The binding technical contract for the pilot build described in
[pilot-build-plan.md](./pilot-build-plan.md). Every agent and human building
this follows it. When code and this document disagree, fix one of them in the
same change. Research inputs live in [research/](./research/).

> **The code is the source of truth for exact types; read
> `packages/domain/src` (and the `apps/web/lib` module you call) before
> coding.** This document says what exists, who owns it and the rules; the
> type blocks below are kept in step with the foundation as built, but the
> `.ts` file wins any disagreement. §K lists where the build differs from the
> original plan, and why.

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
   - Before declaring done: `pnpm -r typecheck`, `pnpm test`,
     `pnpm --filter @aircon/web build` and (with a migration)
     `bash supabase/tests/run-migrations.sh` must pass.
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
   persists). `DATA_BACKEND=none` forces this outside production.

`dataBackend()` says which (`"supabase" | "file" | "memory" | "none"`).

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
- Keys, unique constraints, SQL defaults and honesty triggers are declared
  by hand in `lib/db/local-schema.ts`, mirroring the migrations (keep it in
  step when a migration adds one). Uniques include `projects.quote_id`,
  `messages.idempotency_key`, `payments.provider_ref`, `staff.email`,
  `customers.email`, `documents.ref`, `invoices.number`, and
  (`project_id`, `version`) on `surveys` / `designs` / `proposals`. A clash
  produces a PostgREST-style error `{ code: "23505" }`
  (`repo/base.isUniqueViolation`). The accepted-proposal trigger is mirrored
  (§E).
- Concurrency: a per-process mutex.

**Persistence:** `file` mode writes JSON per table under `LOCAL_DATA_DIR`
(default `apps/web/.data/`, gitignored) atomically (write temp file, then
rename). `memory` mode keeps an in-process Map (tests use it).

**Storage:** `storage.from(bucket)` with `createSignedUploadUrl(path)`,
`createSignedUrl(path, expiresIn)`, `createSignedUrls(paths, expiresIn)`,
`upload`, `download`, `remove`, `list`.
- Signed URLs point at
  `/api/local-files/<bucket>/<path>?op=get|put|upsert&exp=…&sig=…`,
  HMAC-signed with `SESSION_SECRET` (dev fallback secret; in production a
  secret under 32 characters disables signing). The operation is signed, so
  a read URL can't be replayed as an upload; `put` never overwrites.
- Files are stored under `<data dir>/storage/<bucket>/<path>`. 25 MB ceiling.
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
  expiry (break-glass: 12 hours).
- Secret: `SESSION_SECRET` (`openssl rand -hex 32`). Without it, dev uses a
  fixed fallback and logs a warning; production refuses to sign, and treats
  a secret under 32 characters (`MIN_SESSION_SECRET_LENGTH`) as unset.
- Code: `lib/auth/session.ts` (Edge-safe, used by middleware),
  `lib/auth/access.ts` (pure decisions, tested directly) and
  `lib/auth/server.ts` (Node).

```ts
type Session =
  | { kind: "staff"; staffId: string; email: string; name: string; roles: StaffRole[]; external: boolean; exp: number }
  | { kind: "customer"; customerId: string; email: string; name: string; projectIds: string[]; exp: number };
```

**Magic links** (`lib/auth/magic.ts`):
- `login_tokens` rows store `sha256(token)`, the subject, purpose `login`,
  `next_path` and `expires_at`. Staff links last 20 minutes, portal sign-in
  links 60 minutes, links inside customer operational emails 30 days. All
  single-use.
- `GET /auth/verify?t=…` spends nothing: it shows a confirm page ("Continue
  as j***@example.com", with a warning when it would replace a different
  signed-in account). The button POSTs (same-origin only), which exchanges
  the token for a session and redirects to its `next` (same-origin only), or
  the person's home.
- `issueMagicLink({ email, kind, next?, ttlMinutes? }) → { sent, devLink? }`
  sends via the outbox (`magic-link` event). Unknown or inactive addresses
  get nothing and no hint. `devLink` (shown on screen when no email provider
  is set up) only in development, or on a demo deployment
  (`ALLOW_DEMO_LOGIN=1`) for DEMO staff and for reserved demo addresses
  (`example.com`/`.org`/`.net`, `.example`, `.invalid`, `.test`: see
  `linkMayShowOnScreen` in `lib/auth/access.ts`). Never for a real address,
  and never once email is live.
- `customerLink(projectId, path, recipient) → absolute URL` carries a fresh
  30-day token **only when `recipient` is the project's customer's own
  address**; anyone else gets the plain page URL. The outbox calls it at the
  moment a provider takes the message, so tokens are never stored (bodies
  keep `LINK_PLACEHOLDER`, §D4 comms).
- The email is the customer's identity. When `set-customer-contact` changes
  it, `dispatch` moves the project to the customer record for the new
  address (`customers.findOrCreate`, then `projects.customer_id`), so the old
  customer loses access at once. Clearing the email moves nothing and sends
  nothing. v2 never borrows contact details from the quote; only v1
  snapshots do (`lib/legacy-contact.ts`).

**Staff bootstrap:** `ADMIN_EMAILS` (comma list). The first sign-in from
such an email creates an admin `staff` row. Break-glass: when
`OPS_PASSWORD` is set **and at least 20 characters**, `/login` also accepts
an admin email plus that password. Limits per IP (IPv6 by /64), per email and
globally; every checked failure is audited; the password and the admin
lookup always both run.

**Demo sign-in** (`/login` "Try as…", one fictional DEMO account per role,
`lib/auth/demo-staff.ts`): `demoLoginAllowed(env)` is true outside
production; in production only with `ALLOW_DEMO_LOGIN=1`, and on a Supabase
database only with `DEMO_DEPLOYMENT=1` too. A staff row written by a demo
session is itself `demo` (`taintedByDemo`), and demo rows stop working when
demo sign-in is off. `instrumentation.ts` logs unsafe sign-in configuration
at boot (`securityWarnings`).

**Middleware** (`apps/web/middleware.ts`):
- `/ops/**` and `/field/**` need a validly signed staff cookie; otherwise a
  302 to `/login?next=…`. External staff opening `/ops/**` go to `/field`.
- It only proves the cookie is signed. Every page, route and server action
  calls a guard itself (§K11, enforced by `tests/route-guards.test.ts`).
- Customer pages check access in the page itself.

**Guards** (`lib/auth/server.ts`):

```ts
getSession(): Promise<Session | null>
currentStaff(): Promise<StaffMember | null>                        // fresh, active staff row for the session
requireStaff(perm?: Permission): Promise<StaffMember>               // pages/actions: redirect /login, or /auth/forbidden
requireStaffApi(req, perm?): Promise<StaffMember | Response>        // API routes: JSON 401 / 403 to return as-is
requireProjectAccess(projectId, opts?: { perm?: Permission; allowCustomer?: boolean }):
  Promise<{ kind: "staff"; staff: StaffMember } | { kind: "customer"; customerId: string } | null>
```

Staff without `projects.view-all` (subcontractors, installers,
electricians) may only access projects where they're the assigned surveyor
or crew. Customers may only access their own projects (the row's
`customer_id` decides; the session's `projectIds` only when it's unset).
Anything else is `null`: answer 404, never a hint that the record exists.
Other pure helpers in `access.ts`: `safeNextPath`, `staffLanding`,
`isPlausibleEmail`, `normaliseEmail`, `sameEmail`, `maskEmail`.

**Roles and permissions** live in the domain (`staff.ts`, §D2): `can(staff,
perm)` is the only check used anywhere.

## D. Domain contracts (`packages/domain/src`)

Foundation created every file below with these types and the functions
marked **[F]**. Feature agents implement the stubs marked **[F#]** (they
throw `"not implemented: <name> (F#)"` until then) in the same file: they
own those files' logic, not their types. Every file is exported from
`index.ts`, so feature agents never edit `index.ts`. Blocks below are
abridged where noted; the `.ts` file is the exact source.

### D1 · `settings.ts` [F]

```ts
export type TaxCodeId = "standard-20" | "reduced-5" | "zero-esm" | "outside-scope";
export const TAX_CODES: Record<TaxCodeId, { label: string; ratePct: number; note: string }>;
export interface DiscountCode { code: string; label: string; pct?: number; amountPence?: number; reason: string; active: boolean }
export interface PilotSettings {
  company: {
    legalName: string; tradingName: string; companyNumber?: string; registeredAddress?: string;
    geographicAddress: string;        // CCR Sch 2(c): a real street address; "" until set (blocks proposal issue)
    phone: string; email: string;
    complaintsProcess: string;        // CCR Sch 2(k); "" until set (blocks proposal issue)
    adr?: string; workmanshipGuarantee?: string;
    reviewUrl?: string;               // https page on an independent review platform; review requests only while set
    vatNumber?: string;
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
export function mergeSettings(stored: unknown): PilotSettings; // deep-merge over defaults; junk union values and list items reset to defaults
export function isInServiceArea(settings: PilotSettings, postcode: string): boolean;
export function effectiveTaxCode(settings: PilotSettings): TaxCodeId; // outside-scope when not VAT registered; registered + outside-scope → standard-20
export function schedule2Missing(settings: PilotSettings): string[];  // what the pre-contract information still lacks ([] = complete); blocks proposal-issue
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
- `geographicAddress` and `complaintsProcess` are `""`: proposals can't be
  issued until a person fills them in (`schedule2Missing`). Never guessed.

Settings are read with `getSettings()` and written with `saveSettings`
(§F). Facts settings control (warranty years, cancellation days, install
block, survey length) are never hard-coded in copy: read them from settings
(`stageInfo`, `cancellationCopy`, §D3).

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
// Also: STAFF_ROLES, ROLE_LABEL, PERMISSIONS, ROLE_PERMISSIONS, EXTERNAL_DENIED, REQUIREMENT_LABEL.
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
export const STAGE_INFO: Record<ProjectStageId, StageInfo>;              // generic copy: no numbers settings control
export function stageInfo(stage: ProjectStageId, settings: PilotSettings, project?: Project): StageInfo; // customer screens use this
```

Labels: Price · Survey · Proposal · Booking · Kit · Install · Handover ·
Aftercare. The survey is an in-person home visit; the proposal is designed on
your own photos and signed off by a qualified engineer; handover includes
commissioning and your documents. `STAGE_INFO` never states the warranty
years, the survey length, the install block or the cancellation period:
`stageInfo` fills those from settings (and, with the project, that
contract's own cancellation sentence).

State (abridged to the fields; see the file for comments):

```ts
export type ProjectActor = "customer" | "ops" | "field" | "system";
export interface ProjectEvent { at: string; type: string; label: string; actor: ProjectActor; actorName?: string; internal?: boolean; feeGbp?: number }
export interface CrewMember { staffId: string; name: string; role: StaffRole; external: boolean }
export interface InstallDay { n: number; date: string; status: "planned" | "in-progress" | "done"; startedAt?: string; endedAt?: string;
  summary?: string; customerUpdate?: { text: string; mediaIds: string[]; sentAt: string } }
export type ContractType = "supply-and-install" | "install-only";   // who supplies the kit; decides the cancellation clock
export const CONTRACT_TYPES: readonly ContractType[];
export type DocumentsConsentChannel = "portal" | "in-person" | "email";
export interface EarlyStartRecord { requested: boolean; requestedAt?: string; channel?: "email" | "paper" | "portal";
  evidenceRef?: string; evidencedAt?: string; recordedBy?: string; wordingVersion: string }
// PrepItem, ElectricsPlanStatus, InstallerProfile, TimelineDateKind, daysBetween: shared with v1, unchanged.

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
    contractType: ContractType;                                   // set at issue; supply-and-install by default
    documentsByEmailConsent?: { at: string; channel: DocumentsConsentChannel }; // CCR reg 10(2); proposal issue needs it
    preContractInfoSentAt?: string;                               // the issue email (Schedule 2 + cancellation info + model form)
    confirmationSentAt?: string;                                  // the acceptance email (contract copy); needed before work starts
    earlyStartRequested?: boolean;                                // kept in step with earlyStart.requested
    earlyStart?: EarlyStartRecord;
    goodsReceivedOn?: string;                                     // supply-and-install: the day the last of the kit arrived
    cancellationEndsOn?: string;                                  // inclusive; read it through cancellationStatus
    changeRequest?: string; declineReason?: string };
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
    reviewRequestedAt?: string; seasonalCheckSentAt?: string; followUpsOptedOutAt?: string; serviceDueOn?: string };
  money: { contractTotalPence?: number; invoicedPence: number; paidPence: number; changeFeesPence: number };
  events: ProjectEvent[];
}
```

Gates, readiness, the reducer and helpers:

```ts
export type GateId = "survey-complete" | "proposal-issue" | "proposal-accept" | "booking" | "ready-to-install"
  | "install-complete" | "commissioned" | "handed-over" | "closed";
export const GATE_IDS: GateId[];                         // journey order
export const GATE_LABEL: Record<GateId, string>;
export interface Blocker { gate: GateId; code: string; message: string; severity: "block" | "warn";
  owner: StaffRole | "customer" | "ops"; action?: string }
export interface ReadinessContext {
  today: string;
  settings: PilotSettings;
  actor?: StaffMember;                                  // the signed-in person doing the action (qualified steps)
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
export function readiness(project: Project, ctx: ReadinessContext): Blocker[];          // every gate not yet passed
export function blockersFor(project: Project, ctx: ReadinessContext, gate: GateId): Blocker[];
export function isGatePassed(project: Project, gate: GateId): boolean;
export function nextGate(project: Project): GateId | null;
export function isStageComplete(project: Project, stage: ProjectStageId): boolean;
export function currentStage(project: Project): ProjectStageId;
export function stageState(project: Project, stage: ProjectStageId): "complete" | "current" | "upcoming";
export function projectTimeline(project: Project, todayIso: string): TimelineEntry[];  // same TimelineEntry shape as v1
export function migrateProject(raw: unknown): Project;                                  // v1 → v2, idempotent on v2
export function isLegacySnapshot(raw: unknown): boolean;                                // the test migrateProject uses
export function createProject(input: CreateProjectInput): Project;  // v1 input + customerEmail?, customerPhone?, customerId?, surveyFeeGbp?, surveyDurationMinutes?, installDays?
export function applyProjectAction(project: Project, action: ProjectAction, now: string, ctx?: ReadinessContext): ApplyResult;
export function projectFees(project: Project): { changeFeesGbp: number; surveyPaidGbp: number };
export function customerNextAction(project: Project): { label: string; href?: string } | null; // the ONE thing the customer should do now
export function earliestInstallStart(project: Project, todayIso: string, settings?: PilotSettings): string; // for every date picker
export const DEFAULT_PREP_ITEMS: Omit<PrepItem, "done">[];   // v1 list
export function rescheduleFeeGbp(kind: "survey" | "installation", daysNotice: number): number; // v1 fee table (site-visit → survey)
export const WARRANTY_REGISTRATION_DAYS = 30; export const SERVICE_INTERVAL_MONTHS = 12;
// INSTALL_LEAD_DAYS (5) comes from project-v1.ts through index.ts.
// Aftercare timing for the F7 cron: reviewRequestDue(project, today, settings), seasonalCheck(project),
// seasonalCheckDue(project, today), REVIEW_REQUEST_DAYS (37), SEASONAL_CHECK_MIN_DAYS (28).
```

**Cancellation period and early start** (CCR 2013; LEGAL REVIEW REQUIRED,
see `docs/research/uk-consumer-legal.md`). Never compute it by hand:

```ts
export interface CancellationStatus { ended: boolean; endsOn?: string; basis: "acceptance" | "goods-delivery" | "unknown"; earlyStartEvidenced: boolean }
export function cancellationStatus(project: Project, todayIso: string, settings?: PilotSettings): CancellationStatus;
export function cancellationCopy(project: Project, opts?: { settings?: PilotSettings; today?: string }): string; // one plain sentence
export function cancellationSentence(input: { accepted: boolean; contractType?: ContractType; endsOn?: string; ended?: boolean }, cancellationDays: number): string;
export function earlyStartRequestedOf(project: Project): boolean;
export function earlyStartWording(contractType: ContractType): string;  // the words the customer sends to make the request
export const EARLY_START_WORDING_VERSION: string; export const CANCELLATION_RULE_STATUS: string; // shown to ops beside these rules
```

- `install-only` (service contract): `cancellationDays` after the day of
  acceptance. `supply-and-install` (sales contract): `cancellationDays` after
  the last of the kit arrives, never earlier than from acceptance; unknown
  (`endsOn` unset, not ended) until `kit-updated` records delivered or
  inspected with no shortages. If the issue email didn't precede acceptance
  (`preContractInfoSentAt`), reg 31 extends it.
- `endsOn` is inclusive: `ended` turns true the day after. Work starts the
  day after, or earlier only when the customer asked (`earlyStart.requested`)
  **and** the request is on a durable medium (`earlyStart.evidencedAt`).
- **Date pickers (F1 portal, F5 calendar) offer starts from
  `earliestInstallStart(project, today, settings)`**: today +
  `INSTALL_LEAD_DAYS`, after `endsOn` unless early start was requested, on a
  working day.

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

Gate rules (`block` unless noted; codes are stable, per-item rules add
`:<item>`, e.g. `compliance:asbestos`, `issue:<id>`):

| Gate | Rules (blocker codes) |
| --- | --- |
| **survey-complete** | Survey booked (`survey-not-booked`). A survey record exists (`survey-not-started`) and `surveyCompleteness.missing` is empty (`survey-missing:<n>`). |
| **proposal-issue** | Survey submitted. Design approved if `requireEngineerSignoff` (`design-not-approved`), no compatibility errors. Tax confirmed (`!vatRegistered`, `accountantConfirmed`, `taxConfirmed` or `taxOverride`). Customer agreed to documents by email (`documents-consent-missing`). Customer email present (`no-customer-email`). `schedule2Missing` empty (`schedule2-incomplete`). A draft exists (`proposal-not-drafted`), not below minimum margin unless `marginOverride`, validity not passed. Terms or cancellation wording unreviewed → **warn**. |
| **proposal-accept** | Proposal `issued` or `changes-requested`, and not past `validUntil` (`proposal-expired`). |
| **booking** | Proposal accepted. Someone on the crew meets `fgas` (`no-fgas-engineer`) and `electrical` (`no-electrician`, owner ops); nobody meets `tech-lead` → **warn**. Deposit paid when `depositPct > 0` and timing `on-acceptance` (status or `ctx.money`). Dates chosen (`dates-not-chosen`). Without an early-start request, a start on or before the cancellation end blocks (`dates-inside-cancellation`); with the end still unknown (supply-and-install) → **warn** `no-early-start`. |
| **ready-to-install** | Booking confirmed. Kit planned (`kit-not-planned` when no required lines) and delivered (`kit-not-delivered`); not all inspected, or damaged → **warn**. A compliance checklist exists (`compliance-missing`). Every statutory compliance item tagged ≤ ready-to-install is `approved` / `not-applicable` (non-statutory → **warn**). Contract confirmation sent (`confirmation-not-sent`). Cancellation period ended (`today > endsOn`) or early start evidenced; else `cancellation-period`, `early-start-unevidenced` or `cancellation-unknown`. No open blocking issues (scope below). |
| **install-complete** | Install started. Runsheet exists, `complete`, `openExceptions === 0`. Compliance tagged this gate. |
| **commissioned** | Install complete; `commissioning.signed`. Compliance tagged this gate. |
| **handed-over** | Commissioned, pack published, signoff recorded, walkthrough done. Compliance tagged this gate. |
| **closed** | Handed over. `ctx.money` present (`money-unknown`) with `outstandingPence === 0`; invoiced < contract → **warn**. Electrical cert received or not required; warranty registered. Compliance tagged this gate. No open high or critical issue (blocking or not). |

Scope of compliance items and issues:
- **Compliance:** items tagged `survey-complete`, `proposal-issue`,
  `proposal-accept`, `booking` or `ready-to-install` are all enforced at
  **ready-to-install**, never at their own gate. An item tagged a later gate
  is checked at that gate only.
- **Issues:** an open `blocking` issue holds its tagged gate (untagged:
  `ready-to-install`) and every later gate. At `closed`, any open high or
  critical issue blocks too.

Actions (one discriminated union, `ProjectAction`). Each appends a
`ProjectEvent`; ops-only events set `internal: true`. Attribution: with
`ctx.actor` set a staff member did it (`ops`, or `field` for on-site steps);
without it, customer actions are the customer's and the rest the system's.
Date-change fees apply only to the customer's own changes. Gated actions
refuse without `ctx` and return the gate's blockers. Approvals and
signatures record the verified `ctx.actor.name`, never a typed `by`.

| Action | Payload | Guard (reducer) |
| --- | --- | --- |
| `book-survey` (customer) / `ops-book-survey` | `{ scheduledFor, mode, surveyor? }` | survey not in progress or submitted; customer can't re-book (moves instead); slot in future |
| `reschedule-survey` | `{ scheduledFor }` | survey booked; fee by notice (customer only) |
| `assign-surveyor` | `{ staffId, name }` | – |
| `surveyor-on-my-way` | `{ etaMinutes, by }` | survey booked |
| `survey-started` | `{ by }` | survey booked |
| `survey-submitted` | `{ surveyRecordId, electrics? }` | survey-complete gate (`ctx`); `electrics` replaces the funnel's guess |
| `design-updated` | `{ designId, version, status: "draft" \| "in-review" }` | survey submitted; proposal not accepted |
| `design-approved` | `{ designId, version, by }` | `ctx.actor` can `design.approve` and meets `tech-lead`; latest version; no compatibility errors. Records `ctx.actor.name` |
| `documents-consent-recorded` | `{ channel: "portal" \| "in-person" \| "email" }` | not yet accepted; first agreement stands |
| `proposal-issued` | `{ proposalId, version, validUntil, optionCount, contractType? }` | proposal-issue gate (`ctx`); sets `preContractInfoSentAt`; a new version starts clean except the documents consent |
| `proposal-viewed` | `{ proposalId }` | issued; customer only (no `ctx.actor`), once per current version |
| `proposal-changes-requested` | `{ text }` | issued |
| `proposal-declined` | `{ reason }` | issued or changes-requested |
| `proposal-accepted` | `{ proposalId, version, optionLabel, contractTotalPence, earlyStartRequested, earlyStartWordingVersion? }` | current proposal and version; proposal-accept gate. Sets `money.contractTotalPence`, `earlyStart`; install-only: `cancellationEndsOn = today + cancellationDays` (supply-and-install: set later by `kit-updated`) |
| `proposal-expired` | `{}` | issued or changes-requested, and `validUntil < today` |
| `contract-confirmation-sent` | `{ messageId?, demo? }` | system (outbox, §H): accepted; sets `confirmationSentAt` once |
| `early-start-requested` | `{ channel: "email" \| "paper" \| "portal" }` | accepted; install not started; idempotent |
| `early-start-evidenced` | `{ channel: "email" \| "paper", evidenceRef, by }` | accepted; requested; signed-in `ctx.actor` (recorded as `recordedBy`); once |
| `install-dates-set` (customer or ops) | `{ startDate, dates }` | accepted; install not started; `booking.installDays` working days in order; start ≥ today + `INSTALL_LEAD_DAYS`; start after the cancellation end unless early start requested (an unknown end is held at ready-to-install instead) |
| `crew-assigned` | `{ crew: CrewMember[] }` | names and roles |
| `booking-confirmed` | `{}` | booking gate |
| `deposit-requested` / `deposit-paid` | `{ amountPence }` | status only (money moves via `payment-recorded`) |
| `kit-updated` | `{ status, expectedDate?, summary?, shortages }` | booking confirmed. Conservative customer wording. Delivered/inspected with 0 shortages on supply-and-install sets `goodsReceivedOn` and `cancellationEndsOn` (once) |
| `installer-on-my-way` | `{ etaMinutes, by }` | booking confirmed |
| `install-day-started` | `{ n, by }` | n=1: ready-to-install gate (`ctx`); n>1: day n−1 started; overrun days allowed |
| `install-day-ended` | `{ n, summary, customerUpdate? }` | day n in progress |
| `install-completed` | `{}` | install-complete gate |
| `commissioning-signed` | `{ by }` | install complete; `ctx.actor` meets `tech-lead` with `commissioning.sign`; `ctx.commissioning.signed` (the record exists). Records `ctx.actor.name` |
| `handover-pack-published` | `{ documentId }` | commissioned (republish allowed) |
| `handover-signed` | `{ name, outcome, snagCount }` | pack published; walkthrough done (when `ctx.runsheet`); status → handed-over; `warrantyDueOn` (+30 days); `serviceDueOn` (+12 months) |
| `electrical-cert-updated` | `{ status }` | – |
| `warranty-registered` | `{}` | once |
| `invoice-issued` | `{ amountPence }` | non-zero whole pence; negative = credit note; updates `money.invoicedPence` |
| `payment-recorded` | `{ amountPence }` | only after a verified payment record; negative = refund; updates `money.paidPence` |
| `survey-fee-paid` | `{ amountPence }` | status only (like `deposit-paid`); a fee is due and unpaid |
| `prep-toggled` | `{ itemId, done }` | confirmable items |
| `aftercare-checkin-sent` / `feedback-requested` / `review-requested` / `seasonal-check-sent` | `{}` | once each |
| `aftercare-opt-out` | `{ optedOut }` | changes the state |
| `feedback-submitted` | `{ score, comments? }` | 0–10 |
| `set-next-action` | `{ text, dueOn?, ownerRole? }` | empty text clears |
| `set-pilot` | `{ number, label }` | – |
| `set-owner` | `{ staffId, name }` | empty `staffId` clears (internal `owner-set` event) |
| `set-customer-contact` | `{ email?, phone?, accessNotes?, parkingNotes? }` | `""` removes a field; an email change re-links the customer in `dispatch` (§C) |
| `project-closed` | `{ reason? }` | closed gate (`ctx`), unless reason is "cancelled" |
| `note` | `{ text }` | internal |

A closed project accepts only records, money and aftercare (`note`,
`set-next-action`, `set-pilot`, `set-owner`, `set-customer-contact`,
`invoice-issued`, `payment-recorded`, `survey-fee-paid`,
`electrical-cert-updated`, `warranty-registered`, the aftercare actions,
`contract-confirmation-sent`).

`ApplyResult = { ok: true; project } | { ok: false; error: string; blockers?: Blocker[] }`.
When a gate fails, it returns that gate's blockers so the UI can show exactly
what's missing.

`migrateProject` mapping (literal: nothing becomes paid, approved or
designed that v1 didn't record):
- `floorPlan` → `roughPlan`.
- `siteVisit` → `survey`: `completed` → `submitted` (with `submittedAt`),
  booked → `booked`. A booked or completed visit keeps its mode (default
  `video`), fee, payment status and a 60-minute duration. An unbooked visit
  was never agreed, so it takes the v2 terms: in person, fee 0,
  `not-required`. A v1 "paid" fee stays `paid` but moves no money (it wasn't
  a verified payment); an internal `migrated-survey-fee` event tells ops to
  check it and credit it on the balance invoice.
- `finalQuote` → `proposal` (`contractType: "supply-and-install"`):
  `issued` → `issued` (no proposalId), `accepted` → `accepted` with
  `contractTotalPence = totalGbp * 100`. No `preContractInfoSentAt`, so
  `cancellationStatus` applies reg 31.
- `installation` → `booking`: `booked` → `booked`, start date, dates =
  `installDays` consecutive working days, `installer` → crew entry
  (`role: "installer"`, `staffId: "legacy"`).
- `delivery` → `kit`: scheduled → `ordered`; `dispatched` / `delivered` as
  is. Delivered on an accepted contract sets `goodsReceivedOn` and
  `cancellationEndsOn`.
- `installation.completed` → install complete, handover pending.
- Reschedule fees carry over into `money.changeFeesPence`. `events` kept.
- v1 kept email and phone on the quote: `withLegacyContact` (web) fills
  only a v1 snapshot's gaps from it.

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

Until F2 lands it, `lib/media-server.ts` validates with its own
`cleanAnnotations` (same contract) through `validateAnnotationsSafe`.

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
export const DEFAULT_INCLUSIONS: string[]; export const DEFAULT_EXCLUSIONS: string[]; export const DEFAULT_PROPOSAL_ASSUMPTIONS: string[]; // [F4] (§K1)
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
  | "issue-update" | "handover-ready" | "certificate-issued" | "check-in-7d" | "feedback-30d" | "review-request" | "seasonal-check"
  | "service-reminder" | "team-alert";
export interface CommsEventDef { id: CommsEventId; channels: ("email" | "sms")[]; audience: "customer" | "team" | "staff";
  trigger: "auto" | "manual" | "cron"; description: string; templateVersion: number }
export const COMMS_EVENTS: Record<CommsEventId, CommsEventDef>;
export const FOLLOW_UP_EVENTS: ReadonlySet<CommsEventId>; // check-in-7d, feedback-30d, review-request, seasonal-check, service-reminder:
                                                          // carry an opt-out line, never sent once aftercare.followUpsOptedOutAt is set
export function idempotencyKey(event: CommsEventId, projectId: string | null, discriminator: string, channel: "email" | "sms"): string;
export const LINK_PLACEHOLDER: string; // stands in for the sign-in link in every stored body; the link is minted at send
export interface MessageRecord { id: string; idempotencyKey: string; projectId?: string; event: CommsEventId; channel: "email" | "sms";
  templateVersion: number; to: string; subject?: string; bodyText: string; bodyHtml?: string; linkPath?: string;
  status: "queued" | "sent" | "failed" | "demo" | "skipped"; provider?: string; providerRef?: string; error?: string; attempts: number;
  scheduledFor?: string; sentAt?: string; createdAt: string }
```

**`documents.ts`** [F]

```ts
export type DocumentKind = "proposal" | "contract" | "variation" | "invoice" | "receipt" | "commissioning-certificate" | "handover-pack" | "survey-report";
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string>; export const DOCUMENT_KIND_CODE: Record<DocumentKind, string>; // PR CT VA IN RC CC HP SR
export interface DocumentRecord { id: string; projectId: string; kind: DocumentKind; version: number; ref: string; title: string;
  status: "draft" | "final" | "superseded"; customerVisible: boolean; snapshot: unknown; createdAt: string; createdBy?: string }
export function documentRef(kind: DocumentKind, projectShortId: string, version: number, instance?: string): string;
  // ("proposal", "7f3a91c2", 2) → "DIH-PR-7F3A91C2-v2"; ("invoice", "7f3a91c2", 1, "0002") → "DIH-IN-7F3A91C2-0002-v1"
export function projectShortId(projectId: string): string;  // first 8 letters/digits, upper-case (4 collide across projects)
// What each kind freezes (every snapshot extends DocumentHeader { company, customer, issuedAt }):
export interface DocumentSnapshots { proposal: ProposalSnapshot; contract: ContractSnapshot; variation: VariationSnapshot;
  invoice: InvoiceSnapshot; receipt: ReceiptSnapshot; "commissioning-certificate": CommissioningCertificateSnapshot;
  "handover-pack": HandoverPackSnapshot; "survey-report": SurveyReportSnapshot }
export type TypedDocumentRecord<K extends DocumentKind>;    // DocumentRecord with snapshot: DocumentSnapshots[K]
export function documentCompany(settings: PilotSettings): DocumentCompany;  // issuer block, from settings at issue
export function documentCustomer(project: Pick<Project, "customer">): DocumentCustomer;
export function handoverDeadlines(completedOnIso: string): { electricalCertDueBy: string; maintenanceInfoDueBy: string }; // +30 / +5 days
export function fgasRecord(input: { system: string; factoryChargeKg: number; additionalChargeG: number; refrigerant?: string; gwp?: number }): FgasRecord;
// Also: InstalledEquipmentRow, FgasRecord, DocumentLink, VariationIssue, ELECTRICAL_CERT_DUE_DAYS, MAINTENANCE_INFO_DUE_DAYS, R32_GWP.
```

`version` counts revisions of **one** document (proposal v1 → v2), not
documents of a kind. Kinds a project has several of (invoice, receipt,
variation) pass `instance` (invoice number digits, payment id, variation
issue number) so each is its own series. Issue documents through
`lib/documents-server.ts` (§F), which does all of this.

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

Foundation wrote one migration creating everything below (`if not
exists`, RLS enabled, no policies: service role only, matching the
existing tables). It's tested against local Postgres 16 with stub `storage`
/ `auth` schemas (`bash supabase/tests/run-migrations.sh`). Keys, uniques
and triggers are mirrored by hand in `apps/web/lib/db/local-schema.ts`.

**Columns on `projects`:**
- `schema_version int default 1`, `customer_id uuid`, `pilot_number int`.
- `owner_staff_id uuid` (→ staff), `next_action text`, `next_action_at date`.
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
    `subject_id text` (null for a first admin sign-in), `email`, `purpose`,
    `next_path`, `expires_at`, `used_at`, `created_at`.
- **Survey, design, proposal**
  - `media`: `id`, `project_id` → projects (nullable), `bucket`, `storage_path`,
    `content_type`, `tag`, `room_id`, `caption`, `source`,
    `taken_by jsonb`, `taken_at`, `customer_visible`, `width`, `height`,
    `annotations jsonb default '[]'`, `annotations_version int`,
    `locked`, timestamps.
  - `surveys`: `id`, `project_id`, `version`, `status`, `data jsonb`,
    `surveyor jsonb`, `started_at`, `submitted_at`, `minutes`,
    timestamps; unique (`project_id`, `version`): a double-tapped start or
    an offline retry gets 23505 and reuses the draft
    (`surveys.insertOrReuse`).
  - `designs`: `id`, `project_id`, `version`, `status`,
    `record jsonb`, timestamps; unique (`project_id`, `version`).
  - `proposals`: `id`, `project_id`, `version`, `status`,
    `record jsonb`, `issued_at`, `accepted_at`, timestamps; unique
    (`project_id`, `version`). Plus a **trigger**
    (`proposals_guard_accepted`): a row that is `accepted`, or `superseded`
    with an acceptance record, is frozen. The only change allowed is
    (re)stating `status = 'superseded'` with `record->'options'`,
    `record->'acceptance'`, `project_id`, `version` and `accepted_at`
    unchanged.
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
  - `documents`: `id`, `project_id`, `kind`, `version`, `ref unique`
    (`documentRef`), `status`, `customer_visible`, `record jsonb`,
    `created_at`.
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

## F. Web foundation (`apps/web/lib`, `components`)

Foundation-owned and shared: call these, don't fork them. Signatures are
abridged; read the module.

**Data, auth, settings**

| File | Exposes |
| --- | --- |
| `lib/supabase-server.ts` | `getServiceClient()`, `requireDb()`, `dataBackend()`, `MEDIA_BUCKET = "project-media"`, `PHOTO_BUCKET`, `VIDEO_BUCKET` |
| `lib/db/local-client.ts`, `local-schema.ts`, `local-storage.ts` | §B |
| `lib/auth/session.ts`, `access.ts`, `server.ts`, `magic.ts`, `demo-staff.ts` | §C |
| `lib/settings-server.ts` | `getSettings(): Promise<PilotSettings>` (cached per request), `saveSettings(next, actor)` (merged, audited; caller checks `settings.edit`) |
| `lib/audit.ts` | `audit({ actor, action, entity, entityId?, detail? })`; `actor` is a StaffMember, `{ kind, id?, name }` or null (system) |
| `lib/repo/*.ts` (`import { proposals } from "@/lib/repo"`) | One module per table, mapping rows ↔ D4 types. Common shape: `get(id)`, `listForProject(projectId)` (the per-project list), `insert(record)`, `update(record)`, `fromRow` / `toRow`; a board-wide `list(...)` only on `catalogue`, `compatibility`, `invoices`, `learnings`, `purchaseOrders`, `staff`. Special cases: `designs` / `proposals` are versioned (`latestForProject`, `nextVersion`; `designs.approvedForProject`, `proposals.liveForProject`, `proposals.acceptedForProject`); `surveys.currentForProject`, `surveys.insertOrReuse`; `installJobs.getForProject` / `loadForProject(projectId, project?)` / `save(job)`; `evidence.appendIdempotent(projectId, record)` / `listForProject`; `payments.insertIdempotent` (no plain insert), `getByProviderRef`, `listForInvoice`; `invoices.nextNumber`, `insertNumbered`, `getByNumber`; `issues.nextNumber(projectId)`, `listOpen`; `compliance.insertMany`, `getByKey` (no single insert); `media.listByIds`, `saveAnnotations(id, annotations, expectedVersion)`; `documents.getByRef`, `latestOfKind`; `catalogue` / `compatibility` use `upsert` / `upsertMany` (no insert/update); `customers.getByEmail`, `findOrCreate` (no insert), `projectIdsFor`; `staff.getByEmail`, `listByIds`, `insert(member, by)` / `update(member, by)` (`by` taints demo writes); `messages.update(id, patch)`, `findByKey`, `claim`, `due`, `listRecent`; `settings.getValue` / `setValue`; `tokens.findByHash` / `markUsed`; `time.listForStaff` / `openForStaff`; `audit.listForEntity` / `listRecent`. Uniques throw unless the helper says it's idempotent. |
| `lib/legacy-contact.ts` | `withLegacyContact(db, project, rawSnapshot, quoteId)`: v1 snapshots only |

**Projects**

| File | Exposes |
| --- | --- |
| `lib/project-service.ts` | `dispatch(projectId, action, actor) → { project } \| { error, status, blockers? }`: load (migrating v1) → `buildReadinessContext` → reducer → customer re-link (§C) → optimistic save (retries on a concurrent write) → audit → `notifyForAction`. The one write path for v2 projects. Also `loadProject(id)`, `saveProject(project, opts?)`, `createProjectForQuote(quoteId, { pilot?, contact?, actor? }) → { id, created } \| { error, status }` (idempotent per quote; links the customer; instantiates compliance when F5's template exists), `buildReadinessContext(project, actor?)`, `loadReadinessContext(projectId, actor?)`, `londonToday()`, `applyAndSave` (old name), `buildDemoProject`, `DEMO_SURVEY`, `ServiceActor` (`{ kind: "staff", staff } \| { kind: "customer", customerId, name? } \| { kind: "system", name? }`; a bare StaffMember works too). Permission checks are the caller's; qualification checks are the reducer's. |
| `lib/projects-server.ts`, `lib/project-notify.ts` | v1 only, until F1/F7 replace their pages (§K2) |

**Comms**

| File | Exposes |
| --- | --- |
| `lib/comms/outbox.ts` | `notify(event, { projectId?, to?, data, discriminator, scheduledFor?, path?, channels? }) → NotifyResult` (never throws): resolves recipients from the project (or `to`), skips disabled events and opted-out follow-ups, keys on `idempotencyKey`, renders, stores, and sends now unless scheduled. Statuses: `sent` (provider acknowledged), `demo` (no provider: stored, not sent), `queued`, `failed`, `skipped`, `duplicate`, `disabled`, `no-recipient`, `not-allowed`, `error`. Also `dispatchDue(now?)` (cron) and `resend(messageId)`. |
| `lib/comms/outbox-core.ts` | `createOutbox(deps)`: the engine with every dependency injected (tests drive it with fakes) |
| `lib/comms/templates.ts` | `CommsData` (the `data` each event takes), `renderMessage(event, ctx, data)`, `linkPathFor(event, projectId)`. One renderer per `CommsEventId`, via `brandedEmail`: names us, uses their name, says what happened and what's next, links to the right portal screen, gives the support phone. No marketing in operational messages. |
| `lib/comms/action-map.ts` | `commsForAction(project, action, actor)` (pure: which notices an action sends, §H), `followUpForDelivered` (the acceptance email sets `confirmationSentAt`) |
| `lib/comms/for-action.ts` | `notifyForAction(project, action, actor)`: called by `dispatch`; adds what only the database knows (proposal options) |
| `lib/comms/legal-text.ts` | `CANCELLATION_NOTICE_VERSION`, `cancellationInstructions(trader, opts)`, `cancellationForm(trader)`, `traderBlock`: CCR Schedule 3 model wording (needs solicitor review) for emails and documents |

**Documents and media** (shared by every feature that issues a document or takes a photo)

| File | Exposes |
| --- | --- |
| `lib/documents-server.ts` | `createDocument(projectId, kind, snapshot: DocumentSnapshots[K], { title, customerVisible, createdBy?, status?: "draft" \| "final", instance?, id?, createdAt? }) → TypedDocumentRecord<K>`: plans the series, version and ref (`documentRef`), inserts, then supersedes the earlier versions of the same series (a draft supersedes nothing). Repeatable kinds (`MULTI_INSTANCE_KINDS`: invoice, receipt, variation) take their instance from the snapshot. Also `getDocument(id)`, `getDocumentOfKind(id, kind)`, `listDocuments(projectId, { customerVisibleOnly?, kind?, includeSuperseded? })`, `currentDocument(projectId, kind)`, and the pure `planDocument`, `documentInstance`, `documentSeries`, `isCustomerVisible`. Permissions are the caller's. |
| `lib/media-server.ts` | Upload in three steps, with no half-made rows: `createMediaUpload(input) → { mediaId, path, signedUrl, ticket, expiresAt }` (the ticket is the signed row-to-be, 2 hours), browser PUT, `registerMedia(ticket) → MediaResult` (checks the object, size and type; idempotent). `storeSystemMedia(...)` (server-generated files, the only way SVG gets in), `signedMediaUrls(items, expiresSec?) → Map<id, url>`, `listProjectMedia(projectId, { customerVisibleOnly?, tag?, roomId?, source? }) → MediaWithUrl[]`, `updateMedia(id, patch)` (locked items refuse drawing, tag and room changes; stale `expectedVersion` refused). Rules: `canWriteMedia(staff, source)` (`MEDIA_WRITE_PERMISSIONS`), `canEditMedia`, `MEDIA_CONTENT_TYPES` (jpeg, png, webp, heic, pdf, mp4), `MEDIA_MAX_BYTES` (25 MB), `cleanAnnotations`, `validateAnnotationsSafe`, `MediaError(status)`. |
| `app/api/media/route.ts` | `POST /api/media` (staff; `requireProjectAccess` + `canWriteMedia`): start an upload. `GET /api/media?projectId=…[&tag&roomId]`: staff on the job get every item, the project's customer only customer-visible ones (no storage paths), each with a signed `url`. POST signed out → 401; any "no" about a project (GET signed out included) → 404. |
| `app/api/media/[id]/route.ts` | `POST` `{ ticket }`: confirm an upload. `PATCH` `{ annotations?, expectedVersion?, tag?, caption?, customerVisible?, roomId? }` (`canEditMedia`): 409 when locked or stale. Both return the item with a fresh `url`. |
| `lib/media-client.ts` | Browser: `uploadMedia(file, { projectId, tag, source, roomId?, caption?, customerVisible?, onProgress?, signal?, … }) → UploadedMedia`: re-encodes photos (≤ 2048 px, JPEG 0.82, EXIF and GPS stripped), requests, PUTs with progress, confirms; retries with backoff. `MediaUploadError { status, retryable }`, `prepareImage`, `fitWithin`. |
| `components/annotate/annotated-image.tsx` | `<AnnotatedImage src annotations alt? width? height? legend? labels? caption? className? loading? />`: read-only photo + drawing (SVG in normalised coordinates), server-renderable, any size. For proposals, documents, the portal, the command centre. Helpers in `annotation-summary.ts`: `annotationColour`, `describeAnnotations`, `annotatedAlt`, `legendEntries`, `chipTextColour`. The editor is F2's (§G). |

**Demo data**

| File | Exposes |
| --- | --- |
| `lib/demo-seed/**` | `resetDemoData({ now?, settings? }) → { at, cleared, projects }`: five fictional DEMO homes (survey booked; proposal out; ready to install with early start evidenced; design in review with a blocking issue; completed and closed), built through the real reducer and written through the repositories, `createDocument` and `storeSystemMedia`. Deletes and rewrites demo data only (quotes with `source = 'demo'`, ids carrying the `de5e` marker, `@example.com` customers, `demo-` catalogue ids). `buildDemoDataset({ now, settings? })` is pure. Its own catalogue, compliance checklist and photos stand in for feature stubs. |
| `app/api/dev/seed/route.ts` | `POST /api/dev/seed`: only where `demoLoginAllowed`, then only for a signed-in admin, or in development the login page's button (`x-dih-seed: login`, same origin). Anything else 404. |
| `app/login/demo-seed.tsx` | "Load demo pilots" on `/login`: anyone in development; on a demo deployment, signed-in admins only. |

**Providers, formatting, UI**

| File | Exposes |
| --- | --- |
| `lib/providers/sms.ts` | `smsConfigured()`, `sendSms(to, body)` (Twilio REST via fetch: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) → `{ ok, providerRef?, error? }`. UK numbers to E.164. |
| `lib/providers/stripe.ts` | `stripeConfigured()`, `stripeMode()` (`test` / `live` from the key prefix), `createCheckoutSession({ invoice, successUrl, cancelUrl, customerEmail })` (REST, form-encoded, `metadata.invoice_id` / `project_id`), `verifyStripeSignature(rawBody, header, secret, toleranceSec=300)` |
| `lib/env-mode.ts` | `appMode()` → `{ data: "supabase" \| "file" \| "memory" \| "demo", email, sms: "live" \| "demo", payments: "live" \| "test" \| "demo" }`, `isFullyLive()`, `isDemoLoginAllowed()` |
| `lib/format.ts` | `money(pence)` → "£1,234" (pence only when non-zero), `fmtDate(iso)` → "3 Nov 2026", `fmtDay`, `fmtDayTime`, `gbp` |
| `components/kit/*` (index) | `Button`, `LinkButton`, `buttonClass`, `Card`, `Badge`, `StatusChip`, `statusChip`, `Field`, `Fieldset`, `Input`, `Select`, `Textarea`, `Checkbox`, `Section`, `PageHeader`, `EmptyState`, `Stat`, `Tabs` (links), `NavLink`, `BlockerList`, `Money`. `ModeBanner` is server-only: import `@/components/kit/mode-banner`. No `Timeline` (§K10). |
| `app/ops/layout.tsx` | Ops shell: top nav (Board, Calendar, Purchasing, Catalogue, Pilots, Messages, Staff, Settings, plus "More": Quotes, Intel, Analytics, Finance, Status), user menu, mode banner. Pages still call their own guard. Nav links to pages features haven't built yet 404 until they land. |
| `app/field/layout.tsx` | Field shell: sticky header (job title slot, offline/unsynced badge slot), bottom tab bar (Today, Jobs, Issues, Me), large type, no marketing chrome |
| `app/login/page.tsx`, `app/auth/verify/route.ts`, `app/auth/logout/route.ts`, `app/auth/forbidden/page.tsx`, `app/portal/page.tsx` | Staff sign-in (magic link, "Try as…", break-glass), token confirm and exchange, sign-out, the no-access page, customer portal sign-in (F1 extends it) |
| `apps/web/tests/helpers/resolve-app.ts` | `registerAppResolver()`: lets `node --test` import app modules (`@/…`, extensionless paths) against `DATA_BACKEND=memory`; see `tests/project-service.test.ts` |

`next.config.ts` Permissions-Policy becomes
`camera=(self), geolocation=(self)`: the field app uses camera input and
GPS for the arrival fix.

## G. Ownership map (feature phase)

**The code is the source of truth for exact types; read
`packages/domain/src` before coding.**

Each feature agent owns only the files listed for it. It may add new files
inside its own directories, and add a migration only as its own numbered
file (F1 `0011`, F2 `0012`, … F8 `0018`). Cross-feature calls go through
the foundation APIs (`dispatch`, `notify`, `createDocument`, the media API,
repositories). If a feature needs something another feature owns, or a
change to a foundation file, it uses the contract types and leaves a
`// INTEGRATION:` note.

**Foundation-owned (no feature edits these):** `packages/domain/src/index.ts`,
`project.ts`, `project-v1.ts`, `settings.ts`, `staff.ts`, `comms.ts`,
`documents.ts` and every D4 file's types; `lib/project-service.ts`,
`lib/auth/**`, `lib/repo/**`, `lib/db/**`, `lib/comms/**`,
`lib/documents-server.ts`, `lib/media-server.ts`, `lib/media-client.ts`,
`app/api/media/**`, `components/annotate/annotated-image.tsx` and
`annotation-summary.ts`, `lib/demo-seed/**`, `app/api/dev/**`, `app/login/**`,
`app/auth/**`, `components/kit/**`, the ops and field layouts, migrations
`0001`–`0010`. `tests/route-guards.test.ts` and `tests/demo-seed.test.ts`
must keep passing.

| Agent | Owns | Delivers |
| --- | --- | --- |
| **F1 Portal** | `app/p/[id]/**` (except `proposal`), `app/portal/**`, `components/portal/**`, `components/project/**` (rewrite for v2), `app/how-it-works/page.tsx` (demo embed only), `app/d/[id]/**`, `components/docs/**` | Customer hub for v2: timeline, one next action (`customerNextAction`), stage panels for all 8 stages with copy from `stageInfo` / `cancellationCopy` (survey booking, documents-by-email consent, install date picker from `earliestInstallStart`, early-start request, kit status, install days with daily updates and photos via `AnnotatedImage`, handover pack, aftercare feedback and follow-up opt-out, report a problem → issue). Documents list (`listDocuments`, customer-visible only). `/portal` sign-in and "your homes". Printable renderers for every `DocumentKind` from `DocumentSnapshots` (documents are created by the feature that issues them, through `lib/documents-server.ts`). `/p/demo` playable on v2 (client reducer, demo ctx). Access checks via `requireProjectAccess`. |
| **F2 Survey** | `packages/domain/src/survey-visit.ts`, `media.ts` (logic + tests), `app/field/survey/**`, `components/field/survey/**`, the annotation editor `components/annotate/annotator.tsx` (and any new editor files in `components/annotate/`; not `annotated-image.tsx` / `annotation-summary.ts`) | Phone survey flow (§3 Stage 2 of the plan), autosave (`surveys.insertOrReuse` on start), completeness meter, background photo upload through `lib/media-client.ts` and `/api/media` (foundation), the annotation editor (reusable, also for ops and install; saves via `PATCH /api/media/[id]` with `expectedVersion`), the self-survey diff component, survey submit → `dispatch(survey-submitted)` |
| **F3 Design** | `catalogue.ts`, `design-record.ts` (logic + tests), `app/ops/catalogue/**`, `app/ops/projects/[id]/design/**`, `components/ops/design/**`, `lib/catalogue-seed.ts` (loads `docs/research/data/catalogue-seed.json` into `catalogue_items` on demand) | Catalogue CRUD, CSV import and export, compatibility rules. Design from the measured survey, overrides with reasons, verdict lights, layout photos, submit for review, approve (tech lead only) → `dispatch(design-approved)` |
| **F4 Proposal** | `costing.ts`, `proposal.ts` (logic + tests), `app/ops/projects/[id]/proposal/**`, `components/ops/proposal/**`, `app/p/[id]/proposal/**`, `components/proposal/**`, `app/api/proposals/**` | Proposal builder (options, cost build-up, margin, discount, tax, inclusions, `contractType` on issue), issue (with gate blockers; save the record before dispatching `proposal-issued`), revisions. Customer proposal page with accept flow (cancellation info, early start, typed signature, acceptance record with IP/UA), request changes, decline. Contract and proposal documents created via `lib/documents-server.ts` |
| **F5 Booking & money** | `compliance.ts`, `money.ts`, `purchasing.ts` (logic + tests), `app/ops/calendar/**`, `app/ops/purchasing/**`, `app/ops/projects/[id]/kit/**`, `app/ops/projects/[id]/money/**`, `app/ops/projects/[id]/compliance/**`, `app/api/stripe/**`, `app/api/pay/**`, `app/p/[id]/pay/**`, `lib/ops-server.ts`, `app/ops/schedule/**`, `app/ops/procurement/**` | Install blocks (start from `earliestInstallStart`) and crew assignment with qualification checks, calendar (surveys, deliveries, installs, crew day view), POs from design, kit check, compliance checklist UI with review, invoices (deposit, balance, variation), Stripe Checkout and webhook (idempotent), bank transfer details plus manual payment recording, customer pay page, variations' price acceptance (customer side lives in F1's issue panel and calls F5's API), `survey-fee-paid` after a verified survey-fee payment; the balance invoice credits `projectFees().surveyPaidGbp` |
| **F6 Field install** | `install.ts` extensions, `issues.ts` (logic + tests), `app/field/**` (except `survey`), `components/field/**` (except `survey`), `app/api/field/**`, `lib/field-outbox.ts` (client, IndexedDB) | Today, job pack, day runsheet with evidence capture (camera photos via `lib/media-client.ts` and `/api/media`, readings, serials, signature canvas), role gating, Pass/Fail/Blocked/N/A, exceptions for tech lead review, issues and variations, time log (arrive / pause / resume / end), on-my-way SMS with preview, end-of-day customer update with photo picker, kit check, commissioning sign-off, handover walkthrough plus customer signature, offline outbox with unsynced badge |
| **F7 Ops core** | `pilots.ts` (logic + tests), `app/ops/page.tsx`, `app/ops/projects/page.tsx`, `app/ops/projects/[id]/page.tsx`, `app/ops/projects/[id]/actions.ts`, `app/ops/projects/new/**`, `app/ops/pilots/**`, `app/ops/messages/**`, `app/ops/staff/**`, `app/ops/settings/**`, `components/ops/board/**`, `components/ops/command/**`, `app/api/cron/daily-ops/**`, `app/api/cron/digest/route.ts`, `app/api/cron/outbox/**` | Board with search and owners (`set-owner`), command centre (readiness blockers, sections linking to design / proposal / kit / money / compliance / install, issues, time, learnings, documents, messages, activity; record documents consent given in person and early-start evidence, `early-start-evidenced`), new pilot form, staff and qualifications admin, settings editor (including the Schedule 2 company fields and `reviewUrl`), messages log (preview, resend), pilots dashboard (comparison, CSV), daily-ops cron (survey reminders, install-day-before, install-prep, proposal reminder and expiry, day-7 check-in, day-30 feedback, review request via `reviewRequestDue`, seasonal check via `seasonalCheckDue`, service reminders, outbox retries), digest extended |
| **F8 Public & funnel** | `app/page.tsx`, `app/faq/**`, `app/about/**`, `app/terms/**`, `app/privacy/**`, `app/areas/**`, `app/guides/**`, `app/quote/**`, `app/q/**`, `components/quote/**`, `components/site/**`, `lib/brand.ts`, `app/api/quotes/**`, `lib/email.ts` (quote email copy only) | Every honesty fix from plan §1, service-area check from settings, consent ticks (operational vs marketing), terms and privacy links, heating-and-cooling framing, finance hidden unless the lender is configured, warranty and F-gas claims from settings, prototype nav hidden unless enabled, optional "lock your price" photos, accessibility fixes (fieldset/legend, contrast, progressbar, no autofocus keyboard pop), terms page with cancellation info and model form, `/q/[id]` "Book my home survey" CTA |

## H. Comms events: who fires what

`dispatch` → `notifyForAction` → `commsForAction` (pure, `lib/comms/action-map.ts`)
covers every action below; features never call `notify` for these. Every
other event is sent by its owner with `notify`.

| Event | Fired by |
| --- | --- |
| `survey-booked` | `book-survey` / `ops-book-survey` / `reschedule-survey` (plus a `team-alert` when the customer booked it) |
| `surveyor-on-my-way` | `surveyor-on-my-way` (SMS) |
| `survey-complete` | `survey-submitted` |
| `proposal-issued` | `proposal-issued`: the durable copy of the pre-contract information (Schedule 2, cancellation instructions, model form), with the record's options and prices |
| `proposal-accepted` | `proposal-accepted`: customer copy (contract, cancellation position and form, how to confirm an early start by reply) plus a `team-alert`. Once it's sent or stored as demo, the outbox dispatches `contract-confirmation-sent` (which sends nothing) |
| `proposal-changes-requested` | `proposal-changes-requested` (team) |
| `install-booked` | `booking-confirmed`, and `install-dates-set` after confirmation |
| `kit-update` | `kit-updated`, only for confirmed, delivered or inspected |
| `installer-on-my-way` | `installer-on-my-way` (SMS) |
| `install-day-update` | `install-day-ended` with a `customerUpdate` |
| `handover-ready` | `handover-pack-published` |
| `certificate-issued` | `electrical-cert-updated` → received, or `warranty-registered`, after the pack is out |
| `invoice-issued`, `payment-received` | F5 server code |
| `variation-approval` | F6 when a variation is proposed |
| `issue-update` | Manual from ops |
| `survey-reminder`, `install-prep`, `install-day-before`, `proposal-reminder`, `check-in-7d`, `feedback-30d`, `review-request`, `seasonal-check`, `service-reminder` | F7 daily-ops cron (follow-ups skip opted-out customers; the review request only while `company.reviewUrl` is set) |
| `magic-link` | Auth |
| `team-alert` | Any |

## I. Testing and the end-to-end walk

- Domain: unit tests per module, in the same style as the existing ones.
- Web: `apps/web/tests/*.test.ts` for the local client, session
  signing/verification, Stripe signature, outbox idempotency and
  permission guards. Use pure functions where possible.
- Web modules with I/O run against the in-memory backend with
  `tests/helpers/resolve-app.ts` (see `tests/project-service.test.ts`,
  `tests/demo-seed.test.ts`).
- Checks before declaring done: `pnpm -r typecheck`, `pnpm test`,
  `pnpm --filter @aircon/web build`, `bash supabase/tests/run-migrations.sh`.
- E2E (integration phase): `apps/web/scripts/e2e-pilot.mjs` (playwright-core,
  Chromium at `/opt/pw-browsers`) against `next start` with
  `DATA_BACKEND=file`, `ALLOW_DEMO_LOGIN=1`, `SESSION_SECRET` (≥ 32
  characters) and a temp `LOCAL_DATA_DIR`. Wait on `load`, not
  `networkidle`: the ops nav prefetches pages that 404 until features land.
  It walks: demo sign-in as admin
  → new pilot → survey (rooms, a photo, an annotation) → submit → design →
  approve as tech lead → documents-by-email consent → proposal → issue →
  customer magic link → accept (with early start) → early-start evidence
  recorded → dates and crew → kit delivered and inspected →
  compliance approved → field day 1–3 evidence → commissioning sign-off →
  handover pack and signature → balance invoice → demo payment → close →
  pilots dashboard shows the row. It also checks isolation: a second
  customer can't open the first project (404), and an external installer
  can't see margin.
- As built: `BASE_URL=http://localhost:3330 pnpm --filter @aircon/web
  test:e2e:pilot` against a fresh `LOCAL_DATA_DIR` (phases A to L, about 150
  checks, screenshots in `SHOTS_DIR`; `E2E_UNTIL=<letter>` stops after a
  phase). Phones are 390x844, ops 1280x800. Install day 1 is started early
  from the field app (the 5-day lead time means booked dates are never
  today). The Stripe webhook with a secret set and the seed route with demo
  sign-in off are covered by `tests/security-routes.test.ts`, since a running
  server's env can't be flipped.

## J. Out of scope (don't build)

Inventory and warehouse stock, supplier scraping, WhatsApp, recurring
billing, server-side PDF rendering, a native installer app, RLS policies,
multi-crew optimisation, AI heat load, LiDAR.

## K. Deviations (foundation, as built)

Where the as-built foundation differs from the original plan, and why. The
sections above already describe the code as built; this list is the
changelog and the reasons, so nobody "fixes" a deliberate choice back.

1. **`DEFAULT_PROPOSAL_ASSUMPTIONS`** replaces `proposal.ts`'s
   `DEFAULT_ASSUMPTIONS`: `intelligence.ts` already exports that name
   through `index.ts`.
2. **v1 kept side by side until F1/F7 land.** `project-v1.ts` is the frozen
   v1 machine with `V1`-suffixed exports (`ProjectV1`,
   `applyProjectActionV1`, …), and `lib/projects-server.ts` /
   `lib/project-notify.ts` stay as v1 persistence and comms for the pages
   not yet rebuilt (`/p/[id]`, `/how-it-works`, `/ops/projects/**`,
   `/api/projects/**`). It reads a v2 snapshot as "not found", so a v1 page
   never runs a v1 action over v2 data. The old names (`loadProject`,
   `applyAndSave`, …) for v2 callers live in `lib/project-service.ts`.
   Integration deleted `lib/projects-server.ts` and `lib/project-notify.ts`
   once every v1 page had been rebuilt; `project-v1.ts` stays in the domain
   because `migrateProject` reads v1 snapshots through it.
3. **`dispatch` errors carry `status`** (the HTTP code a route should
   answer) alongside `error` and `blockers`.
4. **Local signed URLs sign the operation:** `?op=get|put|upsert&exp=…&sig=…`,
   so a read URL can't be replayed as an upload. `put` never overwrites
   (like a Supabase signed upload URL).
5. **`DATA_BACKEND=none`** forces demo mode outside production, to check the
   public demo pages.
6. **Middleware redirects are explicit 302s**, not Next's default 307,
   which would replay a server action's POST at `/login`. External staff who
   open `/ops/**` are sent to `/field`.
7. **Break-glass sessions last 12 hours**, not 30 days. Without a database,
   an `ADMIN_EMAILS` address gets a synthetic admin so the legacy console
   still opens.
8. **On-screen magic links** appear only in development, or for DEMO staff
   on a demo deployment: showing a real person's link would let anyone sign
   in as them. Portal sign-in links last 60 minutes; links embedded in
   customer emails last 30 days, as specified.
9. **The accepted-proposal trigger is stricter:** besides the options, the
   acceptance record, project, version and `accepted_at` are frozen, and a
   proposal that was accepted and then superseded stays frozen. The local
   backend mirrors it exactly (`local-schema.ts` `acceptedProposalGuard`).
10. **Kit:** no `Timeline` wrapper. The portal timeline stays in
    `components/project/timeline.tsx`, which F1 rewrites for v2.
    `ModeBanner` is server-only, so it's imported from
    `components/kit/mode-banner`, not the kit index.
11. **§A7 is enforced by a test.** Every page, route handler and server
    action under `app/ops` and `app/field` calls a guard itself
    (`tests/route-guards.test.ts`). Middleware only proves the cookie is
    signed; it can't see a deactivation, and a server action can be invoked
    from any route. The legacy ops pages now call `requireStaff`:
    `projects.view-all` by default, `finance.view-margin` for finance and
    review, `settings.edit` for launch, and `projects.edit` for their
    actions. Feature agents rewriting those pages keep a guard.
12. **Sign-in hardening** (security review). `customerLink` takes the
    recipient and mints a token only for the customer's own address; an
    email change re-links the project to that address's customer; v2 never
    falls back to the quote's contact details (a removed address stays
    removed). `GET /auth/verify` is a confirm page, never an auto-submit
    (login CSRF, mail scanners). `safeNextPath` re-checks its normalised
    output (`/.//evil.com`). Production ignores a `SESSION_SECRET` under 32
    characters and an `OPS_PASSWORD` under 20; break-glass has per-IP,
    per-email and global limits and audits failures. Demo sign-in is refused
    on a Supabase database without `DEMO_DEPLOYMENT=1`, and staff rows a demo
    session writes are demo. `instrumentation.ts` logs all of this at boot.
13. **Sign-in tokens are never stored.** Message bodies keep
    `LINK_PLACEHOLDER` plus `linkPath`; the link is minted when a provider
    takes the message (first send, retry, resend), so a stored, demo or
    backed-up message can't sign anyone in. Magic-link emails are sent from
    memory once and not retried.
14. **The legal contract flow** (`docs/research/uk-consumer-legal.md`; legal
    review still required) added to `Project.proposal`: `contractType`,
    `documentsByEmailConsent`, `preContractInfoSentAt`, `confirmationSentAt`,
    `earlyStart` (`EarlyStartRecord`, the durable request) and
    `goodsReceivedOn`; to settings: `geographicAddress`, `complaintsProcess`,
    `adr`, `workmanshipGuarantee`, `reviewUrl` and `schedule2Missing`; and the
    actions `documents-consent-recorded`, `contract-confirmation-sent`,
    `early-start-requested` and `early-start-evidenced`. Proposal issue
    needs the consent, a customer email and complete Schedule 2 settings.
    Ready-to-install needs `confirmationSentAt`, which the outbox records
    when the acceptance email is sent, or stored in demo mode (the event says
    "demo mode", so it isn't passed off as delivered).
15. **Cancellation period** (CCR regs 29–31, 36; was "today ≥
    cancellationEndsOn"). Supply-and-install is a sales contract: the period
    runs from delivery of the last of the kit, so it's unknown until
    `kit-updated` records it; install-only runs from acceptance; reg 31
    extends it when the cancellation information came late. The end date is
    inside the period, so ready-to-install clears when `today > endsOn`.
    Starting earlier needs the customer's request **and** its durable
    evidence. `install-dates-set` and the booking gate
    (`dates-inside-cancellation`) refuse a start on or before the end unless
    early start was requested, beyond the original "start ≥ today+5". Use
    `cancellationStatus` and `earliestInstallStart`, never your own sums.
16. **Gates are more detailed than the original table** (§D3 lists them):
    extra blockers (`survey-not-booked`, `survey-not-started`,
    `proposal-not-drafted`, `validity-passed`, `kit-not-planned`,
    `compliance-missing`, `cancellation-unknown`, `money-unknown`, …), plus
    explicit scope: pre-install compliance items are enforced at
    ready-to-install; a later item at its own gate; a blocking issue holds
    its gate (default ready-to-install) and every later one.
    `commissioning-signed` also needs the commissioning record
    (`ctx.commissioning.signed`), and approvals record the verified
    `ctx.actor.name`, not the typed `by`.
17. **Actions added for gaps the review found:** `set-owner` (the board's
    owner; nobody could set it), `survey-fee-paid` (status only, like
    `deposit-paid`), `review-requested`, `seasonal-check-sent`,
    `aftercare-opt-out` (with `aftercare.reviewRequestedAt`,
    `seasonalCheckSentAt`, `followUpsOptedOutAt`). `survey-submitted` takes
    an optional `electrics` finding; `proposal-issued` an optional
    `contractType`; `proposal-accepted` an optional
    `earlyStartWordingVersion`.
18. **Settings-controlled copy:** `STAGE_INFO` is generic (no "three days",
    no "14 days"); customer screens use `stageInfo(stage, settings,
    project?)` and `cancellationCopy`.
19. **v1 survey fee migration:** an unbooked v1 visit becomes a free
    in-person survey (it was never agreed); a v1 "paid" fee stays paid but
    moves no money (it was a button press, not a verified payment) and adds
    an internal `migrated-survey-fee` note. F5's balance invoice credits
    `projectFees().surveyPaidGbp`, as v1 promised.
20. **Comms events added:** `certificate-issued` (after-handover documents),
    `review-request` and `seasonal-check`; `FOLLOW_UP_EVENTS` carry an
    opt-out line and respect `followUpsOptedOutAt`.
21. **Document refs:** `documentRef` takes an optional `instance`, and
    `projectShortId` is 8 characters (4 collided across projects).
    `version` counts revisions of one document. The foundation built
    `lib/documents-server.ts` (series, versions, supersession) and typed
    snapshots per kind (`DocumentSnapshots`), so F1 renders and every
    feature creates through one module.
22. **Media is shared foundation, not F2's:** `lib/media-server.ts`,
    `lib/media-client.ts`, `/api/media` and the read-only `AnnotatedImage`.
    Uploads use a signed ticket (no half-made pending rows); SVG only through
    `storeSystemMedia`. F2 owns the editor and the domain validator, which
    replaces `cleanAnnotations` when it lands.
23. **Repositories** aren't uniformly `get, list, insert, update`:
    `listForProject` is the per-project list, and several tables have their
    own write helper (§F lists them). No aliases were added.
24. **`surveys` is unique on (`project_id`, `version`)**, like designs and
    proposals; `surveys.insertOrReuse` turns a duplicate start into the
    existing draft.
25. **`mergeSettings` sanitises** union values and list items (tax code,
    deposit timing, payment methods, working days, …) back to defaults, so
    junk can't reach `TAX_CODES[code]`.
26. **Demo seed** (`lib/demo-seed`, `POST /api/dev/seed`, "Load demo pilots"
    on `/login`): five DEMO homes through the real reducer. In production
    (a demo deployment) only a signed-in admin can load them, so the button
    appears after "Try as… Admin", not before.
27. **Integration (pilot/f1…f8 merged).** Cross-feature decisions made when
    the eight features were joined:
    - *Quote-owner grant* (`lib/auth/quote-owner.ts`). `/api/quotes` sets a
      signed, httpOnly `dih_quote` cookie (7 days, newest 5 quotes, MAC
      purpose-prefixed so it can't pass as a session). `requireProjectAccess`
      with `allowCustomer` lets that browser open the project made from one
      of those quotes, and nothing else: never the customer record's other
      projects, because the email typed into the funnel is unverified (a
      full session would let someone who typed another person's email see
      that person's later projects). Sign-out clears it.
    - *Consents*: `createProjectForQuote` copies the funnel's consents onto
      `customers.ops_consent` / `marketing_consent`
      (`repo/customers.consentsFromQuote`); the latest answer wins and
      marketing is only ever a consent when it was ticked.
    - *Settings caches*: every `saveSettings` caller then calls
      `revalidateSettingsCaches()` (tag `settings` + the root layout).
    - *Placeholder phone*: the shipped "0800 000 0000" is
      `isPlaceholderPhone` and counts as missing Schedule 2 information, so
      no proposal or contract can carry it; customer pages, emails and SMS
      say "email us" instead until a real number is set.
    - *One turnaround*: `PROPOSAL_TURNAROUND_WORKING_DAYS = 3` in
      `project.ts`, used by the reducer, the timeline, comms, the hub and
      the survey report.
    - *Uploads*: the shared rules live in the domain (`media.ts`
      `MEDIA_UPLOAD_CONTENT_TYPES`, `MEDIA_MAX_BYTES`, `mediaUploadProblem`)
      and take iPhone video (`video/quicktime`, .mov) under 25 MB.
    - *Frozen documents*: the contract snapshot carries the payment schedule
      (`payments`, with the deposit F5 will invoice), complaints and the
      guarantee lines; the handover pack carries its as-built photos
      (`asBuilt`). The renderers prefer the frozen copy.
    - *Compliance from the design*: `syncCompliance(items, project, now,
      design)` approves "equipment combination verified" from the approved
      design (`designCompatibilityVerdict`: every system passes, provisional
      rules confirmed at approval) and reopens its own approval when the
      design changes; design approval syncs the checklist at once.
    - *Stale proposals*: a proposal issued from a superseded design is
      flagged in the builder, Revise drafts afresh from the approved design,
      and a draft built on an older design can't be issued.
    - *Money*: an accepted variation (portal) moves its issue to in progress
      and is billed by the balance invoice (or on its own); a paid survey
      fee is credited on the balance (§K19).
    - *Signer*: customer install updates are signed by the tech lead, else
      whoever ended the day, else an employed installer (`comms/action-map
      crewLead`), never an arbitrary subcontractor.

