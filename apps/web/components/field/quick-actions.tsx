"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ISSUE_KIND_LABEL,
  LEARNING_PROMPTS,
  SEVERITY_LABEL,
  defaultsForKind,
  isStepFinished,
  stepView,
  stepsForDay,
  type Blocker,
  type IssueKind,
  type Severity,
} from "@aircon/domain";
import { BlockerList } from "@/components/kit/blocker-list";
import { getFieldOutbox, newOpId, type SyncOp } from "@/lib/field-outbox";
import { prepareImage } from "@/lib/media-client";
import { locate, nowIso, parseReading } from "./capture";
import { editDraft, followDefaults, isDirty, openDraft, reopenDraft, type EndDayDraft } from "./end-day-draft";
import { londonDateOf, londonTime, telHref, fmtDay } from "./format";
import { Sheet } from "./sheet";
import { useOnline } from "./use-online";
import type { FieldJob } from "./types";
import { useOutboxState, type MergedJob } from "./use-outbox";

/**
 * Quick actions, always one tap away on a job: On my way, Arrived, Pause /
 * Resume, Raise issue, Request variation, End day. Clock events and issues
 * queue on the phone like any capture; starting and ending a day need the
 * server's answer there and then (the readiness checks run there), so they
 * refuse to run offline and say why.
 */

type Panel = null | "menu" | "omw" | "arrive" | "issue" | "variation" | "end";

const BTN = "min-h-12 rounded-full px-5 font-semibold disabled:opacity-40";
const PRIMARY = `${BTN} bg-accent-600 text-white shadow-sm hover:bg-accent-700`;
const SECONDARY = `${BTN} border border-line bg-white text-ink-900 hover:bg-surface`;
const INPUT = "w-full rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100";

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; blockers?: Blocker[]; offline?: boolean }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; blockers?: Blocker[] };
    if (!res.ok) return { ok: false, error: data.error ?? `That didn't work (${res.status}).`, ...(data.blockers ? { blockers: data.blockers } : {}) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "No connection. Try again when you have signal.", offline: true };
  }
}

/** Is this person's clock running on this job: the server's view plus clock events still on the phone. */
function useClock(data: FieldJob): { running: boolean; entryId?: string; since?: string } {
  const state = useOutboxState();
  return useMemo(() => {
    const ops = [...state.acked, ...state.items.map((i) => i.op).filter((o): o is SyncOp => Boolean(o))].filter((o) => o.projectId === data.header.projectId);
    const starts = ops.filter((o): o is Extract<SyncOp, { type: "time-start" }> => o.type === "time-start").sort((a, b) => a.at.localeCompare(b.at));
    const stopped = new Set(ops.filter((o): o is Extract<SyncOp, { type: "time-stop" }> => o.type === "time-stop").map((o) => o.entryId));
    const lastStart = starts[starts.length - 1];
    if (lastStart && !stopped.has(lastStart.id)) return { running: true, entryId: lastStart.id, since: lastStart.at };
    if (data.clock && !stopped.has(data.clock.entryId) && !(lastStart && lastStart.at > data.clock.startedAt)) {
      return { running: true, entryId: data.clock.entryId, since: data.clock.startedAt };
    }
    return { running: false };
  }, [state.acked, state.items, data.clock, data.header.projectId]);
}

