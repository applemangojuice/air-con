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
 * steps up top, then one fold per topic (signing in and the Home Screen, on my way, evidence, outcomes,
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
        <Fold id="sign-in" title="Signing in, and the Home Screen">
          <p>
            On <B>Sign in</B>, type your work email → <B>Email me a sign-in link</B>. The email has a <B>Sign in</B> link and a 6-digit code. The link works for 20 minutes, the
            code for 15; either one works once, and using one uses up both.
          </p>
          <p>
            If the link opens inside your email app (Gmail, Outlook), you&apos;d be signed in there, not in Safari or Chrome. Instead, go back to the sign-in page where you
            want to be signed in, and type the code under <B>Enter the 6-digit code from the email</B>.
          </p>
          <p>
            <B>On the Home Screen:</B> once you&apos;re signed in, open the field app (Today), then <B>Share</B> → <B>Add to Home Screen</B> on an iPhone (or Chrome&apos;s
            menu → <B>Add to Home screen</B> on Android). The icon opens the field app. It has its own sign-in, apart from the browser&apos;s: the first time, sign in there
            with the code, never the link (a link always opens the browser).
          </p>
          <p>
            A sign-in lasts 30 days and renews itself as you use the app, up to 90 days after you signed in. <B>Me</B> says until when.
          </p>
        </Fold>
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
          <p>A reading outside the allowed range is flagged <B>Needs review</B> for the tech lead (the pressure test and the vacuum are judged as a whole instead: see below). Record what you actually measured: never re-take it to make it pass.</p>
          <p>Photos: whole item in shot, label readable for serials, nothing in the way.</p>
          <p>Everything saves on this phone first and sends by itself (see the sync badge, below).</p>
        </Fold>

        <Fold id="runs" title="Pipe runs and the manual's limits">
          <p>
            Each room&apos;s <B>Pipework</B> step asks for the run you actually laid, one way, and says the outdoor unit&apos;s limits from its manual (for example 3 to
            20 m to one indoor unit). Outside them the reading goes to the tech lead as <B>Needs review</B>. Never cut a run shorter than the minimum: the manual says
            how any extra may be laid. The charge step checks the whole length the same way (on a multi-split, all the runs added up).
          </p>
        </Fold>

        <Fold id="firestop" title="Flats: fire-stopping">
          <p>
            In a block of flats, where the route crosses a compartment wall or floor (into another flat, a corridor, a riser) or a common part, day 1 has a critical step,{" "}
            <B>Fire-stopping at the compartment crossing</B>: seal it with a product tested for that wall or floor and that service, photograph it before it&apos;s boxed in,
            and type the product and its fire rating. Not crossing one after all: the tech lead marks it N/A.
          </p>
        </Fold>

        <Fold id="lift" title="Height and heavy lifts">
          <p>
            The job card and the RAMS name any access at height and the bracket&apos;s height: no work off a ladder there. Check the tower, podium, scaffold or MEWP
            before anyone goes up (a MEWP by a trained operator).
          </p>
          <p>
            An outdoor unit over 25 kg is a <B>two-person lift</B> (or a lifting aid), never carried up a ladder. The <B>Outdoor unit</B> step asks you to confirm it.
          </p>
        </Fold>

        <Fold id="reducers" title="Multi-split reducers">
          <p>
            Where the catalogue has the outdoor unit&apos;s port sizes and a port differs from the pipe, the <B>Flares and torque</B> step names the port and asks for the
            reducer&apos;s torque: fit the reducer (often in the unit&apos;s accessory bag) and tighten it to the job&apos;s reducer torque from the manual. No port sizes on record: fit
            what the manual names and tighten it as it says.
          </p>
        </Fold>

        <Fold id="charge" title="The charge">
          <p>
            On the <B>F-gas label and charge record</B> step, type the as-built length first. The step works out the charge it needs from the catalogue (max(0, as-built
            length − pre-charged length) × g/m) and shows it next to the weighed slot. Charge by weight and type what you weighed.
          </p>
          <p>
            Further from it than the job&apos;s tolerance (10% or 50 g, whichever is larger, unless the tech lead set the job&apos;s own) goes to the tech lead as{" "}
            <B>Needs review</B> with the working: they sign it off with a reason or ask for it again. The R32 room-size maximum still applies.
          </p>
        </Fold>

        <Fold id="tests" title="The pressure test and the vacuum">
          <p>
            <B>Strength and tightness test</B> (oxygen-free nitrogen): apply the manual&apos;s test pressure, never above the outdoor unit&apos;s nameplate PS, and type it with the
            ambient temperature by the pipework. Hold for the manual&apos;s time, then type the pressure and the temperature again, how long it held, and your gauge&apos;s
            resolution (the smallest step it reads: 0.1 bar on most digital manifolds). Photograph the gauge.
          </p>
          <p>
            The app works out the result from your readings: it corrects the end pressure to the start temperature (a cooler afternoon lowers the gauge without a leak) and
            fails the test if it fell by more than the gauge&apos;s resolution, or the manual&apos;s allowance if the tech lead set one. Above PS or below the manual&apos;s
            pressure, or a hold shorter than the manual&apos;s, fails too.
          </p>
          <p>
            <B>Vacuum</B>: digital micron gauge. Pull down to 500 micron (or the manual&apos;s figure if it&apos;s stricter), isolate the pump, hold for the manual&apos;s time and
            type the reading after. A rise above the job&apos;s limit fails: moisture or a leak.
          </p>
          <p className="rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-900">
            A failed test is found, fixed and done again, with every reading taken again. Typing one reading again, or tapping Pass, never clears it, and nobody can accept it:
            commissioning can&apos;t be signed until a retest passes. Record what the gauge says.
          </p>
        </Fold>

        <Fold id="joints" title="Leak checks, brazed joints and the electrics">
          <p>
            <B>Release and leak check</B>: every field joint with an electronic leak detector rated for R32 (A2L), sensitive to 5 g a year or better. Spray alone isn&apos;t
            enough indoors. Type the detector&apos;s make and model and the pressure the joints were at: a quarter of the nameplate PS or more (on a cold day, run it in
            heating). A leak: don&apos;t top up. Pump down (or recover), re-make the joint, then pressure test, evacuate and decay test again.
          </p>
          <p>
            <B>Brazed joint</B> (only on a run longer than one coil): it&apos;s hot work. Clear or shield anything that burns, extinguisher and fire blanket out, nitrogen
            flowing while you braze, a photo of the joint before it&apos;s insulated, and a fire watch after the last flame for as long as the RAMS says. Inside the home only a
            permanent brazed joint: no flare or reusable joint in the run.
          </p>
          <p>
            <B>Electrics</B>: the electrician sizes the breaker, its RCD type and the cable for the route; the design&apos;s figures are a starting point. The interconnect
            between the units is mains voltage: the cable the manual names, terminals tight, strain relief on, earth first, and a photo of the terminal blocks.
          </p>
          <p className="rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-900">
            Suspected asbestos at the survey: the day-1 check asks what cleared it (a test result, or the route changed to avoid it). Never drill it.
          </p>
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
            <B>Request a variation</B> when the customer asks for more, or the job needs something that isn&apos;t in the scope (a longer pipe run, a pump, trunking, a unit moved along the same wall). Say what and why (the customer reads it) and an estimated price.
          </p>
          <p className="rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-900">
            A unit added, removed, swapped or moved to another room or outdoor position is a design change, not a variation: answer Yes to the sheet&apos;s first question and send it to the office as a question. Install what was designed; the office quotes the change as a new job, signed off by the technical lead.
          </p>
          <p className="rounded-xl bg-amber-50 px-3 py-2 font-semibold text-amber-900">
            Then wait. Never do unapproved extra work. The office checks the price, the customer approves or declines it in their portal, and its status shows under Issues. Work they haven&apos;t approved isn&apos;t in their contract. A change over £42 has its own 14 days to cancel: even once approved, start it only when its card says go ahead (the family has asked in writing, or the 14 days are over).
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
              A flat: <B>The block</B> asks its storeys (or height), whether a pipe or cable crosses a compartment wall or floor or a common part (not sure counts as yes), and
              the freeholder or managing agent. 7 storeys or 18 m and above is a higher-risk building: the office sorts the route first.
            </li>
            <li>
              Outdoor: the height to the bracket. Above 2.5 m (the company&apos;s limit) a ladder won&apos;t do for installing it: pick <B>Tower</B>, <B>Podium steps</B>,{" "}
              <B>Scaffold</B> or <B>MEWP</B>. Its hire goes on the proposal and into the RAMS.
            </li>
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
            With a subcontractor on the crew, the sign form asks a line <B>For the health and safety file</B> (anything the next person working on it should know). The
            handover pack carries the file: the routes as built, the R32, the isolators, the manuals and your line.
          </p>
          <p>
            <B>Commission</B> (the tech lead signs): the results for each system, from the evidence, with the pressure and vacuum tests worked out; the manufacturer&apos;s targets (test pressure and PS, hold times, the allowed fall, the vacuum target and rise limit, torques, drain fall); every Needs review item looked at. A failed pressure or vacuum test stops the signature until it&apos;s retested. <B>Sign commissioning</B> completes the install and issues the certificate. It can&apos;t be undone from the field.
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
