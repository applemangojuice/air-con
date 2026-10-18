"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMBINATION_TABLE_ACK,
  designApprovalErrors,
  designDeviations,
  designInputsKey,
  editsFromDesign,
  manufacturersFor,
  needsCombinationAck,
  type CatalogueItem,
  type CompatibilityRule,
  type DesignEdits,
  type DesignRecord,
} from "@aircon/domain";
import { approveDesignAction, saveDesignAction, type DesignActionResult } from "@/app/ops/projects/[id]/design/actions";
import { Badge, Button, Card, LinkButton, StatusChip, textareaClass } from "@/components/kit";
import type { DesignHistoryEntry, DesignViewer, StudioMedia } from "@/lib/design-server";
import { fmtDate } from "@/lib/format";
import { BomTable } from "./bom-table";
import { VERDICT, VerdictBadge } from "./labels";
import { RoomCard } from "./room-card";
import { RuleLights } from "./rule-lights";
import {
  assignRoom,
  dropVariant,
  isEdits,
  previewOf,
  restoreVariant,
  setIndoor,
  setManufacturer,
  setOutdoor,
  setPosition,
  setReason,
  setRoom,
  takeSuggestedIndoor,
  takeSuggestedSystems,
  toggleRoomPhoto,
  toggleSystemPhoto,
  type StudioCtx,
} from "./studio-state";
import { SystemsPanel } from "./systems-panel";

/**
 * The design studio (F3): one design version, edited in the browser with
 * the same pure functions the server uses, saved as the next version.
 *
 * Patchy signal: every change is kept on this device until it's saved (and
 * offered back after a refresh); a failed save says so and keeps it; a save
 * whose reply was lost is recognised by the server on retry.
 */

export interface DesignStudioProps {
  projectId: string;
  design: DesignRecord;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  media: StudioMedia[];
  viewer: DesignViewer;
  /** May this person change this design at all (permission, proposal not accepted)? */
  editable: boolean;
  catalogueChanged: boolean;
  history: DesignHistoryEntry[];
  today: string;
  proposalHref: string;
}

type Busy = null | "save" | "submit" | "approve";

const FLASH_KEY = (projectId: string) => `dih:design-flash:${projectId}`;

