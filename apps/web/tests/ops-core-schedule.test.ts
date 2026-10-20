import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createProject, generateQuote, mergeSettings, type Project, type Survey } from "@aircon/domain";
import { addDays, dailyJobsFor, emptySummary, DAILY_JOB_IDS, type DailyJob } from "../lib/ops-core-schedule.ts";

/** Fictional DEMO home: no real data. */
const SURVEY: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "1 Demo Street",
  property: { type: "terraced", era: "pre-1930", bedrooms: 2, ownership: "owner" },
  rooms: [
    { id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

function project(mut: (p: Project) => void = () => {}): Project {
  const p = createProject({
    id: "22222222-de5e-4000-8000-000000000002",
    quoteId: "q",
    createdAt: "2026-10-01T09:00:00.000Z",
    customerName: "Demo Person (DEMO)",
    survey: SURVEY,
    quote: generateQuote(SURVEY),
  });
  mut(p);
  return p;
}

const TODAY = "2026-10-19";
const WITH_REVIEW = mergeSettings({ ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, reviewUrl: "https://reviews.example.com/demo" } });
const jobsOf = (p: Project, today = TODAY, settings = DEFAULT_SETTINGS) => dailyJobsFor(p, today, settings).map((j) => j.job);

/** Handed over `daysAgo` days before TODAY; the change-of-season check is marked sent so it stays out of the way. */
function handedOver(daysAgo: number, mut: (p: Project) => void = () => {}): Project {
  return project((p) => {
    p.handover = { ...p.handover, status: "handed-over", handedOverAt: `${addDays(TODAY, -daysAgo)}T15:00:00.000Z`, electricalCert: "received", warrantyRegistered: true };
    p.aftercare.seasonalCheckSentAt = "2026-10-01T16:00:00.000Z";
    mut(p);
  });
}

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31T23:00:00Z", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("nothing to do for a fresh project", () => {
  assert.deepEqual(jobsOf(project()), []);
});

test("survey reminder: only the day before, with the surveyor's name", () => {
  const p = project((x) => {
    x.survey = { ...x.survey, status: "booked", scheduledFor: "2026-10-20T10:00:00.000Z", surveyor: { staffId: "s1", name: "DEMO Sam" } };
  });
  const [job] = dailyJobsFor(p, TODAY, DEFAULT_SETTINGS);
  assert.equal(job?.job, "survey-reminder");
  assert.equal(job?.kind === "notify" && job.discriminator, "2026-10-20T10:00:00.000Z");
  assert.deepEqual(job?.kind === "notify" && job.data, {
    scheduledFor: "2026-10-20T10:00:00.000Z",
    durationMinutes: 90,
    mode: "in-person",
    surveyorName: "DEMO Sam",
  });
  assert.deepEqual(jobsOf(p, "2026-10-18"), [], "two days out: not yet");
  assert.deepEqual(jobsOf(p, "2026-10-20"), [], "on the day: too late for a day-before reminder");
});

test("install prep 3 days out (catching up a missed run), then the day-before text with the crew", () => {
  const p = project((x) => {
    x.booking = {
      ...x.booking,
      status: "booked",
      startDate: "2026-10-22",
      dates: ["2026-10-22", "2026-10-23", "2026-10-26"],
      crew: [
        { staffId: "a", name: "DEMO Ivo", role: "installer", external: false },
        { staffId: "b", name: "DEMO Tess", role: "tech-lead", external: false },
      ],
    };
    x.customer.parkingNotes = "Permit on the dashboard";
  });
  assert.deepEqual(jobsOf(p, "2026-10-19"), ["install-prep"]);
  assert.deepEqual(jobsOf(p, "2026-10-20"), ["install-prep"], "a missed run catches up, the key keeps it to one");
  const dayBefore = dailyJobsFor(p, "2026-10-21", DEFAULT_SETTINGS);
  assert.deepEqual(dayBefore.map((j) => j.job), ["install-day-before"]);
  assert.deepEqual(dayBefore[0]!.kind === "notify" && dayBefore[0]!.data, {
    startDate: "2026-10-22",
    crewNames: ["DEMO Ivo", "DEMO Tess"],
    parkingNotes: "Permit on the dashboard",
  });
  const prep = dailyJobsFor(p, "2026-10-19", DEFAULT_SETTINGS)[0] as Extract<DailyJob, { kind: "notify" }>;
  assert.ok(Array.isArray((prep.data as { prep?: string[] }).prep));
  assert.deepEqual(jobsOf(p, "2026-10-18"), [], "four days out: nothing yet");
  const started = project((x) => {
    Object.assign(x.booking, p.booking);
    x.install.status = "in-progress";
  });
  assert.deepEqual(jobsOf(started, "2026-10-21"), [], "an install under way gets no reminders");
});

