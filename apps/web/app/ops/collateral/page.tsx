import Link from "next/link";
import type { Metadata } from "next";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Collateral · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Everything printable: the mailing letter, the door-drop card, the
 * investor one-pager, plus the digital share card. Each piece opens as a
 * page — Cmd/Ctrl+P turns it into the artefact (app chrome hides itself).
 */
const pieces = [
  {
    title: "Mailing letter (A4)",
    href: "/ops/collateral/letter",
    body: "The street-by-street letter. Open plain for the mail-merge template («merge fields» marked), or add ?intel=<property-id> for a print-ready proof of any address in the book, priced by the live engine.",
    tag: "Direct mail",
  },
  {
    title: "Door-drop card (A5)",
    href: "/ops/collateral/card",
    body: "Two-sided unaddressed card for whole-street drops: the hook on the front, the five reasons and the URL on the back. Print to PDF gives the printer both sides.",
    tag: "Direct mail",
  },
  {
    title: "Investor one-pager (A4)",
    href: "/ops/collateral/one-pager",
    body: "Problem, product, moat, the numbers and the ask on one page. Every figure is computed from the live operating model — retune /ops/finance, reprint this, nothing drifts.",
    tag: "Fundraising",
  },
  {
    title: "Social share card",
    href: "/opengraph-image",
    body: "The designed 1200×630 card that WhatsApp, iMessage, Slack and LinkedIn show when anyone shares a link to the site. Rendered live from brand tokens.",
    tag: "Digital",
  },
];

export default async function CollateralPage() {
  // A real property id makes the letter-proof link one click instead of a hunt.
  let proofId: string | null = null;
  const supabase = getServiceClient();
  if (supabase) {
    const { data } = await supabase
      .from("properties")
      .select("id")
      .order("priority_score", { ascending: false })
      .limit(1)
      .maybeSingle();
    proofId = data?.id ?? null;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Collateral</h1>
          <p className="mt-1 text-sm text-ink-500">
            Print-ready pieces, all generated from the live platform. Open one, hit print.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {pieces.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="group rounded-2xl border border-line bg-white p-6 transition hover:border-accent-400 hover:shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold group-hover:text-accent-700">{p.title}</h2>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-500">
                {p.tag}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">{p.body}</p>
            <span className="mt-3 inline-block text-sm font-semibold text-accent-700">
              Open →
            </span>
          </Link>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
        <p className="font-semibold text-ink-900">The mailing workflow</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Build the target list on{" "}
            <Link href="/ops/intel" className="text-accent-700 hover:underline">
              Property intelligence
            </Link>{" "}
            and download the mailing CSV (one row per home, with its personal /a/ link).
          </li>
          <li>
            Give the mail house the CSV and the{" "}
            <Link href="/ops/collateral/letter" className="text-accent-700 hover:underline">
              letter template
            </Link>
            {proofId && (
              <>
                {" "}
                (here&apos;s a{" "}
                <Link
                  href={`/ops/collateral/letter?intel=${proofId}`}
                  className="text-accent-700 hover:underline"
                >
                  proof of your highest-priority address
                </Link>
                )
              </>
            )}
            .
          </li>
          <li>
            Tag the list as mailed on /ops/intel (campaign name), and add{" "}
            <code>?utm_source=mail&amp;utm_campaign=&lt;name&gt;</code> to any printed links so
            responses attribute themselves in{" "}
            <Link href="/ops/analytics" className="text-accent-700 hover:underline">
              analytics
            </Link>
            .
          </li>
        </ol>
      </section>
    </main>
  );
}
