import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";

/**
 * The admin's routine, written for the person running the pilots: what to
 * look at every morning, and what to do at each stage of a job, in the
 * order the job goes. Linked from the ops nav's More menu. The words match
 * the buttons and pages they name.
 */

export const metadata: Metadata = { title: "Help: daily routine · Ops" };
export const dynamic = "force-dynamic";

/** A page in the console, as a link. */
function P({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-accent-700 underline underline-offset-2">
      {children}
    </Link>
  );
}

/** A button name as it appears on screen. */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}

interface Routine {
  id: string;
  title: string;
  when: string;
  steps: ReactNode[];
  note?: ReactNode;
}

const ROUTINES: Routine[] = [
  {
    id: "morning",
    title: "Every morning",
    when: "About 15 minutes, before anyone sets off",
    steps: [
      <>Read the morning email (it arrives at 7am in summer, 6am in winter): today&apos;s visits, what&apos;s overdue, who owes us money.</>,
      <>
        Open the <P href="/ops/projects">Board</P>. Start with the red, blocked cards: open each one, read what&apos;s blocking it, and either do the next action or give it an owner and a date.
      </>,
      <>Then the cards whose next action is due today.</>,
      <>
        <P href="/ops/calendar">Calendar</P>: every survey and install today has a person on it.
      </>,
      <>
        <P href="/ops/messages">Messages</P>: anything that failed to send (red). Open it, fix the address or number, send it again.
      </>,
      <>Any issue or variation the crew raised yesterday: open the project → Issues. Answer questions, and price-check variations before they go to the customer.</>,
      <>
        <P href="/ops">Today</P>: the website leads whose follow-up is due today or overdue (each quote&apos;s next action). Do it, then mark it done or set the next one.
      </>,
    ],
  },
  {
    id: "before-survey",
    title: "Before a survey",
    when: "The day before, or when it's booked",
    steps: [
      <>The customer picks a slot in their portal, or you book it on the project.</>,
      <>Put a surveyor on it. It shows on their Today screen in the field app.</>,
      <>The customer gets a reminder the day before by itself. (If reminders never go, CRON_SECRET is missing: see <P href="/ops/launch">Launch</P>.)</>,
      <>Skim the project: the customer&apos;s own answers and photos from the quote, and the property record, so the surveyor knows what to expect.</>,
    ],
  },
  {
    id: "after-survey",
    title: "After a survey",
    when: "The same day if you can",
    steps: [
      <>The surveyor submits; the project moves to Design. Glance at how the customer&apos;s own answers compared with what was measured.</>,
      <>
        Tech lead: on the project, <B>Open the design</B>. Check the rule lights, pick the size for each room, confirm the outdoor unit. A multi-split only from a combination the catalogue lists as checked.
      </>,
      <>
        <B>Approve and sign</B>. That locks the layout photos the installers will work from.
      </>,
    ],
  },
  {
    id: "proposal",
    title: "Issuing a proposal",
    when: "Within the turnaround the customer was promised",
    steps: [
      <>
        On the project, <B>Build the proposal</B>: one option, or two (Standard and Quiet).
      </>,
      <>Check the cost build-up and the margin. A line without a cost needs one typed in (or an admin override, with a reason): access hire for a high bracket (tower, podium, scaffold or MEWP) is one, unless the catalogue or Settings → Safety has its price.</>,
      <>Pilot discount with its reason, the tax code, the date it&apos;s valid until.</>,
      <>A price above the customer&apos;s instant quote must say why, in words they&apos;ll read (&ldquo;you added a room&rdquo;).</>,
      <>
        <B>Issue proposal</B>. It emails the pre-contract information and the cancellation form. It won&apos;t issue until <P href="/ops/settings#company">Settings → Company</P> is complete, the customer has agreed to documents by email, and email works.
      </>,
      <>The customer accepts, asks for changes or declines in their portal. Accepting emails them the contract.</>,
    ],
  },
  {
    id: "booking",
    title: "Booking",
    when: "As soon as they accept",
    steps: [
      <>
        On the project, <B>Dates, crew and deposit</B>. Pick the install block on working days.
      </>,
      <>Crew: an installer, an F-gas tech lead and an electrician. It checks each person&apos;s qualifications are in date for what they&apos;ll sign.</>,
      <>
        Inside the 14-day cancellation period, only with the customer&apos;s own written request to start early: <B>Record their early-start email or form</B>. Otherwise book after the period ends.
      </>,
      <>A deposit, if Settings asks for one.</>,
      <>
        <B>Confirm booking and tell the customer</B>.
      </>,
    ],
  },
  {
    id: "kit",
    title: "Kit",
    when: "Straight after booking",
    steps: [
      <>
        On the project, <B>Raise purchase orders</B>: made from the approved design, one per supplier.
      </>,
      <>
        <B>Approve to order</B>, place the order with the supplier, then <B>Mark as ordered</B>, add their delivery date, <B>Mark as dispatched</B>, and <B>Record a delivery</B> when it arrives.
      </>,
      <>On the first morning the installer checks every box against the design. Damage or a shortage comes back to you as an issue.</>,
      <>
        <B>Open the checklist</B> (Compliance): everything approved, or marked not applicable, before install day. The Building Regulations route is a choice: a flat can&apos;t use a building notice, and a higher-risk building (7 storeys or 18 m and above) goes through our scheme or the Building Safety Regulator.
      </>,
    ],
  },
  {
    id: "install",
    title: "Install days",
    when: "Each day of the install",
    steps: [
      <>
        Morning: <P href="/ops/calendar">Calendar</P> shows who&apos;s where. The crew&apos;s &ldquo;on my way&rdquo; text shows in the project&apos;s Messages.
      </>,
      <>During the day the project&apos;s Install section shows the runsheet, the photos and the issues. Answer issues quickly: a blocking one holds the job.</>,
      <>
        A variation: check the price, then <B>Send to the customer for their OK</B>. Tell the crew not to start it until it says approved.
      </>,
      <>Evening: the installer&apos;s end-of-day update goes to the customer; you&apos;ll see it under the project&apos;s Messages.</>,
      <>Last day: the tech lead reviews anything flagged Needs review (a weighed charge far from what the as-built length needs among them) and signs commissioning on site.</>,
    ],
  },
  {
    id: "handover",
    title: "Handover",
    when: "The last day, and the week after",
    steps: [
      <>Once commissioning is signed, the customer&apos;s handover pack is published to their portal.</>,
      <>The customer signs All good, or There&apos;s a snag. Each snag is an issue with an owner and a date: get it fixed, then close it.</>,
      <>The electrical certificate, in the project&apos;s Handover box: upload it, or mark it pending from the scheme with a date to chase.</>,
      <>Warranty registration, in the same box, has a date to register by: register with the manufacturer, then record it there.</>,
      <>The heat pump&apos;s own Building Regulations certificate goes on its checklist item: the team is alerted weekly once it&apos;s 30 days late, like the electrical one.</>,
      <>
        Each year: the family gets the service reminder 30 days before it&apos;s due. When a service is done, <B>Record a service visit</B> in the Aftercare box: the next reminder counts from it. Moved house? <B>Close aftercare</B>.
      </>,
    ],
  },
  {
    id: "money",
    title: "Money",
    when: "Whenever money moves, and in the morning email",
    steps: [
      <>
        On the project, <B>Invoices and payments</B>. The balance follows the agreed terms: <B>Issue and email</B>.
      </>,
      <>
        A bank transfer: once you can see it in the bank, <B>Record a payment you&apos;ve seen</B>. Never before.
      </>,
      <>Card payments record themselves from Stripe. Refund a card payment in Stripe&apos;s dashboard: it&apos;s recorded here by itself, so don&apos;t record it by hand too.</>,
      <>Never change bank details because an email asks. Customers only ever see them in their portal and on the invoice.</>,
      <>
        A family cancelled inside the period after asking us to start early, and work had begun: on <B>Money</B>, <B>The charge for the work done before they cancelled</B>. Type the charge and how you worked it out (the work only, never the equipment), then <B>Record the charge, invoice it and email them</B>. It says the refund, or what&apos;s left for them to pay.
      </>,
      <>
        <B>Close the project</B> once it&apos;s paid, the warranty&apos;s registered, the electrical certificate is in and no serious defect is open.
      </>,
    ],
  },
  {
    id: "friday",
    title: "Every Friday: pilots review",
    when: "30 minutes, with whoever was on site",
    steps: [
      <>
        <P href="/ops/pilots">Pilots</P>: the pilots side by side. Instant price against list and final, hours against the estimate, defects, how happy the customer is.
      </>,
      <>
        Each job&apos;s Kit page: type in what the supplier actually charged and <B>Save actual costs</B>, so the margin is real. Its Time page shows the hours logged.
      </>,
      <>Read the week&apos;s end-of-day answers (Learnings, on each project): what took longer, what was missing, what confused the customer.</>,
      <>Pick one to three changes (a checklist step, a catalogue price, a survey question) and make them before Monday.</>,
      <>Download the CSV from Pilots and keep it.</>,
      <>
        <P href="/ops/launch">Launch</P> is still all green.
      </>,
    ],
    note: <>Lessons go into the checklists and settings before the next install, so each pilot runs better than the one before.</>,
  },
];

