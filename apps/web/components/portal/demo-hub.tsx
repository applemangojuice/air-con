"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  EARLY_START_WORDING_VERSION,
  applyProjectAction,
  cancellationSentence,
  isFullName,
  type Blocker,
  type Project,
  type ProjectAction,
  type StaffMember,
} from "@aircon/domain";
import { gbp, money } from "@/lib/format";
import { ActionFeedback, Primary, useEchoesNextStep } from "./bits";
import { HubControllerProvider, type HubController } from "./controller";
import { DEMO_SETTINGS, DEMO_TEAM, demoContext, demoHubData, demoPhoto, type DemoState } from "./demo";
import { Hub } from "./hub";
import { addWorkingDays, blockProblem, londonWallClock } from "./schedule";
import type { HubDocument, HubIssue, PortalRequest, PortalResult } from "./types";

/**
 * /p/demo: the real hub, playable end to end in the browser. The customer's
 * buttons run the same reducer the server runs; "▶ play our side" buttons
 * stand in for the surveyor, engineer, office, supplier and crew. A demo
 * clock moves forward only when a step needs it (install day, a month
 * later). Nothing is saved: reload and it starts again.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** The real instant of a London wall-clock time on a date (the offset is read on that date, so BST and GMT both work). */
function atLondon(date: string, hhmm: string): number {
  const naive = Date.parse(`${date}T${hhmm}:00.000Z`);
  const offset = Date.parse(londonWallClock(new Date(naive))) - naive; // London ahead of UTC by this much
  return naive - offset;
}

const doc = (id: string, kind: HubDocument["kind"], title: string, ref: string, at: number): HubDocument => ({
  id,
  kind,
  title,
  ref,
  version: 1,
  status: "final",
  createdAt: new Date(at).toISOString(),
});

type Step = { label: string; run: () => string | null };

