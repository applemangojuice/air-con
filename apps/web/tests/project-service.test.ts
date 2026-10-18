import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuote, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// The real project service and magic links on the in-memory local backend.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { createProjectForQuote, dispatch, loadProject, DEMO_SURVEY } = await import("../lib/project-service.ts");
const { customerLink, consumeToken } = await import("../lib/auth/magic.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const customersRepo = await import("../lib/repo/customers.ts");

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
    .insert({ id: quoteId, customer_name: "DEMO Sam", email, source: "web", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) });
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

test("clearing the email leaves the project where it is and sends no token anywhere", async () => {
  const id = await projectFor("keep@example.test");
  const before = (await loadProject(id))?.customer.customerId;
  const result = await dispatch(id, { type: "set-customer-contact", email: "" }, OPS);
  assert.ok("project" in result, JSON.stringify(result));
  assert.equal(result.project.customer.email, undefined);
  assert.equal(result.project.customer.customerId, before, "no relink on a cleared address");
  // v2 never falls back to the quote's address.
  assert.equal((await loadProject(id))?.customer.email, undefined);
});
