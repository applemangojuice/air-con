"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { QUALIFICATION_LABEL, ROLE_LABEL, STAFF_ROLES, type Qualification, type QualificationKind, type StaffMember, type StaffRole } from "@aircon/domain";
import { Badge } from "@/components/kit/badge";
import { Button } from "@/components/kit/button";
import { Checkbox, Fieldset, Input, Textarea } from "@/components/kit/form";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import type { ActionResult } from "@/components/ops/command/types";
import { backoffMs, prepareImage } from "@/lib/media-client";
import { expiryState } from "./expiry";

/**
 * Add or edit one person: contact, roles, the subcontractor and active
 * switches, photo, and their qualifications with certificate numbers,
 * expiry dates and evidence. The whole record goes to the server as one
 * JSON payload and is validated there.
 */

const ROLE_HINT: Record<StaffRole, string> = {
  admin: "Everything, including settings and staff",
  "tech-lead": "Approves designs, signs commissioning (needs F-gas)",
  surveyor: "Home surveys, designs and proposals",
  installer: "Field jobs",
  electrician: "Electrical steps (needs Part P)",
};

const QUAL_KINDS = Object.keys(QUALIFICATION_LABEL) as QualificationKind[];

interface QualRow {
  key: string;
  kind: QualificationKind;
  reference: string;
  issuer: string;
  expiresOn: string;
  mediaId: string;
  mediaUrl?: string;
  verified: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
}

const rowFrom = (q: Qualification, i: number, urls: Record<string, string>): QualRow => ({
  key: `q${i}`,
  kind: q.kind,
  reference: q.reference,
  issuer: q.issuer ?? "",
  expiresOn: q.expiresOn ?? "",
  mediaId: q.mediaId ?? "",
  ...(q.mediaId && urls[q.mediaId] ? { mediaUrl: urls[q.mediaId] } : {}),
  verified: Boolean(q.verifiedAt),
  ...(q.verifiedAt ? { verifiedAt: q.verifiedAt } : {}),
  ...(q.verifiedBy ? { verifiedBy: q.verifiedBy } : {}),
});

/** Prepare, ask for an upload URL, PUT (retried), confirm. */
async function uploadStaffFile(file: File, staffId: string, purpose: "photo" | "evidence"): Promise<{ mediaId: string; url: string | null }> {
  const prepared = await prepareImage(file, { maxDimension: purpose === "photo" ? 800 : 2048 });
  const post = async (body: unknown) => {
    const res = await fetch("/ops/staff/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    if (!res.ok) throw new Error(data.error ?? `The upload was refused (${res.status}).`);
    return data;
  };
  const started = (await post({ step: "start", staffId, purpose, fileName: prepared.fileName, contentType: prepared.contentType })) as { mediaId: string; path: string; signedUrl: string };
  let lastError = "The connection dropped during the upload.";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(started.signedUrl, { method: "PUT", headers: { "content-type": prepared.contentType }, body: prepared.blob });
      if (res.ok || (attempt > 1 && res.status === 409)) {
        lastError = "";
        break;
      }
      lastError = `The upload was refused (${res.status}).`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch {
      lastError = "No connection. Check your signal and try again.";
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, backoffMs(attempt)));
  }
  if (lastError) throw new Error(lastError);
  return (await post({ step: "confirm", staffId, purpose, mediaId: started.mediaId, path: started.path })) as { mediaId: string; url: string | null };
}

