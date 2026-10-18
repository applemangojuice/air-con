import type { ReactNode } from "react";
import type { ProjectStageId, StageState } from "@aircon/domain";
import type { HubData } from "./types";

/** What the demo puts where a real project links out (F4's proposal page, F5's pay page). */
export interface HubSlots {
  proposal?: ReactNode;
  pay?: ReactNode;
}

export interface PanelProps {
  data: HubData;
  state: StageState;
  goTo: (stage: ProjectStageId) => void;
  slots?: HubSlots;
}
