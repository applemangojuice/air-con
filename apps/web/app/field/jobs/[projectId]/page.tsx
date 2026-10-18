import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { RiskChips } from "@/components/field/job-card";
import { JobNav } from "@/components/field/job-nav";
import { LoadList, RamsAck } from "@/components/field/pack-bits";
import { HeaderTitle, SyncBadge } from "@/components/field/sync-badge";
import { crewLabel, fmtDay, londonTime, telHref } from "@/components/field/format";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { FieldError, loadJobPack } from "@/lib/field-server";

/**
 * The job pack, read before leaving home: where, who, the approved layout
 * on the real photos, equipment by room, what to load, the risks and RAMS,
 * what the customer asked for, and the documents. Subcontractors get the
 * plain scope, never the priced documents.
 */

export const metadata: Metadata = { title: "Job pack" };
export const dynamic = "force-dynamic";

function Block({ id, title, children, hint }: { id: string; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <h2 id={id} className="font-display text-2xl text-ink-900">
        {title}
      </h2>
      {hint && <p className="mb-3 mt-0.5 text-sm text-ink-500">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/** A list that folds away: long, and only needed while loading the van. */
function Fold({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line bg-white open:border-transparent open:bg-transparent">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between rounded-2xl px-4 font-semibold text-ink-900 group-open:mb-2 group-open:border group-open:border-line group-open:bg-white">
        {summary}
        <span aria-hidden className="text-ink-500 transition group-open:rotate-180">⌄</span>
      </summary>
      {children}
    </details>
  );
}

export default async function JobPackPage({ params }: { params: Promise<{ projectId: string }> }) {
  const staff = await requireStaff("install.work");
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  let pack: Awaited<ReturnType<typeof loadJobPack>>;
  try {
    pack = await loadJobPack(projectId, staff);
  } catch (err) {
    if (err instanceof FieldError && err.status === 404) notFound();
    throw err;
  }
  const h = pack.header;
  const day = h.currentDay ?? h.nextDay ?? 1;
  const dayLabel = h.installStatus === "complete" ? "Install complete" : h.currentDay ? `Day ${h.currentDay} under way` : h.nextDay ? `Day ${h.nextDay} next` : "";

  return (
    <>
      <SyncBadge />
      <HeaderTitle>{h.customerName}</HeaderTitle>
      <JobNav projectId={projectId} active="pack" days={h.totalDays} />

      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">
          Job pack{h.pilotLabel ? ` · ${h.pilotLabel}` : ""}
        </p>
        <h1 className="font-display text-3xl leading-tight text-ink-900">{h.customerName}</h1>
        <p className="mt-1 text-lg text-ink-700">
          {h.address}, {h.postcode}
        </p>
        <p className="mt-1 text-base text-ink-500">
          {h.dates.length ? `${h.dates.map((d) => fmtDay(d)).join(" · ")}` : "Dates not set"} {dayLabel ? `· ${dayLabel}` : ""}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {h.customerPhone ? (
            <a href={telHref(h.customerPhone)} className="flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
              Call customer
            </a>
          ) : (
            <span className="flex min-h-12 items-center justify-center rounded-full bg-surface px-4 text-sm text-ink-500">No phone on file</span>
          )}
          <a href={h.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
            Open in Maps
          </a>
        </div>
        {h.bookingStatus === "booked" && (
          <Link href={`/field/jobs/${projectId}/day/${day}`} className="mt-2 flex min-h-12 w-full items-center justify-center rounded-full bg-accent-600 px-6 font-semibold text-white shadow-sm">
            Open the day {day} runsheet →
          </Link>
        )}
      </header>

      {pack.jobProblem && (
        <div role="status" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <p className="font-semibold">The runsheet isn&apos;t ready.</p>
          <p className="mt-1 text-base">{pack.jobProblem}</p>
        </div>
      )}

      <div className="space-y-10">
        <Block id="site" title="Site">
          <dl className="space-y-3 rounded-2xl border border-line bg-white p-4 text-base">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Parking</dt>
              <dd className="text-ink-900">{h.parkingNotes ?? "No parking notes. Ask the customer when you call."}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Access</dt>
              <dd className="text-ink-900">{h.accessNotes ?? "No access notes."}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Crew</dt>
              <dd className="text-ink-900">{h.crew.length ? h.crew.map(crewLabel).join(", ") : "No crew assigned yet."}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Kit</dt>
              <dd className="font-semibold text-ink-900">{h.kitLabel}</dd>
            </div>
            {h.onMyWay && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Last “on my way”</dt>
                <dd className="text-ink-900">
                  {h.onMyWay.by}, {londonTime(h.onMyWay.at)} (about {h.onMyWay.etaMinutes} min)
                </dd>
              </div>
            )}
          </dl>
          {h.risks.length > 0 && (
            <div className="mt-3">
              <RiskChips risks={h.risks} />
            </div>
          )}
        </Block>

        <Block id="rams" title="RAMS" hint="Read before you set off. Everyone on site acknowledges them.">
          {pack.rams.guidance && <p className="mb-3 rounded-2xl bg-surface px-4 py-3 text-base text-ink-900">{pack.rams.guidance}</p>}
          <RamsAck projectId={projectId} {...(pack.rams.specId ? { specId: pack.rams.specId } : {})} acknowledged={pack.rams.acknowledged} mine={pack.rams.mine} meName={staff.name} />
        </Block>

        <Block id="layout" title="The approved layout" hint="Exactly where everything goes, drawn on the survey photos and signed off by the tech lead.">
          {pack.rooms.length === 0 && pack.outside.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-white/60 px-4 py-6 text-center text-ink-500">{pack.designNote ?? "No approved design yet."}</p>
          ) : (
            <div className="space-y-6">
              {pack.rooms.map((r) => (
                <article key={r.roomId} className="overflow-hidden rounded-2xl border border-line bg-white">
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink-900">{r.name}</h3>
                    <p className="text-base text-ink-700">
                      {r.unitLabel}
                      {r.model ? ` · ${r.model}` : ""}
                    </p>
                    <p className="text-sm text-ink-500">
                      {[r.floor ? `${r.floor} floor` : "", r.pipeRunM !== undefined ? `${r.pipeRunM} m pipe run` : "", r.condensate === "pump" ? "condensate pump" : "gravity drain"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {r.photos.length ? (
                    <div className="space-y-3 px-4 pb-4">
                      {r.photos.map((p) => (
                        <AnnotatedImage
                          key={p.id}
                          src={p.url}
                          annotations={p.annotations}
                          alt={`${r.name}: approved layout`}
                          {...(p.width ? { width: p.width } : {})}
                          {...(p.height ? { height: p.height } : {})}
                          legend
                          labels
                          {...(p.caption ? { caption: p.caption } : {})}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="border-t border-line px-4 py-3 text-sm text-ink-500">No layout photo for this room. Check the position with the tech lead before marking out.</p>
                  )}
                </article>
              ))}
              {pack.outside.map((o, i) => (
                <article key={`out-${i}`} className="overflow-hidden rounded-2xl border border-line bg-white">
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink-900">Outside</h3>
                    <p className="text-base text-ink-700">{o.label}</p>
                    {o.note && <p className="text-sm text-ink-500">{o.note}</p>}
                  </div>
                  {o.photos.length > 0 && (
                    <div className="space-y-3 px-4 pb-4">
                      {o.photos.map((p) => (
                        <AnnotatedImage key={p.id} src={p.url} annotations={p.annotations} alt="Outdoor unit: approved position" {...(p.width ? { width: p.width } : {})} {...(p.height ? { height: p.height } : {})} legend labels />
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </Block>

        <Block id="materials" title="Materials" hint={pack.materials[0]?.source === "po" ? "From the purchase orders, with where each line has got to." : "From the design's bill of materials (no purchase orders yet)."}>
          {pack.materials.length ? (
            <Fold summary={`${pack.materials.length} line${pack.materials.length === 1 ? "" : "s"} to load`}>
              <LoadList projectId={projectId} kind="materials" items={pack.materials} />
            </Fold>
          ) : (
            <p className="text-base text-ink-700">No materials list yet.</p>
          )}
        </Block>

        <Block id="tools" title="Tools" hint="The standard kit, plus what this job needs.">
          <Fold summary={`${pack.tools.length} tools, ${pack.tools.filter((t) => t.why).length} for this job`}>
            <LoadList projectId={projectId} kind="tools" items={pack.tools.map((t, i) => ({ key: `tool-${i}`, label: t.label, ...(t.why ? { why: t.why } : {}) }))} />
          </Fold>
        </Block>

        <Block id="customer" title="What the customer asked for">
          {pack.instructions.length ? (
            <ul className="space-y-2">
              {pack.instructions.map((t, i) => (
                <li key={i} className="rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink-900">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-ink-700">Nothing special noted.</p>
          )}
        </Block>

        <Block id="scope" title="Scope of work">
          <ul className="space-y-1 rounded-2xl border border-line bg-white p-4 text-base text-ink-900">
            {pack.scope.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
            {pack.scope.length === 0 && <li className="text-ink-500">No accepted scope on record yet.</li>}
          </ul>
        </Block>

        {pack.documents.length > 0 && (
          <Block id="documents" title="Documents" hint="Read-only copies of what the customer has.">
            <ul className="space-y-2">
              {pack.documents.map((d) => (
                <li key={d.id}>
                  <a href={d.href} className="flex min-h-14 items-center justify-between rounded-2xl border border-line bg-white px-4 py-3">
                    <span>
                      <span className="block font-semibold text-ink-900">{d.title}</span>
                      <span className="block text-sm text-ink-500">{d.ref}</span>
                    </span>
                    <span aria-hidden className="text-ink-500">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </>
  );
}
