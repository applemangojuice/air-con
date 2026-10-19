import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuote, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { quoteRow } from "./helpers/rows.ts";

// The real project service and magic links on the in-memory local backend.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { claimProjectOnSignIn, createProjectForQuote, dispatch, loadProject, pilotNumberHolder, DEMO_SURVEY } = await import("../lib/project-service.ts");
const { customerLink, consumeToken } = await import("../lib/auth/magic.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const customersRepo = await import("../lib/repo/customers.ts");
const { sendSignInLink } = await import("../lib/portal-server.ts");

/** DEMO people only. */
const OPS: StaffMember = {
  id: "5a5a5a5a-1111-4111-8111-000000000001",
  email: "ops@demo.dang.invalid",
  name: "DEMO Ops",
  roles: ["admin"],
  external: false,
  active: true,
  qualifications: [],
  demo: true,
};

async function projectFor(email: string): Promise<string> {
  const quoteId = crypto.randomUUID();
  await requireDb()
    .from("quote_requests")
    .insert(quoteRow({ id: quoteId, customer_name: "DEMO Sam", email, source: "web", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) }));
  const created = await createProjectForQuote(quoteId);
  assert.ok("id" in created, JSON.stringify(created));
  return created.id;
}

const tokenOf = (url: string) => new URL(url).searchParams.get("t");

test("a corrected email moves the project to that address's customer: links sign in as the new owner, never the old", async () => {
  const id = await projectFor("victim@example.test");
  const victim = await customersRepo.getByEmail("victim@example.test");
  assert.ok(victim);
  assert.equal((await loadProject(id))?.customer.customerId, victim.id);

  const result = await dispatch(id, { type: "set-customer-contact", email: "Corrected@Example.test" }, OPS);
  assert.ok("project" in result, JSON.stringify(result));
  const moved = result.project.customer.customerId;
  assert.ok(moved && moved !== victim.id, "a different customer record");
  const { data: row } = await requireDb().from("projects").select("customer_id").eq("id", id).single();
  assert.equal(row?.customer_id, moved, "the row's customer_id (the access authority) moved too");

  // The new address gets a token, and it signs in as the new customer.
  const link = await customerLink(id, `/p/${id}`, "corrected@example.test");
  const raw = tokenOf(link);
  assert.ok(raw, "a sign-in token for the customer's own address");
  const subject = await consumeToken(raw);
  assert.equal(subject?.kind, "customer");
  assert.equal(subject?.subjectId, moved);
  assert.equal(subject?.email, "corrected@example.test");

  // The old address, or anyone else, gets the plain page and no token.
  assert.equal(tokenOf(await customerLink(id, `/p/${id}`, "victim@example.test")), null);
  assert.equal(tokenOf(await customerLink(id, `/p/${id}`, "someone@example.test")), null);
});

test("clearing the email detaches whoever owned it: no access, no sign-in link, no token anywhere", async () => {
  const wrong = "wrong.person@example.test";
  const id = await projectFor(wrong);
  const owner = (await customersRepo.getByEmail(wrong))!;
  assert.equal(await customerIdOf(id), owner.id);
  assert.deepEqual(await customersRepo.projectIdsFor(owner.id), [id]);
  const linksTo = async (email: string) =>
    ((await requireDb().from("messages").select("id").eq("event", "magic-link").eq("to_address", email)).data ?? []).length;
  const before = await linksTo(wrong);

  const result = await dispatch(id, { type: "set-customer-contact", email: "" }, OPS);
  assert.ok("project" in result, JSON.stringify(result));
  assert.equal(result.project.customer.email, undefined);
  assert.equal(result.project.customer.customerId, undefined, "the snapshot forgets them");
  // v2 never falls back to the quote's address.
  assert.equal((await loadProject(id))?.customer.email, undefined);
  // The row's customer_id (the access authority) is cleared in the same save.
  assert.equal(await customerIdOf(id), null);
  assert.deepEqual(await customersRepo.projectIdsFor(owner.id), [], "their /portal no longer lists it");

  // "Email me a sign-in link" on the project or one of its documents sends nothing, to anyone.
  await sendSignInLink({ kind: "project", projectId: id });
  assert.equal(await linksTo(wrong), before, "the removed address gets no link");
  assert.equal(((await requireDb().from("login_tokens").select("id").eq("next_path", `/p/${id}`)).data ?? []).length, 0);
  // Their own sign-in still works, but this household isn't theirs any more.
  await sendSignInLink({ kind: "email", email: wrong });
  assert.deepEqual(await customersRepo.projectIdsFor(owner.id), []);
  assert.equal(await claimProjectOnSignIn(owner, `/p/${id}`), null, "and they can't claim it back from an old link");

  // The right address, once staff type it, owns the project.
  const fixed = await dispatch(id, { type: "set-customer-contact", email: "right.family@example.test" }, OPS);
  assert.ok("project" in fixed, JSON.stringify(fixed));
  const right = (await customersRepo.getByEmail("right.family@example.test"))!;
  assert.equal(await customerIdOf(id), right.id);
});