export function StaffEditor({
  action,
  person,
  today,
  photoUrl,
  evidenceUrls = {},
  self = false,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  person?: StaffMember;
  today: string;
  photoUrl?: string | null;
  evidenceUrls?: Record<string, string>;
  self?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [roles, setRoles] = useState<StaffRole[]>(person?.roles ?? []);
  const [external, setExternal] = useState(person?.external ?? false);
  const [active, setActive] = useState(person?.active ?? true);
  const [quals, setQuals] = useState<QualRow[]>(() => (person?.qualifications ?? []).map((q, i) => rowFrom(q, i, evidenceUrls)));
  const [photo, setPhoto] = useState<string | null>(photoUrl ?? null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const seq = useRef(quals.length);

  const update = (key: string, patch: Partial<QualRow>) => setQuals((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const toggleRole = (r: StaffRole) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));

  async function onFile(file: File | undefined, purpose: "photo" | "evidence", qualKey?: string) {
    if (!file || !person) return;
    setUploading(qualKey ?? "photo");
    setUploadError(null);
    try {
      const r = await uploadStaffFile(file, person.id, purpose);
      if (purpose === "photo") {
        setPhoto(r.url);
        router.refresh();
      } else if (qualKey) update(qualKey, { mediaId: r.mediaId, ...(r.url ? { mediaUrl: r.url } : {}) });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "The upload didn't work.");
    } finally {
      setUploading(null);
    }
  }

  function payload(fd: FormData): string {
    const v = (name: string) => String(fd.get(name) ?? "");
    return JSON.stringify({
      id: person?.id ?? "",
      name: v("name"),
      email: v("email"),
      phone: v("phone").trim(),
      roles,
      external,
      active,
      bio: v("bio"),
      qualifications: quals.map((q) => ({
        kind: q.kind,
        reference: q.reference,
        issuer: q.issuer,
        expiresOn: q.expiresOn,
        mediaId: q.mediaId,
        verified: q.verified && Boolean(q.mediaId),
      })),
    });
  }

  return (
    <div>
      <ActionForm
        action={async (fd) => {
          fd.set("payload", payload(fd));
          return action(fd);
        }}
        onResult={(r) => {
          if (r.ok && r.href && !person) router.push(r.href);
        }}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby={`${id}-who`}>
              <h2 id={`${id}-who`} className="mb-4 font-display text-xl text-ink-900">
                Details
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Name" name="name" required defaultValue={person?.name ?? ""} maxLength={120} className="sm:col-span-2" hint="As customers will see it." />
                <Input label="Email" name="email" type="email" required defaultValue={person?.email ?? ""} maxLength={200} hint="They sign in with this address." />
                <Input label="Phone" name="phone" type="tel" defaultValue={person?.phone ?? ""} maxLength={20} />
                <Textarea label="Short bio" name="bio" rows={3} maxLength={600} defaultValue={person?.bio ?? ""} hint="Optional. Customers see it when this person is on their crew." className="sm:col-span-2" />
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <Fieldset legend="Roles" hint="What they can do here. A subcontractor only ever sees the jobs they're on.">
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {STAFF_ROLES.map((r) => (
                    <Checkbox
                      key={r}
                      label={ROLE_LABEL[r]}
                      hint={ROLE_HINT[r]}
                      checked={roles.includes(r)}
                      onChange={() => toggleRole(r)}
                      disabled={self && r === "admin"}
                    />
                  ))}
                </div>
              </Fieldset>
              <div className="mt-3 grid gap-x-4 border-t border-line pt-3 sm:grid-cols-2">
                <Checkbox
                  label="Subcontractor"
                  hint="External: no board, no margins, no other customers."
                  checked={external}
                  onChange={(e) => setExternal(e.currentTarget.checked)}
                />
                <Checkbox label="Active" hint="Inactive people can't sign in." checked={active} onChange={(e) => setActive(e.currentTarget.checked)} disabled={self} />
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby={`${id}-quals`}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id={`${id}-quals`} className="font-display text-xl text-ink-900">
                    Qualifications
                  </h2>
                  <p className="mt-1 text-sm text-ink-500">F-gas and Part P unlock the refrigerant, electrical and sign-off steps. Each needs its certificate number; an expired one stops counting the day after it expires.</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    seq.current += 1;
                    setQuals((qs) => [...qs, { key: `n${seq.current}`, kind: "fgas-cat1", reference: "", issuer: "", expiresOn: "", mediaId: "", verified: false }]);
                  }}
                >
                  Add a qualification
                </Button>
              </div>
              {quals.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">None recorded.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {quals.map((q) => {
                    const state = expiryState(q.expiresOn, today);
                    return (
                      <li key={q.key} className="rounded-xl border border-line p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap gap-1.5">
                            {state === "expired" && <Badge tone="danger">Expired</Badge>}
                            {state === "soon" && <Badge tone="warn">Expires within 60 days</Badge>}
                            {state === "current" && <Badge tone="success">Current</Badge>}
                            {state === "no-expiry" && <Badge>No expiry date</Badge>}
                            {q.verified && q.mediaId ? (
                              <Badge tone="info">Verified{q.verifiedBy ? ` by ${q.verifiedBy}` : ""}</Badge>
                            ) : (
                              <Badge tone="warn">Not verified: doesn&apos;t count yet</Badge>
                            )}
                          </span>
                          <button type="button" onClick={() => setQuals((qs) => qs.filter((x) => x.key !== q.key))} className="min-h-10 rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                            Remove
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-semibold text-ink-900">
                            Kind
                            <select value={q.kind} onChange={(e) => update(q.key, { kind: e.target.value as QualificationKind })} className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal">
                              {QUAL_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {QUALIFICATION_LABEL[k]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-sm font-semibold text-ink-900">
                            Certificate or registration number
                            <input value={q.reference} onChange={(e) => update(q.key, { reference: e.target.value })} maxLength={120} required className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal" />
                          </label>
                          <label className="block text-sm font-semibold text-ink-900">
                            Issued by
                            <input value={q.issuer} onChange={(e) => update(q.key, { issuer: e.target.value })} maxLength={120} placeholder="e.g. REFCOM, NICEIC" className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal" />
                          </label>
                          <label className="block text-sm font-semibold text-ink-900">
                            Expires
                            <input type="date" value={q.expiresOn} onChange={(e) => update(q.key, { expiresOn: e.target.value })} className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal" />
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {person ? (
                            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line px-3 text-sm font-semibold text-ink-900 hover:bg-surface">
                              {uploading === q.key ? "Uploading…" : q.mediaId ? "Replace evidence" : "Upload evidence"}
                              <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={uploading !== null} onChange={(e) => onFile(e.target.files?.[0], "evidence", q.key)} />
                            </label>
                          ) : (
                            <span className="text-xs text-ink-500">Save the person first to upload evidence.</span>
                          )}
                          {q.mediaId &&
                            (q.mediaUrl ? (
                              <a href={q.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent-700 underline">
                                View evidence
                              </a>
                            ) : (
                              <span className="text-sm text-ink-700">Evidence attached</span>
                            ))}
                          <label className={`flex min-h-10 items-center gap-2 text-sm ${q.mediaId ? "text-ink-900" : "text-ink-500"}`}>
                            <input
                              type="checkbox"
                              checked={q.verified && Boolean(q.mediaId)}
                              disabled={!q.mediaId}
                              onChange={(e) => update(q.key, { verified: e.currentTarget.checked })}
                              className="h-5 w-5 accent-accent-700"
                            />
                            I&apos;ve checked it against the certificate
                          </label>
                        </div>
                        {!(q.verified && q.mediaId) && (
                          <p className="mt-2 text-xs text-ink-500">
                            Bookings, sign-offs and the customer&apos;s project page only count it once the certificate is uploaded and you&apos;ve ticked that you checked it{q.mediaId ? "." : ": upload it first."}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-semibold text-ink-900">Photo</h2>
              <div className="mt-3 flex items-center gap-3">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-surface font-display text-2xl text-ink-700">
                    {(person?.name ?? "?").slice(0, 1)}
                  </span>
                )}
                {person ? (
                  <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line px-3 text-sm font-semibold text-ink-900 hover:bg-surface">
                    {uploading === "photo" ? "Uploading…" : photo ? "Change photo" : "Add a photo"}
                    <input type="file" accept="image/*" className="sr-only" disabled={uploading !== null} onChange={(e) => onFile(e.target.files?.[0], "photo")} />
                  </label>
                ) : (
                  <span className="text-xs text-ink-500">Add a photo once they&apos;re saved.</span>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-500">Customers see it with the crew on their booking.</p>
              <p aria-live="polite" className="mt-2 text-sm text-red-700">
                {uploadError}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <SubmitButton size="lg" block busyLabel="Saving…">
                {person ? "Save changes" : "Add to the team"}
              </SubmitButton>
              {self && <p className="mt-2 text-xs text-ink-500">This is you: you can&apos;t remove your own admin role or deactivate yourself.</p>}
            </div>
          </aside>
        </div>
      </ActionForm>
    </div>
  );
}
