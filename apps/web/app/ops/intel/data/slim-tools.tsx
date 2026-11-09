"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SIZE_SQL = `select
  pg_size_pretty(pg_total_relation_size('public.properties')) as homes,
  pg_size_pretty(pg_total_relation_size('public.property_assessments')) as history,
  pg_size_pretty(pg_database_size(current_database())) as whole_database;`;

const COMPACT_SQL = `vacuum full public.properties;
vacuum full public.property_assessments;`;

async function post(body: object) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch("/api/ops/intel/slim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if (res.status < 500 || attempt >= 4) throw new Error(data.error ?? `Error ${res.status}`);
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

function Sql({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-xl bg-ink-900 p-3 text-xs text-white">{text}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white hover:bg-white/25"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SlimTools({ total, needSlimming, notes }: { total: number; needSlimming: number; notes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"slim" | "notes" | null>(null);
  const [scanned, setScanned] = useState(0);
  const [changed, setChanged] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [didSomething, setDidSomething] = useState(false);

  async function slim() {
    setBusy("slim");
    setMessage(null);
    setScanned(0);
    setChanged(0);
    let after: string | null = "";
    let s = 0;
    let c = 0;
    try {
      while (after !== null) {
        const r: { scanned: number; changed: number; next: string | null } = await post({ action: "slim", after });
        s += r.scanned;
        c += r.changed;
        setScanned(s);
        setChanged(c);
        after = r.next;
      }
      setMessage(`Done: ${c.toLocaleString("en-GB")} of ${s.toLocaleString("en-GB")} homes slimmed. Now compact the tables (below) to get the space back.`);
      setDidSomething(true);
    } catch (err) {
      setMessage(`${err instanceof Error ? err.message : String(err)}. Press the button again: it's safe to repeat, homes already slimmed are skipped.`);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function clearNotes() {
    if (!window.confirm(`Remove ${notes.toLocaleString("en-GB")} bulk-import history notes? Audits and other history stay.`)) return;
    setBusy("notes");
    setMessage(null);
    try {
      const r: { removed: number } = await post({ action: "clear-notes" });
      setMessage(`Removed ${r.removed.toLocaleString("en-GB")} notes. Now compact the tables (below) to get the space back.`);
      setDidSomething(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const pct = total ? Math.min(100, (scanned / total) * 100) : 0;

  return (
    <section className="mt-8 space-y-4 rounded-2xl border border-line p-5">
      <h2 className="font-bold">Make the book smaller</h2>

      <div>
        <p className="text-sm">
          <strong>1. Remove unused details from saved homes.</strong> Takes out the details marked &ldquo;Not used&rdquo;,
          empty values and the &ldquo;England and Wales:&rdquo; prefix on age bands. About{" "}
          {needSlimming.toLocaleString("en-GB")} homes need it. Safe to stop and repeat.
        </p>
        <button
          type="button"
          disabled={busy !== null || needSlimming === 0}
          onClick={() => void slim()}
          className="mt-2 rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
        >
          {busy === "slim" ? "Slimming…" : needSlimming === 0 ? "Nothing to slim" : "Remove unused details"}
        </button>
        {(busy === "slim" || scanned > 0) && (
          <div className="mt-2 space-y-1" role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-accent-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-ink-600">
              {scanned.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")} homes checked, {changed.toLocaleString("en-GB")} slimmed
            </p>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm">
          <strong>2. Remove the bulk-import history notes.</strong> One short note per home from earlier imports (
          {notes.toLocaleString("en-GB")} of them). The certificate date is on each home already; new imports don&apos;t
          write them.
        </p>
        <button
          type="button"
          disabled={busy !== null || notes === 0}
          onClick={() => void clearNotes()}
          className="mt-2 rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700 disabled:opacity-50"
        >
          {busy === "notes" ? "Removing…" : notes === 0 ? "No notes to remove" : "Remove the notes"}
        </button>
      </div>

      {message && (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className={didSomething ? "rounded-2xl border border-accent-200 bg-accent-50/40 p-4" : ""}>
        <p className="text-sm">
          <strong>3. Compact the tables in Supabase.</strong> The database keeps the space of changed or removed rows
          until it&apos;s compacted, so the size only drops after this. In Supabase, open <strong>SQL Editor</strong> →{" "}
          <strong>New query</strong>, paste, and press <strong>Run</strong>. It locks the two tables for a few seconds to a
          minute; run it when nobody is mid-quote.
        </p>
        <Sql text={COMPACT_SQL} />
        <p className="mt-3 text-sm">To see the exact sizes, before and after:</p>
        <Sql text={SIZE_SQL} />
      </div>
    </section>
  );
}
