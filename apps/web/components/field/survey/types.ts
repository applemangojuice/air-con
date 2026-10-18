import type { Annotation, MeasuredSurvey, PhotoTag, Project, SelfSurveyDiffRow, Survey, SurveyRecord } from "@aircon/domain";

/**
 * What the survey screens receive from the server page (plain JSON), so the
 * client never imports a server module. lib/survey-server.ts builds these.
 */

export interface SurveyMediaItem {
  id: string;
  url: string | null;
  tag: PhotoTag;
  roomId?: string;
  caption?: string;
  contentType: string;
  width?: number;
  height?: number;
  annotations: Annotation[];
  annotationsVersion: number;
  locked: boolean;
  takenAt: string;
  source: "customer" | "survey" | "install" | "handover" | "ops";
}

export type TextStatus =
  | { state: "sent"; to: string; at: string }
  | { state: "demo"; to: string; at: string }
  | { state: "queued"; to: string; at: string }
  | { state: "failed"; to: string; at: string; error?: string }
  | { state: "not-sent"; reason: string };

export interface OnMyWayState {
  etaMinutes: number;
  at: string;
  text: TextStatus;
}

export type SurveyIssueTopic = "asbestos" | "flash-guard" | "structural";

/** The slice of the project the screens show (no money, no other customers). */
export interface VisitProject {
  id: string;
  customer: Pick<Project["customer"], "name" | "email" | "phone" | "postcode" | "addressLine" | "accessNotes" | "parkingNotes">;
  survey: Pick<Project["survey"], "status" | "mode" | "scheduledFor" | "durationMinutes" | "surveyor" | "startedAt" | "submittedAt">;
  pilotLabel?: string;
  documentsConsent?: { at: string; channel: string };
  proposalAccepted: boolean;
}

export interface VisitProps {
  project: VisitProject;
  draft: { record: SurveyRecord; updatedAt: string } | null;
  self: Survey | null;
  diff: SelfSurveyDiffRow[] | null;
  media: SurveyMediaItem[];
  onMyWay: OnMyWayState | null;
  issues: Partial<Record<SurveyIssueTopic, { id: string; number: number }>>;
  smsMode: "live" | "demo";
  canOpenOps: boolean;
  staffName: string;
}

export type { MeasuredSurvey };
