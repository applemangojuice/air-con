import type { SurveyPhoto } from "@aircon/domain";
import type { QuoteDraft } from "./store";

/** Point at the deployed web app (same API the web funnel uses).
 *  For local dev: EXPO_PUBLIC_API_URL=http://<your-mac-ip>:3000 */
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type SubmissionResult =
  | { status: "saved"; id: string }
  | { status: "demo" }
  | { status: "error" };

type LocalPhoto = SurveyPhoto & { uri?: string };

export async function submitSurvey(draft: QuoteDraft): Promise<SubmissionResult> {
  try {
    const survey = JSON.parse(JSON.stringify(draft.survey)) as QuoteDraft["survey"];
    await uploadPhotos(survey.rooms.flatMap((r) => r.photos));
    await uploadPhotos(survey.outdoor.photos);
    await uploadPhotos(survey.electrics.photos);

    const res = await fetch(`${API_BASE}/api/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ survey, contact: draft.contact, source: "ios" }),
    });
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { demo: boolean; id?: string };
    return data.demo ? { status: "demo" } : { status: "saved", id: data.id ?? "" };
  } catch {
    return { status: "error" };
  }
}

async function uploadPhotos(photos: LocalPhoto[]): Promise<void> {
  for (const photo of photos) {
    if (photo.storagePath || !photo.uri) continue;

    const signRes = await fetch(`${API_BASE}/api/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: photo.fileName ?? "photo.jpg", kind: photo.kind }),
    });
    if (!signRes.ok) continue;
    const sign = (await signRes.json()) as {
      configured: boolean;
      path?: string;
      signedUrl?: string;
    };
    if (!sign.configured || !sign.signedUrl || !sign.path) continue;

    const file = await fetch(photo.uri);
    const blob = await file.blob();
    const put = await fetch(sign.signedUrl, {
      method: "PUT",
      headers: { "content-type": blob.type || "image/jpeg" },
      body: blob,
    });
    if (put.ok) photo.storagePath = sign.path;
  }
}

export async function requestBooking(
  quoteId: string,
  preferredStart: "asap" | "2-4-weeks" | "1-2-months" | "flexible",
  notes: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId, preferredStart, notes }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
