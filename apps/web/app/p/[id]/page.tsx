import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/site/logo";
import { ProjectView } from "@/components/project/project-view";
import { buildDemoProject, loadProject } from "@/lib/projects-server";

export const metadata: Metadata = {
  title: "Your installation",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The project page: the customer's whole journey on one timeline.
 * `/p/demo` serves a fully playable in-browser project (nothing persists);
 * real projects live at `/p/<uuid>`.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const demo = id === "demo";
  const project = demo ? buildDemoProject() : UUID_RE.test(id) ? await loadProject(id) : null;
  if (!project) notFound();

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Back to homepage">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-300">
            {project.customer.name.split(" ")[0]}&apos;s installation
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <ProjectView initialProject={project} demo={demo} />
      </main>
    </div>
  );
}
