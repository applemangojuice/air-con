import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The accountant's export (§K45): the real route on the in-memory backend
 * with the DEMO books. Admins only; CSVs that reconcile with the summary to
 * the penny; formula-looking text defused.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const route = await import("../app/ops/money/export/route.ts");
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const { ensureDemoStaff, staffSession } = await import("../lib/auth/server.ts");
const { SESSION_COOKIE, signSession } = await import("../lib/auth/session.ts");
const { londonToday } = await import("../lib/project-service.ts");
const paymentsRepo = await import("../lib/repo/payments.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");

await resetDemoData({ now: new Date().toISOString() });
await ensureDemoStaff();
const today = londonToday();
const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

const cookieFor = async (key: keyof typeof DEMO_STAFF) => `${SESSION_COOKIE}=${await signSession(staffSession(DEMO_STAFF[key]))}`;
const get = async (query: string, who: keyof typeof DEMO_STAFF | null = "admin") =>
  route.GET(new Request(`http://localhost:3000/ops/money/export?${query}`, { headers: who ? { cookie: await cookieFor(who) } : {} }));

function parse(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}
const pence = (v: string) => Math.round(Number(v) * 100);

test("admins only: a tech lead is refused, and signed out is a 401", async () => {
  assert.equal((await get(`file=summary&from=${from}&to=${today}`, null)).status, 401);
  assert.equal((await get(`file=summary&from=${from}&to=${today}`, "tech-lead")).status, 403, "everything but this");
  assert.equal((await get(`file=summary&from=${from}&to=${today}`, "external-installer")).status, 403);
  assert.equal((await get(`file=summary&from=${from}&to=${today}`, "admin")).status, 200);
});

test("bad requests: an unknown file, a backwards or missing range", async () => {
  assert.equal((await get(`file=everything&from=${from}&to=${today}`)).status, 400);
  assert.equal((await get(`file=invoices&from=${today}&to=${from}`)).status, 400);
  assert.equal((await get("file=invoices")).status, 400);
});

test("the three files reconcile with each other and the books, to the penny", async () => {
  // A payment reference typed as a formula, to see it defused.
  const invoices = await invoicesRepo.listAll();
  const payments = await paymentsRepo.listAll();
  assert.ok(invoices.length > 0 && payments.length > 0, "the DEMO books have invoices and payments");
  const target = payments.find((p) => p.amountPence > 0)!;
  await paymentsRepo.update({ ...target, reference: "=HYPERLINK(\"http://example.invalid\",\"x\")" });

  const res = await get(`file=invoices&from=${from}&to=${today}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`attachment; filename="dih-invoices-${from}-to-${today}\\.csv"`));
  assert.equal(res.headers.get("cache-control"), "no-store");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "a BOM, so Excel reads it as UTF-8");
  const invCsv = new TextDecoder().decode(bytes);
  assert.ok(invCsv.startsWith("type,number,issued_on"), "then the header");
  const invRows = parse(invCsv);
  const live = invoices.filter((i) => i.status !== "draft");
  assert.equal(invRows.length, live.length, "every issued invoice and credit note in the year");
  for (const r of invRows) {
    assert.match(r.total_gbp!, /^-?\d+\.\d{2}$/, "pounds to two decimals");
    assert.match(r.issued_on!, /^\d{4}-\d{2}-\d{2}$/);
  }

  const payRows = parse(await (await get(`file=payments&from=${from}&to=${today}`)).text());
  assert.equal(payRows.length, payments.length);
  assert.equal(payRows.find((r) => r.payment_id === target.id)!.customer_reference, "'=HYPERLINK(\"http://example.invalid\",\"x\")", "defused");

  const sum = parse(await (await get(`file=summary&from=${from}&to=${today}`)).text());
  const line = (start: string) => sum.find((r) => r.line!.startsWith(start))!;
  const counted = payRows.filter((r) => r.counted === "yes");
  assert.equal(pence(line("Net received").total_gbp!), counted.reduce((t, r) => t + pence(r.amount_gbp!), 0));
  const notVoid = invRows.filter((r) => r.status !== "void");
  assert.equal(pence(line("Net invoiced").total_gbp!), notVoid.reduce((t, r) => t + pence(r.total_gbp!), 0));
  assert.equal(pence(line("Owed to us").total_gbp!), notVoid.reduce((t, r) => t + pence(r.owed_at_end_gbp!), 0));
  // DEMO payments moved no money: listed, never counted.
  const demo = payRows.filter((r) => r.provider.startsWith("DEMO"));
  assert.ok(demo.every((r) => r.counted === "no"));
});
