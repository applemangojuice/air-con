/**
 * Speech-to-text for walkthrough videos.
 *
 * Claude doesn't accept audio/video input, so transcription uses OpenAI's
 * Whisper API when OPENAI_API_KEY is set. Returns null when not configured —
 * the video survey then parks at 'needs_review' with the video still
 * available to ops.
 */
export async function transcribeVideo(
  video: Blob,
  fileName: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const form = new FormData();
  form.append("file", video, fileName);
  form.append("model", "whisper-1");
  form.append("language", "en");
  form.append(
    "prompt",
    // Domain vocabulary biases the decoder toward our terms.
    "A homeowner walks through their house describing rooms where they want air conditioning installed: bedroom, living room, kitchen diner, loft, conservatory, fuse board, consumer unit, outdoor unit, garden, side passage.",
  );

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

export function isTranscriptionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
