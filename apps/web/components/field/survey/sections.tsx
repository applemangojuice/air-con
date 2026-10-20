"use client";

import { useState, type ReactNode } from "react";
import { HRB_MIN_HEIGHT_M, HRB_MIN_STOREYS, PD_CHECKS, RISK_QUESTIONS, SURVEY_LABELS, higherRiskBuilding, type BlockFacts, type MeasuredSurvey, type RiskQuestionId } from "@aircon/domain";
import { Callout, ChoiceGroup, FieldCard, MultiChoice, NumberField, TextArea, TextField, Tick, SelectField, choices, type Choice } from "./controls";
import { setOpt, useSurvey } from "./context";
import { SCREEN_LABEL, nextScreen, type ScreenId } from "./nav";
import { PhotoStrip } from "./photo-strip";

/**
 * The survey's sections that aren't lists: site and people, wishes, the
 * house, electrics, permissions, risks, assumptions. Each writes straight
 * into the draft (autosaved) and marks what's still to do.
 */

/** "Next: Wishes →" at the bottom of every screen. */
/** `quiet` when the screen has its own main action, so there's only ever one orange button. */
export function NextButton({ from, quiet = false }: { from: ScreenId; quiet?: boolean }) {
  const { go } = useSurvey();
  const next = nextScreen(from);
  return (
    <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
      {next && (
        <button
          type="button"
          onClick={() => go({ s: next })}
          className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-6 text-base font-semibold sm:w-auto ${quiet ? "border border-line bg-white text-ink-900 hover:bg-surface" : "bg-accent-700 text-white shadow-sm hover:bg-accent-800"}`}
        >
          Next: {SCREEN_LABEL[next]} <span aria-hidden>→</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => go({ s: "overview" })}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 text-base font-semibold text-ink-900 hover:bg-surface sm:w-auto"
      >
        All sections
      </button>
    </div>
  );
}

function Screen({ children, from }: { children: ReactNode; from: ScreenId }) {
  return (
    <div className="space-y-4">
      {children}
      <NextButton from={from} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Site & people                                                       */
/* ------------------------------------------------------------------ */

export function SiteSection() {
  const { data, update, isMissing, project } = useSurvey();
  const site = data.site;
  const set = (patch: Partial<MeasuredSurvey["site"]>) => update((m) => ({ ...m, site: { ...m.site, ...patch } }));
  const text = (key: "decisionMaker" | "accessNotes" | "parkingNotes" | "petsKids" | "siteContactPhone") => (v: string) =>
    update((m) => ({ ...m, site: setOpt(m.site, key, v) }));
  return (
    <Screen from="site">
      <FieldCard>
        <Tick
          field="confirmedAddress"
          label="Address confirmed"
          hint={`${project.customer.addressLine}, ${project.customer.postcode}`}
          checked={site.confirmedAddress}
          onChange={(v) => set({ confirmedAddress: v })}
          missing={isMissing("site", "confirmedAddress")}
        />
        <TextField
          field="decisionMaker"
          label="Who makes the decision?"
          hint="The person who'll accept the proposal. Usually the owner."
          value={site.decisionMaker}
          onChange={text("decisionMaker")}
          missing={isMissing("site", "decisionMaker")}
          autoComplete="off"
          maxLength={120}
        />
        <ChoiceGroup
          field="tenure"
          legend="Do they own it?"
          value={site.tenure === "unknown" ? undefined : site.tenure}
          options={choices(SURVEY_LABELS.tenure, ["owner", "leaseholder", "tenant"])}
          onChange={(v) => set({ tenure: v })}
          columns={3}
          missing={isMissing("site", "tenure")}
        />
        <Tick
          field="ownerConfirmed"
          label="Authority to go ahead confirmed"
          hint={
            site.tenure === "owner"
              ? "They own the property and can agree the work."
              : "A leaseholder or tenant needs the freeholder's or landlord's permission in writing. Note who gives it."
          }
          checked={site.ownerConfirmed}
          onChange={(v) => set({ ownerConfirmed: v })}
          missing={isMissing("site", "ownerConfirmed")}
        />
      </FieldCard>
      <FieldCard title="On the day">
        <TextArea field="accessNotes" label="Access" hint="Side gate, keys, which door. The install crew sees this." value={site.accessNotes} onChange={text("accessNotes")} rows={2} />
        <TextArea field="parkingNotes" label="Parking" hint="Where a van can park, permits, loading." value={site.parkingNotes} onChange={text("parkingNotes")} rows={2} />
        <TextField field="petsKids" label="Pets and children" placeholder="e.g. dog in the garden, baby naps 1–3pm" value={site.petsKids} onChange={text("petsKids")} maxLength={500} />
        <TextField field="siteContactPhone" label="Phone on the day" type="tel" autoComplete="tel" value={site.siteContactPhone} onChange={text("siteContactPhone")} maxLength={40} />
      </FieldCard>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Wishes                                                              */
/* ------------------------------------------------------------------ */

const PRIORITIES: Choice<MeasuredSurvey["wishes"]["priorities"][number]>[] = [
  { value: "quiet", label: "Quiet" },
  { value: "discreet", label: "Discreet" },
  { value: "heating", label: "Heating" },
  { value: "cooling", label: "Cooling" },
  { value: "smart-control", label: "App control" },
  { value: "budget", label: "Budget" },
];

export function WishesSection() {
  const { data, update, isMissing } = useSurvey();
  const w = data.wishes;
  return (
    <Screen from="wishes">
      <FieldCard>
        <MultiChoice
          field="priorities"
          legend="What matters most to them?"
          hint="Pick any. It shapes the units we suggest."
          values={w.priorities}
          options={PRIORITIES}
          onChange={(priorities) => update((m) => ({ ...m, wishes: { ...m.wishes, priorities } }))}
        />
        <ChoiceGroup
          field="heatingUse"
          legend="How will they use it?"
          hint="Ask whether they'll heat with it. Permitted development covers heat pumps used for heating; a unit meant only for cooling needs a planning application."
          value={w.heatingUse === "unsure" ? undefined : w.heatingUse}
          options={choices(SURVEY_LABELS.heatingUse, ["main", "supplementary", "cooling-only-intent"])}
          onChange={(heatingUse) => update((m) => ({ ...m, wishes: { ...m.wishes, heatingUse } }))}
          columns={1}
          missing={isMissing("wishes", "heatingUse")}
        />
        {w.heatingUse === "cooling-only-intent" && (
          <Callout tone="warn" title="Cooling only means a planning application">
            Explain that heating mode is what makes it permitted development, and that it&apos;s often the cheapest heat in the house. If they still only want cooling, note it: the technical lead decides the planning route.
          </Callout>
        )}
        <TextField
          field="timing"
          label="When would they like it?"
          placeholder="e.g. before next summer"
          value={w.timing}
          onChange={(v) => update((m) => ({ ...m, wishes: setOpt(m.wishes, "timing", v) }))}
          maxLength={300}
        />
        <TextArea
          field="wishNotes"
          label="Anything else they said"
          hint="Write down anything you promised or they relied on (it becomes part of the contract), and how you qualified it."
          value={w.notes}
          onChange={(v) => update((m) => ({ ...m, wishes: setOpt(m.wishes, "notes", v) }))}
          maxLength={2000}
        />
      </FieldCard>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* House                                                               */
/* ------------------------------------------------------------------ */

function RaiseIssue({ topic, label }: { topic: "asbestos" | "flash-guard" | "structural"; label: string }) {
  const { issues, raiseIssue } = useSurvey();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = issues[topic];
  if (open) {
    return (
      <p role="status" className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-800">
        Issue #{open.number} raised. The technical lead has been told; don&apos;t drill or open anything there.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <TextField field={`issue-${topic}`} label="What did you see, and where?" value={note} onChange={setNote} maxLength={500} placeholder="e.g. textured ceiling on the landing" />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await raiseIssue(topic, note);
          setBusy(false);
          if (!r.ok) setError(r.error);
        }}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-red-700 px-5 text-base font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
      >
        {busy ? "Raising…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function HouseSection() {
  const { data, update, isMissing } = useSurvey();
  const h = data.house;
  const set = (patch: Partial<MeasuredSurvey["house"]>) => update((m) => ({ ...m, house: { ...m.house, ...patch } }));
  const older = h.era !== "2000+";
  const concern = h.asbestosRisk === "possible" || h.asbestosRisk === "suspected";
  return (
    <Screen from="house">
      <FieldCard>
        <ChoiceGroup field="houseType" legend="Type of home" value={h.type} options={choices(SURVEY_LABELS.propertyType)} onChange={(type) => set({ type })} />
        <ChoiceGroup field="era" legend="When was it built?" value={h.era} options={choices(SURVEY_LABELS.era)} onChange={(era) => set({ era })} />
        <SelectField
          field="wallConstruction"
          label="Main wall construction"
          hint="Check at a window reveal or the meter box. Solid brick walls are usually about 23 cm (9 in) thick; cavity walls are thicker."
          value={h.wallConstruction}
          options={choices(SURVEY_LABELS.wallConstruction)}
          onChange={(wallConstruction) => set({ wallConstruction })}
        />
        <NumberField field="storeys" label="Storeys" value={h.storeys} onChange={(v) => v !== undefined && set({ storeys: Math.max(1, Math.round(v)) })} integer min={1} max={10} suggestions={[1, 2, 3]} />
        <ChoiceGroup
          field="loftAccess"
          legend="Loft access"
          value={h.loftAccess ? "yes" : "no"}
          options={[
            { value: "yes", label: "Yes, a hatch we can use" },
            { value: "no", label: "No" },
          ]}
          onChange={(v) => set({ loftAccess: v === "yes" })}
        />
        <ChoiceGroup
          field="listedOrConservation"
          legend="Listed, conservation area or Article 4?"
          hint={h.notes?.includes("Property record shows") ? h.notes.split("\n").find((l) => l.includes("Property record shows")) : "Check the council's map if you're not sure."}
          value={h.listedOrConservation}
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
            { value: "unknown", label: "Not sure" },
          ]}
          onChange={(listedOrConservation) => set({ listedOrConservation })}
          columns={3}
        />
      </FieldCard>

      {h.type === "flat" && <BlockCard />}

      <FieldCard title="Asbestos" tone={concern ? "danger" : older ? "warn" : "plain"}>
        {older ? (
          <Callout tone="warn" title="Built before 2000: check before anyone drills">
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Textured (Artex) ceilings and walls</li>
              <li>Soffits, fascias, gutters and old downpipes</li>
              <li>Old boards behind or around the fuse board, and in boiler cupboards</li>
              <li>Old floor tiles, bath panels, flue pipes</li>
            </ul>
            <p className="mt-2 font-semibold">If you suspect asbestos, stop and raise an issue. Don&apos;t drill, cut or sample it.</p>
          </Callout>
        ) : (
          <p className="text-sm text-ink-500">Built 2000 or later, so asbestos is very unlikely. Note anything that looks older.</p>
        )}
        <ChoiceGroup
          field="asbestosRisk"
          legend="Asbestos risk where we'd work"
          value={h.asbestosRisk === "not-assessed" ? undefined : h.asbestosRisk}
          options={[
            { value: "none-suspected", label: "Nothing suspected" },
            { value: "possible", label: "Possible" },
            { value: "suspected", label: "Suspected" },
          ]}
          onChange={(asbestosRisk) => set({ asbestosRisk })}
          columns={3}
          missing={isMissing("house", "asbestosRisk")}
        />
        {concern && (
          <>
            <TextArea
              field="asbestosNote"
              label="What you saw, and where"
              value={h.asbestosNote}
              onChange={(v) => update((m) => ({ ...m, house: setOpt(m.house, "asbestosNote", v) }))}
              missing={isMissing("house", "asbestosNote")}
              rows={2}
            />
            <RaiseIssue topic="asbestos" label="Stop: raise an asbestos issue" />
          </>
        )}
      </FieldCard>

      <FieldCard>
        <TextArea field="houseNotes" label="Notes about the house" value={h.notes} onChange={(v) => update((m) => ({ ...m, house: setOpt(m.house, "notes", v) }))} maxLength={2000} />
      </FieldCard>
    </Screen>
  );
}

/** A flat: the block's height, whether our route crosses its fire compartments, and who manages it. */
function BlockCard() {
  const { data, update, isMissing } = useSurvey();
  const b: BlockFacts = data.house.block ?? {};
  const setBlock = (fn: (x: BlockFacts) => BlockFacts) => update((m) => ({ ...m, house: { ...m.house, block: fn(m.house.block ?? {}) } }));
  const hrb = higherRiskBuilding(data);
  return (
    <FieldCard title="The block" tone={hrb ? "warn" : "plain"}>
      <NumberField
        field="blockStoreys"
        label="Storeys in the block"
        hint="Count the ground floor as one; leave out basements and roof plant. Or give its height below if that's known instead."
        value={b.storeys}
        onChange={(v) => setBlock((x) => setOpt(x, "storeys", v === undefined ? undefined : Math.max(1, Math.round(v))))}
        integer
        min={1}
        max={200}
        suggestions={[3, 4, 6, 8]}
        missing={isMissing("house", "blockStoreys")}
      />
      <NumberField field="blockHeightM" label="Or its height, ground to the top floor" unit="m" value={b.heightM} onChange={(v) => setBlock((x) => setOpt(x, "heightM", v))} min={0} max={400} />
      {hrb && (
        <Callout tone="warn" title={`A higher-risk building (${HRB_MIN_STOREYS} storeys or ${HRB_MIN_HEIGHT_M} m and above)`}>
          Building control is the Building Safety Regulator here, not the council: the office sorts the route before anything is booked.
        </Callout>
      )}
      <ChoiceGroup
        field="blockCrossing"
        legend="Does a pipe or cable cross a compartment wall or floor (into another flat, a corridor, a riser), or run through a common part?"
        hint="Not sure counts as yes: the crew fire-stops and photographs every crossing."
        value={b.crossing}
        options={[
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
          { value: "unsure", label: "Not sure" },
        ]}
        onChange={(crossing) => setBlock((x) => ({ ...x, crossing }))}
        columns={3}
        missing={isMissing("house", "blockCrossing")}
      />
      <TextField
        field="blockFreeholder"
        label="Freeholder or managing agent"
        hint="Name and a phone or email: the consent and any access to common parts go through them."
        value={b.freeholder}
        onChange={(v) => setBlock((x) => setOpt(x, "freeholder", v.slice(0, 300)))}
        maxLength={300}
        missing={isMissing("house", "blockFreeholder")}
      />
    </FieldCard>
  );
}

/* ------------------------------------------------------------------ */
/* Electrics                                                           */
/* ------------------------------------------------------------------ */

export function ElectricsSection() {
  const { data, update, isMissing, media, queue, addPhotos, detachPhoto, annotate, self } = useSurvey();
  const e = data.electrics;
  const set = (patch: Partial<MeasuredSurvey["electrics"]>) => update((m) => ({ ...m, electrics: { ...m.electrics, ...patch } }));
  const said = self?.electrics?.condition;
  const older = e.boardType === "older-fuse-box";
  const flash = e.asbestosFlashGuard === "possible" || e.asbestosFlashGuard === "yes";
  return (
    <Screen from="electrics">
      <FieldCard>
        <PhotoStrip
          legend="Fuse board photos"
          hint="The whole board with the cover on, then close-ups of the labels and any spare ways."
          mediaIds={e.mediaIds}
          media={media}
          pending={queue.items.filter((p) => p.target.kind === "electrics")}
          tags={["fuse-board", "electrical-supply"]}
          missing={isMissing("electrics", "photos")}
          onAdd={(files, tag) => addPhotos(files, tag, { kind: "electrics" })}
          onRemove={(id) => detachPhoto(id, { kind: "electrics" })}
          onRetry={queue.retry}
          onRemovePending={(id) => void queue.remove(id)}
          onAnnotate={(id) => annotate(id, "Fuse board", "cable")}
        />
        <ChoiceGroup
          field="boardType"
          legend="What kind of board?"
          hint={said ? `Customer said: ${SURVEY_LABELS.electricsCondition[said].toLowerCase()}.` : undefined}
          value={e.boardType === "unknown" ? undefined : e.boardType}
          options={choices(SURVEY_LABELS.boardType, ["modern-rcbo", "modern-rcd", "older-fuse-box"])}
          onChange={(boardType) => set({ boardType })}
          columns={1}
          missing={isMissing("electrics", "boardType")}
        />
        <NumberField
          field="spareWays"
          label="Spare ways"
          hint="Empty slots that could take a new breaker."
          value={e.spareWays}
          onChange={(v) => update((m) => ({ ...m, electrics: setOpt(m.electrics, "spareWays", v) }))}
          integer
          min={0}
          max={60}
          suggestions={[0, 1, 2, 3]}
        />
        <ChoiceGroup
          field="earthing"
          legend="Earthing"
          hint="From the supply cut-out label, if you can see it."
          value={e.earthing}
          options={[
            { value: "TN-C-S", label: "TN-C-S (PME)" },
            { value: "TN-S", label: "TN-S" },
            { value: "TT", label: "TT (earth rod)" },
            { value: "unknown", label: "Can't tell" },
          ]}
          onChange={(earthing) => set({ earthing })}
        />
      </FieldCard>

      <FieldCard title="Cable route">
        <NumberField
          field="cableRouteM"
          label="Cable run, board to outdoor unit"
          hint="Your best measurement along the route the electrician would take."
          unit="m"
          value={e.cableRouteM}
          onChange={(v) => update((m) => ({ ...m, electrics: setOpt(m.electrics, "cableRouteM", v) }))}
          min={0}
          max={200}
          missing={isMissing("electrics", "cableRouteM")}
        />
        <TextArea
          field="cableRouteNote"
          label="How it would run"
          placeholder="e.g. under the stairs, through the kitchen ceiling void, out the back wall"
          value={e.cableRouteNote}
          onChange={(v) => update((m) => ({ ...m, electrics: setOpt(m.electrics, "cableRouteNote", v) }))}
          rows={2}
        />
      </FieldCard>

      <FieldCard title="Old-board asbestos check" tone={flash ? "danger" : older ? "warn" : "plain"}>
        <p className="text-sm text-ink-700">
          Older fuse boxes can have asbestos flash guards (grey or white pads behind the fuse carriers). Look, don&apos;t touch: never pull a carrier to check.
        </p>
        <ChoiceGroup
          field="asbestosFlashGuard"
          legend="Possible asbestos flash guard?"
          value={e.asbestosFlashGuard}
          options={[
            { value: "n/a", label: "Not an old board" },
            { value: "no", label: "No" },
            { value: "possible", label: "Possible" },
            { value: "yes", label: "Yes" },
          ]}
          onChange={(asbestosFlashGuard) => set({ asbestosFlashGuard })}
          missing={isMissing("electrics", "asbestosFlashGuard")}
        />
        {flash && <RaiseIssue topic="flash-guard" label="Stop: raise a fuse board issue" />}
      </FieldCard>

      <FieldCard>
        <TextArea field="electricsNotes" label="Notes" value={e.notes} onChange={(v) => update((m) => ({ ...m, electrics: setOpt(m.electrics, "notes", v) }))} maxLength={2000} />
      </FieldCard>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export function PermissionsSection() {
  const { data, update, isMissing } = useSurvey();
  const pd = data.permissions.pd;
  const flagged = PD_CHECKS.filter((c) => pd[c.id] === "no" || pd[c.id] === "unsure");
  const cooling = data.wishes.heatingUse === "cooling-only-intent" && pd["heating-use"] === "yes";
  return (
    <Screen from="permissions">
      <Callout tone="info">
        A working checklist for permitted development (England, Class G), not legal advice. Answer what you can see; the technical lead approves the assessment. Any &ldquo;No&rdquo; or &ldquo;Not sure&rdquo; goes down the planning route.
      </Callout>
      {cooling && (
        <Callout tone="warn">They said cooling only in Wishes, but heating use is ticked here. Check which is right.</Callout>
      )}
      <ol className="space-y-3">
        {PD_CHECKS.map((c, i) => (
          <li key={c.id}>
            <FieldCard>
              <ChoiceGroup
                field={`pd-${c.id}`}
                legend={
                  <span>
                    <span className="mr-1 text-ink-500">{i + 1}.</span>
                    {c.label}
                  </span>
                }
                hint={c.help}
                value={pd[c.id]}
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Not sure" },
                ]}
                onChange={(v) => update((m) => ({ ...m, permissions: { ...m.permissions, pd: { ...m.permissions.pd, [c.id]: v } } }))}
                columns={3}
                missing={isMissing("permissions", `pd-${c.id}`)}
              />
            </FieldCard>
          </li>
        ))}
      </ol>
      {flagged.length > 0 && (
        <Callout tone="warn" title={`${flagged.length} check${flagged.length === 1 ? "" : "s"} for the planning route`}>
          Note what you found below. The technical lead decides whether it needs a planning application.
        </Callout>
      )}
      <FieldCard>
        <TextArea
          field="pdNotes"
          label="Planning notes"
          value={data.permissions.notes}
          onChange={(v) => update((m) => ({ ...m, permissions: setOpt(m.permissions, "notes", v) }))}
          maxLength={2000}
        />
      </FieldCard>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Risks                                                               */
/* ------------------------------------------------------------------ */

export function RisksSection() {
  const { data, update, isMissing } = useSurvey();
  const r = data.risks;
  const answered = r.answered;
  const answer = (id: RiskQuestionId, v: boolean) =>
    update((m) => ({
      ...m,
      risks: { ...m.risks, [id]: v, ...(m.risks.answered ? { answered: [...new Set([...m.risks.answered, id])] } : {}) },
    }));
  const valueOf = (id: RiskQuestionId) => (answered === undefined || answered.includes(id) ? r[id] : undefined);
  return (
    <Screen from="risks">
      {RISK_QUESTIONS.map((q) => {
        const v = valueOf(q.id);
        return (
          <FieldCard key={q.id}>
            <ChoiceGroup
              field={q.id}
              legend={q.question}
              hint={q.help}
              value={v === undefined ? undefined : v ? "yes" : "no"}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(x) => answer(q.id, x === "yes")}
              missing={isMissing("risks", q.id)}
            />
            {q.id === "workingAtHeight" && v === true && (
              <p className="text-sm text-ink-700">Set the access equipment on each outdoor position, and say where else height work is needed below.</p>
            )}
            {q.id === "structuralConcern" && v === true && <RaiseIssue topic="structural" label="Raise a structural issue for the technical lead" />}
          </FieldCard>
        );
      })}
      <FieldCard>
        <TextArea
          field="riskNotes"
          label="Risk notes"
          hint="What the concern is, where, and what the crew should do about it."
          value={r.notes}
          onChange={(v) => update((m) => ({ ...m, risks: setOpt(m.risks, "notes", v) }))}
          missing={isMissing("risks", "riskNotes")}
          maxLength={2000}
        />
      </FieldCard>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Assumptions & unknowns                                              */
/* ------------------------------------------------------------------ */

function ListEditor({
  title,
  hint,
  field,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  hint: string;
  field: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t.slice(0, 300)].slice(0, 50));
    setDraft("");
  };
  return (
    <FieldCard title={title}>
      <p className="-mt-3 text-sm text-ink-500">{hint}</p>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={`${i}-${it}`} className="flex items-start gap-2 rounded-2xl border border-line bg-cream px-4 py-2">
              <span className="min-w-0 flex-1 py-2 text-base text-ink-900">{it}</span>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove: ${it}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-surface"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-500">None yet.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor={`f-${field}`} className="sr-only">
          Add to {title.toLowerCase()}
        </label>
        <input
          id={`f-${field}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          className="min-h-12 min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        <button type="submit" disabled={!draft.trim()} className="min-h-12 shrink-0 rounded-full bg-ink-900 px-5 text-base font-semibold text-white disabled:opacity-40">
          Add
        </button>
      </form>
    </FieldCard>
  );
}

export function AssumptionsSection() {
  const { data, update } = useSurvey();
  return (
    <Screen from="assumptions">
      <ListEditor
        title="Assumptions"
        hint="What the design and price rely on that you couldn't fully check. They go on the proposal."
        field="assumptions"
        items={data.assumptions}
        onChange={(assumptions) => update((m) => ({ ...m, assumptions }))}
        placeholder="e.g. clear access to the loft on the day"
      />
      <ListEditor
        title="Unknowns"
        hint="What still needs finding out before the design is signed off."
        field="unknowns"
        items={data.unknowns}
        onChange={(unknowns) => update((m) => ({ ...m, unknowns }))}
        placeholder="e.g. what's inside the boxed-in pipe"
      />
    </Screen>
  );
}
