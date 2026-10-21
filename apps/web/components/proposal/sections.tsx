import type { ReactNode } from "react";
import { installPlan, type ProposalOption } from "@aircon/domain";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { money } from "@/lib/format";
import type { ProposalPageData } from "./types";

/**
 * The read-only sections of the customer proposal, in reading order. No
 * state: the option comes from the page's toggle. Server- and
 * client-safe.
 */

export function SectionHeading({ n, title, lead, id }: { n?: number; title: ReactNode; lead?: ReactNode; id?: string }) {
  return (
    <div className="mb-4">
      {n !== undefined && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent-700" aria-hidden>
          {String(n).padStart(2, "0")}
        </p>
      )}
      <h2 id={id} className="font-display text-2xl leading-tight text-ink-900 sm:text-3xl">
        {title}
      </h2>
      {lead && <p className="mt-1.5 max-w-2xl text-base text-ink-500">{lead}</p>}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <li className="rounded-full border border-sage-200 bg-sage-50 px-3 py-1 text-sm font-medium text-sage-800">{children}</li>;
}

function Photo({ data, id, alt, legend = true, labels = true }: { data: ProposalPageData; id: string; alt: string; legend?: boolean; labels?: boolean }) {
  const m = data.media[id];
  if (!m) return null;
  return (
    <AnnotatedImage
      src={m.url}
      annotations={m.annotations}
      {...(m.width && m.height ? { width: m.width, height: m.height } : {})}
      alt={m.caption ? `${alt}: ${m.caption}` : alt}
      legend={legend}
      labels={labels}
    />
  );
}

