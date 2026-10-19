import {
  documentRef,
  projectShortId,
  type DocumentKind,
  type DocumentRecord,
  type DocumentSnapshots,
  type TypedDocumentRecord,
} from "@aircon/domain";
import { db, isUniqueViolation, isUuid, jsonClean, must } from "./repo/base";
import * as documentsRepo from "./repo/documents";

/**
 * Documents on the server: numbering, versions and supersession in one
 * place, so every feature that issues a document (proposal, contract,
 * invoice, certificate, handover pack) gets the same rules.
 *
 *   const doc = await createDocument(projectId, "handover-pack", snapshot, {
 *     title: "Your handover pack", customerVisible: true, createdBy: staff.name,
 *   });
 *
 * The rules (pure, below, tested in tests/documents.test.ts):
 *  * A document belongs to a series: one per (project, kind) for the kinds a
 *    project has one of (proposal, contract, survey report, commissioning
 *    certificate, handover pack), and one per (project, kind, instance) for
 *    the kinds it has several of (invoices, receipts, variations). The
 *    instance comes from the snapshot: the invoice number's digits, the
 *    payment id, the variation's issue number (see `documentRef`).
 *  * `version` counts revisions within a series: max + 1. So invoice 2 is
 *    a different series from invoice 1 (its own ref, version 1), and never
 *    supersedes it; a corrected invoice 2 is invoice 2 v2.
 *  * A new final version supersedes the earlier versions of its own series
 *    (it replaces them); a draft supersedes nothing. The old rows keep their
 *    snapshot: only the status changes.
 *  * Refs are unique in the database; a race on the same version retries
 *    with a fresh read.
 *
 * Permissions are the caller's job (requireStaff / requireProjectAccess).
 */

/** Kinds a project has several of, each its own series. */
export const MULTI_INSTANCE_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>(["invoice", "receipt", "variation", "certificate"]);

/** A certificate's series: one per kind of certificate (a re-upload is a new version of it). */
const CERTIFICATE_INSTANCE: Record<string, string> = {
  "electrical-installation": "EIC",
  "building-regulations": "BRC",
  "warranty-registration": "WAR",
};

const refPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The instance key of a repeatable kind, from its snapshot; undefined for
 * the one-per-project kinds. The invoice number's digits ("DIH-0002" →
 * "0002"), the receipt's payment id (first 8), the variation's issue number.
 */
export function documentInstance<K extends DocumentKind>(kind: K, snapshot: DocumentSnapshots[K]): string | undefined {
  switch (kind) {
    case "invoice": {
      const number = (snapshot as DocumentSnapshots["invoice"]).invoice?.number ?? "";
      const digits = number.replace(/\D/g, "");
      return digits || refPart(number) || undefined;
    }
    case "receipt": {
      const payment = (snapshot as DocumentSnapshots["receipt"]).payment;
      return refPart(payment?.id ?? "").slice(0, 8) || refPart(payment?.providerRef ?? "").slice(0, 12) || undefined;
    }
    case "variation": {
      const n = (snapshot as DocumentSnapshots["variation"]).issue?.number;
      return typeof n === "number" && Number.isFinite(n) ? String(n) : undefined;
    }
    case "certificate":
      return CERTIFICATE_INSTANCE[(snapshot as DocumentSnapshots["certificate"]).certificate?.kind ?? ""];
    default:
      return undefined;
  }
}

/** A ref without its version suffix: "DIH-IN-7F3A91C2-0002-v3" → "DIH-IN-7F3A91C2-0002". */
export function documentSeries(ref: string): string {
  return ref.replace(/-v\d+$/, "");
}

export interface DocumentPlan {
  version: number;
  ref: string;
  /** Earlier versions of the same series this one replaces (to mark superseded). */
  supersede: DocumentRecord[];
}

/**
 * Where a new document goes, from the project's existing documents (all of
 * them, superseded included). Pure. Throws when a repeatable kind has no
 * instance: two invoices must never share a series.
 */
export function planDocument(input: {
  existing: DocumentRecord[];
  projectId: string;
  kind: DocumentKind;
  instance?: string;
  status?: DocumentRecord["status"];
}): DocumentPlan {
  const { existing, projectId, kind } = input;
  const instance = input.instance !== undefined && refPart(input.instance) ? input.instance : undefined;
  if (MULTI_INSTANCE_KINDS.has(kind) && instance === undefined) {
    throw new Error(`A ${kind} document needs an instance (its number) so it never shares a series with another.`);
  }
  const short = projectShortId(projectId);
  const series = documentSeries(documentRef(kind, short, 1, instance));
  const same = existing.filter((d) => d.projectId === projectId && d.kind === kind && documentSeries(d.ref) === series);
  const version = same.reduce((max, d) => Math.max(max, d.version), 0) + 1;
  const replaces = (input.status ?? "final") === "final";
  return {
    version,
    ref: documentRef(kind, short, version, instance),
    supersede: replaces ? same.filter((d) => d.status !== "superseded") : [],
  };
}

