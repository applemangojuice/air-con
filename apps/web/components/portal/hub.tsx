"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { currentStage, customerNextAction, projectTimeline, stageState, type Project, type ProjectStageId } from "@aircon/domain";
import { ProjectStepper } from "@/components/project/timeline";
import { fmtDay, fmtDayTime, money } from "@/lib/format";
import { primaryCls } from "./bits";
import { useHub } from "./controller";
import type { HubSlots, PanelProps } from "./panel-types";
import { BookingPanel, KitPanel } from "./panels-booking";
import { PricePanel, ProposalPanel, SurveyPanel } from "./panels-early";
import { AftercarePanel, HandoverPanel, InstallPanel } from "./panels-late";
import { blockLabel } from "./schedule";
import { ContactCard, DocumentsCard, PaymentsCard, UpdatesFeed } from "./side";
import type { HubData } from "./types";
import { defaultStage, stageForHash, waitingCopy } from "./view";

/**
 * The customer hub (contract §G F1): one page for the whole journey.
 *
 *   Your home at …          (where we are)
 *   Your next step          (the ONE thing to do, from customerNextAction)
 *   the eight stages        (stepper; the selected stage's panel opens in place)
 *   updates · contact · documents · payments
 *
 * The same tree renders a real project (live controller), the team's
 * read-only view and the browser demo. Panels never decide what's allowed:
 * they show the domain's state and send requests; the server (or the
 * demo's reducer) says yes or no.
 */

const PANELS: Record<ProjectStageId, (props: PanelProps) => ReactNode> = {
  price: PricePanel,
  survey: SurveyPanel,
  proposal: ProposalPanel,
  booking: BookingPanel,
  kit: KitPanel,
  install: InstallPanel,
  handover: HandoverPanel,
  aftercare: AftercarePanel,
};

const PANEL_ID = "stage-panel";

const isPhone = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;

function scrollToId(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });
}

/** One supporting line under the next step, from facts already on the page. */
function nextDetail(label: string, data: HubData): string | null {
  const p = data.project;
  switch (label) {
    case "Book your home survey":
      return `About ${data.scheduling.surveyDurationMinutes} minutes at your home. ${p.survey.feeGbp > 0 ? `£${p.survey.feeGbp}.` : "Free, with no obligation."}`;
    case "Get ready for your survey":
      return p.survey.scheduledFor
        ? `${fmtDayTime(p.survey.scheduledFor)}${data.surveyor ? ` with ${data.surveyor.name}` : ""}. Clear access to your fuse board and loft, please.`
        : null;
    case "Review your proposal":
      return p.proposal.validUntil ? `Your design and fixed price. Valid until ${fmtDay(p.proposal.validUntil)}: take your time.` : "Your design and fixed price.";
    case "Pay your deposit":
    case "Pay your invoice":
    case "Pay your balance":
      return data.money.outstandingPence > 0 ? `${money(data.money.outstandingPence)} to pay, by card or bank transfer.` : null;
    case "Agree to get your documents by email":
      return "We can only email your proposal and contract with your OK. One tick and we can send it.";
    case "Choose your install dates":
      return `Pick a block that suits you, from ${fmtDay(data.earliestStart.date)}.`;
    case "Reply to confirm your early start":
      return "We need your request in writing before we can start early.";
    case "Get your home ready": {
      const left = p.booking.prep.filter((i) => i.confirmable && !i.done).length;
      return `${left} thing${left === 1 ? "" : "s"} to sort before ${p.booking.dates.length ? blockLabel(p.booking.dates) : "we arrive"}.`;
    }
    case "Check your handover pack":
      return "Your certificates, warranty details and care guide, all in one place.";
    case "Tell us how it's going":
      return "Two minutes, and it genuinely helps us get better.";
    case "Ask us for an updated proposal":
      return `Call ${data.company.phone} or email ${data.company.email} and we'll refresh it.`;
    default:
      return null;
  }
}

