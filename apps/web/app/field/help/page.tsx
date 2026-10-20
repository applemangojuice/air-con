import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { isPlaceholderPhone } from "@aircon/domain";
import { HeaderTitle, SyncBadge } from "@/components/field/sync-badge";
import { telHref } from "@/components/field/format";
import { requireStaff } from "@/lib/auth/server";
import { getSettings } from "@/lib/settings-server";

/**
 * Help for surveyors and installers, on the phone: the job day in eight
 * steps up top, then one fold per topic (on my way, evidence, outcomes,
 * issues and variations, end of day, the sync badge, surveys, sign-off) and
 * who to call. Linked from the Me tab and the job pack. The words match the
 * buttons on the screens they describe.
 */

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-24 rounded-2xl border border-line bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-lg font-semibold text-ink-900">
        {title}
        <span aria-hidden className="shrink-0 text-ink-500 transition group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="space-y-3 px-4 pb-4 text-base text-ink-900">{children}</div>
    </details>
  );
}

/** A button name as it appears on screen. */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}

const steps: ReactNode[] = [
  <>
    <B>Night before:</B> open the <B>Job pack</B>. Read the RAMS and acknowledge them, look at the layout photos, check what to load.
  </>,
  <>
    <B>Setting off:</B> <B>Actions</B> → <B>On my way</B> → pick your ETA → check the text → send.
  </>,
  <>
    <B>On site:</B> <B>Actions</B> → <B>Arrived: start day 1</B> (or 2, or 3). That starts the day and your clock.
  </>,
  <>
    <B>Work down the day&apos;s runsheet.</B> For each step, capture its evidence, then mark it <B>Pass</B> (or Fail, Blocked or N/A, with a reason).
  </>,
  <>
    <B>Something wrong, or extra work?</B> <B>Actions</B> → <B>Raise an issue</B> or <B>Request a variation</B>. Never do extra work before the customer approves it.
  </>,
  <>
    <B>Breaks:</B> <B>Actions</B> → <B>Pause</B>. Back on: <B>Resume</B>.
  </>,
  <>
    <B>Leaving:</B> <B>Actions</B> → <B>End day 1</B> (or 2, or 3) → check the summary → pick 2 to 4 photos → preview → send.
  </>,
  <>
    <B>Last day:</B> the tech lead signs on the <B>Commission</B> tab, then you do the <B>Handover</B> with the customer.
  </>,
];

