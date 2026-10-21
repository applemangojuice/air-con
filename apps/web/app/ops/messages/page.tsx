import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { COMMS_EVENTS, can, type CommsEventId, type MessageRecord } from "@aircon/domain";
import { Badge, StatusChip } from "@/components/kit/badge";
import { buttonClass } from "@/components/kit/button";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { Tabs } from "@/components/kit/tabs";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import { Disclosure, ResendForm } from "@/components/ops/command/forms";
import { fmtInstant } from "@/components/ops/command/model";
import { MessageBody } from "@/components/ops/command/sections";
import { requireStaff } from "@/lib/auth/server";
import { appMode } from "@/lib/env-mode";
import { COMMS_EVENT_IDS, projectNames } from "@/lib/ops-core-server";
import { listRecent, type StoredMessage } from "@/lib/repo/messages";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";
import { resendMessageAction } from "../projects/[id]/actions";
import { runDailyJobsAction, toggleEventAction } from "./actions";
import { ALWAYS_ON } from "./always-on";

export const metadata: Metadata = { title: "Messages · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUSES: MessageRecord["status"][] = ["sent", "demo", "queued", "failed", "skipped"];
const plain = (s: string) => {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : s;
};
const LIMIT = 200;

/**
 * Every message the platform has sent or recorded (plan §5): the outbox
 * log with previews and resend, the templates with their on/off switch,
 * and the daily jobs, runnable by hand.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff("projects.view-all");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") === "templates" ? "templates" : "log";
  const status = STATUSES.includes(one("status") as MessageRecord["status"]) ? (one("status") as MessageRecord["status"]) : undefined;
  const channel = one("channel") === "sms" || one("channel") === "email" ? (one("channel") as "sms" | "email") : undefined;
  const event = COMMS_EVENT_IDS.includes(one("event") as CommsEventId) ? (one("event") as CommsEventId) : undefined;
  const canSend = can(staff, "messages.send");
  const canSettings = can(staff, "settings.edit");
  const mode = appMode();

  if (!getServiceClient()) {
    return (
      <Shell tab={tab} canRun={false}>
        <EmptyState title="No database connected" body="Messages are recorded in the database, so there's no log in demo mode." />
      </Shell>
    );
  }

  if (tab === "templates") {
    const settings = await getSettings();
    const disabled = new Set(settings.comms.disabledEvents);
    return (
      <Shell tab={tab} canRun={canSettings}>
        <p className="mb-4 text-sm text-ink-500">
          Every message we send, what triggers it and who gets it. Turning one off stops new sends at once; ones already queued are skipped.
          {!settings.company.reviewUrl && " The review request only goes out once there's a review link in Settings."}
        </p>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {COMMS_EVENT_IDS.map((id) => {
            const def = COMMS_EVENTS[id];
            const off = disabled.has(id);
            const locked = ALWAYS_ON[id];
            return (
              <li key={id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {plain(id)}{" "}
                    {off ? <Badge tone="neutral">Off</Badge> : <Badge tone="success">On</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">{def.description}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {def.channels.map((c) => (c === "sms" ? "SMS" : "Email")).join(" + ")} · to the {def.audience} ·{" "}
                    {def.trigger === "cron" ? "daily job" : def.trigger === "manual" ? "sent by hand" : "sent automatically"} · template v{def.templateVersion}
                  </p>
                </div>
                <div className="shrink-0">
                  {locked ? (
                    <p className="max-w-[14rem] text-xs text-ink-500">Always on: {locked}</p>
                  ) : canSettings ? (
                    <ActionForm action={toggleEventAction}>
                      <input type="hidden" name="event" value={id} />
                      <input type="hidden" name="on" value={off ? "1" : "0"} />
                      <SubmitButton variant={off ? "primary" : "secondary"} busyLabel="…">
                        {off ? "Turn on" : "Turn off"}
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Shell>
    );
  }

  let messages: StoredMessage[] = [];
  let failed = false;
  try {
    messages = await listRecent(LIMIT, { ...(status ? { status } : {}), ...(channel ? { channel } : {}), ...(event ? { event } : {}) });
  } catch (err) {
    console.error("[messages] list failed:", err);
    failed = true;
  }
  const names = await projectNames(messages.map((m) => m.projectId).filter((x): x is string => Boolean(x))).catch(() => new Map());
  const filtering = Boolean(status || channel || event);

  return (
    <Shell tab={tab} canRun={canSettings}>
      {(mode.email === "demo" || mode.sms === "demo") && (
        <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {mode.email === "demo" && mode.sms === "demo"
            ? "Email and SMS aren't set up here: messages are recorded as “Demo, not sent” and nobody receives them."
            : mode.email === "demo"
              ? "Email isn't set up here: emails are recorded as “Demo, not sent”."
              : "SMS isn't set up here: texts are recorded as “Demo, not sent”."}
        </p>
      )}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white p-3" aria-label="Filter messages">
        <label className="text-xs font-semibold text-ink-700">
          Status
          <select name="status" defaultValue={status ?? ""} className="mt-1 block min-h-10 rounded-xl border border-line bg-white px-3 text-sm">
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "demo" ? "Demo, not sent" : plain(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-700">
          Channel
          <select name="channel" defaultValue={channel ?? ""} className="mt-1 block min-h-10 rounded-xl border border-line bg-white px-3 text-sm">
            <option value="">Any</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label className="min-w-0 text-xs font-semibold text-ink-700">
          Message
          <select name="event" defaultValue={event ?? ""} className="mt-1 block min-h-10 max-w-full rounded-xl border border-line bg-white px-3 text-sm">
            <option value="">Any</option>
            {COMMS_EVENT_IDS.map((e) => (
              <option key={e} value={e}>
                {plain(e)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Filter
        </button>
        {filtering && (
          <Link href="/ops/messages" className="inline-flex min-h-10 items-center px-2 text-sm font-semibold text-accent-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {failed ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          The message log couldn&apos;t load. Reload in a moment.
        </p>
      ) : messages.length === 0 ? (
        <EmptyState title={filtering ? "No messages match" : "No messages yet"} body={filtering ? "Try a different filter." : "Messages appear here as soon as anything is sent or recorded."} />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-500">
            {messages.length === LIMIT ? `The latest ${LIMIT}` : `${messages.length} message${messages.length === 1 ? "" : "s"}`}, newest first.
          </p>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {messages.map((m) => {
              const project = m.projectId ? names.get(m.projectId) : undefined;
              return (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-semibold text-ink-900">{plain(m.event)}</span>
                        <span className="text-ink-500"> · {m.channel === "sms" ? "SMS" : "Email"} to </span>
                        <span className="break-all text-ink-700">{m.to}</span>
                      </p>
                      {m.projectId && (
                        <Link href={`/ops/projects/${m.projectId}#messages`} className="text-xs font-semibold text-accent-700 hover:underline">
                          {project ? `${project.name}${project.pilot ? ` · Pilot ${project.pilot}` : ""}` : "Project"}
                        </Link>
                      )}
                    </div>
                    <span className="flex items-center gap-2 text-xs text-ink-500">
                      {m.sentAt ? `Sent ${fmtInstant(m.sentAt)}` : m.scheduledFor && m.status === "queued" ? `Due ${fmtInstant(m.scheduledFor)}` : fmtInstant(m.createdAt)}
                      {m.attempts > 1 && <span>· {m.attempts} tries</span>}
                      <StatusChip status={m.status} />
                    </span>
                  </div>
                  {m.error && m.status !== "sent" && <p className="mt-1 text-xs text-red-700">{m.error}</p>}
                  <Disclosure summary="Preview">
                    <MessageBody html={m.channel === "email" ? m.bodyHtml : undefined} text={m.bodyText} subject={m.subject} />
                    {canSend && m.event !== "magic-link" && (
                      <div className="mt-2">
                        <ResendForm action={resendMessageAction} messageId={m.id} label={m.status === "sent" ? "Send again" : "Retry"} />
                      </div>
                    )}
                  </Disclosure>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, tab, canRun }: { children: ReactNode; tab: "log" | "templates"; canRun: boolean }) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader title="Messages" subtitle="Every email and text: what went, to whom, and whether a provider took it." />
      {canRun && (
        <section className="mb-6 rounded-2xl border border-line bg-white p-4" aria-labelledby="daily">
          <h2 id="daily" className="text-sm font-semibold text-ink-900">
            Daily jobs
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Reminders, proposal nudges and expiries, aftercare and outbox retries. They run every afternoon on their own; running them now is safe, nothing is sent twice.
          </p>
          <ActionForm action={runDailyJobsAction} className="mt-3">
            <SubmitButton variant="secondary" busyLabel="Running…">
              Run daily jobs now
            </SubmitButton>
          </ActionForm>
        </section>
      )}
      <Tabs
        label="Messages"
        current={tab === "templates" ? "/ops/messages?tab=templates" : "/ops/messages"}
        tabs={[
          { href: "/ops/messages", label: "Log" },
          { href: "/ops/messages?tab=templates", label: "Templates" },
        ]}
      />
      {children}
    </main>
  );
}
