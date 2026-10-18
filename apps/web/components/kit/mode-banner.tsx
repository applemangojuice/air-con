import { appMode, isFullyLive, type AppMode } from "@/lib/env-mode";

/**
 * The honesty strip (contract §A5): whenever anything in this deployment
 * isn't live, every staff screen says what and what that means. Nothing
 * renders when it's all live. Server component: it reads the environment.
 *
 * Not exported from the kit index, because env-mode reaches the database
 * module (Node-only); import it from "@/components/kit/mode-banner".
 */

function notes(mode: AppMode): { label: string; detail: string; serious: boolean }[] {
  const out: { label: string; detail: string; serious: boolean }[] = [];
  if (mode.data === "demo") out.push({ label: "DEMO", detail: "No database: nothing is saved", serious: true });
  else if (mode.data !== "supabase") out.push({ label: "LOCAL DATA", detail: `Records are kept in ${mode.data === "file" ? "local files" : "memory"}`, serious: false });
  if (mode.email === "demo") out.push({ label: "EMAIL DEMO", detail: "Emails are recorded, not sent", serious: false });
  if (mode.sms === "demo") out.push({ label: "SMS DEMO", detail: "Texts are recorded, not sent", serious: false });
  if (mode.payments === "test") out.push({ label: "TEST MODE", detail: "Card payments use Stripe test keys: no real money moves", serious: false });
  else if (mode.payments === "demo") out.push({ label: "PAYMENTS DEMO", detail: "No card payments: bank transfers are recorded by hand", serious: false });
  return out;
}

export function ModeBanner({ className = "" }: { className?: string }) {
  const mode = appMode();
  if (isFullyLive(mode)) return null;
  const items = notes(mode);
  if (items.length === 0) return null;
  const serious = items.some((i) => i.serious);
  return (
    <div
      role="note"
      aria-label="This deployment isn't fully live"
      className={`no-print border-b px-4 py-1.5 text-xs ${serious ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"} ${className}`.trim()}
    >
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
        {items.map((i) => (
          <li key={i.label} title={i.detail}>
            <span className="font-bold tracking-wide">{i.label}</span>
            {/* Phones get the labels only, so the strip stays one or two lines. */}
            <span className="hidden sm:inline"> {i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