test("proposal reminder once it's 3 days old and open; expiry once it's lapsed", () => {
  const issued = (issuedAt: string, validUntil: string, status: Project["proposal"]["status"] = "issued") =>
    project((x) => {
      x.proposal = { ...x.proposal, status, proposalId: "p-1", version: 2, issuedAt, validUntil };
    });
  assert.deepEqual(jobsOf(issued("2026-10-17T10:00:00Z", "2026-11-15")), [], "two days old");
  const due = dailyJobsFor(issued("2026-10-16T10:00:00Z", "2026-11-15"), TODAY, DEFAULT_SETTINGS);
  assert.deepEqual(due.map((j) => j.job), ["proposal-reminder"]);
  assert.equal(due[0]!.kind === "notify" && due[0]!.discriminator, "p-1", "one reminder per proposal version, ever");
  assert.deepEqual(due[0]!.kind === "notify" && due[0]!.data, { version: 2, validUntil: "2026-11-15" });
  assert.deepEqual(jobsOf(issued("2026-10-01T10:00:00Z", "2026-10-18")), ["proposal-expired"]);
  assert.deepEqual(jobsOf(issued("2026-10-01T10:00:00Z", "2026-10-19")), ["proposal-reminder"], "valid through today");
  assert.deepEqual(jobsOf(issued("2026-10-01T10:00:00Z", "2026-10-18", "changes-requested")), ["proposal-expired"]);
  assert.deepEqual(jobsOf(issued("2026-10-01T10:00:00Z", "2026-11-18", "changes-requested")), [], "no nudge while we're revising");
  assert.deepEqual(jobsOf(issued("2026-10-01T10:00:00Z", "2026-10-18", "accepted")), []);
});

test("7-day check-in and 30-day feedback: on time, late within the window, never twice", () => {
  assert.deepEqual(jobsOf(handedOver(6)), []);
  const checkIn = dailyJobsFor(handedOver(7), TODAY, DEFAULT_SETTINGS);
  assert.deepEqual(checkIn.map((j) => j.job), ["check-in-7d"]);
  assert.deepEqual(checkIn[0]!.kind === "notify" && checkIn[0]!.record, { type: "aftercare-checkin-sent" });
  assert.deepEqual(jobsOf(handedOver(21)), ["check-in-7d"]);
  assert.deepEqual(jobsOf(handedOver(22)), [], "too late to say 'a week in'");
  assert.deepEqual(jobsOf(handedOver(10, (p) => (p.aftercare.checkIn7dSentAt = "2026-10-16T16:00:00Z"))), []);
  // Everyone gets the feedback request: nothing about the score or the customer gates it.
  const fb = dailyJobsFor(handedOver(30, (p) => (p.aftercare.checkIn7dSentAt = "x")), TODAY, DEFAULT_SETTINGS);
  assert.deepEqual(fb.map((j) => j.job), ["feedback-30d"]);
  assert.deepEqual(fb[0]!.kind === "notify" && fb[0]!.record, { type: "feedback-requested" });
  assert.deepEqual(jobsOf(handedOver(61, (p) => (p.aftercare.checkIn7dSentAt = "x"))), []);
});

test("review request follows the domain rule and needs a review link", () => {
  const p = handedOver(40, (x) => {
    x.aftercare = { checkIn7dSentAt: "x", feedbackRequestedAt: "y", seasonalCheckSentAt: "s" };
  });
  assert.deepEqual(jobsOf(p, TODAY, DEFAULT_SETTINGS), [], "no review link in settings: never");
  const jobs = dailyJobsFor(p, TODAY, WITH_REVIEW);
  assert.deepEqual(jobs.map((j) => j.job), ["review-request"]);
  assert.deepEqual(jobs[0]!.kind === "notify" && jobs[0]!.record, { type: "review-requested" });
  const asked = handedOver(40, (x) => {
    x.aftercare = { checkIn7dSentAt: "x", feedbackRequestedAt: "y", reviewRequestedAt: "z", seasonalCheckSentAt: "s" };
  });
  assert.deepEqual(jobsOf(asked, TODAY, WITH_REVIEW), []);
});