/**
 * True while someone's typing in the page (not in a sheet): the floating
 * button steps aside for the keyboard. It comes back a moment after the
 * field loses focus, so the tap that left the field (often on its Save
 * button, right where the floating button sits) lands on what was under
 * the finger, not on the button reappearing.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const off = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTyping(false), 400);
    };
    const on = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.closest("[role=dialog]")) {
        window.clearTimeout(timer);
        setTyping(true);
      } else off();
    };
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return typing;
}

export function QuickActions({ data, merged, day }: { data: FieldJob; merged: MergedJob | null; day: number }) {
  const [panel, setPanel] = useState<Panel>(null);
  const typing = useTyping();
  const close = () => setPanel(null);
  const { header } = data;
  const clock = useClock(data);
  const openDay = header.currentDay ? header.days.find((d) => d.n === header.currentDay) : undefined;
  const staleDay = openDay && openDay.date !== header.today;
  const done = header.installStatus === "complete";

  return (
    <>
      <button
        type="button"
        onClick={() => setPanel("menu")}
        className={`fixed bottom-24 right-4 z-30 flex min-h-14 items-center gap-2 rounded-full bg-ink-900 px-6 text-lg font-semibold text-white shadow-lg shadow-ink-900/25 sm:right-[max(1rem,calc(50%-17rem))] ${typing ? "hidden" : ""}`}
        aria-haspopup="dialog"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Actions
      </button>

      <Sheet open={panel === "menu"} onClose={close} title="Actions" description={statusText(data, clock.running)}>
        <ul className="grid gap-2">
          {!done && !header.currentDay && header.nextDay && (
            <>
              <Action label="On my way" hint="Text the customer your ETA" onClick={() => setPanel("omw")} />
              <Action label={`Arrived: start day ${header.nextDay}`} hint="Starts your clock and the day" onClick={() => setPanel("arrive")} primary />
            </>
          )}
          {header.currentDay && !staleDay && (
            clock.running ? (
              <Action label="Pause" hint="Stops your clock (lunch, a supplier run)" onClick={() => void pauseResume(data, clock, close)} />
            ) : (
              !done && <Action label="Resume" hint="Starts your clock again" onClick={() => void pauseResume(data, clock, close)} primary />
            )
          )}
          {/* A clock with no open day to end (someone else ended it): it must still be stoppable, or it runs until the next job. */}
          {!header.currentDay && clock.running && (
            <Action label="Stop my clock" hint={`Running since ${clock.since ? londonTime(clock.since) : "earlier"}: stop it when you leave`} onClick={() => void pauseResume(data, clock, close)} primary />
          )}
          <Action label="Raise an issue" hint="Missing kit, damage, safety, a question for the office" onClick={() => setPanel("issue")} />
          <Action label="Request a variation" hint="A change to the job that needs the customer's OK and a price" onClick={() => setPanel("variation")} />
          {header.currentDay && <Action label={`End day ${header.currentDay}`} hint={staleDay ? `Still open from ${fmtDay(openDay!.date)}: close it first` : "Summary, customer update, photos"} onClick={() => setPanel("end")} primary={Boolean(staleDay) || done} />}
          {header.customerPhone && (
            <li>
              <a href={telHref(header.customerPhone)} className="flex min-h-14 items-center justify-between rounded-2xl border border-line bg-white px-4 py-3">
                <span>
                  <span className="block text-lg font-semibold text-ink-900">Call {header.customerName.replace(/\s*\(DEMO\)$/, "")}</span>
                  <span className="block text-sm text-ink-500">{header.customerPhone}</span>
                </span>
                <span aria-hidden className="text-ink-500">→</span>
              </a>
            </li>
          )}
        </ul>
      </Sheet>

      <OnMyWaySheet open={panel === "omw"} onClose={close} data={data} />
      <ArriveSheet open={panel === "arrive"} onClose={close} data={data} running={clock.running} />
      <IssueSheet open={panel === "issue"} onClose={close} data={data} variation={false} />
      <IssueSheet open={panel === "variation"} onClose={close} data={data} variation />
      <EndDaySheet open={panel === "end"} onClose={close} data={data} merged={merged} n={header.currentDay ?? day} clockEntryId={clock.running ? clock.entryId : undefined} />
    </>
  );
}

function statusText(data: FieldJob, running: boolean): string {
  const h = data.header;
  if (h.installStatus === "complete") {
    if (h.currentDay) return `The install is complete. End day ${h.currentDay} when you leave: it sends the customer's update${running ? " and stops your clock" : ""}.`;
    return running ? "The install is complete, and your clock is still running." : "The install is complete.";
  }
  if (h.currentDay) {
    const d = h.days.find((x) => x.n === h.currentDay);
    return `Day ${h.currentDay} of ${h.totalDays} under way${d?.startedAt ? ` since ${londonTime(d.startedAt)}` : ""}. Your clock is ${running ? "running" : "paused"}.`;
  }
  return h.nextDay ? `Day ${h.nextDay} hasn't started yet.` : "Nothing to start.";
}

