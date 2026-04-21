import type { AppMap, PipelineConfig } from "./types.js";

export interface StageRunner {
  name: string;
  execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap>;
}