export default async function FieldHelpPage() {
  await requireStaff();
  const settings = await getSettings();
  const phone = settings.company.phone?.trim();
  const office = phone && !isPlaceholderPhone(phone) ? phone : null;

  return (
    <>
      <SyncBadge />
      <HeaderTitle>Help</HeaderTitle>
      <header className="mb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">Help</p>
        <h1 className="font-display text-3xl leading-tight text-ink-900">How a job day works</h1>
        <p className="mt-1 text-base text-ink-500">The big black Actions button, bottom right on every job, does most of it.</p>
      </header>

      <section aria-labelledby="day-title" id="day" className="mb-6 scroll-mt-24 rounded-2xl border border-line bg-white p-4">
        <h2 id="day-title" className="sr-only">
          The job day in eight steps
        </h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-base text-ink-900">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="space-y-3">
        <Fold id="on-my-way" title="On my way and Arrived">
          <p>
            <B>On my way</B> texts the customer the arrival time you pick (20, 30, 45 or 60 minutes, or type one). You see the exact text before it goes. It needs signal: with none, tap <B>Call them instead</B>.
          </p>
          <p>
            <B>Arrived</B> starts the day and your clock, and saves your location if the phone allows (optional). If the day won&apos;t start, the screen says what&apos;s stopping it: sort that, or call the office.
          </p>
          <p>
            Joining a day someone else started? <B>Arrived: start my clock</B>.
          </p>
        </Fold>

        <Fold id="evidence" title="Evidence: photos, readings, serials">
          <p>Each step has slots: photos, readings, serial numbers, signatures. Fill every one it asks for, then tap Pass.</p>
          <p>A reading outside the allowed range is flagged <B>Needs review</B> for the tech lead. Record what you actually measured: never re-take it to make it pass.</p>
          <p>Photos: whole item in shot, label readable for serials, nothing in the way.</p>
          <p>Everything saves on this phone first and sends by itself (see the sync badge, below).</p>
        </Fold>

        <Fold id="outcomes" title="Pass, Fail, Blocked, N/A">
          <ul className="space-y-2">
            <li>
              <B>Pass</B>: done, and every slot captured.
            </li>
            <li>
              <B>Fail</B>: done, but the result is wrong (a pressure test that drops). Say what happened. A failed critical step stops the job until the tech lead looks.
            </li>
            <li>
              <B>Blocked</B>: you can&apos;t do it (no access, a missing part, not safe). Say why. It raises an issue for the office.
            </li>
            <li>
              <B>N/A</B>: it doesn&apos;t apply to this job (no condensate pump on this one). Say why.
            </li>
          </ul>
          <p>Fail, Blocked and N/A all need a reason. A few words is fine: the office and the tech lead read every one.</p>
          <p>
            Steps marked F-gas, electrical or tech lead are locked unless you hold that qualification, in date (see <Link href="/field/me" className="font-semibold underline">Me</Link>). You can still mark them Blocked. Never do refrigerant or electrical work you&apos;re not certified for.
          </p>
        </Fold>

        <Fold id="issues" title="Issues and variations">
          <p>
            <B>Raise an issue</B>: missing kit, damage, safety, a question, a customer request, anything that stops you. Add a photo. Tick <B>This stops the job</B> if it does.
          </p>
          <p className="rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-900">Safety first: stop work in that area, then raise it as Safety and call the office. Suspected asbestos is never drilled.</p>
          <p>
            <B>Request a variation</B> when the customer asks for more, or the job needs something that isn&apos;t in the scope (a longer pipe run, a pump, a unit moved). Say what and why (the customer reads it) and an estimated price.
          </p>
          <p className="rounded-xl bg-amber-50 px-3 py-2 font-semibold text-amber-900">
            Then wait. Never do unapproved extra work. The office checks the price, the customer approves or declines it in their portal, and its status shows under Issues. Work they haven&apos;t approved isn&apos;t in their contract.
          </p>
        </Fold>

        <Fold id="end-day" title="End of day">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <B>Actions</B> → <B>End day 1</B> (the button shows today&apos;s day number).
            </li>
            <li>Check the summary of what&apos;s done and what&apos;s next. It&apos;s written for the customer.</li>
            <li>Pick 2 to 4 photos of finished work. Only the ones you pick are shown to them.</li>
            <li>
              <B>Preview the update</B>, then <B>End day 1 and send</B>. Nothing to tell them today? <B>End day 1 (no customer update)</B>.
            </li>
            <li>Two minutes of questions: what took longer, what was missing. Optional, but it&apos;s how the next job goes better.</li>
          </ol>
          <p>Ending the day stops your clock. It needs signal.</p>
        </Fold>

        <Fold id="sync" title="The sync badge (top right)">
          <ul className="space-y-2">
            <li>
              <B>All synced</B>: everything is safe on the server.
            </li>
            <li>
              <B>3 waiting to sync</B>: saved on this phone, sending now.
            </li>
            <li>
              <B>Offline · 3 waiting</B>: no signal. Keep working: it all sends when you&apos;re back in signal.
            </li>
            <li>
              <B>1 needs attention</B> (red): something was turned down. Tap the badge to see what and why, then fix it or tell the office.
            </li>
          </ul>
          <p>
            Tap the badge any time for the list and <B>Sync now</B>. While anything is waiting, don&apos;t clear the browser&apos;s data or switch to a private tab: it lives on this phone until it&apos;s sent.
          </p>
          <p>Starting a day, ending a day, commissioning and handover sign-off need signal, because the server checks them. Step outside or try again in a minute.</p>
        </Fold>

        <Fold id="survey" title="Home surveys (surveyors)">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open the visit from Today. <B>On my way</B> → ETA → send.
            </li>
            <li>
              <B>Start survey</B>. Work through each section: it saves as you go, signal or not.
            </li>
            <li>Every room needs its measurements and a tagged photo, with the unit drawn where it would go.</li>
            <li>Older homes: answer the asbestos questions. Suspected asbestos means stop and raise it.</li>
            <li>
              Before you leave, ask about <B>Documents by email</B>. Without it no proposal can go: the pilot can&apos;t send documents on paper. If they&apos;d rather not, the office gets in touch.
            </li>
            <li>
              <B>Check and submit</B> lists anything missing. <B>Submit survey</B> sends it to the tech lead; you can&apos;t edit it afterwards.
            </li>
          </ol>
        </Fold>

        <Fold id="sign-off" title="Commissioning and handover sign-off">
          <p>
            <B>Commission</B> (the tech lead signs): the results for each system, from the evidence; the manufacturer&apos;s targets; every Needs review item looked at. <B>Sign commissioning</B> completes the install and issues the certificate. It can&apos;t be undone from the field.
          </p>
          <p>
            <B>Handover</B>, with the customer beside you: show them the remote, the modes, the app, cleaning the filters, and what&apos;s normal (steam when it defrosts, a few drips). The handover pack appears once commissioning is signed. They pick <B>All good</B> or <B>There&apos;s a snag</B> (write each snag down), type their name and sign. Each snag becomes an issue with an owner and a date, and the customer can see it.
          </p>
        </Fold>
      </div>

      <section aria-labelledby="call-title" id="call" className="mt-6 scroll-mt-24 rounded-2xl border border-line bg-white p-4">
        <h2 id="call-title" className="font-display text-2xl text-ink-900">
          Who to call
        </h2>
        <ul className="mt-3 space-y-3 text-base text-ink-900">
          <li>
            <B>Anyone hurt, fire, an electric shock, anyone in danger:</B> 999 first, then the office.
          </li>
          <li>
            <B>The office</B>, for anything else: stuck, unsure, a customer problem.
            {office ? (
              <a href={telHref(office)} className="mt-2 flex min-h-12 items-center justify-center rounded-full bg-accent-700 px-6 font-semibold text-white">
                Call the office: {office}
              </a>
            ) : (
              <span className="mt-1 block text-ink-500">The office number isn&apos;t in Settings yet: ask the office for it and save it in your phone.</span>
            )}
          </li>
          <li>
            <B>The tech lead</B> on the job, for readings, F-gas and design questions: their name is under Crew on the job pack.
          </li>
          <li>
            <B>The customer</B>: on the job, <B>Actions</B> → <B>Call</B> and their name.
          </li>
        </ul>
      </section>
    </>
  );
}
