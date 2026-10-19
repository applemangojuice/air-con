import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The public video walkthrough endpoints: off in production unless switched
 * on, and processing runs once per record (never a second paid extraction).
 * The real route handlers on the in-memory backend, with no AI keys set.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
registerAppResolver();
const { processDecision, videoSurveysEnabled } = await import("../lib/video-surveys.ts");
const processRoute = await import("../app/api/video-surveys/[id]/process/route.ts");
const { requireDb } = await import("../lib/supabase-server.ts");

test("video surveys: off in production unless switched on", () => {
  assert.equal(videoSurveysEnabled({ NODE_ENV: "production" }), false);
  assert.equal(videoSurveysEnabled({ NODE_ENV: "production", VIDEO_SURVEYS_ENABLED: "1" }), true);
  assert.equal(videoSurveysEnabled({ NODE_ENV: "development" }), true);
});

test("video surveys: only an uploaded or transcribed record is processed; a settled one answers from what's stored", () => {
  assert.equal(processDecision("uploaded"), "claim");
  assert.equal(processDecision("transcribed"), "claim");
  for (const s of ["extracted", "quoted", "needs_review"]) assert.equal(processDecision(s), "stored", s);
  assert.equal(processDecision("processing"), "busy");
  assert.equal(processDecision(undefined), "busy");
});

async function record(status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await requireDb()
    .from("video_surveys")
    .insert({ id, archetype_id: "thirties-semi", permutation_id: "side-passage-multi", status, video_path: `${id}/walk.mp4`, ...extra });
  return id;
}
const call = (id: string, ip: string) =>
  processRoute.POST(new Request(`http://localhost/api/video-surveys/${id}/process`, { method: "POST", headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ id }) });
const statusOf = async (id: string) => ((await requireDb().from("video_surveys").select("status").eq("id", id).single()).data as { status: string }).status;

test("video process: a quoted record returns its quote again without running anything", async () => {
  const id = await record("quoted", { quote: { totalGbp: 1 }, draft_survey: { postcode: "SW4 7AA" } });
  const r = await call(id, "198.51.100.10");
  const body = (await r.json()) as { status: string; quote?: unknown };
  assert.equal(body.status, "quoted");
  assert.deepEqual(body.quote, { totalGbp: 1 });
  assert.equal(await statusOf(id), "quoted", "untouched");
});

test("video process: one run per record; repeats get the parked answer, and a run in progress isn't started twice", async () => {
  const id = await record("uploaded");
  const first = await call(id, "198.51.100.11");
  const a = (await first.json()) as { status?: string; error?: string };
  assert.equal(a.status, "needs_review", "no keys: parked for manual review");
  const again = (await (await call(id, "198.51.100.11")).json()) as { status: string; reason?: string };
  assert.equal(again.status, "needs_review");
  assert.match(again.reason ?? "", /not configured/i, "the stored reason, not a new run");

  const busy = await record("processing");
  const r = await call(busy, "198.51.100.12");
  assert.equal(r.status, 202);
  assert.equal(await statusOf(busy), "processing");
});

test("video process: rate limited per address", async () => {
  const id = await record("needs_review");
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) codes.push((await call(id, "198.51.100.13")).status);
  assert.ok(codes.slice(0, 6).every((c) => c !== 429));
  assert.equal(codes.at(-1), 429);
});
