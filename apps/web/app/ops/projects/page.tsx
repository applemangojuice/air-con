import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can } from "@aircon/domain";
import { LinkButton } from "@/components/kit/button";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { filtersFromParams } from "@/components/ops/board/board-model";
import { BoardView } from "@/components/ops/board/board-view";
import { requireStaff } from "@/lib/auth/server";
import { loadBoard, type BoardData } from "@/lib/ops-core-server";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Board · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The board (plan §5): every project by stage, each card with its next
 * action and what's blocking it, straight from the domain's gates.
 */
export default async function BoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff("projects.view-all");
  const raw = await searchParams;
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const initial = filtersFromParams(params);
  const canCreate = can(staff, "projects.edit");

  if (!getServiceClient()) {
    return (
      <Shell canCreate={false}>
        <EmptyState title="No database connected" body="Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or DATA_BACKEND=file locally) to see projects here." />
      </Shell>
    );
  }

  let board: BoardData;
  try {
    board = await loadBoard();
  } catch (err) {
    console.error("[board] load failed:", err);
    return (
      <Shell canCreate={canCreate}>
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-semibold">The board couldn&apos;t load.</p>
          <p className="mt-1">The database didn&apos;t answer. Reload in a moment; if it keeps happening, check System status.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell canCreate={canCreate} live={board.cards.filter((c) => c.column !== "closed").length} blocked={board.cards.filter((c) => c.blockers > 0 && c.column !== "closed").length}>
      {board.cards.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Projects appear when a customer books from their quote, or when you set up a pilot household here."
          action={
            canCreate ? (
              <LinkButton href="/ops/projects/new" variant="primary">
                Set up the first pilot
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <BoardView cards={board.cards} me={staff.id} today={board.today} initial={initial} />
      )}
    </Shell>
  );
}

function Shell({ children, canCreate, live, blocked }: { children: ReactNode; canCreate: boolean; live?: number; blocked?: number }) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-[100rem] px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Board"
        subtitle={live === undefined ? "Every project, by stage." : `${live} in flight${blocked ? `, ${blocked} blocked` : ""}.`}
        actions={
          canCreate ? (
            <LinkButton href="/ops/projects/new" variant="primary">
              New pilot
            </LinkButton>
          ) : undefined
        }
      />
      {children}
    </main>
  );
}