const consentsAt = (at: string, marketing: boolean) => ({
  consents: {
    operational: { given: true, at, version: "quote-consent-v1", text: "DEMO project updates", channels: ["email"], source: "quote-funnel" },
    marketing: { given: marketing, at, version: "quote-consent-v1", text: "DEMO offers", channels: marketing ? ["email"] : [], source: "quote-funnel" },
  },
});

/** A funnel quote (or, with `actor`, one staff set up) and its project. */
async function fromQuote(email: string, attribution: unknown, extra: { name?: string; phone?: string; actor?: StaffMember } = {}): Promise<string> {
  const quoteId = crypto.randomUUID();
  await requireDb()
    .from("quote_requests")
    .insert(quoteRow({ id: quoteId, customer_name: extra.name ?? "DEMO Kim", email, phone: extra.phone ?? null, source: "web", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY), attribution }));
  const created = await createProjectForQuote(quoteId, extra.actor ? { actor: extra.actor } : {});
  assert.ok("id" in created, JSON.stringify(created));
  return created.id;
}

const customerIdOf = async (projectId: string) =>
  ((await requireDb().from("projects").select("customer_id").eq("id", projectId).single()).data?.customer_id as string | null) ?? null;

test("a project made from a quote copies the funnel's consents onto a new customer (marketing only when ticked)", async () => {
  await fromQuote("consents@example.test", consentsAt("2026-10-01T10:00:00.000Z", true));
  const c = await customersRepo.getByEmail("consents@example.test");
  assert.equal(c?.opsConsent?.text, "DEMO project updates");
  assert.match(c?.opsConsent?.source ?? "", /quote-funnel \(quote-consent-v1; email\)/);
  assert.equal(c?.marketingConsent?.text, "DEMO offers");
});

test("the funnel never changes an existing customer: the project joins them, with its consents, when the address signs in from its link", async () => {
  const email = "victim.pilot@example.test";
  const own = await fromQuote(email, consentsAt("2026-10-01T10:00:00.000Z", false));
  const victim = (await customersRepo.getByEmail(email))!;
  assert.equal(await customerIdOf(own), victim.id, "a new address gets its record at once");
  assert.equal(victim.marketingConsent, null);

  // Someone else types the same address, ticks marketing and adds a phone.
  const typed = await fromQuote(email, consentsAt("2026-10-05T10:00:00.000Z", true), { name: "DEMO Mallory", phone: "07700 900999" });
  const after = (await customersRepo.getByEmail(email))!;
  assert.equal(after.marketingConsent, null, "no marketing consent they never gave");
  assert.equal(after.opsConsent?.at, "2026-10-01T10:00:00.000Z", "their own answer stands");
  assert.equal(after.phone, undefined, "no phone filled in from a stranger's form");
  assert.equal(await customerIdOf(typed), null, "the project isn't theirs");
  assert.deepEqual(await customersRepo.projectIdsFor(victim.id), [own], "and isn't among their homes");

  // A link about it goes to the address, signs in as that customer, and attaches nothing until it's used.
  const raw = tokenOf(await customerLink(typed, `/p/${typed}`, email));
  assert.ok(raw, "the address's owner can still be sent a link");
  assert.equal(await customerIdOf(typed), null, "sending a link attaches nothing");
  const subject = await consumeToken(raw);
  assert.equal(subject?.subjectId, victim.id);
  // A link about some other project claims nothing.
  assert.equal(await claimProjectOnSignIn(after, `/p/${own}`), null);
  assert.equal(await claimProjectOnSignIn(after, "/portal"), null);
  assert.equal(await claimProjectOnSignIn(after, subject?.next), typed, "using the link about it proves the address");
  assert.equal(await customerIdOf(typed), victim.id);
  const claimed = (await customersRepo.getByEmail(email))!;
  assert.equal(claimed.marketingConsent?.text, "DEMO offers", "the newer quote's answer, now that it's theirs");
  assert.equal(claimed.phone, "07700 900999");
  assert.equal(await claimProjectOnSignIn(claimed, subject?.next), null, "only once");
});