export function DesignStudio(props: DesignStudioProps) {
  const { projectId, design, catalogue, compatibility, media, viewer, today } = props;
  const router = useRouter();
  const ctx: StudioCtx = useMemo(() => ({ design, catalogue, compatibility, by: viewer.name }), [design, catalogue, compatibility, viewer.name]);
  const initial = useMemo(() => editsFromDesign(design), [design]);
  const [edits, setEdits] = useState<DesignEdits>(initial);
  const [editing, setEditing] = useState(props.editable && design.status !== "approved");
  const [tab, setTab] = useState(design.variants[0]?.id ?? "standard");
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [restore, setRestore] = useState<DesignEdits | null>(null);
  const storageKey = `dih:design-edits:${projectId}:${design.id}`;

  const preview = useMemo(() => {
    try {
      return previewOf(ctx, edits);
    } catch (err) {
      console.error("[design] preview failed:", err);
      return design;
    }
  }, [ctx, edits, design]);
  const shown = editing ? preview : design;
  const dirty = editing && designInputsKey(preview) !== designInputsKey(design);
  const savable = dirty || (editing && props.catalogueChanged);
  const variant = shown.variants.find((v) => v.id === tab) ?? shown.variants[0];
  const deviations = useMemo(() => designDeviations(shown), [shown]);
  const needsAck = needsCombinationAck(shown);
  const approvalErrors = useMemo(() => {
    const candidate: DesignRecord = {
      ...shown,
      status: design.status === "approved" && !editing ? "approved" : "draft",
      ...(needsAck && ack ? { acknowledgements: { combinationTable: { by: viewer.name, at: today } } } : {}),
    };
    return designApprovalErrors(candidate);
  }, [shown, design.status, editing, needsAck, ack, viewer.name, today]);

  // A message from the version we just saved (this component remounts per version).
  useEffect(() => {
    try {
      const flash = sessionStorage.getItem(FLASH_KEY(projectId));
      if (flash) {
        setMessage({ tone: "ok", text: flash });
        sessionStorage.removeItem(FLASH_KEY(projectId));
      }
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { edits?: unknown };
        if (isEdits(saved.edits) && JSON.stringify(saved.edits) !== JSON.stringify(initial)) setRestore(saved.edits);
        else localStorage.removeItem(storageKey);
      }
    } catch {
      /* storage unavailable: nothing to restore */
    }
    // Run once per version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep unsaved changes on this device.
  useEffect(() => {
    if (!editing) return;
    try {
      if (dirty) localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), edits }));
      else localStorage.removeItem(storageKey);
    } catch {
      /* private mode: the warning on leaving still protects them */
    }
  }, [edits, dirty, editing, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const statusRef = useRef<HTMLDivElement>(null);
  const say = (tone: "ok" | "error", text: string) => {
    setMessage({ tone, text });
    statusRef.current?.focus();
  };

  const change = (fn: (e: DesignEdits) => DesignEdits) => {
    setMessage(null);
    setEdits((prev) => {
      try {
        return fn(prev);
      } catch (err) {
        console.error("[design] edit failed:", err);
        return prev;
      }
    });
  };

  const offline = "Couldn't reach the server. Your changes are kept on this device; try again when you have signal.";

  async function save(submit: boolean): Promise<Extract<DesignActionResult, { ok: true }> | null> {
    const r = await saveDesignAction(projectId, { baseId: design.id, baseVersion: design.version, edits, ...(submit ? { submit: true } : {}) });
    if (!r.ok) {
      say("error", r.conflict ? r.error : r.error);
      return null;
    }
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* fine */
    }
    return r;
  }

  const onSave = async (submit: boolean) => {
    setBusy(submit ? "submit" : "save");
    setMessage(null);
    try {
      const r = await save(submit);
      if (!r) return;
      const text = r.unchanged
        ? submit
          ? `Version ${r.version} is with the technical lead for review.`
          : "Nothing had changed, so there's no new version."
        : `Saved as version ${r.version}${r.status === "in-review" ? ", in review" : ""}.`;
      try {
        sessionStorage.setItem(FLASH_KEY(projectId), text);
      } catch {
        /* fine */
      }
      say("ok", text);
      router.refresh();
    } catch {
      say("error", offline);
    } finally {
      setBusy(null);
    }
  };

  const onApprove = async () => {
    setBusy("approve");
    setMessage(null);
    try {
      let target = { id: design.id, version: design.version };
      if (savable) {
        const saved = await save(false);
        if (!saved) return;
        target = { id: saved.id, version: saved.version };
      }
      const r = await approveDesignAction(projectId, { designId: target.id, version: target.version, combinationTableChecked: ack });
      if (!r.ok) {
        say("error", r.error);
        router.refresh();
        return;
      }
      const text = `Approved and signed. Version ${r.version} is now the design the proposal is built from${r.lockFailures ? `; ${r.lockFailures} layout photo(s) couldn't be locked yet, so retry from the banner` : ", and its layout photos are locked"}.`;
      try {
        sessionStorage.setItem(FLASH_KEY(projectId), text);
      } catch {
        /* fine */
      }
      say("ok", text);
      router.refresh();
    } catch {
      say("error", offline);
    } finally {
      setBusy(null);
    }
  };

  const discard = () => {
    setEdits(initial);
    setMessage(null);
    if (design.status === "approved") setEditing(false);
  };

  if (!variant) {
    return <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">This design has no options. Re-draft it from the survey.</p>;
  }

  const removed = design.variants.filter((v) => !edits.variants.some((e) => e.id === v.id));
  const brands = manufacturersFor(variant.tier, catalogue);
  const variantDeviations = deviations.filter((d) => d.field.startsWith("rooms.") || d.field.startsWith(`variants.${variant.id}.`));
  const missingReasons = deviations.filter((d) => {
    const reason = edits.reasons[d.field] ?? shown.overrides.find((o) => o.field === d.field && o.to === d.to)?.reason ?? "";
    return reason.trim().length < 3;
  }).length;

  /* ---------------- the next action ---------------- */

  const approver = viewer.canApprove && props.editable;
  let primary: React.ReactNode = null;
  if (design.status === "approved" && !editing) {
    primary = (
      <LinkButton href={props.proposalHref} block>
        Build the proposal
      </LinkButton>
    );
  } else if (approver) {
    primary = (
      <Button block onClick={onApprove} busy={busy === "approve"} busyLabel={savable ? "Saving and signing…" : "Signing…"} disabled={busy !== null || approvalErrors.length > 0}>
        {savable ? "Save, approve and sign" : "Approve and sign"}
      </Button>
    );
  } else if (editing && design.status === "draft") {
    primary = (
      <Button block onClick={() => onSave(true)} busy={busy === "submit"} busyLabel="Sending…" disabled={busy !== null}>
        {savable ? "Save and submit for review" : "Submit for review"}
      </Button>
    );
  } else if (editing) {
    primary = (
      <Button block onClick={() => onSave(false)} busy={busy === "save"} busyLabel="Saving…" disabled={busy !== null || !savable}>
        Save changes
      </Button>
    );
  }
  const secondarySave =
    editing && savable && (approver || design.status === "draft") ? (
      <Button variant="secondary" block onClick={() => onSave(false)} busy={busy === "save"} busyLabel="Saving…" disabled={busy !== null}>
        Save draft
      </Button>
    ) : null;

  return (
    <div>
      {restore && (
        <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
          <p className="min-w-0 flex-1">You have unsaved changes to this version from earlier, kept on this device.</p>
          <Button
            variant="secondary"
            onClick={() => {
              setEdits(restore);
              setEditing(true);
              setRestore(null);
            }}
          >
            Restore them
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRestore(null);
              try {
                localStorage.removeItem(storageKey);
              } catch {
                /* fine */
              }
            }}
          >
            Discard
          </Button>
        </div>
      )}

      {editing && design.status === "approved" && (
        <p role="note" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You're changing an approved design. Saving starts version {design.version + 1}, which needs approving again before a proposal can be issued from it.
        </p>
      )}

      {/* Options */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Design options" className="flex flex-wrap gap-2">
          {shown.variants.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              id={`tab-${v.id}`}
              aria-selected={v.id === variant.id}
              aria-controls={`panel-${v.id}`}
              onClick={() => setTab(v.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                v.id === variant.id ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-900 hover:border-ink-300"
              }`}
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${v.verdict === "auto-approved" ? "bg-emerald-500" : v.verdict === "needs-review" ? "bg-amber-400" : "bg-red-500"}`} />
              {v.label}
              {v.manufacturer && <span className={v.id === variant.id ? "font-normal text-white/75" : "font-normal text-ink-500"}>{v.manufacturer}</span>}
            </button>
          ))}
          {editing &&
            removed.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => change((e) => restoreVariant(design, e, v.id))}
                className="inline-flex min-h-11 items-center rounded-full border border-dashed border-line px-4 text-sm font-semibold text-ink-700 hover:border-ink-300"
              >
                Bring back {v.label}
              </button>
            ))}
        </div>
        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            {brands.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-ink-700">
                Brand for {variant.label}
                <select
                  className="min-h-10 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink-900"
                  value={variant.manufacturer ?? ""}
                  onChange={(e) => change((ed) => setManufacturer(ctx, ed, variant.id, e.target.value))}
                >
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shown.variants.length > 1 && (
              <Button variant="ghost" onClick={() => change((e) => dropVariant(e, variant.id))}>
                Drop the {variant.label} option
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-6">
        <div id={`panel-${variant.id}`} role="tabpanel" aria-labelledby={`tab-${variant.id}`} className="min-w-0 space-y-8">
          <section aria-labelledby="checks-h">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="checks-h" className="font-display text-2xl text-ink-900">
                Checks
              </h2>
              <VerdictBadge verdict={variant.verdict} />
            </div>
            <RuleLights rules={variant.rules} />
          </section>

          <section aria-labelledby="rooms-h">
            <h2 id="rooms-h" className="mb-3 font-display text-2xl text-ink-900">
              Rooms
            </h2>
            <div className="space-y-4">
              {shown.rooms.map((room) => (
                <RoomCard
                  key={room.roomId}
                  room={room}
                  variant={variant}
                  multipleVariants={shown.variants.length > 1}
                  catalogue={catalogue}
                  media={media}
                  editing={editing}
                  today={today}
                  deviations={variantDeviations.filter((d) => d.field.includes(`.${room.roomId}.`))}
                  overrides={shown.overrides}
                  reasons={edits.reasons}
                  onRoom={(patch) => change((e) => setRoom(ctx, e, room.roomId, patch))}
                  onIndoor={(id) => change((e) => setIndoor(ctx, e, variant.id, room.roomId, id))}
                  onTakeSuggestedIndoor={() => change((e) => takeSuggestedIndoor(ctx, e, variant.id, room.roomId))}
                  onTogglePhoto={(m) => change((e) => toggleRoomPhoto(e, room.roomId, m))}
                  onReason={(f, t) => change((e) => setReason(e, f, t))}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="outdoor-h">
            <h2 id="outdoor-h" className="mb-3 font-display text-2xl text-ink-900">
              Outdoor units, electrics and refrigerant
            </h2>
            <SystemsPanel
              design={shown}
              variant={variant}
              catalogue={catalogue}
              compatibility={compatibility}
              media={media}
              editing={editing}
              today={today}
              deviation={deviations.find((d) => d.field === `variants.${variant.id}.systems`)}
              overrides={shown.overrides}
              reasons={edits.reasons}
              onAssign={(roomId, target) => change((e) => assignRoom(ctx, e, variant.id, roomId, target))}
              onOutdoor={(i, id) => change((e) => setOutdoor(e, variant.id, i, id))}
              onPosition={(i, id) => change((e) => setPosition(e, variant.id, i, id))}
              onTogglePhoto={(i, m) => change((e) => toggleSystemPhoto(e, variant.id, i, m))}
              onReason={(f, t) => change((e) => setReason(e, f, t))}
              onTakeSuggested={() => change((e) => takeSuggestedSystems(ctx, e, variant.id))}
            />
          </section>

          <section aria-labelledby="bom-h">
            <h2 id="bom-h" className="mb-1 font-display text-2xl text-ink-900">
              Bill of materials
            </h2>
            <p className="mb-3 text-sm text-ink-500">From the catalogue, sized to the runs. Purchase orders and the proposal's cost build-up are made from this.</p>
            <BomTable bom={variant.bom} catalogue={catalogue} canSeeCosts={viewer.canSeeCosts} />
          </section>

          <section aria-labelledby="notes-h">
            <h2 id="notes-h" className="mb-3 font-display text-2xl text-ink-900">
              Notes
            </h2>
            {editing ? (
              <>
                <label htmlFor="design-notes" className="sr-only">
                  Design notes
                </label>
                <textarea
                  id="design-notes"
                  rows={4}
                  className={textareaClass}
                  value={edits.notes ?? ""}
                  onChange={(e) => change((ed) => ({ ...ed, notes: e.target.value }))}
                  placeholder="Anything the installer or the reviewer should know: access, a tricky joist, what the customer asked for."
                />
              </>
            ) : (
              <p className="whitespace-pre-line rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink-700">{shown.notes || "No notes."}</p>
            )}
          </section>

          <section aria-labelledby="versions-h">
            <h2 id="versions-h" className="mb-3 font-display text-2xl text-ink-900">
              Versions
            </h2>
            <ol className="divide-y divide-line rounded-2xl border border-line bg-white">
              {props.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-ink-900">
                    <span className="font-semibold">v{h.version}</span> · {fmtDate(h.createdAt)}
                    {h.createdBy ? ` · ${h.createdBy}` : ""}
                    {h.approvedBy ? ` · signed by ${h.approvedBy}` : ""}
                  </span>
                  <StatusChip status={h.status} />
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* The summary and the one next action. */}
        <aside className="order-first space-y-4 lg:sticky lg:top-4 lg:order-none" aria-label="Design summary and actions">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{variant.label} option</p>
            <div className="mt-2">
              <VerdictBadge verdict={variant.verdict} />
            </div>
            <p className="mt-2 text-sm text-ink-500">{VERDICT[variant.verdict].detail}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {(["fail", "review", "pass"] as const).map((s) => (
                <div key={s} className="rounded-xl bg-surface/70 px-2 py-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{s === "fail" ? "Blocked" : s === "review" ? "Check" : "Pass"}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-ink-900">{variant.rules.filter((r) => r.status === s).length}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-700">
              {variant.systems.length} outdoor unit{variant.systems.length === 1 ? "" : "s"} · about {variant.installDays} install day{variant.installDays === 1 ? "" : "s"}
            </p>
          </Card>

          <Card>
            {design.status === "approved" && !editing ? (
              <div>
                <Badge tone="success" dot>
                  Approved
                </Badge>
                <p className="mt-2 text-sm text-ink-700">
                  Signed by <span className="font-semibold text-ink-900">{design.approval?.name}</span>
                  {design.approval?.qualificationRef ? `, F-gas ${design.approval.qualificationRef}` : ""}, on {design.approval ? fmtDate(design.approval.at) : "–"}.
                </p>
                {design.acknowledgements?.combinationTable && <p className="mt-1 text-sm text-ink-500">Combination table checked by {design.acknowledgements.combinationTable.by}.</p>}
                <p className="mt-1 text-sm text-ink-500">Its layout photos are locked.</p>
              </div>
            ) : (
              <div>
                <h3 className="text-sm font-semibold text-ink-900">{approver ? "Before you sign" : "Approval"}</h3>
                {approvalErrors.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Nothing stops this being approved.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm text-red-800">
                    {approvalErrors.slice(0, 8).map((e) => (
                      <li key={e} className="flex gap-2">
                        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                        <span>{e}</span>
                      </li>
                    ))}
                    {approvalErrors.length > 8 && <li className="text-ink-500">…and {approvalErrors.length - 8} more.</li>}
                  </ul>
                )}
                {approver && needsAck && (
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>
                      <span className="font-semibold">{COMBINATION_TABLE_ACK}</span>
                      <span className="mt-0.5 block text-amber-800">This multi-split rests on a provisional rule, so the official table is your evidence.</span>
                    </span>
                  </label>
                )}
                {approver ? (
                  <p className="mt-3 text-xs text-ink-500">
                    Signing as {viewer.name}
                    {viewer.qualificationRef ? `, ${viewer.qualificationLabel} ${viewer.qualificationRef}` : ""}. Your signature covers every check marked Check or Blocked above, and locks the layout photos.
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-ink-500">{viewer.approveBlockedReason ?? "A technical lead with current F-gas certification signs this off."}</p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {primary}
              {secondarySave}
              {design.status === "approved" && !editing && props.editable && viewer.canEdit && (
                <Button variant="secondary" block onClick={() => setEditing(true)}>
                  Make changes
                </Button>
              )}
              {dirty && (
                <Button variant="ghost" block onClick={discard} disabled={busy !== null}>
                  Discard changes
                </Button>
              )}
            </div>
            <div ref={statusRef} tabIndex={-1} aria-live="polite" className="mt-3 outline-none">
              {message && <p className={`text-sm ${message.tone === "error" ? "font-medium text-red-700" : "text-emerald-800"}`}>{message.text}</p>}
              {!message && dirty && (
                <p className="text-sm text-ink-500">
                  Unsaved changes, kept on this device.{missingReasons ? ` ${missingReasons} change${missingReasons === 1 ? " needs" : "s need"} a reason.` : ""}
                </p>
              )}
              {!message && !dirty && editing && props.catalogueChanged && (
                <p className="text-sm text-amber-800">The checks have moved on since this version was saved (catalogue or survey data). Saving records them as a new version.</p>
              )}
            </div>
          </Card>

          {!props.editable && viewer.canEdit && (
            <p className="text-sm text-ink-500">This design can't be changed here: changes after acceptance go through a variation.</p>
          )}
          <p className="text-xs text-ink-500">
            Questions about an item? <Link href="/ops/catalogue" className="font-semibold text-accent-700 underline-offset-2 hover:underline">Open the catalogue</Link>
          </p>
        </aside>
      </div>

      {/* Phones: the next action stays in reach. */}
      {(primary || dirty) && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-ink-500" aria-hidden>
              {dirty ? "Unsaved changes" : design.status === "approved" ? "Approved" : `${approvalErrors.length} thing${approvalErrors.length === 1 ? "" : "s"} before approval`}
            </p>
            <div className="w-56 shrink-0">{primary}</div>
          </div>
        </div>
      )}
    </div>
  );
}
