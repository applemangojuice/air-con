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

/* ------------------------------------------------------------------ */
/* Video walkthrough pipeline                                          */
/* ------------------------------------------------------------------ */

export interface VideoSurveyStatus {
  id: string;
  status: "uploaded" | "transcribed" | "extracted" | "quoted" | "needs_review";
  draft_survey?: unknown;
  quote?: unknown;
  error?: string | null;
}

/** Create the video survey record and get a signed upload URL. */
export async function createVideoSurvey(
  archetypeId: string,
  permutationId: string,
  postcode: string,
  fileName: string,
): Promise<{ id: string; signedUrl: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/video-surveys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archetypeId, permutationId, postcode, fileName }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      configured: boolean;
      id?: string;
      signedUrl?: string;
    };
    if (!data.configured || !data.id || !data.signedUrl) return null;
    return { id: data.id, signedUrl: data.signedUrl };
  } catch {
    return null;
  }
}

export async function uploadVideo(signedUrl: string, uri: string): Promise<boolean> {
  try {
    const file = await fetch(uri);
    const blob = await file.blob();
    const put = await fetch(signedUrl, {
      method: "PUT",
      headers: { "content-type": blob.type || "video/mp4" },
      body: blob,
    });
    return put.ok;
  } catch {
    return false;
  }
}

/** Kick off transcription → extraction → quote. Long-running; errors park at needs_review. */
export async function processVideoSurvey(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/video-surveys/${id}/process`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getVideoSurvey(id: string): Promise<VideoSurveyStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/video-surveys/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as VideoSurveyStatus;
  } catch {
    return null;
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
