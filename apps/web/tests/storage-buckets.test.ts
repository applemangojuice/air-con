import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEDIA_UPLOAD_CONTENT_TYPES } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * Every bucket has a size ceiling and a list of types (migration 0011 on
 * Supabase, lib/storage-buckets.ts here), and the public upload route asks
 * for a photo type before it mints anything.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { BUCKET_RULES, PROJECT_MEDIA_TYPES, bucketAccepts, storedFileName } = await import("../lib/storage-buckets.ts");
const uploads = await import("../app/api/uploads/route.ts");
const { requireDb } = await import("../lib/supabase-server.ts");

const MIGRATION = readFileSync(new URL("../../../supabase/migrations/0011_storage_limits.sql", import.meta.url), "utf8");

test("migration 0011 sets exactly the rules the app enforces, bucket by bucket", () => {
  for (const [bucket, rule] of Object.entries(BUCKET_RULES)) {
    const block = new RegExp(`set file_size_limit = (\\d+)[^;]*?allowed_mime_types = array\\[([^\\]]*)\\]\\s*where id = '${bucket}'`, "s").exec(MIGRATION);
    assert.ok(block, `${bucket} is limited by 0011`);
    assert.equal(Number(block[1]), rule.maxBytes, `${bucket} size`);
    const types = [...block[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(types, [...rule.contentTypes], `${bucket} types`);
  }
});

test("project media takes every type the domain lets staff upload, and only the system's SVG besides", () => {
  for (const t of MEDIA_UPLOAD_CONTENT_TYPES) assert.ok((PROJECT_MEDIA_TYPES as readonly string[]).includes(t), t);
  assert.deepEqual(PROJECT_MEDIA_TYPES.filter((t) => !(MEDIA_UPLOAD_CONTENT_TYPES as readonly string[]).includes(t)), ["image/svg+xml"]);
  assert.equal(bucketAccepts("survey-photos", "text/html"), false);
  assert.equal(bucketAccepts("survey-photos", "image/svg+xml"), false, "no script-bearing images from the public funnel");
  assert.equal(bucketAccepts("survey-photos", "Image/JPG; charset=binary"), true);
  assert.equal(bucketAccepts("survey-videos", "application/x-msdownload"), false);
});

test("stored names take their extension from the type, never the uploader", () => {
  assert.equal(storedFileName("Living room.HTML", "image/jpeg"), "Living_room.jpg");
  assert.equal(storedFileName("../../evil.exe", "image/png"), "evil.png");
  assert.equal(storedFileName("", "video/quicktime", "walkthrough"), "walkthrough.mov");
});

test("the local backend refuses what the bucket doesn't list, like Supabase", async () => {
  const bucket = requireDb().storage.from("survey-photos");
  const html = await bucket.upload("x/page.html", new Blob(["<script>1</script>"], { type: "text/html" }));
  assert.match(html.error?.message ?? "", /not supported/);
  const jpeg = await bucket.upload("x/photo.jpg", new Uint8Array([0xff, 0xd8, 0xff]), { contentType: "image/jpeg" });
  assert.equal(jpeg.error, null);
  const { data } = await requireDb().storage.getBucket("survey-photos");
  assert.equal(data?.file_size_limit, 25 * 1024 * 1024);
  assert.ok(data?.allowed_mime_types?.includes("image/jpeg"));
});

const sign = (body: unknown, ip: string) =>
  uploads.POST(new Request("http://localhost/api/uploads", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip } }));

test("/api/uploads: a photo type is required, and the object is named for it", async () => {
  assert.equal((await sign({ fileName: "a.jpg", kind: "room" }, "198.51.100.40")).status, 400, "no type");
  assert.equal((await sign({ fileName: "a.html", kind: "room", contentType: "text/html" }, "198.51.100.40")).status, 400, "not a photo");
  const ok = await sign({ fileName: "landing.html", kind: "room", contentType: "image/jpeg" }, "198.51.100.40");
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { path: string };
  assert.match(body.path, /^[0-9a-f-]{36}\/room-landing\.jpg$/);
});
