"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultOptionFor, guaranteeLines, proposalIssueErrors, type Blocker, type OptionContext, type ProposalRecord } from "@aircon/domain";
import { BlockerList, Button, Card, Fieldset, Input, Textarea } from "@/components/kit";
import { fmtDate, money } from "@/lib/format";
import type { EngineReference, ProposalMedia } from "@/lib/proposal-server";
import {
  customerEmailAction,
  issueAction,
  overrideAction,
  recordConsentAction,
  saveDraftAction,
  type ActionResult,
} from "@/app/ops/projects/[id]/proposal/actions";
import { ListEditor } from "./fields";
import { formFromRecord, optionFormFrom, previewOption, recordFromForm, type OptionForm } from "./model";
import { OptionEditor } from "./option-editor";
import { reloadProposalPage } from "./reload";

/**
 * The proposal builder: edit a draft, see the price and margin move as you
 * type, save automatically (the server reprices; the browser only previews),
 * and issue when the checks are clear. Unsaved work is never lost silently:
 * the status line says what's saved, a failed save keeps the edits and
 * retries, and leaving with unsaved changes asks first.
 */

export interface BuilderProps {
  projectId: string;
  proposal: ProposalRecord;
  ctx: OptionContext;
  engine: EngineReference;
  canSeeMargins: boolean;
  canIssue: boolean;
  isAdmin: boolean;
  media: Record<string, ProposalMedia>;
  blockers: Blocker[];
  schedule2Missing: string[];
  customer: { name: string; email?: string; consentAt?: string };
  today: string;
  instantPricePence: number;
  surveyHref: string;
  designHref: string;
}

type SaveState = { kind: "saved"; at?: string } | { kind: "dirty" } | { kind: "saving" } | { kind: "error"; message: string; conflict: boolean };

/** The gate blockers the builder re-checks live from the draft itself. */
const LIVE_CODES = new Set(["margin-below-minimum", "costs-unpriced", "validity-passed", "proposal-not-drafted"]);

