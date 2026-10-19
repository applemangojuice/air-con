"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import type { Blocker } from "@aircon/domain";
import { HubControllerProvider, type HubController } from "./controller";
import { Hub } from "./hub";
import type { HubData, PortalRequest, PortalResult } from "./types";
import { uploadPortalPhoto } from "./upload";

/**
 * A real project's hub. Requests go to app/api/portal; after each one the
 * page re-reads from the server (router.refresh), and the button stays
 * busy until the fresh data is on screen, so nothing can be pressed twice
 * against a stale view. A dropped connection says so and re-reads, so the
 * screen never claims something happened that didn't.
 *
 * While the page is open it re-reads every couple of minutes (and when the
 * phone comes back to it), so an "on my way" or an end-of-day update shows
 * up without anyone pressing refresh.
 */

const TIMEOUT_MS = 20_000;
const POLL_MS = 120_000;

function endpoint(projectId: string, req: PortalRequest): { url: string; body: unknown } {
  const base = `/api/portal/${projectId}`;
  if (req.kind === "variation") {
    return {
      url: `${base}/variations/${req.issueId}`,
      body: { decision: req.decision, ...(req.name !== undefined ? { name: req.name } : {}), ...(req.agreed !== undefined ? { agreed: req.agreed } : {}) },
    };
  }
  if (req.kind === "problem") return { url: `${base}/problems`, body: { title: req.title, detail: req.detail, mediaIds: req.mediaIds } };
  return { url: `${base}/actions`, body: req };
}

export function LiveHub({ data, staffOpsHref }: { data: HubData; staffOpsHref?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const projectId = data.project.id;

  // Resolve waiting requests once the refreshed server data arrives.
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    const ready = waiters.current;
    waiters.current = [];
    ready.forEach((resolve) => resolve());
  }, [data]);

  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        waiters.current.push(() => {
          clearTimeout(timer);
          resolve();
        });
        startTransition(() => router.refresh());
      }),
    [router],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  const request = useCallback(
    async (req: PortalRequest): Promise<PortalResult> => {
      const { url, body } = endpoint(projectId, req);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
          signal: controller.signal,
        });
      } catch {
        void refresh();
        return { ok: false, error: "We couldn't reach our server. Check your signal and try again: nothing has changed until you see it here." };
      } finally {
        clearTimeout(timer);
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string; blockers?: Blocker[] } | null;
      if (res.status === 401 || res.status === 404) {
        void refresh();
        return { ok: false, error: "We couldn't find that. Refresh the page; if it keeps happening, your sign-in may have run out, and the page will offer you a new link." };
      }
      if (!res.ok || !json?.ok) {
        void refresh();
        return {
          ok: false,
          error: json?.error ?? (res.status === 429 ? "That's a lot of requests in a row. Give it a minute and try again." : "Something went wrong. Please try again."),
          ...(json?.blockers ? { blockers: json.blockers } : {}),
        };
      }
      await refresh();
      return { ok: true, ...(json.message ? { message: json.message } : {}) };
    },
    [projectId, refresh],
  );

  const controller = useMemo<HubController>(
    () =>
      data.viewer.kind === "staff"
        ? {
            mode: "staff",
            request: async () => ({ ok: false, error: "You're viewing the customer's screen. Make changes from the command centre." }),
            hrefs: {
              proposal: `/p/${projectId}/proposal`,
              pay: `/p/${projectId}/pay`,
              documents: `/p/${projectId}/documents`,
              document: (id) => `/d/${id}`,
              ops: staffOpsHref ?? `/ops/projects/${projectId}`,
            },
          }
        : {
            mode: "live",
            request,
            uploadPhoto: (file, onProgress) => uploadPortalPhoto(projectId, file, onProgress),
            hrefs: {
              proposal: `/p/${projectId}/proposal`,
              pay: `/p/${projectId}/pay`,
              documents: `/p/${projectId}/documents`,
              document: (id) => `/d/${id}`,
              ops: null,
            },
          },
    [data.viewer.kind, projectId, request, staffOpsHref],
  );

  return (
    <HubControllerProvider value={controller}>
      <Hub data={data} refLabel={`Ref ${projectId.slice(0, 8).toUpperCase()}`} />
    </HubControllerProvider>
  );
}
