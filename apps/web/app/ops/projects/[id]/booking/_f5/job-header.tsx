import { STAGE_INFO, currentStage, type Project } from "@aircon/domain";
import { Badge, PageHeader, Tabs } from "@/components/kit";

/**
 * The header on F5's project pages (booking, kit, compliance, money): who
 * and where, the stage, and the sections of the project as link tabs. The
 * command centre, design and proposal pages are other features' routes
 * (contract §G); these tabs only link to them.
 */

export type JobTab = "booking" | "kit" | "compliance" | "money";

export function JobHeader({
  project,
  current,
  title,
  subtitle,
  actions,
}: {
  project: Project;
  current: JobTab;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const base = `/ops/projects/${project.id}`;
  const stage = currentStage(project);
  return (
    <>
      <PageHeader
        back={{ href: base, label: project.customer.name || "Project" }}
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2 normal-case tracking-normal">
            <span>
              {project.customer.addressLine}
              {project.customer.postcode ? `, ${project.customer.postcode}` : ""}
            </span>
            {project.pilot && <Badge tone="accent">Pilot {project.pilot.number}</Badge>}
            <Badge tone={project.closure.closed ? "neutral" : "info"}>{project.closure.closed ? "Closed" : STAGE_INFO[stage].label}</Badge>
          </span>
        }
        title={title}
        subtitle={subtitle}
        actions={actions}
      />
      <Tabs
        label="Project sections"
        current={`${base}/${current}`}
        tabs={[
          { href: base, label: "Overview" },
          { href: `${base}/design`, label: "Design" },
          { href: `${base}/proposal`, label: "Proposal" },
          { href: `${base}/booking`, label: "Booking" },
          { href: `${base}/kit`, label: "Kit" },
          { href: `${base}/compliance`, label: "Compliance" },
          { href: `${base}/money`, label: "Money" },
        ]}
      />
    </>
  );
}
