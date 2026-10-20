import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { quoteRow } from "./helpers/rows.ts";

/**
 * The unfinished-quote reminder (api/cron/follow-up) and the leads' chase
 * list (lib/lead-follow-ups): who may be reminded, that nobody is reminded
 * twice or past the email budget, what the email says, and which scheduled
 * follow-ups the console and the digest list. The real route on the
 * in-memory backend; Resend stood in for. DEMO addresses only.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { FOLLOW_UPS_PER_RUN, followUpLines, followUpMailto, pickFollowUps, reminderAllowed, reminderRecord, reminderState } = await import("../lib/follow-up.ts");
const { REMINDER_NOTICE, REMINDER_NOTICE_VERSION } = await import("../lib/follow-up-notice.ts");
const { EMAIL_BUDGET } = await import("../lib/email-budget.ts");
const { dueLeadCutoff, loadDueLeads, toDueLeads } = await import("../lib/lead-follow-ups.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const followUpRoute = await import("../app/api/cron/follow-up/route.ts");
const draftRoute = await import("../app/api/quotes/draft/route.ts");

const AT = "2026-10-20T10:00:00.000Z";
const allowed = { reminder: { ok: true, version: REMINDER_NOTICE_VERSION, at: AT } };

test("a draft records the reminder box only with the wording it showed; only a ticked one is reminded", () => {
  assert.deepEqual(reminderRecord({ reminder: true, reminderNotice: REMINDER_NOTICE_VERSION }, AT), { ok: true, version: REMINDER_NOTICE_VERSION, at: AT });
  assert.deepEqual(reminderRecord({ reminder: false, reminderNotice: REMINDER_NOTICE_VERSION }, AT), { ok: false, version: REMINDER_NOTICE_VERSION, at: AT });
  assert.equal(reminderRecord({ reminder: true }, AT), null, "a page (or script) that never showed the box");
  assert.equal(reminderRecord({ reminder: true, reminderNotice: "draft-reminder-0" }, AT), null, "older wording");
  assert.equal(reminderRecord({ reminderNotice: REMINDER_NOTICE_VERSION }, AT), null, "no answer");

  assert.equal(reminderState(allowed), "allowed");
  assert.equal(reminderState({ reminder: { ok: false, version: REMINDER_NOTICE_VERSION, at: AT } }), "refused");
  assert.equal(reminderState(null), "unknown", "a draft from before the box");
  assert.equal(reminderState({ consents: { marketing: true } }), "unknown", "a finished quote's attribution");
  assert.equal(reminderState({ reminder: { ok: true, version: "draft-reminder-0" } }), "unknown");
  assert.equal(reminderState({ reminder: { ok: "yes", version: REMINDER_NOTICE_VERSION } }), "unknown");
  assert.equal(reminderAllowed(allowed), true);
  assert.equal(reminderAllowed({ reminder: { ok: false, version: REMINDER_NOTICE_VERSION } }), false);
});

test("pickFollowUps: ticked only, one per person, never someone who finished or was already reminded, capped", () => {
  const d = (id: string, email: string, created_at: string, attribution: unknown = allowed) => ({ id, email, postcode: "SW16 2BE", created_at, attribution });
  const drafts = [
    d("a1", "ada@example.test", "2026-10-15T09:00:00Z"),
    d("a2", "Ada@Example.test", "2026-10-16T09:00:00Z"), // the same person, newer draft
    d("b", "bo@example.test", "2026-10-15T10:00:00Z", { reminder: { ok: false, version: REMINDER_NOTICE_VERSION, at: AT } }),
    d("c", "cy@example.test", "2026-10-15T11:00:00Z", null),
    d("e", "eve@example.test", "2026-10-15T12:00:00Z"),
    d("f", "fay@example.test", "2026-10-15T13:00:00Z"),
    d("g", "gus@example.test", "2026-10-14T13:00:00Z"),
  ];
  const related = [
    { email: "EVE@example.test", status: "new", follow_up_sent_at: null }, // finished on another device
    { email: "fay@example.test", status: "draft", follow_up_sent_at: "2026-10-10T10:00:00Z" }, // reminded about an older draft
    { email: "ada@example.test", status: "draft", follow_up_sent_at: null },
  ];
  assert.deepEqual(pickFollowUps(drafts, related).map((x) => x.id), ["g", "a2"], "oldest first; Ada's newest draft only");
  assert.deepEqual(pickFollowUps(drafts, related, 1).map((x) => x.id), ["g"]);
  assert.deepEqual(pickFollowUps(drafts, related, 0), []);
  assert.equal(FOLLOW_UPS_PER_RUN, 10);
});

test("the reminder says why it came, that it's the only one, and how to have the quote deleted", () => {
  const lines = followUpLines("SW16 2BE", "hello@demo.dang.invalid");
  const why = lines.find((l) => l.startsWith("You're getting this"));
  assert.ok(why, "an opt-out line");
  assert.ok(why!.includes(`"${REMINDER_NOTICE.label}"`), "names the box they left ticked");
  assert.match(why!, /We won't email you about it again\. To have your unfinished quote deleted, reply to this email or write to hello@demo\.dang\.invalid\./);
  assert.ok(lines.some((l) => /this is the only nudge we'll send/.test(l)));
  assert.match(followUpLines("SW16 2BE").join("\n"), /write to hello@dang\.ac\./, "the brand address when settings have none");
  assert.ok(decodeURIComponent(followUpMailto("ada@example.test", "SW16 2BE", "hello@demo.dang.invalid")).includes("write to hello@demo.dang.invalid"));
});

/* ---------------------------------------------------------------- */
/* The route                                                          */
/* ---------------------------------------------------------------- */