export default async function OpsHelpPage() {
  await requireStaff("projects.view-all");
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Help"
        title="The daily routine"
        subtitle="What to check every morning, and what to do at each stage of a job, in the order the job goes."
        actions={
          <Link href="/ops/projects" className="inline-flex min-h-11 items-center rounded-full bg-accent-700 px-5 font-semibold text-white">
            Open the Board
          </Link>
        }
      />

      <nav aria-label="On this page" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          {ROUTINES.map((r) => (
            <li key={r.id}>
              <a href={`#${r.id}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface">
                {r.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-5">
        {ROUTINES.map((r) => (
          <Card as="section" key={r.id} id={r.id} aria-labelledby={`${r.id}-title`} className="scroll-mt-24">
            <h2 id={`${r.id}-title`} className="font-display text-2xl text-ink-900">
              {r.title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">{r.when}</p>
            <ol className="mt-4 space-y-3">
              {r.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-base text-ink-900">
                  <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ol>
            {r.note && <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-sm text-ink-700">{r.note}</p>}
          </Card>
        ))}
      </div>

      <p className="mt-8 text-sm text-ink-500">
        Something looks broken? <P href="/ops/status">Status</P> checks the database and every setting. The installers&apos; own guide is at <P href="/field/help">/field/help</P>.
      </p>
    </main>
  );
}
