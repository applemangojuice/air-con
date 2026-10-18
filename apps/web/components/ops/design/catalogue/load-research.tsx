"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { loadResearchedCatalogueAction } from "@/app/ops/catalogue/actions";
import { Button, Checkbox } from "@/components/kit";
import { fmtDate } from "@/lib/format";

/**
 * "Load researched catalogue": upserts the research seed. Anything already
 * stored is kept (costs, edits, retirements) unless "overwrite" is ticked,
 * which needs a second, explicit confirmation.
 */
export function LoadResearch({ researchedAt, caveats, empty = false }: { researchedAt: string; caveats: string[]; empty?: boolean }) {
  const router = useRouter();
  const [overwrite, setOverwrite] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = () => {
    if (overwrite && !confirming) {
      setConfirming(true);
      return;
    }
    setMessage(null);
    start(async () => {
      try {
        const r = await loadResearchedCatalogueAction(overwrite);
        if (!r.ok) {
          setMessage({ tone: "error", text: r.errors.join(" ") });
          return;
        }
        const { items, rules } = r.value;
        const parts = [
          `Added ${items.added} item${items.added === 1 ? "" : "s"} and ${rules.added} rule${rules.added === 1 ? "" : "s"}.`,
          items.replaced || rules.replaced ? `Replaced ${items.replaced} items and ${rules.replaced} rules with the research.` : "",
          items.kept || rules.kept ? `Kept ${items.kept} items and ${rules.kept} rules exactly as they were.` : "",
        ];
        setMessage({ tone: "ok", text: parts.filter(Boolean).join(" ") });
        setConfirming(false);
        setOverwrite(false);
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "Couldn't reach the server. Nothing was changed; try again when you have signal." });
      }
    });
  };

  return (
    <div className={empty ? "mx-auto max-w-xl text-left" : ""}>
      {!empty && <h2 className="font-display text-xl text-ink-900">Researched catalogue</h2>}
      <p className={`text-sm text-ink-500 ${empty ? "" : "mt-1.5"}`}>
        Researched {fmtDate(researchedAt)}. Loading adds anything missing and leaves what's already here untouched.
      </p>
      <details className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <summary className="cursor-pointer font-semibold">What the research says to be careful about</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </details>
      <Checkbox
        className="mt-2"
        checked={overwrite}
        onChange={(e) => {
          setOverwrite(e.target.checked);
          setConfirming(false);
        }}
        label="Overwrite items that are already here"
        hint="Replaces costs, edits and retirements on researched items with the research. Your own items aren't touched."
      />
      {confirming && (
        <p role="alert" className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          This replaces any supplier prices and edits on researched items. Press the button again to go ahead.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={run} busy={pending} busyLabel="Loading…" variant={confirming ? "danger" : "primary"}>
          {confirming ? "Yes, overwrite and load" : "Load researched catalogue"}
        </Button>
      </div>
      <p aria-live="polite" className={`mt-3 text-sm ${message?.tone === "error" ? "font-medium text-red-700" : "text-emerald-800"}`}>
        {message?.text}
      </p>
    </div>
  );
}
