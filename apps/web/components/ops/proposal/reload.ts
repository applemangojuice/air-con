/**
 * After starting, revising or issuing a proposal the page changes shape (the
 * start card becomes the builder; the builder becomes the issued summary). We
 * load it afresh rather than let the router swap it in place.
 *
 * Why: on Next 15.5 (React 19.2 canary) an in-place update of this page, from
 * the action's own revalidation or a router.refresh(), could stall for good when
 * the builder's RSC payload arrived in several network chunks. The action had
 * worked (the draft existed, the proposal was issued) but the old page stayed on
 * screen with nothing to say so; tapping again changed nothing. Seen in about
 * two of three tries in the pilot E2E walk, never when the same payload arrived
 * in one piece, and never on a normal navigation to the page. A full load always
 * shows the right thing, and these are one-off steps where it costs nothing.
 */
export function reloadProposalPage(projectId: string): void {
  window.location.assign(`/ops/projects/${encodeURIComponent(projectId)}/proposal`);
}
