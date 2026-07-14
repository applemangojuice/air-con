import type { Confidence, ConfidenceBand, Survey } from "./types.ts";

/**
 * Installation Confidence Score.
 *
 * Measures how complete/verifiable the self-survey is. High confidence means
 * the fixed price can be guaranteed as-is; lower bands tell the customer
 * exactly what to add to firm it up, and tell ops what to review.
 */
export function scoreConfidence(survey: Survey): Confidence {
  let score = 40; // a completed survey with rooms starts here
  const gaps: string[] = [];

  if (survey.rooms.length === 0) {
    return { score: 0, band: "low", gaps: ["Add at least one room to cool."] };
  }

  // Room photos: up to 30 points.
  const roomsWithPhotos = survey.rooms.filter((r) => r.photos.length > 0).length;
  score += Math.round((roomsWithPhotos / survey.rooms.length) * 30);
  if (roomsWithPhotos < survey.rooms.length) {
    gaps.push("Add a photo of each room (wall you'd mount the unit on).");
  }

  // Outdoor position: 15 points.
  if (survey.outdoor.location !== "unsure") score += 8;
  else gaps.push("Tell us where the outdoor unit could go.");
  if (survey.outdoor.photos.length > 0) score += 7;
  else gaps.push("Add a photo of the outdoor unit location.");

  // Electrics: 15 points.
  if (survey.electrics.condition !== "unsure") score += 8;
  else gaps.push("Check your fuse board type.");
  if (survey.electrics.photos.length > 0) score += 7;
  else gaps.push("Add a photo of your fuse board.");

  score = Math.min(score, 97); // an in-person check is the last few points

  const band: ConfidenceBand = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  return { score, band, gaps };
}