/** What customers may see: visible, and not a draft. */
export function isCustomerVisible(doc: Pick<DocumentRecord, "customerVisible" | "status">): boolean {
  return doc.customerVisible && doc.status !== "draft";
}

async function allForProject(projectId: string): Promise<DocumentRecord[]> {
  return documentsRepo.listForProject(projectId, { includeSuperseded: true });
}

const ATTEMPTS = 3;

/**
 * Issue a document: plan its series, version and ref, insert it, then mark
 * the versions it replaces superseded (insert first, so a failure in between
 * leaves two live versions rather than none).
 */
export async function createDocument<K extends DocumentKind>(
  projectId: string,
  kind: K,
  snapshot: DocumentSnapshots[K],
  opts: {
    title: string;
    customerVisible: boolean;
    createdBy?: string;
    /** Default "final". A draft supersedes nothing. */
    status?: "draft" | "final";
    /** Override the instance derived from the snapshot (repeatable kinds). */
    instance?: string;
    /** For imports and the demo seed: a known id and issue time. */
    id?: string;
    createdAt?: string;
  },
): Promise<TypedDocumentRecord<K>> {
  if (!isUuid(projectId)) throw new Error("createDocument: not a project id");
  const title = opts.title.trim();
  if (!title) throw new Error("createDocument: a document needs a title");
  const instance = opts.instance ?? documentInstance(kind, snapshot);
  const status = opts.status ?? "final";
  const createdAt = opts.createdAt ?? new Date().toISOString();

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const plan = planDocument({ existing: await allForProject(projectId), projectId, kind, instance, status });
    const doc: DocumentRecord = {
      id: opts.id && isUuid(opts.id) ? opts.id : crypto.randomUUID(),
      projectId,
      kind,
      version: plan.version,
      ref: plan.ref,
      title,
      status,
      customerVisible: opts.customerVisible,
      // JSON-clean: the record is what a JSONB round trip would give back.
      snapshot: jsonClean(snapshot),
      createdAt,
      ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
    };
    const res = await db()
      .from("documents")
      .insert({ ...documentsRepo.toRow(doc), created_at: createdAt })
      .select("*")
      .single();
    if (isUniqueViolation(res.error) && attempt < ATTEMPTS - 1) continue; // someone took this version: re-plan
    const saved = documentsRepo.fromRow(must(res, "documents insert")!);
    for (const old of plan.supersede) {
      await documentsRepo.update({ ...old, status: "superseded" });
    }
    return saved as TypedDocumentRecord<K>;
  }
  throw new Error("createDocument: could not allocate a document version");
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  return documentsRepo.get(id);
}

/** A typed read: null unless the document exists and is of this kind. */
export async function getDocumentOfKind<K extends DocumentKind>(id: string, kind: K): Promise<TypedDocumentRecord<K> | null> {
  const doc = await documentsRepo.get(id);
  return doc && doc.kind === kind ? (doc as TypedDocumentRecord<K>) : null;
}

/**
 * A project's documents, newest first, current versions only unless
 * `includeSuperseded`. Customer pages pass `customerVisibleOnly`, which also
 * hides drafts.
 */
export async function listDocuments(
  projectId: string,
  opts: { customerVisibleOnly?: boolean; kind?: DocumentKind; includeSuperseded?: boolean } = {},
): Promise<DocumentRecord[]> {
  const docs = await documentsRepo.listForProject(projectId, {
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.customerVisibleOnly ? { customerVisibleOnly: true } : {}),
    ...(opts.includeSuperseded ? { includeSuperseded: true } : {}),
  });
  return opts.customerVisibleOnly ? docs.filter(isCustomerVisible) : docs;
}

/** The current (newest live) document of a one-per-project kind, e.g. the handover pack. */
export async function currentDocument<K extends DocumentKind>(projectId: string, kind: K): Promise<TypedDocumentRecord<K> | null> {
  const [doc] = await listDocuments(projectId, { kind });
  return doc ? (doc as TypedDocumentRecord<K>) : null;
}
