import type { StageDef } from "../sim/types";
import { buildFoundry } from "./stage-foundry";
import { buildProvingGround } from "./stage-proving";
import { buildSkyline } from "./stage-skyline";
import type { Stage3D } from "./stage-common";

export type { CameraFocus, Stage3D, StageLook } from "./stage-common";

export const buildStage = (def: StageDef): Stage3D => {
  switch (def.theme.decor) {
    case "skyline":
      return buildSkyline(def);
    case "foundry":
      return buildFoundry(def);
    default:
      return buildProvingGround(def);
  }
};