function Action({ label, hint, onClick, primary = false }: { label: string; hint: string; onClick: () => void; primary?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 py-3 text-left ${primary ? "bg-accent-600 text-white" : "border border-line bg-white text-ink-900"}`}
      >
        <span>
          <span className="block text-lg font-semibold">{label}</span>
          <span className={`block text-sm ${primary ? "text-white/90" : "text-ink-500"}`}>{hint}</span>
        </span>
        <span aria-hidden>→</span>
      </button>
    </li>
  );
}

async function pauseResume(data: FieldJob, clock: { running: boolean; entryId?: string }, done: () => void) {
  const outbox = getFieldOutbox();
  const projectId = data.header.projectId;
  if (clock.running && clock.entryId) {
    await outbox.enqueue({ type: "time-stop", id: newOpId(), projectId, entryId: clock.entryId, at: nowIso() }, "Paused: clock stopped");
  } else {
    await outbox.enqueue(
      { type: "time-start", id: newOpId(), projectId, kind: "install", ...(data.header.currentDay ? { dayN: data.header.currentDay } : {}), at: nowIso(), note: "Resumed" },
      "Resumed: clock started",
    );
  }
  done();
}

/* ---------------- on my way ---------------- */

const ETAS = [20, 30, 45, 60];

function OnMyWaySheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: FieldJob }) {
  const online = useOnline();
  const [eta, setEta] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [preview, setPreview] = useState<{ sms: string | null; to: string | null; mode: "live" | "demo" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = data.header.projectId;

  useEffect(() => {
    if (!open) {
      setEta(null);
      setCustom("");
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!eta || !open) return;
    let live = true;
    setPreview(null);
    fetch(`/api/field/jobs/${id}/on-my-way?eta=${eta}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "No preview.");
        if (live) setPreview(body);
      })
      .catch((err: unknown) => live && setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No connection: the preview needs signal."));
    return () => {
      live = false;
    };
  }, [eta, id, open]);

  async function send() {
    if (!eta) return;
    setBusy(true);
    setError(null);
    const r = await post<{ status: string; hasPhone: boolean; error?: string }>(`/api/field/jobs/${id}/on-my-way`, { etaMinutes: eta });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const s = r.data.status;
    setResult(
      s === "sent"
        ? { tone: "ok", text: "Text sent." }
        : s === "demo"
          ? { tone: "warn", text: "Recorded in demo mode: no text was actually sent." }
          : s === "queued"
            ? { tone: "warn", text: "Queued: it'll send in a moment." }
            : !r.data.hasPhone
              ? { tone: "bad", text: "There's no mobile number on this job, so nothing was sent. Call them instead." }
              : { tone: "bad", text: `It didn't send${r.data.error ? `: ${r.data.error}` : ""}. Call them instead.` },
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="On my way"
      description="Pick how long you'll be. The customer gets a text with your arrival time."
      footer={
        result ? (
          <button type="button" onClick={onClose} className={`${PRIMARY} w-full`}>
            Done
          </button>
        ) : (
          <button type="button" disabled={!eta || !preview || busy || !online} onClick={send} className={`${PRIMARY} w-full`}>
            {!online ? "Offline: can't text now" : busy ? "Sending…" : eta ? `Send: about ${eta} min` : "Pick an ETA"}
          </button>
        )
      }
    >
      {!result && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-900">Arriving in about</legend>
            <div className="grid grid-cols-4 gap-2">
              {ETAS.map((m) => (
                <button key={m} type="button" aria-pressed={eta === m} onClick={() => setEta(m)} className={`min-h-14 rounded-2xl border text-lg font-semibold ${eta === m ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-900"}`}>
                  {m}
                  <span className="block text-xs font-normal">min</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex gap-2">
            <label htmlFor="omw-custom" className="sr-only">
              Other ETA in minutes
            </label>
            <input id="omw-custom" inputMode="numeric" placeholder="Other (minutes)" value={custom} onChange={(e) => setCustom(e.target.value)} className={`${INPUT} min-h-12 rounded-full`} />
            <button
              type="button"
              className={SECONDARY}
              onClick={() => {
                const v = parseReading(custom);
                if (v && v >= 1 && v <= 240) setEta(Math.round(v));
                else setError("Between 1 and 240 minutes.");
              }}
            >
              Use
            </button>
          </div>
          <div className="mt-4" aria-live="polite">
            {eta && !preview && !error && <p className="text-sm text-ink-500">Loading the message…</p>}
            {preview && (
              <div>
                <p className="text-sm font-semibold text-ink-900">The text {preview.to ? `to their mobile ${preview.to}` : "(no mobile number on the job)"}:</p>
                <p className="mt-2 rounded-2xl rounded-tl-sm bg-sage-50 px-4 py-3 text-base text-ink-900">{preview.sms ?? "No text template for this message."}</p>
                {preview.mode === "demo" && <p className="mt-2 text-sm font-medium text-amber-900">Demo mode: texts are recorded, not sent.</p>}
              </div>
            )}
          </div>
          {!online && data.header.customerPhone && (
            <a href={telHref(data.header.customerPhone)} className={`${SECONDARY} mt-4 flex w-full items-center justify-center`}>
              Call them instead
            </a>
          )}
        </>
      )}
      {result && (
        <p role="status" className={`rounded-2xl px-4 py-3 text-base font-semibold ${result.tone === "ok" ? "bg-emerald-50 text-emerald-800" : result.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}>
          {result.text}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/* ---------------- arrived ---------------- */

function ArriveSheet({ open, onClose, data, running }: { open: boolean; onClose: () => void; data: FieldJob; running: boolean }) {
  const router = useRouter();
  const online = useOnline();
  const [phase, setPhase] = useState<"ready" | "working" | "started" | "refused" | "offline">("ready");
  // The day being started, held once the tap happens: the refresh after a
  // successful start moves header.nextDay on, and the sheet must keep saying
  // which day it started (not fall back to "day 1").
  const [startedN, setStartedN] = useState<number | null>(null);
  const n = phase !== "ready" && startedN !== null ? startedN : (data.header.nextDay ?? 1);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const planned = data.header.dates[n - 1];

  useEffect(() => {
    if (!open) {
      setPhase("ready");
      setStartedN(null);
      setBlockers([]);
      setError(null);
      setGpsNote(null);
    }
  }, [open]);

  async function arrive() {
    setStartedN(n);
    setPhase("working");
    const fix = await locate();
    setGpsNote(fix ? (fix.accuracyM && fix.accuracyM >= 1 ? `Location recorded (within about ${fix.accuracyM} m).` : "Location recorded.") : "No location: that's fine, it's optional.");
    if (!running) {
      await getFieldOutbox().enqueue(
        { type: "time-start", id: newOpId(), projectId: data.header.projectId, kind: "install", dayN: n, at: nowIso(), note: "Arrived" },
        `Arrived: clock started (day ${n})`,
      );
    }
    if (!navigator.onLine) {
      setPhase("offline");
      return;
    }
    const r = await post(`/api/field/jobs/${data.header.projectId}/day`, { action: "start", n, ...(fix ? { gps: { lat: fix.lat, lng: fix.lng } } : {}) });
    if (r.ok) {
      setPhase("started");
      router.refresh();
    } else if (r.offline) {
      setPhase("offline");
    } else {
      setError(r.error);
      setBlockers(r.blockers ?? []);
      setPhase("refused");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Arrived: day ${n}`}
      description={planned && planned !== data.header.today ? `Day ${n} is planned for ${fmtDay(planned)}. Starting it today records today as day ${n}.` : "Starts your clock and day " + n + "."}
      footer={
        phase === "ready" || phase === "working" ? (
          <button type="button" disabled={phase === "working" || !online} onClick={arrive} className={`${PRIMARY} w-full`}>
            {!online ? "Offline: starting the day needs signal" : phase === "working" ? "Starting…" : `Start day ${n}`}
          </button>
        ) : (
          <button type="button" onClick={onClose} className={`${PRIMARY} w-full`}>
            {phase === "started" ? "Go to the runsheet" : "Close"}
          </button>
        )
      }
    >
      <div aria-live="polite" className="space-y-3">
        {phase === "working" && <p className="text-base font-semibold text-ink-900">{gpsNote ? `Starting day ${n}…` : "Getting your location (up to 5 seconds)…"}</p>}
        {phase === "ready" && (
          <ul className="space-y-2 text-base text-ink-700">
            <li>· We ask for your location once, for the arrival record (optional).</li>
            <li>· Your clock starts now{running ? " (it's already running)" : ""}.</li>
            <li>· {n === 1 ? "Day 1 only starts if the job is ready: kit in, paperwork approved, the cancellation period dealt with." : `Day ${n} follows day ${n - 1}.`}</li>
          </ul>
        )}
        {gpsNote && <p className="text-sm text-ink-500">{gpsNote}</p>}
        {phase === "started" && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">Day {n} started. The runsheet is open for capture.</p>}
        {phase === "offline" && (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900">
            <strong>You&apos;re offline.</strong> Your arrival time is saved on the phone. Starting day {n} needs signal, because the readiness checks run on the server. Step outside or try again in a minute.
          </p>
        )}
        {phase === "refused" && (
          <>
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-base font-semibold text-red-900">
              Day {n} can&apos;t start yet. Don&apos;t start work: call the office.
            </p>
            {blockers.length > 0 ? <BlockerList blockers={blockers} /> : error && <p className="text-sm text-ink-700">{error}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- issues and variations ---------------- */

const FIELD_KINDS: IssueKind[] = ["defect", "shortage", "damage", "safety", "clarification", "customer-instruction", "blocker"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

function IssueSheet({ open, onClose, data, variation }: { open: boolean; onClose: () => void; data: FieldJob; variation: boolean }) {
  const [kind, setKind] = useState<IssueKind>(variation ? "variation" : "defect");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<Severity>(defaultsForKind(variation ? "variation" : "defect").severity);
  const [blocking, setBlocking] = useState(defaultsForKind(variation ? "variation" : "defect").blocking);
  const [pounds, setPounds] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useOutboxState();

  // Closing it without saving (a stray tap on the backdrop, Escape) keeps
  // what was written for next time; only a saved issue starts afresh.
  useEffect(() => {
    if (!open && saved) {
      setKind(variation ? "variation" : "defect");
      setTitle("");
      setDetail("");
      setPounds("");
      setPhoto(null);
      setSaved(false);
      const d = defaultsForKind(variation ? "variation" : "defect");
      setSeverity(d.severity);
      setBlocking(d.blocking);
    }
    if (!open) setError(null);
  }, [open, variation, saved]);
  const dirty = !saved && Boolean(title.trim() || detail.trim() || pounds.trim() || photo);

  function pick(k: IssueKind) {
    setKind(k);
    const d = defaultsForKind(k);
    setSeverity(d.severity);
    setBlocking(d.blocking);
  }

  async function save() {
    setError(null);
    if (title.trim().length < 3) return setError("Give it a short title.");
    let pence = 0;
    if (variation) {
      const v = parseReading(pounds);
      if (v === null) return setError("Enter your estimate in pounds (before any VAT).");
      pence = Math.round(v * 100);
      if (detail.trim().length < 3) return setError("Describe the change for the customer.");
    }
    setBusy(true);
    try {
      const outbox = getFieldOutbox();
      const mediaIds: string[] = [];
      if (photo) {
        const prepared = await prepareImage(photo, { fileName: photo.name || "issue.jpg" });
        mediaIds.push(
          await outbox.enqueueMedia(
            { projectId: data.header.projectId, blob: prepared.blob, fileName: prepared.fileName, tag: variation ? "progress" : "obstruction", source: "install", caption: title.trim().slice(0, 280) },
            `Photo: ${title.trim()}`,
          ),
        );
      }
      await outbox.enqueue(
        {
          type: "issue",
          id: newOpId(),
          projectId: data.header.projectId,
          kind,
          title: title.trim(),
          ...(detail.trim() ? { detail: detail.trim() } : {}),
          severity,
          blocking,
          mediaIds,
          ...(variation ? { variation: { description: detail.trim(), priceDeltaNetPence: pence } } : {}),
          at: nowIso(),
        },
        `${variation ? "Variation" : ISSUE_KIND_LABEL[kind]}: ${title.trim()}`,
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save on the phone.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      keepOnBackdrop={dirty}
      title={variation ? "Request a variation" : "Raise an issue"}
      description={
        variation
          ? "A change to what was agreed. The office checks your price, then the customer approves or declines it in their portal."
          : "The office hears about it as soon as it syncs. Blocking issues hold the job until they're sorted."
      }
      footer={
        saved ? (
          <button type="button" onClick={onClose} className={`${PRIMARY} w-full`}>
            Done
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={save} className={`${PRIMARY} w-full`}>
            {busy ? "Saving…" : variation ? "Send to the office" : "Raise it"}
          </button>
        )
      }
    >
      {saved ? (
        <div role="status" className="space-y-3">
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">
            Saved on the phone.{" "}
            {state.online ? "Sending now: check the badge at the top." : "It goes to the office when you're back in signal."}
          </p>
          {variation && (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
              Don&apos;t do this work until the customer approves it. The office checks the price and sends it to them; its status shows under Issues.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {!variation && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">What kind?</legend>
              <div className="grid grid-cols-2 gap-2">
                {FIELD_KINDS.map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => pick(k)} className={`min-h-12 rounded-2xl border px-3 text-left text-base font-semibold ${kind === k ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-900"}`}>
                    {ISSUE_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              {kind === "safety" && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">Safety: stop work in that area now. Suspected asbestos is never drilled.</p>}
            </fieldset>
          )}
          <div>
            <label htmlFor="issue-title" className="mb-1.5 block text-sm font-semibold text-ink-900">
              {variation ? "The change, in a few words" : "Title"}
            </label>
            <input id="issue-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} className={`${INPUT} min-h-12 rounded-full`} placeholder={variation ? "e.g. Condensate pump in the office" : "e.g. One trunking length short"} />
          </div>
          <div>
            <label htmlFor="issue-detail" className="mb-1.5 block text-sm font-semibold text-ink-900">
              {variation ? "Why it's needed (the customer reads this)" : "Details (optional)"}
            </label>
            <textarea id="issue-detail" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} className={INPUT} />
          </div>
          {variation && (
            <div>
              <label htmlFor="issue-price" className="mb-1.5 block text-sm font-semibold text-ink-900">
                Estimated price change, £ before VAT
              </label>
              <input id="issue-price" inputMode="decimal" value={pounds} onChange={(e) => setPounds(e.target.value)} className={`${INPUT} min-h-12 rounded-full`} placeholder="e.g. 180" aria-describedby="issue-price-hint" />
              <p id="issue-price-hint" className="mt-1.5 text-xs text-ink-500">
                VAT is added if we charge it. Use a minus for a saving. The customer doesn&apos;t see it until the office has checked it.
              </p>
            </div>
          )}
          {!variation && (
            <>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink-900">How serious?</legend>
                <div className="grid grid-cols-4 gap-1 rounded-full bg-surface p-1">
                  {SEVERITIES.map((s) => (
                    <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)} className={`min-h-11 rounded-full text-sm font-semibold ${severity === s ? "bg-white text-ink-900 shadow-sm" : "text-ink-700"}`}>
                      {SEVERITY_LABEL[s]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3">
                <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} className="mt-1 h-5 w-5 accent-accent-600" />
                <span>
                  <span className="block font-semibold text-ink-900">This stops the job</span>
                  <span className="block text-sm text-ink-500">Holds install complete until the office resolves it.</span>
                </span>
              </label>
            </>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add a photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className={`${SECONDARY} w-full`}>
              {photo ? "Photo added: change it" : "Add a photo (optional)"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------- end of day ---------------- */

interface DayPhoto {
  id: string;
  url: string | null;
  caption?: string;
  customerVisible: boolean;
}

/** "RAMS acknowledged" stays as it is; "Core drilling" becomes "core drilling". */
function lowerFirst(t: string): string {
  const first = t.split(/\s+/)[0] ?? "";
  return first.length > 1 && first === first.toUpperCase() ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

function uniqueTitles(titles: string[], max = 5): string[] {
  const out: string[] = [];
  for (const t of titles) if (!out.includes(t)) out.push(t);
  return out.slice(0, max);
}

function EndDaySheet({ open, onClose, data, merged, n: liveN, clockEntryId }: { open: boolean; onClose: () => void; data: FieldJob; merged: MergedJob | null; n: number; clockEntryId?: string }) {
  const router = useRouter();
  // The day this sheet is ending, fixed when it opens: the page refreshes underneath once it's closed.
  const [n, setN] = useState(liveN);
  useEffect(() => {
    if (open) setN(liveN);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const online = useOnline();
  const [stage, setStage] = useState<"summary" | "photos" | "sent" | "learn" | "finished">("summary");
  // What the installer types is theirs: see end-day-draft.ts.
  const [draft, setDraft] = useState<EndDayDraft>(() => openDraft({ summary: "", message: "" }));
  const { summary, message } = draft;
  const [photos, setPhotos] = useState<DayPhoto[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ subject: string; text: string; mode: "live" | "demo"; to: string | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // A beat after the preview appears before "send" takes a tap: a double tap on "Preview" never sends.
  const [sendReady, setSendReady] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const id = data.header.projectId;

  // Defaults written from the runsheet: what got done today, and what's next.
  const defaults = useMemo(() => {
    if (!merged) return { summary: "", message: "" };
    const today = data.header.today;
    const doneToday = merged.job.runsheet.filter((s) => {
      const v = stepView(merged.job, s);
      if (!isStepFinished(v)) return false;
      const last = v.slots.map((x) => x.record?.at).filter(Boolean).sort().pop();
      return last ? londonDateOf(last) === today : false;
    });
    const doneTitles = uniqueTitles(doneToday.map((s) => lowerFirst(s.title)));
    const nextTitles = uniqueTitles(stepsForDay(merged.job.runsheet, n + 1).map((s) => lowerFirst(s.title)), 3);
    const last = n >= data.header.totalDays;
    // Ending the last day after commissioning was signed: the job is finished, not paused for the night.
    const complete = data.header.installStatus === "complete";
    const next = complete
      ? " Your system is commissioned, and your handover pack is on your project page."
      : last
        ? " Next: commissioning and your handover."
        : nextTitles.length
          ? ` Tomorrow: ${nextTitles.join(", ")}.`
          : "";
    return {
      summary: doneTitles.length ? `Done today: ${doneTitles.join(", ")}.` : `Day ${n} on site.`,
      message: `${doneTitles.length ? `Today we did: ${doneTitles.join(", ")}.` : "Good progress today."}${next}${complete ? " Thank you for having us." : " Everything is tidied away for the night."}`,
    };
  }, [merged, data.header.today, data.header.totalDays, data.header.installStatus, n]);

  // Filled when the sheet opens. A sync or refresh while it's open (new
  // outbox items or acks, router.refresh) makes new defaults, and must never
  // wipe what the installer typed, or change what was previewed. Closing it
  // by accident (a stray tap on the backdrop) loses nothing: what they typed
  // and the photos they picked are still there when it opens again, until
  // the day is sent (or it's a different day).
  const draftDay = useRef<number | null>(null);
  const finished = stage === "sent" || stage === "learn" || stage === "finished";
  useEffect(() => {
    if (open) {
      if (draftDay.current !== liveN) {
        draftDay.current = liveN;
        setDraft(openDraft(defaults));
        setStage("summary");
        setChosen([]);
      } else {
        setDraft((d) => reopenDraft(d, defaults));
      }
    } else {
      if (finished) {
        // Sent: the next time it opens is a fresh day.
        draftDay.current = null;
        setStage("summary");
        setChosen([]);
        setAnswers({});
      }
      setPhotos(null);
      setPreview(null);
      setError(null);
      setBlockers([]);
      setEmailStatus(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) setDraft((d) => followDefaults(d, defaults, stage === "summary"));
  }, [open, defaults, stage]);

  useEffect(() => {
    if (stage !== "photos" || photos) return;
    fetch(`/api/field/jobs/${id}/photos?day=${n}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setPhotos(body.items);
      })
      .catch(() => {
        setPhotos([]);
        setError("Today's photos couldn't be loaded (no signal?). You can still send the update without photos.");
      });
  }, [stage, photos, id, n]);

  async function loadPreview() {
    if (previewing) return;
    setError(null);
    setPreviewing(true);
    const r = await post<{ subject: string; text: string; mode: "live" | "demo"; to: string | null }>(`/api/field/jobs/${id}/day`, { action: "preview", n, text: message, photoCount: chosen.length });
    setPreviewing(false);
    if (r.ok) setPreview(r.data);
    else setError(r.error);
  }

  // The preview is what they're about to send: bring it into view (it sits below the photos), and hold
  // the send button for a moment so the second tap of a double tap lands on nothing.
  useEffect(() => {
    if (!preview) {
      setSendReady(false);
      return;
    }
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    previewRef.current?.focus({ preventScroll: true });
    const t = window.setTimeout(() => setSendReady(true), 900);
    return () => window.clearTimeout(t);
  }, [preview]);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await post<{ email: { status: string } }>(`/api/field/jobs/${id}/day`, {
      action: "end",
      n,
      summary,
      customerText: message,
      mediaIds: chosen,
      learnings: [],
      ...(clockEntryId ? { clockEntryId } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setBlockers(r.blockers ?? []);
      return;
    }
    // The clock may still be on the phone (not yet synced): stop it there too.
    if (clockEntryId) await getFieldOutbox().enqueue({ type: "time-stop", id: newOpId(), projectId: id, entryId: clockEntryId, at: nowIso() }, "End of day: clock stopped");
    const s = r.data.email.status;
    setEmailStatus(
      s === "sent" ? "Update emailed to the customer." : s === "demo" ? "Update recorded in demo mode: no email was actually sent." : s === "queued" ? "Update queued to send." : message.trim() ? "The update is on their portal; the email didn't go (check Messages in ops)." : "Day closed.",
    );
    setStage("sent");
    router.refresh();
  }

  async function saveLearnings() {
    const list = LEARNING_PROMPTS.map((p) => ({ promptId: p.id, answer: answers[p.id] ?? "" })).filter((a) => a.answer.trim());
    if (!list.length) return setStage("finished");
    setBusy(true);
    const r = await post(`/api/field/jobs/${id}/day`, { action: "learnings", n, answers: list });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setStage("finished");
  }

  const footer =
    stage === "summary" ? (
      <button type="button" onClick={() => setStage("photos")} disabled={!summary.trim()} className={`${PRIMARY} w-full`}>
        Next: customer update
      </button>
    ) : stage === "photos" ? (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            // Editing again means previewing again: what's sent is always what was previewed.
            setPreview(null);
            setStage("summary");
          }}
          className={SECONDARY}
        >
          Back
        </button>
        {preview ? (
          <button key="send" type="button" disabled={busy || !online || !sendReady} onClick={send} className={`${BTN} flex-1 bg-emerald-700 text-white shadow-sm hover:bg-emerald-800`}>
            {!online ? "Offline: needs signal" : busy ? "Sending…" : `End day ${n} and send`}
          </button>
        ) : (
          <button key="preview" type="button" disabled={!online || !message.trim() || previewing} aria-busy={previewing || undefined} onClick={loadPreview} className={`${PRIMARY} flex-1`}>
            {!online ? "Offline: needs signal" : previewing ? "Getting the preview…" : "Preview the update"}
          </button>
        )}
      </div>
    ) : stage === "sent" ? (
      <button type="button" onClick={() => setStage("learn")} className={`${PRIMARY} w-full`}>
        Two minutes: what did today teach us?
      </button>
    ) : stage === "learn" ? (
      <div className="flex gap-2">
        <button type="button" onClick={() => setStage("finished")} className={SECONDARY}>
          Skip
        </button>
        <button type="button" disabled={busy} onClick={saveLearnings} className={`${PRIMARY} flex-1`}>
          {busy ? "Saving…" : "Save and finish"}
        </button>
      </div>
    ) : (
      <button type="button" onClick={onClose} className={`${PRIMARY} w-full`}>
        Done
      </button>
    );

  return (
    <Sheet open={open} onClose={onClose} title={`End day ${n}`} footer={footer} wide keepOnBackdrop={!finished && (isDirty(draft) || chosen.length > 0)}>
      <div aria-live="polite">
        {stage === "summary" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="end-summary" className="mb-1.5 block text-sm font-semibold text-ink-900">
                Summary for the office
              </label>
              <textarea id="end-summary" rows={4} value={summary} onChange={(e) => setDraft((d) => editDraft(d, "summary", e.target.value))} className={INPUT} />
            </div>
            <div>
              <label htmlFor="end-message" className="mb-1.5 block text-sm font-semibold text-ink-900">
                Update for the customer
              </label>
              <textarea
                id="end-message"
                rows={5}
                value={message}
                onChange={(e) => setDraft((d) => editDraft(d, "message", e.target.value))}
                className={INPUT}
                aria-describedby="end-message-hint"
              />
              <p id="end-message-hint" className="mt-1.5 text-xs text-ink-500">
                Plain and friendly: what&apos;s done, what&apos;s next, anything they need to decide. Leave it empty to close the day without emailing.
              </p>
            </div>
          </div>
        )}
        {stage === "photos" && (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-ink-900">Pick 2 to 4 photos to share</legend>
              <p className="mb-3 text-xs text-ink-500">Only the ones you pick are shown to the customer.</p>
              {photos === null && <p className="text-sm text-ink-500">Loading today&apos;s photos…</p>}
              {photos && photos.length === 0 && <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-700">No photos from today on the server yet. Photos still uploading appear once they&apos;ve synced.</p>}
              {photos && photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((p) => {
                    const on = chosen.includes(p.id);
                    return (
                      <label key={p.id} className={`relative block cursor-pointer overflow-hidden rounded-xl border-2 ${on ? "border-accent-600" : "border-transparent"}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => {
                            setPreview(null);
                            setChosen((c) => (on ? c.filter((x) => x !== p.id) : c.length >= 4 ? c : [...c, p.id]));
                          }}
                          aria-label={p.caption ?? "Photo"}
                        />
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                        ) : (
                          <span className="flex aspect-square items-center justify-center bg-surface text-xs text-ink-500">No preview</span>
                        )}
                        {on && <span className="absolute right-1 top-1 rounded-full bg-accent-600 px-2 text-sm font-bold text-white">✓</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-sm text-ink-700">{chosen.length} chosen</p>
            </fieldset>
            {preview && (
              <div ref={previewRef} tabIndex={-1} className="scroll-mt-4 rounded-2xl border border-line bg-white p-4 outline-none">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Preview · {preview.to ? "email to the customer" : "no customer email on file"}</p>
                <p className="mt-1 font-semibold text-ink-900">{preview.subject}</p>
                <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{preview.text.split("\n\n").slice(0, 5).join("\n\n")}</p>
                {preview.mode === "demo" && <p className="mt-2 text-sm font-medium text-amber-900">Demo mode: the email is recorded, not sent.</p>}
              </div>
            )}
          </div>
        )}
        {stage === "sent" && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">Day {n} closed. {emailStatus}</p>}
        {stage === "learn" && (
          <div className="space-y-4">
            <p className="text-base text-ink-700">Optional, and only the ones that apply. This is how pilot 2 goes better than pilot 1.</p>
            {LEARNING_PROMPTS.map((p) => (
              <div key={p.id}>
                <label htmlFor={`learn-${p.id}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                  {p.question}
                </label>
                <textarea id={`learn-${p.id}`} rows={2} value={answers[p.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))} className={INPUT} />
              </div>
            ))}
          </div>
        )}
        {stage === "finished" && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">Thanks. See you {n >= data.header.totalDays ? "at handover" : "tomorrow"}.</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        {blockers.length > 0 && (
          <div className="mt-3">
            <BlockerList blockers={blockers} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