function NextStep({ data, go }: { data: HubData; go: (stage: ProjectStageId, anchor?: string) => void }) {
  const hub = useHub();
  const p = data.project;
  const next = customerNextAction(p);
  const staff = hub.mode === "staff";

  if (!next) {
    const w = waitingCopy(p);
    return (
      <section aria-labelledby="next-title" className="rounded-3xl border border-line bg-white p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{staff ? "Customer's next step" : "Your next step"}</p>
        <h2 id="next-title" className="mt-1 font-display text-2xl text-ink-900 sm:text-3xl">
          {w.title}
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-700">
          Nothing for you to do right now. {w.body}
        </p>
      </section>
    );
  }

  const href = next.href ?? "";
  const hash = href.includes("#") ? href.slice(href.indexOf("#")) : null;
  const toProposal = href.endsWith("/proposal");
  const toPay = href.endsWith("/pay");
  const linkHref = toProposal ? hub.hrefs.proposal : toPay ? hub.hrefs.pay : null;
  const detail = nextDetail(next.label, data);

  const onClick = () => {
    if (hash) {
      const stage = stageForHash(hash, p);
      if (stage) go(stage, stage === "price" && p.survey.status === "not-booked" ? "book-survey" : undefined);
    } else if (toProposal) go("proposal");
    else if (toPay) go("booking");
  };

  return (
    <section aria-labelledby="next-title" className="ink-gradient overflow-hidden rounded-3xl p-5 text-white shadow-lg sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{staff ? "Customer's next step" : "Your next step"}</p>
      <h2 id="next-title" className="mt-1 font-display text-2xl leading-tight sm:text-3xl">
        {next.label}
      </h2>
      {detail && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/85">{detail}</p>}
      <div className="mt-5">
        {linkHref && !staff ? (
          <Link href={linkHref} className={primaryCls()}>
            {next.label}
          </Link>
        ) : (
          <button type="button" onClick={onClick} className={primaryCls()}>
            {staff ? "Show me" : next.label}
          </button>
        )}
      </div>
    </section>
  );
}

function StaffStrip({ data }: { data: HubData }) {
  if (data.viewer.kind !== "staff") return null;
  return (
    <p role="note" className="mb-6 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
      <span className="font-semibold">Staff view{data.viewer.name ? `: ${data.viewer.name}` : ""}.</span> This is exactly what the customer sees; their buttons are
      switched off for you. Use Ops view to make changes.
    </p>
  );
}

export function Hub({ data, slots, controls, refLabel }: { data: HubData; slots?: HubSlots; controls?: ReactNode; refLabel?: string }) {
  const p: Project = data.project;
  const current = currentStage(p);
  const [selected, setSelected] = useState<ProjectStageId>(() => defaultStage(p));
  const entries = useMemo(() => projectTimeline(p, data.today), [p, data.today]);

  /** Open a stage. From a button or link: bring it into view. From the timeline itself: only keep the tapped row in view on a phone. */
  const go = useCallback((stage: ProjectStageId, anchor?: string, fromTimeline = false) => {
    setSelected(stage);
    if (fromTimeline && !isPhone()) return;
    scrollToId(anchor ?? (isPhone() ? `step-${stage}` : PANEL_ID));
  }, []);

  // When the stage they were on completes (they just booked, accepted…), follow them to the next one.
  const lastCurrent = useRef(current);
  useEffect(() => {
    if (lastCurrent.current !== current) {
      setSelected((s) => (s === lastCurrent.current ? current : s));
      lastCurrent.current = current;
    }
  }, [current]);

  // Links from emails land on a stage: /p/<id>#booking.
  const projectRef = useRef(p);
  projectRef.current = p;
  useEffect(() => {
    const apply = () => {
      const stage = stageForHash(window.location.hash, projectRef.current);
      if (stage) go(stage);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [go]);

  const Panel = PANELS[selected];
  const panel = <Panel data={data} state={stageState(p, selected)} goTo={go} slots={slots} />;

  return (
    <div>
      <StaffStrip data={data} />
      <header className="mb-6 sm:mb-8">
        <p className="text-sm font-semibold text-accent-700">{p.customer.name ? `Hello, ${p.customer.name.replace(/\s*\(DEMO\)\s*/, "").split(" ")[0]}` : "Your project"}</p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900 sm:text-4xl">Your home at {p.customer.addressLine || "your address"}</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {[p.customer.postcode, refLabel].filter(Boolean).join(" · ")}
        </p>
      </header>
      <div className="space-y-6">
        <NextStep data={data} go={go} />
        {controls}
        <section aria-label="Your project, stage by stage" className="pt-2">
          <h2 className="sr-only">Your project, stage by stage</h2>
          <ProjectStepper
            entries={entries}
            selected={selected}
            onSelect={(stage) => go(stage, undefined, true)}
            panelId={PANEL_ID}
            panel={panel}
            aside={
              <>
                <UpdatesFeed data={data} />
                <PaymentsCard data={data} payButton={slots?.pay} />
                <DocumentsCard data={data} />
                <ContactCard data={data} />
              </>
            }
          />
        </section>
      </div>
    </div>
  );
}