test("seasonal check on the first change of season, once", () => {
  // Handed over in June: heating tips from 1 October.
  const june = project((x) => {
    x.handover = { ...x.handover, status: "handed-over", handedOverAt: "2026-06-10T15:00:00Z", electricalCert: "received", warrantyRegistered: true };
    x.aftercare = { checkIn7dSentAt: "x", feedbackRequestedAt: "y", reviewRequestedAt: "z" };
  });
  const jobs = dailyJobsFor(june, "2026-10-01", DEFAULT_SETTINGS);
  assert.deepEqual(jobs.map((j) => j.job), ["seasonal-check"]);
  assert.deepEqual(jobs[0]!.kind === "notify" && jobs[0]!.data, { mode: "heating" });
  assert.deepEqual(jobsOf(june, "2026-09-30"), []);
  june.aftercare.seasonalCheckSentAt = "2026-10-01T16:00:00Z";
  assert.deepEqual(jobsOf(june, "2026-10-02"), []);
});

test("service reminder in the 30 days before it's due", () => {
  const p = project((x) => {
    x.aftercare.serviceDueOn = "2026-11-10";
  });
  assert.deepEqual(jobsOf(p, "2026-10-11"), ["service-reminder"], "30 days before");
  assert.deepEqual(jobsOf(p, "2026-10-10"), []);
  assert.deepEqual(jobsOf(p, "2026-11-10"), ["service-reminder"]);
  assert.deepEqual(jobsOf(p, "2026-11-11"), [], "overdue: a person follows up, not the cron");
  const [job] = dailyJobsFor(p, "2026-10-20", DEFAULT_SETTINGS);
  assert.equal(job?.kind === "notify" && job.discriminator, "2026-11-10");
});

test("cancelled projects get nothing; closed ones keep aftercare but no delivery messages", () => {
  const cancelled = handedOver(7, (p) => {
    p.closure = { closed: true, closedAt: "x", reason: "cancelled" };
    p.aftercare.serviceDueOn = addDays(TODAY, 5);
  });
  assert.deepEqual(jobsOf(cancelled), []);
  const closed = handedOver(7, (p) => {
    p.closure = { closed: true, closedAt: "x" };
    p.survey = { ...p.survey, status: "booked", scheduledFor: "2026-10-20T10:00:00Z" };
  });
  assert.deepEqual(jobsOf(closed), ["check-in-7d"]);
});

test("the summary starts at zero for every job", () => {
  const s = emptySummary("2026-10-19T16:00:00Z", TODAY);
  assert.deepEqual(Object.keys(s.jobs).sort(), [...DAILY_JOB_IDS].sort());
  assert.ok(Object.values(s.jobs).every((j) => j.planned === 0 && j.done === 0));
});

test("an electrical certificate past its 30 days alerts the team, weekly, until it's in", () => {
  const done = (completed: string, cert: "pending" | "received" = "pending") =>
    project((p) => {
      p.install = { ...p.install, status: "complete", completedAt: `${completed}T15:00:00.000Z` };
      p.handover = { ...p.handover, electricalCert: cert };
    });
  const completed = addDays(TODAY, -31); // due 30 days on: yesterday
  const jobs = dailyJobsFor(done(completed), TODAY, DEFAULT_SETTINGS);
  const alert = jobs.find((j) => j.job === "paperwork-overdue");
  assert.ok(alert && alert.kind === "notify" && alert.event === "team-alert");
  assert.match((alert.data as { title: string }).title, /Overdue: the electrical certificate/);
  assert.equal((alert.data as { urgent?: boolean }).urgent, true);
  // Not before it's due, not every day, and never once it's in.
  assert.ok(!jobsOf(done(addDays(TODAY, -30))).includes("paperwork-overdue"), "due today: not yet late");
  assert.ok(!jobsOf(done(addDays(TODAY, -33))).includes("paperwork-overdue"), "3 days late: between weekly alerts");
  assert.ok(jobsOf(done(addDays(TODAY, -38))).includes("paperwork-overdue"), "8 days late: the weekly alert");
  assert.ok(!jobsOf(done(completed, "received")).includes("paperwork-overdue"));
  assert.ok(DAILY_JOB_IDS.includes("paperwork-overdue"));
});

