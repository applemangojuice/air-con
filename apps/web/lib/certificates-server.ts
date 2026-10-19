import {
  CERTIFICATE_KIND_LABEL,
  documentCompany,
  documentCustomer,
  type CertificateKind,
  type DocumentSnapshots,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { createDocument } from "./documents-server";
import { updateMedia } from "./media-server";
import { dispatch, loadProject, londonToday } from "./project-service";
import { isUuid } from "./repo/base";
import * as mediaRepo from "./repo/media";
import { getSettings } from "./settings-server";

/**
 * Certificates we hold for the customer (the electrical installation
 * certificate, the warranty registration): the file and its reference
 * become a customer-visible "certificate" document first, and only then is
 * the project told (electrical-cert-updated received, warranty-registered),
 * so the timeline, the portal and the email that say "it's in your
 * documents" are always true.
 */

export type CertificateResult = { ok: true; documentId: string } | { ok: false; error: string; status: number; blockers?: unknown };

export interface CertificateInput {
  kind: Extract<CertificateKind, "electrical-installation" | "warranty-registration">;
  reference: string;
  mediaIds: string[];
  issuer?: string;
  note?: string;
}

const fail = (error: string, status = 422): CertificateResult => ({ ok: false, error, status });

export async function recordCertificate(projectId: string, input: CertificateInput, staff: StaffMember): Promise<CertificateResult> {
  if (!isUuid(projectId)) return fail("Project not found.", 404);
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  const reference = input.reference.trim();
  const electrical = input.kind === "electrical-installation";
  if (reference.length < 3) {
    return fail(electrical ? "Add the certificate number (or the scheme's notification reference)." : "Add the warranty registration reference.");
  }
  if (electrical && project.handover.electricalCert === "received") return fail("The certificate is already marked received.", 409);
  if (!electrical && project.handover.warrantyRegistered) return fail("The warranty is already registered.", 409);

  // Only this project's own uploads. The electrical certificate needs its file.
  const wanted = [...new Set(input.mediaIds.filter((id) => isUuid(id)))].slice(0, 8);
  const media = (await mediaRepo.listByIds(wanted)).filter((m) => m.projectId === projectId);
  if (electrical && media.length === 0) return fail("Upload the certificate itself (a PDF or a photo of it) first.");

  for (const m of media) {
    if (m.customerVisible) continue;
    const shown = await updateMedia(m.id, { customerVisible: true });
    if (!shown.ok) console.warn(`[certificates] couldn't show ${m.id} to the customer:`, shown.error);
  }

  const settings = await getSettings();
  const now = new Date().toISOString();
  const snapshot: DocumentSnapshots["certificate"] = {
    company: documentCompany(settings),
    customer: documentCustomer(project),
    issuedAt: now,
    certificate: {
      kind: input.kind,
      title: CERTIFICATE_KIND_LABEL[input.kind],
      reference,
      ...(input.issuer?.trim() ? { issuer: input.issuer.trim() } : {}),
      receivedOn: londonToday(),
      mediaIds: media.map((m) => m.id),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    },
  };
  let documentId: string;
  try {
    const doc = await createDocument(projectId, "certificate", snapshot, { title: CERTIFICATE_KIND_LABEL[input.kind], customerVisible: true, createdBy: staff.name });
    documentId = doc.id;
  } catch (err) {
    console.error(`[certificates] ${input.kind} on ${projectId} failed to save:`, err);
    return fail("The certificate couldn't be saved. Nothing was recorded; try again.", 502);
  }

  const result = await dispatch(
    projectId,
    electrical ? { type: "electrical-cert-updated", status: "received", documentId } : { type: "warranty-registered", documentId },
    staff,
  );
  if ("error" in result) return { ok: false, error: result.error, status: result.status, ...(result.blockers ? { blockers: result.blockers } : {}) };
  await audit({ actor: staff, action: `certificate.${input.kind}`, entity: "document", entityId: documentId, detail: { projectId, reference, files: media.length } });
  return { ok: true, documentId };
}