export function DemoHub({ initialProject }: { initialProject: Project }) {
  const initial = useMemo<DemoState>(
    () => ({
      // A fictional household with an (unreachable) email, so the email-only gates behave as they would for real,
      // and an obviously made-up address so no screenshot ever looks like someone's real home.
      project: {
        ...initialProject,
        customer: {
          ...initialProject.customer,
          name: "Alex Morgan (DEMO)",
          email: "alex.morgan@example.com",
          addressLine: "12 Demo Rise",
          postcode: "SW4 9ZZ",
        },
      },
      now: Date.parse(initialProject.createdAt),
      issues: [],
      invoices: [],
      documents: [],
      photos: {},
    }),
    [initialProject],
  );
  const [state, setState] = useState<DemoState>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ourError, setOurError] = useState<string | null>(null);
  const [lastStep, setLastStep] = useState<string | null>(null);

  /** Apply one action at the demo clock (+1 minute per step, so the updates read in order). */
  const apply = useCallback((s: DemoState, action: ProjectAction, actor?: StaffMember, at?: number): { ok: true; s: DemoState } | { ok: false; error: string; blockers?: Blocker[] } => {
    const now = at ?? s.now + MIN;
    const result = applyProjectAction(s.project, action, new Date(now).toISOString(), demoContext({ ...s, now }, actor));
    if (!result.ok) return { ok: false, error: result.error, ...(result.blockers ? { blockers: result.blockers } : {}) };
    return { ok: true, s: { ...s, project: result.project, now } };
  }, []);

  /** Run a sequence; all or nothing. */
  const chain = useCallback(
    (steps: { action: ProjectAction; actor?: StaffMember; at?: number }[], extra?: (s: DemoState) => DemoState): string | null => {
      let s = stateRef.current;
      for (const step of steps) {
        const r = apply(s, step.action, step.actor, step.at);
        if (!r.ok) return r.error;
        s = r.s;
      }
      if (extra) s = extra(s);
      stateRef.current = s;
      setState(s);
      return null;
    },
    [apply],
  );

  /* ---------------- the customer's side ---------------- */

  const request = useCallback(
    async (req: PortalRequest): Promise<PortalResult> => {
      const s = stateRef.current;
      const p = s.project;
      const fail = (error: string): PortalResult => ({ ok: false, error });
      switch (req.kind) {
        case "book-survey": {
          const steps: { action: ProjectAction; actor?: StaffMember }[] = [{ action: { type: "book-survey", scheduledFor: req.scheduledFor, mode: req.mode } }];
          if (req.documentsConsent) steps.push({ action: { type: "documents-consent-recorded", channel: "portal" } });
          steps.push({ action: { type: "assign-surveyor", staffId: DEMO_TEAM.surveyor.id, name: DEMO_TEAM.surveyor.name }, actor: DEMO_TEAM.surveyor });
          const e = chain(steps);
          return e ? fail(e) : { ok: true };
        }
        case "reschedule-survey": {
          const e = chain([{ action: { type: "reschedule-survey", scheduledFor: req.scheduledFor } }]);
          return e ? fail(e) : { ok: true };
        }
        case "documents-consent": {
          const e = chain([{ action: { type: "documents-consent-recorded", channel: "portal" } }]);
          return e ? fail(e) : { ok: true, message: "Thanks. We can email your documents now." };
        }
        case "install-dates": {
          const today = londonWallClock(new Date(s.now)).slice(0, 10);
          const problem = blockProblem({ project: p, settings: DEMO_SETTINGS, today, booked: [], dates: req.dates });
          if (problem) return fail(problem);
          const e = chain([{ action: { type: "install-dates-set", startDate: req.dates[0]!, dates: req.dates } }]);
          return e ? fail(e) : { ok: true };
        }
        case "prep": {
          const e = chain([{ action: { type: "prep-toggled", itemId: req.itemId, done: req.done } }]);
          return e ? fail(e) : { ok: true };
        }
        case "feedback": {
          const e = chain([{ action: { type: "feedback-submitted", score: req.score, ...(req.comments?.trim() ? { comments: req.comments.trim() } : {}) } }]);
          return e ? fail(e) : { ok: true, message: "Thanks. In a real project this goes straight to the team." };
        }
        case "early-start": {
          const e = chain([{ action: { type: "early-start-requested", channel: "portal" } }]);
          return e ? fail(e) : { ok: true };
        }
        case "follow-ups": {
          const e = chain([{ action: { type: "aftercare-opt-out", optedOut: req.optedOut } }]);
          return e ? fail(e) : { ok: true };
        }
        case "variation": {
          const issue = s.issues.find((i) => i.id === req.issueId);
          if (!issue?.variation || issue.variation.status !== "proposed") return fail("That change has already been decided.");
          // The same rule as the real thing: a yes needs their typed name and the agree-to-pay press.
          if (req.decision === "accept" && (!isFullName(req.name ?? "") || req.agreed !== true)) {
            return fail("Type your first name and surname, then press the button to agree.");
          }
          const status = req.decision === "accept" ? "accepted" : "declined";
          const next: HubIssue = {
            ...issue,
            variation: {
              ...issue.variation,
              status,
              decidedAt: new Date(s.now).toISOString(),
              decidedBy: req.decision === "accept" ? (req.name ?? "").trim() : p.customer.name,
            },
          };
          const updated = { ...s, issues: s.issues.map((i) => (i.id === issue.id ? next : i)) };
          stateRef.current = updated;
          setState(updated);
          return { ok: true, message: req.decision === "accept" ? "Thanks. We've told the team it's a yes." : "Thanks. We'll carry on exactly as agreed." };
        }
        case "problem": {
          const issue: HubIssue = {
            id: `demo-fault-${s.issues.length + 1}`,
            number: s.issues.length + 1,
            kind: "fault",
            title: req.title.trim(),
            ...(req.detail.trim() ? { detail: req.detail.trim() } : {}),
            status: "open",
            raisedAt: new Date(s.now).toISOString(),
            raisedBy: "you",
            photos: [],
          };
          const updated = { ...s, issues: [...s.issues, issue] };
          stateRef.current = updated;
          setState(updated);
          return { ok: true, message: "Thanks. In a real project it goes straight to the team, and we call you back." };
        }
      }
    },
    [chain],
  );

  const controller = useMemo<HubController>(
    () => ({ mode: "demo", request, hrefs: { proposal: null, pay: null, documents: null, document: () => null, ops: null } }),
    [request],
  );

  /* ---------------- our side ---------------- */

  const p = state.project;
  const today = londonWallClock(new Date(state.now)).slice(0, 10);
  const tech = DEMO_TEAM.techLead;
  const office = DEMO_TEAM.surveyor; // any signed-in DEMO team member can record office facts
  const crewLead = DEMO_TEAM.installer;

  const steps: Step[] = [];
  const add = (label: string, run: () => string | null) => steps.push({ label, run });

  if (p.survey.status === "booked") {
    if (!p.survey.onMyWay && p.survey.scheduledFor) {
      add("Survey day: Sam's on the way", () => {
        const at = atLondon(p.survey.scheduledFor!.slice(0, 10), `${String(Math.max(0, Number(p.survey.scheduledFor!.slice(11, 13)) - 1)).padStart(2, "0")}:40`);
        return chain([{ action: { type: "surveyor-on-my-way", etaMinutes: 20, by: DEMO_TEAM.surveyor.name }, actor: DEMO_TEAM.surveyor, at: Math.max(at, state.now + MIN) }]);
      });
    }
    add("The survey happens", () => {
      const slot = p.survey.scheduledFor!;
      const start = Math.max(atLondon(slot.slice(0, 10), slot.slice(11, 16)), state.now + MIN);
      return chain(
        [
          { action: { type: "survey-started", by: DEMO_TEAM.surveyor.name }, actor: DEMO_TEAM.surveyor, at: start },
          {
            action: {
              type: "survey-submitted",
              surveyRecordId: "demo-survey",
              electrics: { status: "validated", summary: "DEMO: a dedicated circuit from a spare way on your fuse board. No board work needed." },
            },
            actor: DEMO_TEAM.surveyor,
            at: start + 90 * MIN,
          },
        ],
        (s) => ({ ...s, documents: [...s.documents, doc("demo-survey-report", "survey-report", "Your survey report", "DIH-SR-DEMO-v1", s.now)] }),
      );
    });
  }
  if (p.survey.status === "submitted" && p.design.status !== "approved" && p.proposal.status !== "accepted") {
    add("Our engineer signs off your design", () =>
      chain(
        [
          { action: { type: "design-updated", designId: "demo-design", version: 1, status: "in-review" }, actor: tech, at: state.now + DAY },
          { action: { type: "design-approved", designId: "demo-design", version: 1, by: tech.name }, actor: tech },
        ],
      ),
    );
  }
  if (p.design.status === "approved" && (p.proposal.status === "not-issued" || p.proposal.status === "changes-requested")) {
    add("We issue your proposal", () =>
      chain(
        [
          {
            action: { type: "proposal-issued", proposalId: "demo-proposal", version: 1, validUntil: addWorkingDays(today, 20), optionCount: 1 },
            actor: office,
          },
          // The outbox records this once the issue email has gone; in the demo it "goes" at once.
          { action: { type: "pre-contract-info-sent", proposalId: "demo-proposal", messageId: "demo-issue-message", demo: true } },
        ],
        (s) => ({ ...s, documents: [...s.documents, doc("demo-proposal-doc", "proposal", "Your proposal", "DIH-PR-DEMO-v1", s.now)] }),
      ),
    );
  }
  if (p.proposal.status === "accepted" && DEMO_SETTINGS.payments.depositPct > 0 && p.booking.depositStatus === "not-required" && !state.invoices.some((i) => i.kind === "deposit")) {
    add("We send your deposit invoice", () => {
      const amount = Math.round(((p.proposal.contractTotalPence ?? 0) * DEMO_SETTINGS.payments.depositPct) / 100);
      return chain(
        [
          { action: { type: "deposit-requested", amountPence: amount }, actor: office },
          { action: { type: "invoice-issued", amountPence: amount }, actor: office },
        ],
        (s) => ({
          ...s,
          invoices: [...s.invoices, { id: "demo-inv-1", number: "DEMO-0001", kind: "deposit", status: "issued", totalPence: amount, paidPence: 0, dueOn: addWorkingDays(today, 5), issuedAt: new Date(s.now).toISOString() }],
          documents: [...s.documents, doc("demo-inv-1-doc", "invoice", "Deposit invoice DEMO-0001", "DIH-IN-DEMO-0001-v1", s.now)],
        }),
      );
    });
  }
  const earlyAsked = p.proposal.earlyStart?.requested ?? p.proposal.earlyStartRequested ?? false;
  if (p.proposal.status === "accepted" && earlyAsked && !p.proposal.earlyStart?.evidencedAt && p.install.status === "not-started") {
    add("Your early-start email arrives (we file it)", () =>
      chain([
        {
          action: {
            type: "early-start-evidenced",
            channel: "email",
            evidenceRef: "DEMO-EMAIL-1, Re: Your contract",
            by: office.name,
            // The office saves their reply with the project: a DEMO stand-in for the stored copy.
            mediaIds: ["demo-early-start-email"],
            receivedOn: londonWallClock(new Date(p.proposal.acceptedAt ?? Date.now())).slice(0, 10),
            ...(p.customer.email ? { fromAddress: p.customer.email } : {}),
            wordingVersion: p.proposal.earlyStart?.wordingVersion ?? EARLY_START_WORDING_VERSION,
          },
          actor: office,
        },
      ]),
    );
  }
  if (p.booking.dates.length > 0 && p.booking.crew.length === 0) {
    add("We assign your install team", () =>
      chain([
        {
          action: {
            type: "crew-assigned",
            crew: [
              { staffId: crewLead.id, name: crewLead.name, role: "installer", external: false },
              { staffId: tech.id, name: tech.name, role: "tech-lead", external: false },
              { staffId: DEMO_TEAM.electrician.id, name: DEMO_TEAM.electrician.name, role: "electrician", external: false },
            ],
          },
          actor: office,
        },
      ]),
    );
  }
  if (p.booking.dates.length > 0 && p.booking.crew.length > 0 && p.booking.status !== "booked") {
    add("We confirm your booking", () => chain([{ action: { type: "booking-confirmed" }, actor: office }]));
  }
  if (p.booking.status === "booked" && p.install.status === "not-started") {
    const start = p.booking.dates[0]!;
    if (p.kit.status === "not-ordered") add("We order your kit", () => chain([{ action: { type: "kit-updated", status: "ordered", shortages: 0 }, actor: office }]));
    if (p.kit.status === "ordered") {
      add("The supplier confirms a delivery date", () =>
        chain([{ action: { type: "kit-updated", status: "confirmed", expectedDate: today, shortages: 0 }, actor: office }]),
      );
    }
    if (p.kit.status === "confirmed" || p.kit.status === "dispatched") {
      // Delivered the day it was confirmed for, so the cancellation clock (14 days from delivery) runs from today.
      add("Your kit is delivered", () => chain([{ action: { type: "kit-updated", status: "delivered", shortages: 0 }, actor: office }]));
    }
    if ((p.kit.status === "delivered" || p.kit.status === "inspected") && !p.install.onMyWay) {
      add("Install day 1: the crew's on the way", () =>
        chain([
          ...(p.kit.status === "delivered"
            ? [{ action: { type: "kit-updated", status: "inspected", shortages: 0 } as ProjectAction, actor: crewLead, at: atLondon(start, "07:30") }]
            : []),
          { action: { type: "installer-on-my-way", etaMinutes: 20, by: crewLead.name }, actor: crewLead, at: atLondon(start, "07:40") },
        ]),
      );
    }
    if (p.install.onMyWay) {
      add("Install day 1 starts", () =>
        chain([{ action: { type: "install-day-started", n: 1, by: crewLead.name }, actor: crewLead, at: atLondon(start, "08:05") }]),
      );
    }
  }
  if (p.install.status === "in-progress") {
    const open = p.install.days.find((d) => d.status === "in-progress");
    const planned = p.booking.installDays;
    const doneCount = p.install.days.filter((d) => d.status === "done").length;
    const updates: Record<number, { text: string; scene: Parameters<typeof demoPhoto>[2]; caption: string }> = {
      1: { text: "Holes drilled and sealed, wall plates and the outdoor base are in. Tomorrow: the units go up.", scene: "wall", caption: "Wall plate fixed, hole sealed" },
      2: { text: "Both units are on the wall and the pipework is run and insulated. Tomorrow: testing, commissioning and your walkthrough.", scene: "unit", caption: "Indoor unit up" },
      3: { text: "Pressure and vacuum tests passed, commissioned in heating and cooling, tidied up. Enjoy!", scene: "outdoor", caption: "Outdoor unit, finished" },
    };
    if (open) {
      if (open.n === 2 && !state.issues.some((i) => i.kind === "variation")) {
        add("The crew asks you about a change", () => {
          const s = stateRef.current;
          const issue: HubIssue = {
            id: "demo-variation-1",
            number: s.issues.length + 1,
            kind: "variation",
            title: "Condensate pump for the bedroom unit",
            status: "awaiting-customer",
            raisedAt: new Date(s.now + 3 * 60 * MIN).toISOString(),
            raisedBy: "us",
            photos: [],
            variation: {
              description: "DEMO: the bedroom wall has no fall to a drain, so the condensation needs a small, quiet pump hidden in the trunking.",
              priceDeltaNetPence: 14_500,
              taxPence: 0,
              totalDeltaPence: 14_500,
              status: "proposed",
            },
          };
          const updated = { ...s, now: s.now + 3 * 60 * MIN, issues: [...s.issues, issue] };
          stateRef.current = updated;
          setState(updated);
          return null;
        });
      }
      const u = updates[Math.min(open.n, 3)]!;
      add(`End of day ${open.n}: your update with photos`, () => {
        const photoId = `demo-photo-${open.n}`;
        return chain(
          [
            {
              action: { type: "install-day-ended", n: open.n, summary: `DEMO day ${open.n}`, customerUpdate: { text: u.text, mediaIds: [photoId, `${photoId}b`] } },
              actor: crewLead,
              at: atLondon(open.date, "16:45"),
            },
          ],
          (s) => ({
            ...s,
            photos: { ...s.photos, [photoId]: demoPhoto(photoId, u.caption, u.scene), [`${photoId}b`]: demoPhoto(`${photoId}b`, "Pipe route, clipped and tidy", "pipes") },
          }),
        );
      });
    } else if (doneCount < planned) {
      const n = doneCount + 1;
      const date = p.booking.dates[n - 1] ?? addWorkingDays(today, 1);
      add(`Install day ${n} starts`, () => chain([{ action: { type: "install-day-started", n, by: crewLead.name }, actor: crewLead, at: atLondon(date, "08:00") }]));
    } else {
      add("The install is complete", () => chain([{ action: { type: "install-completed" }, actor: crewLead }]));
    }
  }
  if (p.install.status === "complete" && p.handover.status === "pending") {
    add("Our engineer commissions your system", () => chain([{ action: { type: "commissioning-signed", by: tech.name }, actor: tech }]));
  }
  if (p.handover.status === "commissioned" && !p.handover.packDocumentId) {
    add("We publish your handover pack", () =>
      chain([{ action: { type: "handover-pack-published", documentId: "demo-pack" }, actor: tech }], (s) => ({
        ...s,
        documents: [
          ...s.documents,
          doc("demo-cert", "commissioning-certificate", "Commissioning certificate", "DIH-CC-DEMO-v1", s.now),
          doc("demo-pack", "handover-pack", "Your handover pack", "DIH-HP-DEMO-v1", s.now),
        ],
      })),
    );
  }
  if (p.handover.status === "commissioned" && p.handover.packDocumentId) {
    add("Walkthrough done: you sign off on the installer's phone", () =>
      chain([{ action: { type: "handover-signed", name: p.customer.name.replace(/\s*\(DEMO\)/, ""), outcome: "all-good", snagCount: 0 }, actor: crewLead }]),
    );
  }
  if (p.handover.status === "handed-over" && !p.closure.closed) {
    const invoiced = state.invoices.reduce((s, i) => s + i.totalPence, 0);
    const contract = p.proposal.contractTotalPence ?? 0;
    if (invoiced < contract) {
      add("We send your balance invoice", () => {
        const amount = contract - invoiced;
        return chain([{ action: { type: "invoice-issued", amountPence: amount }, actor: office }], (s) => ({
          ...s,
          invoices: [...s.invoices, { id: "demo-inv-2", number: "DEMO-0002", kind: "balance", status: "issued", totalPence: amount, paidPence: 0, dueOn: addWorkingDays(today, 5), issuedAt: new Date(s.now).toISOString() }],
          documents: [...s.documents, doc("demo-inv-2-doc", "invoice", "Balance invoice DEMO-0002", "DIH-IN-DEMO-0002-v1", s.now)],
        }));
      });
    }
    if (p.handover.electricalCert !== "received" || !p.handover.warrantyRegistered) {
      add("The certificate arrives and we register your warranty", () =>
        chain(
          [
            ...(p.handover.electricalCert !== "received"
              ? [{ action: { type: "electrical-cert-updated", status: "received", documentId: "demo-cert-eic" } as ProjectAction, actor: office, at: state.now + 6 * DAY }]
              : []),
            ...(!p.handover.warrantyRegistered ? [{ action: { type: "warranty-registered", documentId: "demo-cert-war" } as ProjectAction, actor: office }] : []),
          ],
          // In the documents before the timeline says so, as on the real thing.
          (s) => ({
            ...s,
            documents: [
              ...s.documents,
              ...(p.handover.electricalCert !== "received" ? [doc("demo-cert-eic", "certificate", "Electrical installation certificate", "DIH-CE-DEMO-EIC-v1", s.now)] : []),
              ...(!p.handover.warrantyRegistered ? [doc("demo-cert-war", "certificate", "Manufacturer warranty registration", "DIH-CE-DEMO-WAR-v1", s.now)] : []),
            ],
          }),
        ),
      );
    }
    if (!p.aftercare.feedbackRequestedAt) {
      add("A month later: we ask how it's going", () => chain([{ action: { type: "feedback-requested" }, at: state.now + 30 * DAY }]));
    }
    const outstanding = state.invoices.some((i) => i.paidPence < i.totalPence);
    if (!outstanding && invoiced >= contract && p.handover.electricalCert === "received" && p.handover.warrantyRegistered) {
      add("We close the project", () => chain([{ action: { type: "project-closed" }, actor: office }]));
    }
  }

  const play = (step: Step) => {
    setOurError(null);
    const error = step.run();
    if (error) setOurError(error);
    else setLastStep(step.label);
  };

  const data = useMemo(() => demoHubData(state), [state]);

  const controls = (
    <section aria-labelledby="demo-controls" className="rounded-3xl border-2 border-dashed border-ink-300 bg-white/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="demo-controls" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-700">
          <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] text-white">DEMO</span> Play our side
        </h2>
        <button
          type="button"
          onClick={() => {
            stateRef.current = initial;
            setState(initial);
            setOurError(null);
            setLastStep(null);
          }}
          className="min-h-10 rounded-full px-3 text-sm font-semibold text-ink-700 underline underline-offset-2 hover:text-ink-900"
        >
          Start again
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        A fictional home and team, nothing saved. Use the page as the customer; these buttons do what our surveyor, engineer, office and crew would.
      </p>
      {steps.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {steps.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => play(s)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-ink-300 bg-surface px-4 py-2.5 text-left text-sm font-semibold text-ink-900 transition hover:border-ink-500 hover:bg-line"
            >
              <span aria-hidden>▶</span> {s.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium text-ink-700">{p.closure.closed ? "That's the whole journey. Start again any time." : "Your move: the next step is yours, above."}</p>
      )}
      <ActionFeedback className="mt-3" error={ourError} message={!ourError && lastStep ? `Done: ${lastStep}.` : null} />
    </section>
  );

  return (
    <HubControllerProvider value={controller}>
      <Hub data={data} controls={controls} refLabel="DEMO project" slots={{ proposal: <DemoProposal state={state} chain={chain} />, pay: <DemoPay state={state} chain={chain} /> }} />
    </HubControllerProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Stand-ins for the proposal (F4) and pay (F5) pages                  */
/* ------------------------------------------------------------------ */

function DemoProposal({ state, chain }: { state: DemoState; chain: (steps: { action: ProjectAction; actor?: StaffMember }[], extra?: (s: DemoState) => DemoState) => string | null }) {
  const p = state.project;
  const total = Math.round(p.quoteSummary.totalGbp * 100);
  const [name, setName] = useState("");
  const [early, setEarly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-white p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500">DEMO stand-in for your proposal page</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink-900">Standard option</p>
        <p className="font-display text-2xl tabular-nums text-ink-900">{gbp(p.quoteSummary.totalGbp)}</p>
      </div>
      <ul className="space-y-1 text-sm text-ink-700">
        {p.quoteSummary.roomDesigns.map((r, i) => (
          <li key={`${r.name}-${i}`}>
            {r.name}: {r.unitLabel}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-700">{cancellationSentence({ accepted: false, contractType: p.proposal.contractType }, DEMO_SETTINGS.scheduling.cancellationDays)}</p>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 py-1">
        <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600" />
        <span className="text-[15px] text-ink-900">
          Please start before my cancellation period ends
          <span className="block text-sm text-ink-500">Optional. If you then cancel after we&apos;ve started, you pay for the work done up to then.</span>
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-ink-900">Type your full name to accept</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="min-h-12 w-full rounded-full border border-line bg-white px-4 py-3 text-base outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
      </label>
      <ActionFeedback error={error} />
      <Primary
        disabled={name.trim().length < 3}
        onClick={() =>
          setError(
            chain(
              [
                { action: { type: "proposal-viewed", proposalId: "demo-proposal" } },
                { action: { type: "proposal-accepted", proposalId: "demo-proposal", version: 1, optionLabel: "Standard option", contractTotalPence: total, earlyStartRequested: early } },
                // The outbox records this once the acceptance email has gone; in the demo it "goes" at once.
                { action: { type: "contract-confirmation-sent", messageId: "demo-message", demo: true } },
              ],
              (s) => ({ ...s, documents: [...s.documents, { id: "demo-contract", kind: "contract", title: "Your contract confirmation", ref: "DIH-CT-DEMO-v1", version: 1, status: "final", createdAt: new Date(s.now).toISOString() }] }),
            ),
          )
        }
      >
        I accept and agree to pay {money(total)}
      </Primary>
    </div>
  );
}

function DemoPay({
  state,
  chain,
}: {
  state: DemoState;
  chain:(steps: { action: ProjectAction; actor?: StaffMember }[], extra?: (s: DemoState) => DemoState) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const echo = useEchoesNextStep("Pay your deposit", "Pay your invoice", "Pay your balance");
  const due = state.invoices.find((i) => i.paidPence < i.totalPence);
  if (!due) return <p className="text-sm text-ink-500">Your invoice will appear here to pay.</p>;
  const amount = due.totalPence - due.paidPence;
  const pay = () => {
    const steps: { action: ProjectAction; actor?: StaffMember }[] = [{ action: { type: "payment-recorded", amountPence: amount } }];
    if (due.kind === "deposit") steps.push({ action: { type: "deposit-paid", amountPence: amount } });
    const e = chain(steps, (s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === due.id ? { ...i, paidPence: i.totalPence, status: "paid" } : i)) }));
    setError(e);
  };
  return (
    <div className="space-y-2">
      <Primary onClick={pay} quiet={echo}>
        Pay {money(amount)} (DEMO)
      </Primary>
      <p className="text-xs text-ink-500">In the demo no money moves; for real, this opens your secure payment page.</p>
      <ActionFeedback error={error} />
    </div>
  );
}
