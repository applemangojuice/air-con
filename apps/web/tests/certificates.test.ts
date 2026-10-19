import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// "It's in your documents" is only ever said once it is. The real modules on the in-memory backend, DEMO data.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const { recordCertificate } = await import("../lib/certificates-server.ts");
const { loadProject } = await import("../lib/project-service.ts");
const { getDocument, listDocuments } = await import("../lib/documents-server.ts");
const { documentMediaIds } = await import("../lib/portal-server.ts");
const mediaRepo = await import("../lib/repo/media.ts");

test("a certificate is recorded with its file: the document exists, is the customer's, and only then does the project say so", async () => {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  // A home with the certificate still to come.
  let target: string | undefined;
  for (const p of summary.projects) {
    const project = await loadProject(p.id);
    if (!target && project && project.handover.electricalCert === "pending" && !project.handover.warrantyRegistered) target = p.id;
  }
  assert.ok(target, "a DEMO home waiting for its certificate");
  const projectId = target!;
  const before = (await loadProject(projectId))!;
  const admin = DEMO_STAFF.admin;

  // No file: refused, nothing recorded.
  const bare = await recordCertificate(projectId, { kind: "electrical-installation", reference: "DEMO-EIC-9", mediaIds: [] }, admin);
  assert.equal(bare.ok, false);
  assert.match(!bare.ok ? bare.error : "", /Upload the certificate itself/);
  assert.equal((await loadProject(projectId))!.handover.electricalCert, before.handover.electricalCert);

  // Someone else's file doesn't count either.
  const foreign = crypto.randomUUID();
  await mediaRepo.insert({ id: foreign, projectId: crypto.randomUUID(), bucket: "project-media", storagePath: `x/${foreign}.pdf`, contentType: "application/pdf", tag: "document", source: "ops", takenAt: new Date().toISOString(), customerVisible: false, annotations: [], annotationsVersion: 0, locked: false });
  assert.equal((await recordCertificate(projectId, { kind: "electrical-installation", reference: "DEMO-EIC-9", mediaIds: [foreign] }, admin)).ok, false);

  const file = crypto.randomUUID();
  await mediaRepo.insert({ id: file, projectId, bucket: "project-media", storagePath: `${projectId}/${file}.pdf`, contentType: "application/pdf", tag: "document", source: "ops", caption: "Electrical installation certificate", takenAt: new Date().toISOString(), customerVisible: false, annotations: [], annotationsVersion: 0, locked: false });
  const ok = await recordCertificate(projectId, { kind: "electrical-installation", reference: "DEMO-EIC-9", issuer: "DEMO scheme", mediaIds: [file, foreign] }, admin);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const documentId = ok.ok ? ok.documentId : "";

  const doc = (await getDocument(documentId))!;
  assert.equal(doc.kind, "certificate");
  assert.equal(doc.customerVisible, true);
  assert.match(doc.ref, /^DIH-CE-.+-EIC-v1$/);
  assert.deepEqual(documentMediaIds(doc), [file], "only this project's file");
  assert.equal((await mediaRepo.get(file))!.customerVisible, true);
  const visible = await listDocuments(projectId, { customerVisibleOnly: true });
  assert.ok(visible.some((d) => d.id === documentId), "in the customer's documents");

  const after = (await loadProject(projectId))!;
  assert.equal(after.handover.electricalCert, "received");
  assert.equal(after.handover.electricalCertDocumentId, documentId);
  assert.equal(after.events.at(-1)!.label, "Your electrical installation certificate is in your documents.");

  // The warranty registration: a reference is enough, the confirmation file is optional.
  {
    assert.equal((await recordCertificate(projectId, { kind: "warranty-registration", reference: "x", mediaIds: [] }, admin)).ok, false, "a reference is needed");
    const war = await recordCertificate(projectId, { kind: "warranty-registration", reference: "DEMO-WR-77", mediaIds: [] }, admin);
    assert.equal(war.ok, true);
    const registered = (await loadProject(projectId))!;
    assert.equal(registered.handover.warrantyDocumentId, war.ok ? war.documentId : "");
    assert.match(registered.events.at(-1)!.label, /confirmation is in your documents/);
  }
});