export function RoomsSection({ data, option, n }: { data: ProposalPageData; option: ProposalOption; n: number }) {
  return (
    <section aria-labelledby="rooms-h" className="scroll-mt-24">
      <SectionHeading
        n={n}
        id="rooms-h"
        title="Your rooms"
        lead="Each unit drawn on your own photos, where we agreed it at your survey."
      />
      <div className="space-y-5">
        {option.roomCards.map((card) => {
          const [main, ...more] = card.mediaIds.filter((id) => data.media[id]);
          return (
            <article key={card.roomId} className="overflow-hidden rounded-2xl border border-line bg-white">
              {main ? (
                <div className="p-3 pb-0 sm:p-4 sm:pb-0">
                  <Photo data={data} id={main} alt={`${card.roomName}, where the indoor unit goes`} />
                </div>
              ) : (
                <div className="mx-3 mt-3 rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-6 text-center text-sm text-ink-500 sm:mx-4 sm:mt-4">
                  The photo for this room isn&apos;t available right now. Ask us and we&apos;ll send it.
                </div>
              )}
              <div className="p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{card.roomName}</p>
                <h3 className="mt-1 font-display text-xl leading-snug text-ink-900">{card.unitName}</h3>
                {card.highlights.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${card.roomName}: highlights`}>
                    {card.highlights.map((h) => (
                      <Chip key={h}>{h}</Chip>
                    ))}
                  </ul>
                )}
                {card.why && (
                  <div className="mt-4 rounded-2xl bg-cream px-4 py-3">
                    <p className="text-sm font-semibold text-ink-900">Why this size</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-700">{card.why}</p>
                  </div>
                )}
                {more.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {more.map((id) => (
                      <Photo key={id} data={data} id={id} alt={`${card.roomName}, another view`} legend={false} labels={false} />
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function OutsideSection({ data, option, n }: { data: ProposalPageData; option: ProposalOption; n: number }) {
  const photos = option.outdoorMediaIds.filter((id) => data.media[id]);
  return (
    <section aria-labelledby="outside-h" className="scroll-mt-24">
      <SectionHeading n={n} id="outside-h" title="Outside" lead="Where the outdoor unit sits, as agreed at your survey." />
      <div className="rounded-2xl border border-line bg-white p-3 sm:p-4">
        {photos.length > 0 ? (
          <div className="space-y-4">
            {photos.map((id) => (
              <Photo key={id} data={data} id={id} alt="Where the outdoor unit goes" />
            ))}
          </div>
        ) : (
          <p className="px-2 py-4 text-sm text-ink-500">We&apos;ll confirm the outdoor position with you before we start. Ask us if you&apos;d like a photo of it now.</p>
        )}
        <p className="px-2 pb-2 pt-3 text-sm text-ink-500">
          In winter the outdoor unit melts frost off itself now and then: a little steam and some water underneath is normal, and we plan where that water goes.
        </p>
      </div>
    </section>
  );
}

/** Is there a "How the pipes run" section to show (any room with its pipe line)? */
export function hasPipeNotes(option: ProposalOption): boolean {
  return option.roomCards.some((c) => c.pipeNote?.trim());
}

export function PipesSection({ option, n }: { option: ProposalOption; n: number }) {
  const notes = option.roomCards.filter((c) => c.pipeNote?.trim());
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="pipes-h" className="scroll-mt-24">
      <SectionHeading n={n} id="pipes-h" title="How the pipes run" lead="From each indoor unit to the outdoor unit, measured at your survey." />
      <ol className="space-y-3">
        {notes.map((c, i) => (
          <li key={c.roomId} className="flex gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sage-50 text-sm font-semibold text-sage-700">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">{c.roomName}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-700">{c.pipeNote}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-ink-500">
        We can&apos;t see inside walls. If we find something unexpected when we drill, we stop and talk to you before going further.
      </p>
    </section>
  );
}

function Bullets({ items, tone }: { items: string[]; tone: "yes" | "no" | "neutral" }) {
  const mark = tone === "yes" ? "✓" : tone === "no" ? "–" : "•";
  const colour = tone === "yes" ? "text-sage-700" : tone === "no" ? "text-ink-500" : "text-accent-700";
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-sm leading-relaxed text-ink-700">
          <span aria-hidden className={`mt-0.5 w-4 shrink-0 text-center font-bold ${colour}`}>
            {mark}
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function IncludedSection({ data, n }: { data: ProposalPageData; n: number }) {
  return (
    <section aria-labelledby="included-h" className="scroll-mt-24">
      <SectionHeading n={n} id="included-h" title="What's included, and what isn't" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h3 className="mb-3 font-semibold text-ink-900">Included in your price</h3>
          <Bullets items={data.inclusions} tone="yes" />
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h3 className="mb-3 font-semibold text-ink-900">Not included</h3>
          <Bullets items={data.exclusions} tone="no" />
        </div>
      </div>
      {data.assumptions.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h3 className="mb-3 font-semibold text-ink-900">What the price assumes</h3>
          <Bullets items={data.assumptions} tone="neutral" />
        </div>
      )}
      {data.planningNote && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <h3 className="mb-2 font-semibold text-ink-900">Planning and noise</h3>
          <p className="text-sm leading-relaxed text-ink-700">{data.planningNote}</p>
        </div>
      )}
    </section>
  );
}

export function PlanSection({ option, n }: { option: ProposalOption; n: number }) {
  const days = installPlan(option.installDays);
  return (
    <section aria-labelledby="plan-h" className="scroll-mt-24">
      <SectionHeading
        n={n}
        id="plan-h"
        title={days.length === 3 ? "Your three-day plan" : `Your ${days.length}-day plan`}
        lead="What happens each day. We send you a short update with photos at the end of every day."
      />
      <ol className="grid gap-4 md:grid-cols-3">
        {days.map((d) => (
          <li key={d.day} className="rounded-2xl border border-line bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">Day {d.day}</p>
            <h3 className="mt-1 font-semibold text-ink-900">{d.title}</h3>
            <ul className="mt-3 space-y-2">
              {d.items.map((item) => (
                <li key={item} className="text-sm leading-relaxed text-ink-700">
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PriceSection({ data, option, n }: { data: ProposalPageData; option: ProposalOption; n: number }) {
  return (
    <section aria-labelledby="price-h" className="scroll-mt-24">
      <SectionHeading n={n} id="price-h" title="Your price" lead="Fixed for the work described here." />
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <dl className="divide-y divide-line">
          {option.priceLines.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
              <dt className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900">{l.label}</span>
                {l.detail && <span className="mt-0.5 block text-sm text-ink-500">{l.detail}</span>}
              </dt>
              <dd className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{money(l.amountPence)}</dd>
            </div>
          ))}
          <div className="flex items-end justify-between gap-4 bg-cream px-5 py-5 sm:px-6">
            <dt>
              <span className="block font-semibold text-ink-900">Pilot price</span>
              <span className="block text-sm text-ink-500">{data.vatNotes[option.id]}</span>
              {data.foundingPilot && (
                <span className="mt-2 inline-block rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">Founding pilot price</span>
              )}
            </dt>
            <dd className="font-display text-3xl tabular-nums text-ink-900">{money(option.pricing.totalPence)}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h3 className="mb-3 font-semibold text-ink-900">Paying</h3>
        <ul className="space-y-2 text-sm leading-relaxed text-ink-700">
          {(data.paymentTerms[option.id] ?? []).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">{data.extraCharges}</p>
      </div>
    </section>
  );
}

export function GuaranteesSection({ data, n }: { data: ProposalPageData; n: number }) {
  return (
    <section aria-labelledby="guarantee-h" className="scroll-mt-24">
      <SectionHeading n={n} id="guarantee-h" title="Guarantees and aftercare" />
      <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <ul className="space-y-2.5 text-sm leading-relaxed text-ink-700">
          {data.guarantees.map((g) => (
            <li key={g}>{g}</li>
          ))}
          <li>After handover we check in at a week and a month, and you can report a problem any time from your project page or by phone.</li>
        </ul>
      </div>
    </section>
  );
}

/** Schedule 3: the model instructions and the model form, in full, behind a disclosure. */
export function CancellationDetails({ data, summaryLabel = "Read the full cancellation information and model form" }: { data: ProposalPageData; summaryLabel?: string }) {
  return (
    <details className="group rounded-2xl border border-line bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-ink-900 sm:px-6">
        {summaryLabel}
        <span aria-hidden className="text-ink-500 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-5 py-4 text-sm leading-relaxed text-ink-700 sm:px-6">
        {data.cancellation.instructions.map((p, i) => (
          <div key={i}>
            {p.heading && <p className="font-semibold text-ink-900">{p.heading}</p>}
            <p>{p.text}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-dashed border-line bg-cream p-4">
          <p className="mb-2 font-semibold text-ink-900">Model cancellation form</p>
          <ul className="space-y-1.5">
            {data.cancellation.form.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {!data.cancellation.reviewed && <p className="text-xs text-ink-500">This wording follows the model in the Consumer Contracts Regulations 2013.</p>}
      </div>
    </details>
  );
}

export function CancelSection({ data, n }: { data: ProposalPageData; n: number }) {
  return (
    <section aria-labelledby="cancel-h" className="scroll-mt-24">
      <SectionHeading n={n} id="cancel-h" title="Your right to cancel" />
      <div className="space-y-3">
        <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <p className="text-base leading-relaxed text-ink-900">{data.cancellation.summary}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            To cancel, just tell us clearly, by email, letter or phone. You can use the model form, but you don&apos;t have to.
          </p>
        </div>
        <CancellationDetails data={data} />
      </div>
    </section>
  );
}
