import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SurveyApp } from "@/components/field/survey/survey-app";
import type { VisitProps } from "@/components/field/survey/types";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { loadSurveyVisit } from "@/lib/survey-server";

/**
 * /field/survey/<projectId>: the surveyor's home visit on a phone (plan §3
 * Stage 2). Staff with survey.conduct who can open the project; anyone else
 * gets a 404, never a hint that it exists. The page reads everything once;
 * the client app saves through /api/field/survey.
 */

export const metadata: Metadata = { title: "Survey" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function FieldSurveyPage({ params }: Props) {
  const staff = await requireStaff("survey.conduct");
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") notFound();

  const visit = await loadSurveyVisit(projectId, staff);
  if (!visit) notFound();
  const p = visit.project;

  // Only what the screens need: no money, no other customers, no internal notes.
  const props: VisitProps = {
    project: {
      id: p.id,
      customer: {
        name: p.customer.name,
        ...(p.customer.email ? { email: p.customer.email } : {}),
        ...(p.customer.phone ? { phone: p.customer.phone } : {}),
        postcode: p.customer.postcode,
        addressLine: p.customer.addressLine,
        ...(p.customer.accessNotes ? { accessNotes: p.customer.accessNotes } : {}),
        ...(p.customer.parkingNotes ? { parkingNotes: p.customer.parkingNotes } : {}),
      },
      survey: {
        status: p.survey.status,
        mode: p.survey.mode,
        durationMinutes: p.survey.durationMinutes,
        ...(p.survey.scheduledFor ? { scheduledFor: p.survey.scheduledFor } : {}),
        ...(p.survey.surveyor ? { surveyor: p.survey.surveyor } : {}),
        ...(p.survey.startedAt ? { startedAt: p.survey.startedAt } : {}),
        ...(p.survey.submittedAt ? { submittedAt: p.survey.submittedAt } : {}),
      },
      ...(p.pilot?.label ? { pilotLabel: p.pilot.label } : {}),
      ...(p.proposal.documentsByEmailConsent ? { documentsConsent: p.proposal.documentsByEmailConsent } : {}),
      proposalAccepted: p.proposal.status === "accepted",
    },
    draft: visit.draft,
    self: visit.self,
    diff: visit.diff,
    media: visit.media,
    onMyWay: visit.onMyWay,
    issues: visit.issues,
    smsMode: visit.smsMode,
    canOpenOps: visit.canOpenOps,
    staffName: staff.name,
  };
  return <SurveyApp {...props} />;
}