export function ProposalBuilder(props: BuilderProps) {
  const { projectId, proposal, canSeeMargins, canIssue, isAdmin } = props;
  const [form, setForm] = useState(() => formFromRecord(proposal));
  const [tab, setTab] = useState(form.options[0]?.designVariantId ?? "");
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [issue, setIssue] = useState<{ busy: boolean; result?: ActionResult<{ version: number }> }>({ busy: false });
  const revision = useRef(proposal.draftRevision ?? 0);
  const inflight = useRef<Promise<boolean> | null>(null);
  const pending = useRef(false);
  const latest = useRef(form);
  latest.current = form;
  const first = useRef(true);

  const ctx = useMemo<OptionContext>(() => ({ ...props.ctx, contractType: form.contractType }), [props.ctx, form.contractType]);
  const previews = useMemo(
    () =>
      form.options
        .map((o) => {
          const preview = previewOption(ctx, o);
          // Without margin access the browser has no costs to price with: show the stored price instead.
          const stored = proposal.options.find((s) => s.designVariantId === o.designVariantId);
          if (preview && !canSeeMargins && stored) {
            return { form: o, preview: { option: { ...preview.option, pricing: stored.pricing, priceLines: stored.priceLines } } };
          }
          return { form: o, preview };
        })
        .filter((x): x is { form: OptionForm; preview: NonNullable<ReturnType<typeof previewOption>> } => x.preview !== null),
    [ctx, form.options, canSeeMargins, proposal.options],
  );
  const draftRecord = useMemo(() => recordFromForm(proposal, form, previews.map((p) => p.preview.option)), [proposal, form, previews]);
  const liveErrors = useMemo(() => proposalIssueErrors(draftRecord, ctx.settings, props.today), [draftRecord, ctx.settings, props.today]);
  const projectBlockers = props.blockers.filter((b) => !LIVE_CODES.has(b.code));
  const blocking = projectBlockers.filter((b) => b.severity === "block");
  const anyAboveInstant = props.instantPricePence > 0 && previews.some((p) => p.preview.option.pricing.totalPence > props.instantPricePence);
  // Below the minimum, or with costs missing so the minimum can't be checked: both need an admin override to issue.
  const belowMin = previews.some(
    (p) => p.preview.option.pricing.netPence > 0 && (p.preview.option.pricing.belowMinMargin || p.preview.option.pricing.unpricedCostLines > 0),
  );

  /* ---------------- saving ---------------- */

  const runSave = useCallback(async (): Promise<boolean> => {
    if (inflight.current) {
      pending.current = true;
      return inflight.current;
    }
    const attempt = (async () => {
      setSave({ kind: "saving" });
      try {
        const res = await saveDraftAction(projectId, proposal.id, { ...latest.current, revision: revision.current });
        if (!res.ok) {
          const conflict = /Someone else saved/.test(res.error);
          setSave({ kind: "error", message: res.error, conflict });
          return false;
        }
        revision.current = res.revision;
        setSave({ kind: "saved", at: new Date().toISOString() });
        return true;
      } catch {
        setSave({ kind: "error", message: "Couldn't reach the server. Your changes are still here; they'll save when you're back online.", conflict: false });
        return false;
      }
    })();
    inflight.current = attempt;
    const ok = await attempt;
    inflight.current = null;
    if (pending.current) {
      pending.current = false;
      return runSave();
    }
    return ok;
  }, [projectId, proposal.id]);

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave((s) => (s.kind === "error" && s.conflict ? s : { kind: "dirty" }));
    const t = setTimeout(() => {
      void runSave();
    }, 1200);
    return () => clearTimeout(t);
  }, [form, runSave]);

  // Retry a failed save when the connection comes back.
  useEffect(() => {
    const online = () => {
      if (save.kind === "error" && !save.conflict) void runSave();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [save, runSave]);

  // Don't let someone leave with unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.kind === "dirty" || save.kind === "saving" || (save.kind === "error" && !save.conflict)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  async function flush(): Promise<boolean> {
    if (save.kind === "saved" && !inflight.current) return true;
    return runSave();
  }

  /* ---------------- options ---------------- */

  const setOption = (id: string, next: OptionForm) => setForm((f) => ({ ...f, options: f.options.map((o) => (o.designVariantId === id ? next : o)) }));
  const missingVariants = ctx.design.variants.filter((v) => !form.options.some((o) => o.designVariantId === v.id));
  const addBack = (variantId: string) => {
    const variant = ctx.design.variants.find((v) => v.id === variantId);
    if (!variant) return;
    const fresh = optionFormFrom(defaultOptionFor(ctx, variant));
    setForm((f) => ({ ...f, options: [...f.options, fresh] }));
    setTab(variantId);
  };
  const remove = (variantId: string) => {
    setForm((f) => ({ ...f, options: f.options.filter((o) => o.designVariantId !== variantId) }));
    setTab(form.options.find((o) => o.designVariantId !== variantId)?.designVariantId ?? "");
  };
  const active = previews.find((p) => p.form.designVariantId === tab) ?? previews[0];

  /* ---------------- issue ---------------- */

  async function onIssue() {
    setIssue({ busy: true });
    const saved = await flush();
    if (!saved) {
      setIssue({ busy: false, result: { ok: false, error: "Save the draft first: it didn't save (see above)." } });
      return;
    }
    try {
      const result = await issueAction(projectId, proposal.id);
      if (result.ok) {
        // Stay busy while the page reloads into the issued version (see reload.ts).
        setIssue({ busy: true, result });
        reloadProposalPage(projectId);
        return;
      }
      setIssue({ busy: false, result });
    } catch {
      setIssue({ busy: false, result: { ok: false, error: "Couldn't reach the server. Nothing was sent: try again." } });
    }
  }

  const previewHref = `/p/${projectId}/proposal?preview=${proposal.id}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        {/* Option tabs */}
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Options">
          {previews.map(({ form: o, preview }) => {
            const on = active?.form.designVariantId === o.designVariantId;
            return (
              <button
                key={o.designVariantId}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls="option-panel"
                onClick={() => setTab(o.designVariantId)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                  on ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-900 hover:bg-surface"
                }`}
              >
                {o.label || "Untitled"}
                <span className={`tabular-nums ${on ? "text-white/80" : "text-ink-500"}`}>
                  {preview.option.pricing.totalPence > 0 ? money(preview.option.pricing.totalPence) : "not priced"}
                </span>
              </button>
            );
          })}
          {missingVariants.map((v) => (
            <Button key={v.id} variant="ghost" onClick={() => addBack(v.id)}>
              + Add {v.label} back
            </Button>
          ))}
        </div>

        <div id="option-panel" role="tabpanel">
          {active ? (
            <OptionEditor
              key={active.form.designVariantId}
              form={active.form}
              preview={active.preview}
              ctx={ctx}
              engine={props.engine}
              media={props.media}
              canSeeMargins={canSeeMargins}
              isAdmin={isAdmin}
              instantPricePence={props.instantPricePence}
              onChange={(next) => setOption(active.form.designVariantId, next)}
              {...(previews.length > 1 ? { onRemove: () => remove(active.form.designVariantId) } : {})}
            />
          ) : (
            <Card>
              <p className="text-sm text-ink-700">There are no options in this draft. Add one back from the design above.</p>
            </Card>
          )}
        </div>

        {/* Wording */}
        <Card>
          <h3 className="font-display text-xl text-ink-900">What&apos;s included, excluded and assumed</h3>
          <p className="mt-1 text-sm text-ink-500">Shared by every option. The defaults are honest starting points: edit them to fit this home.</p>
          <div className="mt-4 space-y-6">
            <ListEditor label="Included" value={form.inclusions} onChange={(v) => setForm((f) => ({ ...f, inclusions: v }))} max={20} />
            <ListEditor label="Not included" value={form.exclusions} onChange={(v) => setForm((f) => ({ ...f, exclusions: v }))} max={20} />
          </div>
          <div className="mt-4">
            <ListEditor label="What the price assumes" value={form.assumptions} onChange={(v) => setForm((f) => ({ ...f, assumptions: v }))} max={20} />
          </div>
          <div className="mt-5 rounded-2xl bg-cream p-4">
            <p className="text-sm font-semibold text-ink-900">Guarantees (from settings)</p>
            <ul className="mt-2 space-y-1 text-sm text-ink-700">
              {guaranteeLines(ctx.settings).map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">
              From the warranty settings, and frozen into the proposal when it&apos;s issued. Change them in{" "}
              <Link href="/ops/settings" className="font-semibold text-accent-700 underline">
                settings
              </Link>
              .
            </p>
          </div>
          <div className="mt-5">
            <Textarea
              label="Internal notes"
              hint="For the team only. Never shown to the customer."
              rows={3}
              maxLength={4000}
              value={form.internalNotes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))}
            />
          </div>
        </Card>
      </div>

      {/* Issue panel: the checks sit right next to the one action they gate. */}
      <aside className="order-first space-y-4 lg:sticky lg:top-4 lg:order-none" aria-label="Issue">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink-900">Draft · version {proposal.version}</p>
            <SaveStatus state={save} onRetry={() => void runSave()} />
          </div>
          <div className="mt-4 space-y-3">
            {liveErrors.length === 0 && blocking.length === 0 ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Ready to issue.</p>
            ) : (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Before it can go</h3>
                {liveErrors.length > 0 && (
                  <ul className="space-y-2">
                    {liveErrors.map((e) => (
                      <li key={e} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {projectBlockers.length > 0 && <BlockerList blockers={projectBlockers} empty={null} />}
            <Fixes {...props} blockers={projectBlockers} flushEdits={flush} />
          </div>
          <div className="mt-5 space-y-3 border-t border-line pt-5">
            {canIssue ? (
              <Button size="lg" block onClick={onIssue} busy={issue.busy} busyLabel="Issuing…">
                Issue proposal
              </Button>
            ) : (
              <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-ink-700">A technical lead or admin issues proposals. Your draft saves as you go: let them know it&apos;s ready.</p>
            )}
            <a href={previewHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface">
              Preview as the customer ↗
            </a>
            <p className="text-xs text-ink-500">
              The preview shows the last saved version. Issuing emails {props.customer.email ?? "the customer"} the proposal with the pre-contract information and cancellation form, and freezes this version.
            </p>
            <div aria-live="polite" role="status">
              {issue.result && !issue.result.ok && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-semibold">{issue.result.error}</p>
                  {issue.result.errors && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {issue.result.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {issue.result.blockers && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {issue.result.blockers
                        .filter((b) => b.severity === "block")
                        .map((b) => (
                          <li key={b.code}>
                            {b.message}
                            {b.action ? ` (${b.action})` : ""}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
              {issue.result?.ok && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Issued. The email is on its way.</p>}
            </div>
          </div>
        </Card>

        {(isAdmin || proposal.marginOverride || proposal.taxOverride) && (belowMin || proposal.marginOverride || ctx.settings.tax.vatRegistered) && (
          <Overrides projectId={projectId} proposal={proposal} flushEdits={flush} isAdmin={isAdmin} showMargin={belowMin || Boolean(proposal.marginOverride)} showTax={ctx.settings.tax.vatRegistered} />
        )}

        <Card>
          <div className="space-y-4">
            <Fieldset legend="Contract">
              <div className="space-y-2">
                {(
                  [
                    ["supply-and-install", "Supply and install", "We supply the kit. Cancellation runs 14 days from delivery."],
                    ["install-only", "Install only", "They supply the kit. Cancellation runs 14 days from acceptance."],
                  ] as const
                ).map(([value, title, detail]) => (
                  <label key={value} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${form.contractType === value ? "border-accent-500 bg-accent-50/50" : "border-line"}`}>
                    <input type="radio" name="contract-type" className="mt-1 h-4 w-4 accent-accent-600" checked={form.contractType === value} onChange={() => setForm((f) => ({ ...f, contractType: value }))} />
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{title}</span>
                      <span className="block text-xs text-ink-500">{detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Fieldset>
            <Input
              label="Valid until"
              type="date"
              min={props.today}
              value={form.validUntil}
              hint={`Default: ${ctx.settings.pricing.quoteValidityDays} days from today. Only a real date: no false urgency.`}
              onChange={(e) => e.target.value && setForm((f) => ({ ...f, validUntil: e.target.value }))}
            />
            {(anyAboveInstant || form.increaseReason) && (
              <Textarea
                label="Why it's more than the online estimate"
                hint={`Their online estimate was ${money(props.instantPricePence)}. The customer sees this reason.`}
                rows={4}
                maxLength={1000}
                required={anyAboveInstant}
                value={form.increaseReason ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, increaseReason: e.target.value }))}
              />
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  return (
    <div aria-live="polite" role="status" className="text-right text-xs">
      {state.kind === "saved" && <span className="text-emerald-800">{state.at ? "All changes saved" : "Saved"}</span>}
      {state.kind === "dirty" && <span className="text-ink-500">Unsaved changes…</span>}
      {state.kind === "saving" && <span className="text-ink-500">Saving…</span>}
      {state.kind === "error" && (
        <span className="block max-w-[14rem] text-red-700">
          {state.message}{" "}
          {state.conflict ? (
            <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>
              Reload
            </button>
          ) : (
            <button type="button" className="font-semibold underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** One-tap fixes for the blockers a builder can clear without leaving the page; links for the rest. */
function Fixes(props: BuilderProps & { flushEdits: () => Promise<boolean> }) {
  const codes = new Set(props.blockers.map((b) => b.code));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const run = async (fn: () => Promise<ActionResult>) => {
    setBusy(true);
    setMsg(null);
    try {
      // Save any edits first: the page reloads with the fix applied (see reload.ts).
      if (!(await props.flushEdits())) {
        setMsg("Save the draft first: it didn't save (see above).");
      } else {
        const r = await fn();
        if (r.ok) {
          reloadProposalPage(props.projectId);
          return;
        }
        setMsg(r.error);
      }
    } catch {
      setMsg("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  };
  const items: React.ReactNode[] = [];
  if (codes.has("documents-consent-missing")) {
    items.push(
      <div key="consent" className="rounded-2xl border border-line p-3">
        <p className="text-sm text-ink-700">
          Did {props.customer.name || "the customer"} tell you they&apos;re happy to get documents by email? Record how. (They can also agree on their project page.)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(() => recordConsentAction(props.projectId, "in-person"))}>
            They agreed in person
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => recordConsentAction(props.projectId, "email"))}>
            They agreed by email
          </Button>
        </div>
      </div>,
    );
  }
  if (codes.has("no-customer-email")) {
    items.push(
      <form
        key="email"
        className="space-y-2 rounded-2xl border border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => customerEmailAction(props.projectId, email));
        }}
      >
        <Input label="Customer's email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy || !email.includes("@")}>
          Save email
        </Button>
      </form>,
    );
  }
  if (codes.has("schedule2-incomplete") || codes.has("terms-unreviewed") || codes.has("tax-unconfirmed")) {
    items.push(
      <p key="settings" className="text-sm text-ink-700">
        <Link href="/ops/settings" className="font-semibold text-accent-700 underline">
          Open settings
        </Link>{" "}
        {props.schedule2Missing.length > 0 ? `to fill in: ${props.schedule2Missing.join(", ")}.` : "to review the company, tax and legal details."}
      </p>,
    );
  }
  if ([...codes].some((c) => c.startsWith("design-"))) {
    items.push(
      <p key="design" className="text-sm text-ink-700">
        <Link href={props.designHref} className="font-semibold text-accent-700 underline">
          Open the design
        </Link>{" "}
        to resolve it.
      </p>,
    );
  }
  if (codes.has("survey-not-submitted")) {
    items.push(
      <p key="survey" className="text-sm text-ink-700">
        <Link href={props.surveyHref} className="font-semibold text-accent-700 underline">
          Open the survey
        </Link>{" "}
        to finish and submit it.
      </p>,
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Fix it</p>
      {items}
      {props.customer.consentAt && <p className="text-xs text-ink-500">Documents by email agreed {fmtDate(props.customer.consentAt)}.</p>}
      <div aria-live="polite" role="status">
        {msg && <p className="text-sm font-medium text-red-700">{msg}</p>}
      </div>
    </div>
  );
}

function Overrides({
  projectId,
  proposal,
  flushEdits,
  isAdmin,
  showMargin,
  showTax,
}: {
  projectId: string;
  proposal: ProposalRecord;
  flushEdits: () => Promise<boolean>;
  isAdmin: boolean;
  showMargin: boolean;
  showTax: boolean;
}) {
  const [margin, setMargin] = useState(proposal.marginOverride?.reason ?? "");
  const [tax, setTax] = useState(proposal.taxOverride?.reason ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (kind: "margin" | "tax", reason: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      // Save edits before the override changes the draft (it moves the draft's revision on), then reload with it.
      if (!(await flushEdits())) {
        setMsg("Save the draft first: it didn't save (see above).");
      } else {
        const r = await overrideAction(projectId, proposal.id, kind, reason);
        if (r.ok) {
          reloadProposalPage(projectId);
          return;
        }
        setMsg(r.error);
      }
    } catch {
      setMsg("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  };
  const block = (kind: "margin" | "tax", title: string, value: string, setValue: (v: string) => void, current?: { reason: string; by: string; at: string }) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {current && (
        <p className="text-xs text-ink-500">
          Recorded by {current.by} on {fmtDate(current.at)}.
        </p>
      )}
      {isAdmin ? (
        <>
          <Textarea label="Reason" rows={2} maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || value.trim().length < 5} onClick={() => save(kind, value)}>
              {current ? "Update override" : "Record override"}
            </Button>
            {current && (
              <Button variant="ghost" disabled={busy} onClick={() => save(kind, null)}>
                Remove
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-700">{current ? `“${current.reason}”` : "Only an admin can record this."}</p>
      )}
    </div>
  );
  return (
    <Card>
      <h3 className="text-sm font-semibold text-ink-900">Admin overrides</h3>
      <p className="mt-1 text-xs text-ink-500">On the record with your name. For this version only.</p>
      <div className="mt-3 space-y-5">
        {showMargin && block("margin", "Below the minimum margin, or costs not all priced", margin, setMargin, proposal.marginOverride)}
        {showTax && block("tax", "VAT treatment not confirmed / changed tax code", tax, setTax, proposal.taxOverride)}
      </div>
      <div aria-live="polite" role="status">
        {msg && <p className="mt-2 text-sm font-medium text-red-700">{msg}</p>}
      </div>
    </Card>
  );
}