const ENV = { RESEND_API_KEY: "re_demo_followup_test_key_123", EMAIL_FROM: "DEMO <hello@demo.dang.invalid>", CRON_SECRET: "demo-cron-secret-for-follow-up-tests-0123456789" };

async function withLiveEmail(fn: (sent: { to: string; html: string }[]) => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  const original = globalThis.fetch;
  const sent: { to: string; html: string }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes("api.resend.com")) return original(url as never, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as { to: string | string[]; html: string };
    sent.push({ to: Array.isArray(body.to) ? body.to[0]! : body.to, html: body.html });
    return new Response(JSON.stringify({ id: `re_demo_${sent.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    await fn(sent);
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const cron = () => followUpRoute.GET(new Request("http://localhost/api/cron/follow-up", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }));

test("the daily reminder: only ticked drafts, nobody twice, at most 10 a run, and never past its email budget", async () => {
  const db = requireDb();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
  const rows = [
    // 15 people who left the box ticked, each a day or two into their 7-day window.
    ...Array.from({ length: 15 }, (_, i) =>
      quoteRow({ email: `ticked${String(i).padStart(2, "0")}@example.test`, status: "draft", created_at: new Date(Date.parse(twoDaysAgo) - i * 60_000).toISOString(), attribution: allowed }),
    ),
    quoteRow({ email: "unticked@example.test", status: "draft", created_at: twoDaysAgo, attribution: { reminder: { ok: false, version: REMINDER_NOTICE_VERSION, at: AT } } }),
    quoteRow({ email: "before-the-box@example.test", status: "draft", created_at: twoDaysAgo, attribution: null }),
    quoteRow({ email: "finished@example.test", status: "draft", created_at: twoDaysAgo, attribution: allowed }),
    quoteRow({ email: "finished@example.test", status: "new", created_at: twoDaysAgo }),
    quoteRow({ email: "reminded@example.test", status: "draft", created_at: twoDaysAgo, attribution: allowed }),
    quoteRow({ email: "reminded@example.test", status: "draft", created_at: new Date(Date.now() - 6 * 24 * 3600_000).toISOString(), follow_up_sent_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString() }),
    quoteRow({ email: "too-new@example.test", status: "draft", created_at: new Date().toISOString(), attribution: allowed }),
  ];
  const { error } = await db.from("quote_requests").insert(rows);
  assert.equal(error, null);

  await withLiveEmail(async (sent) => {
    const first = await (await cron()).json();
    assert.equal(first.ok, true);
    assert.equal(first.sent, FOLLOW_UPS_PER_RUN, "at most 10 a run");
    assert.equal(sent.length, FOLLOW_UPS_PER_RUN);
    assert.ok(sent.every((m) => /^ticked\d\d@example\.test$/.test(m.to)), `only ticked drafts: ${sent.map((m) => m.to).join(", ")}`);
    assert.equal(new Set(sent.map((m) => m.to)).size, sent.length, "one each");
    assert.ok(sent.every((m) => m.html.includes("To have your unfinished quote deleted")), "every one carries the opt-out line");

    // The same day again: the follow-up budget (10 a day) is spent, so the
    // other five wait for tomorrow, released, with nothing sent.
    const second = await (await cron()).json();
    assert.equal(second.ok, true);
    assert.equal(second.sent, 0);
    assert.equal(second.heldBack, 15 - FOLLOW_UPS_PER_RUN);
    assert.equal(sent.length, FOLLOW_UPS_PER_RUN, "nothing more sent");
    assert.equal(EMAIL_BUDGET["follow-up"].perDay, FOLLOW_UPS_PER_RUN);
    const { data: waiting } = await db.from("quote_requests").select("email").like("email", "ticked%").is("follow_up_sent_at", null);
    assert.equal(waiting?.length, 5, "held back, not marked sent: they're reminded on a later run");
  });

  const { data: untouched } = await db.from("quote_requests").select("email, follow_up_sent_at").in("email", ["unticked@example.test", "before-the-box@example.test", "finished@example.test", "too-new@example.test"]);
  assert.ok(untouched?.every((r) => r.follow_up_sent_at === null), "never claimed");
});

test("a draft save stores the reminder answer only with the current wording", async () => {
  const db = requireDb();
  const survey = { postcode: "SW16 2BE", addressLine: "1 Demo Street", property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" }, rooms: [], outdoor: { location: "ground-rear", photos: [] }, electrics: { condition: "unsure", photos: [] } };
  const save = async (email: string, extra: Record<string, unknown>, ip: string) => {
    const r = await draftRoute.POST(new Request("http://localhost/api/quotes/draft", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, survey, ...extra }) }));
    assert.equal(r.status, 200, await r.clone().text());
    const { id } = (await r.json()) as { id: string };
    const { data } = await db.from("quote_requests").select("attribution").eq("id", id).single();
    return (data as { attribution: unknown }).attribution;
  };
  assert.equal(reminderState(await save("yes@example.test", { reminder: true, reminderNotice: REMINDER_NOTICE_VERSION }, "198.51.100.1")), "allowed");
  assert.equal(reminderState(await save("no@example.test", { reminder: false, reminderNotice: REMINDER_NOTICE_VERSION }, "198.51.100.2")), "refused");
  assert.equal(await save("old-page@example.test", {}, "198.51.100.3"), null, "no box shown: never reminded");
});

/* ---------------------------------------------------------------- */
/* The leads' chase list                                              */
/* ---------------------------------------------------------------- */

test("a lead's follow-up is due until London's midnight, across the clocks changing", () => {
  assert.equal(dueLeadCutoff("2026-10-20"), "2026-10-20T23:00:00.000Z", "BST: midnight is 23:00 UTC");
  assert.equal(dueLeadCutoff("2026-10-25"), "2026-10-26T00:00:00.000Z", "the day the clocks go back ends at midnight GMT");
  assert.equal(dueLeadCutoff("2026-12-01"), "2026-12-02T00:00:00.000Z");
  const row = (id: string, at: string | null, over: Record<string, string | null> = {}) => ({ id, customer_name: `DEMO ${id}`, email: `${id}@example.test`, postcode: "SW16 2BE", next_action: `Call ${id}`, next_action_at: at, ...over });
  const due = toDueLeads(
    [
      row("today", "2026-10-20T09:00:00Z"),
      row("late", "2026-10-18T09:00:00Z"),
      row("tomorrow", "2026-10-21T09:00:00Z"),
      row("night", "2026-10-20T23:30:00Z"), // 00:30 BST on the 21st: tomorrow in London
      row("none", null),
      row("nameless", "2026-10-19T09:00:00Z", { customer_name: null, next_action: "  " }),
    ],
    "2026-10-20",
  );
  assert.deepEqual(
    due.map((d) => [d.id, d.dueOn, d.overdue]),
    [
      ["late", "2026-10-18", true],
      ["nameless", "2026-10-19", true],
      ["today", "2026-10-20", false],
    ],
  );
  assert.equal(due[1]!.name, "nameless@example.test", "an unfinished quote shows its email");
  assert.equal(due[1]!.action, "Follow up");
});

test("loadDueLeads: scheduled lead follow-ups due today or overdue, declined ones left out, with the full count", async () => {
  const db = requireDb();
  const { error } = await db.from("quote_requests").insert([
    quoteRow({ customer_name: "DEMO Due", email: "due@example.test", status: "reviewed", next_action: "Call back about the loft room", next_action_at: "2026-10-19T09:00:00Z" }),
    quoteRow({ customer_name: "DEMO Today", email: "today@example.test", status: "new", next_action: "Send the survey slots", next_action_at: "2026-10-20T09:00:00Z" }),
    quoteRow({ customer_name: "DEMO Later", email: "later@example.test", status: "new", next_action: "Chase", next_action_at: "2026-10-22T09:00:00Z" }),
    quoteRow({ customer_name: "DEMO Declined", email: "declined@example.test", status: "declined", next_action: "Nothing", next_action_at: "2026-10-18T09:00:00Z" }),
    quoteRow({ customer_name: "DEMO Draft", email: "draftlead@example.test", status: "draft", next_action: "Email them", next_action_at: "2026-10-17T09:00:00Z" }),
  ]);
  assert.equal(error, null);
  const all = await loadDueLeads(db, "2026-10-20");
  assert.deepEqual(all?.leads.map((l) => [l.name, l.action, l.overdue]), [
    ["DEMO Draft", "Email them", true],
    ["DEMO Due", "Call back about the loft room", true],
    ["DEMO Today", "Send the survey slots", false],
  ]);
  assert.equal(all?.total, 3);
  const firstTwo = await loadDueLeads(db, "2026-10-20", 2);
  assert.deepEqual([firstTwo?.leads.length, firstTwo?.total], [2, 3], "the count says how many more there are");
});
