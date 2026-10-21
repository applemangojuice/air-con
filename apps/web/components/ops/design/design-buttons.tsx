"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftDesignAction, relockLayoutAction } from "@/app/ops/projects/[id]/design/actions";
import { Button } from "@/components/kit";

/** "Draft the design" (first time) or "Re-draft from the survey" (after a re-survey), with an optional brand. */
export function DraftDesignButton({
  projectId,
  brands,
  label = "Draft the design",
  confirm,
  variant = "primary",
}: {
  projectId: string;
  brands: string[];
  label?: string;
  /** Ask before replacing choices that are already made. */
  confirm?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () => {
    if (confirm && !asking) return setAsking(true);
    setError(null);
    start(async () => {
      try {
        const r = await draftDesignAction(projectId, brand || undefined);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't reach the server. Nothing was changed; try again when you have signal.");
      }
    });
  };
  return (
    <div className="flex flex-col items-center gap-3 sm:items-start">
      {brands.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
          Brand
          <select className="min-h-10 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink-900" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Best fit for each option</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      )}
      {asking && <p className="text-sm font-medium text-amber-900">{confirm} Press again to go ahead.</p>}
      <Button variant={asking ? "danger" : variant} onClick={run} busy={pending} busyLabel="Drafting…">
        {asking ? "Yes, re-draft it" : label}
      </Button>
      <p aria-live="polite" className="text-sm font-medium text-red-700">
        {error}
      </p>
    </div>
  );
}

export function RelockButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        busy={pending}
        busyLabel="Locking…"
        onClick={() =>
          start(async () => {
            try {
              const r = await relockLayoutAction(projectId);
              if (!r.ok) setError(r.error);
              else router.refresh();
            } catch {
              setError("Couldn't reach the server. Try again when you have signal.");
            }
          })
        }
      >
        Lock them now
      </Button>
      <span aria-live="polite" className="text-sm font-medium text-red-700">
        {error}
      </span>
    </span>
  );
}