test("a repeat quote's consents wait for the sign-in; the latest answer then wins, and an older one never overwrites it", async () => {
  const email = "consents.repeat@example.test";
  await fromQuote(email, consentsAt("2026-10-01T10:00:00.000Z", true));
  const second = await fromQuote(email, consentsAt("2026-10-05T10:00:00.000Z", false));
  let c = (await customersRepo.getByEmail(email))!;
  assert.equal(c.marketingConsent?.text, "DEMO offers", "unchanged until the address signs in");
  await claimProjectOnSignIn(c, `/p/${second}`);
  c = (await customersRepo.getByEmail(email))!;
  assert.equal(c.marketingConsent, null, "the newer quote unticked it");
  assert.equal(c.opsConsent?.at, "2026-10-05T10:00:00.000Z");
  const older = await fromQuote(email, consentsAt("2026-09-01T10:00:00.000Z", true));
  await claimProjectOnSignIn(c, `/p/${older}`);
  c = (await customersRepo.getByEmail(email))!;
  assert.equal(c.marketingConsent, null, "an older quote never overwrites the newer answer");
});

test("a pilot staff set up under a customer's address joins that customer at once", async () => {
  const email = "staff.typed@example.test";
  const first = await fromQuote(email, null);
  const customer = (await customersRepo.getByEmail(email))!;
  const second = await fromQuote(email, null, { actor: OPS });
  assert.equal(await customerIdOf(first), customer.id);
  assert.equal(await customerIdOf(second), customer.id, "staff typed it: trusted");
});

test("pilot numbers belong to one household: the holder is found, except the project itself or a retried form's own", async () => {
  const quoteId = crypto.randomUUID();
  await requireDb()
    .from("quote_requests")
    .insert(quoteRow({ id: quoteId, customer_name: "DEMO Pilot Seven", email: "pilot7@example.test", source: "ops", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) }));
  const created = await createProjectForQuote(quoteId, { pilot: { number: 707, label: "DEMO seven" } });
  assert.ok("id" in created, JSON.stringify(created));
  assert.deepEqual(await pilotNumberHolder(707), { id: created.id, name: "DEMO Pilot Seven" }, "a second household can't take 707");
  assert.equal(await pilotNumberHolder(707, { projectId: created.id }), null, "re-saving its own number is fine");
  assert.equal(await pilotNumberHolder(707, { quoteId }), null, "a retry of the form that made it is fine");
  assert.equal(await pilotNumberHolder(708), null);
});

test("the database refuses a second household on a pilot number, even when the check was raced", async () => {
  const quote = async (name: string) => {
    const id = crypto.randomUUID();
    await requireDb()
      .from("quote_requests")
      .insert(quoteRow({ id, customer_name: name, email: `${id.slice(0, 8)}@example.test`, source: "ops", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) }));
    return id;
  };
  const first = await createProjectForQuote(await quote("DEMO Pilot Seventeen"), { pilot: { number: 717, label: "DEMO seventeen" } });
  assert.ok("id" in first, JSON.stringify(first));
  // A second form that passed its pilotNumberHolder check a moment before the first saved: the insert itself is refused.
  const raced = await createProjectForQuote(await quote("DEMO Raced"), { pilot: { number: 717, label: "DEMO raced" } });
  assert.ok("error" in raced, JSON.stringify(raced));
  assert.equal(raced.status, 409);
  assert.equal(raced.error, "Pilot 717 is already DEMO Pilot Seventeen. Pick another number.");
  // Retagging another household onto it goes through the reducer's save: refused the same way.
  const other = await createProjectForQuote(await quote("DEMO Other"));
  assert.ok("id" in other);
  const retag = await dispatch(other.id, { type: "set-pilot", number: 717, label: "DEMO retag" }, OPS);
  assert.ok("error" in retag && retag.status === 409, JSON.stringify(retag));
  assert.match(retag.error, /^Pilot 717 is already DEMO Pilot Seventeen\./);
  assert.equal((await loadProject(other.id))!.pilot, undefined, "nothing was saved");
  // Its own number again is fine.
  const again = await dispatch(first.id, { type: "set-pilot", number: 717, label: "DEMO seventeen (renamed)" }, OPS);
  assert.ok(!("error" in again), JSON.stringify(again));
});