test("a proposal past the date we gave alerts the team the next day, then every few days, until it's issued", () => {
  // Survey Mon 12 Oct: we said Thu 15 Oct.
  const submitted = (mut: (p: Project) => void = () => {}) =>
    project((p) => {
      p.survey = { ...p.survey, status: "submitted", submittedAt: "2026-10-12T15:00:00.000Z" };
      mut(p);
    });
  assert.ok(!jobsOf(submitted(), "2026-10-15").includes("proposal-late"), "the promised day itself: not late");
  const first = dailyJobsFor(submitted(), "2026-10-16", DEFAULT_SETTINGS).find((j) => j.job === "proposal-late");
  assert.ok(first && first.kind === "notify" && first.event === "team-alert");
  assert.match((first.data as { title: string }).title, /Late: the proposal for Demo Person/);
  assert.match((first.data as { lines: string[] }).lines[0]!, /by 2026-10-15.*1 day late/);
  assert.equal(first.discriminator, "proposal-late:2026-10-15:1");
  assert.ok(!jobsOf(submitted(), "2026-10-17").includes("proposal-late"), "not every day");
  assert.ok(jobsOf(submitted(), "2026-10-19").includes("proposal-late"), "4 days late: the next alert");
  assert.ok(!jobsOf(submitted((p) => (p.proposal = { ...p.proposal, status: "issued" })), "2026-10-19").includes("proposal-late"));
  assert.ok(!jobsOf(submitted((p) => (p.proposal = { ...p.proposal, status: "changes-requested" })), "2026-10-19").includes("proposal-late"), "a revision has no promised date");
  assert.ok(DAILY_JOB_IDS.includes("proposal-late"));
});

test("a late proposal held by the customer's email agreement tells the team what it's waiting for, not to send it", () => {
  const submitted = (consent: boolean) =>
    project((p) => {
      p.survey = { ...p.survey, status: "submitted", submittedAt: "2026-10-12T15:00:00.000Z" };
      p.customer = { ...p.customer, email: "demo.person@example.com" };
      if (consent) p.proposal.documentsByEmailConsent = { at: "2026-10-12T15:00:00.000Z", channel: "portal", email: "demo.person@example.com" };
      else delete p.proposal.documentsByEmailConsent;
    });
  const linesOf = (p: Project) => {
    const alert = dailyJobsFor(p, "2026-10-16", DEFAULT_SETTINGS).find((j) => j.job === "proposal-late");
    assert.ok(alert && alert.kind === "notify");
    return (alert.data as { lines: string[] }).lines.join(" ");
  };
  // Ours to send: send it, or a new date.
  assert.match(linesOf(submitted(true)), /Send it, or email them a new date/);
  // Theirs to agree: no "send it" the gate would refuse, no paper promise, and what to do instead.
  const held = linesOf(submitted(false));
  assert.doesNotMatch(held, /Send it, or email them a new date|apology/);
  assert.match(held, /haven't agreed to get their documents by email[\s\S]*can't send them on paper[\s\S]*Get in touch/);
});

test("a survey with nobody down to do it alerts the team once, on the working day before (or the day, if that run was missed)", () => {
  // Booked by the family for Monday 26 Oct at 10:00: the working day before is Friday 23.
  const p = project((x) => {
    x.survey = { ...x.survey, status: "booked", scheduledFor: "2026-10-26T10:00:00.000Z" };
  });
  const alert = (today: string) => dailyJobsFor(p, today, DEFAULT_SETTINGS).find((j) => j.job === "survey-unassigned");
  assert.equal(alert("2026-10-22"), undefined, "two working days out: not yet");
  const fri = alert("2026-10-23");
  assert.ok(fri && fri.kind === "notify" && fri.event === "team-alert");
  assert.equal(fri.kind === "notify" && fri.discriminator, "survey-unassigned:2026-10-26T10:00:00.000Z", "one alert per slot, whichever day sends it");
  assert.match(fri.kind === "notify" ? (fri.data as { title: string }).title : "", /No surveyor for Demo Person \(DEMO\)'s survey on 2026-10-26 at 10:00/);
  assert.ok(alert("2026-10-24"), "the weekend run catches up (same key: sent once)");
  assert.match(alert("2026-10-26")!.kind === "notify" ? (alert("2026-10-26")!.data as { title: string }).title : "", /survey today at 10:00/);
  assert.equal(alert("2026-10-27"), undefined, "after the slot: nothing");
  // Someone assigned: no alert, and the day-before reminder names them.
  const assigned = project((x) => {
    x.survey = { ...x.survey, status: "booked", scheduledFor: "2026-10-26T10:00:00.000Z", surveyor: { staffId: "s1", name: "DEMO Sam" } };
  });
  assert.equal(dailyJobsFor(assigned, "2026-10-23", DEFAULT_SETTINGS).find((j) => j.job === "survey-unassigned"), undefined);
  assert.ok(DAILY_JOB_IDS.includes("survey-unassigned"));
});

