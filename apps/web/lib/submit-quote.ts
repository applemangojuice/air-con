import type { Survey, SurveyPhoto } from "@aircon/domain";
import { getPhotoFile } from "./photo-registry";
import type { QuoteDraft } from "./quote-draft";
import type { SubmissionState } from "@/components/quote/result";

/**
 * Uploads photos straight to Supabase Storage via short-lived signed URLs
 * (keeps big files off our API routes), then persists the survey snapshot.
 * Degrades gracefully: with no Supabase configured the server answers in
 * demo mode and the quote still renders client-side.
 */
export async function submitQuote(draft: QuoteDraft): Promise<SubmissionState> {
  try {
    const survey = structuredClone(draft.survey);
    await uploadPhotos(survey.rooms.flatMap((r) => r.photos));
    await uploadPhotos(survey.outdoor.photos);
    await uploadPhotos(survey.electrics.photos);

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ survey, contact: draft.contact, draftId: draft.draftId }),
    });
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { demo: boolean; id?: string; emailed?: boolean };
    return data.demo
      ? { status: "demo" }
      : { status: "saved", id: data.id ?? "", emailed: data.emailed ?? false };
  } catch {
    return { status: "error" };
  }
}

async function uploadPhotos(photos: SurveyPhoto[]): Promise<void> {
  for (const photo of photos) {
    if (photo.storagePath) continue; // already uploaded
    const file = getPhotoFile(photo.id);
    if (!file) continue; // metadata restored from a previous session

    const signRes = await fetch("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, kind: photo.kind }),
    });
    if (!signRes.ok) continue;
    const sign = (await signRes.json()) as {
      configured: boolean;
      path?: string;
      signedUrl?: string;
    };
    if (!sign.configured || !sign.signedUrl || !sign.path) continue;

    const put = await fetch(sign.signedUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (put.ok) photo.storagePath = sign.path;
  }
}

export type { Survey };
