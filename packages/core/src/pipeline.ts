import { Logger } from "@toetslib/shared";
import type { AppMap, PipelineConfig } from "./types.js";
import type { StageRunner } from "./stage.js";

type PipelineTarget = "ingest" | "analyze" | "crawl" | "generate" | "validate";

const STAGE_ORDER: PipelineTarget[] = [
  "ingest",
  "analyze",
  "crawl",
  "generate",
  "validate",
];

interface PipelineStages {
  ingest: StageRunner;
  analyze: StageRunner;
  crawl: StageRunner;
  generate: StageRunner;
  validate: StageRunner;
}

export class Pipeline {
  private stages: PipelineStages;
  private config: PipelineConfig;
  private logger: Logger;

  constructor(stages: PipelineStages, config: PipelineConfig) {
    this.stages = stages;
    this.config = config;
    this.logger = new Logger(config.verbose);
  }

  async run(targetStage?: PipelineTarget): Promise<AppMap> {
    const stopAt = targetStage
      ? STAGE_ORDER.indexOf(targetStage)
      : STAGE_ORDER.length - 1;

    let appMap = this.createEmptyAppMap();

    for (let i = 0; i <= stopAt; i++) {
      const stageName = STAGE_ORDER[i]!;
      const stage = this.stages[stageName];

      this.logger.start(`Running ${stage.name}...`);
      try {
        appMap = await stage.execute(appMap, this.config);
        this.logger.succeed(`${stage.name} complete`);
      } catch (error) {
        this.logger.fail(`${stage.name} failed`);
        throw error;
      }
    }

    return appMap;
  }

  private createEmptyAppMap(): AppMap {
    return {
      project: {
        name: "",
        path: "",
        framework: "react-vite",
        packageManager: "npm",
        devCommand: "",
        devPort: 0,
        srcDir: "",
      },
      routes: [],
      components: [],
      forms: [],
      apiCalls: [],
      auth: {
        type: "none",
        loginRoute: null,
        trialMode: false,
        restrictions: [],
      },
      pages: [],
      interactions: [],
      screenshots: [],
      navigationGraph: [],
      testPlan: { files: [], totalTests: 0 },
      results: [],
      healAttempts: [],
    };
  }
}
