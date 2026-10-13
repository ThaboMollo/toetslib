import type { StageRunner, AppMap, PipelineConfig } from "@toetslib/core";
import { ProjectDetector } from "./detector.js";
import { ProjectStructure } from "./structure.js";

export { DevServerManager } from "./dev-server.js";
export { ProjectDetector } from "./detector.js";
export { ProjectStructure } from "./structure.js";

export class IngestStage implements StageRunner {
  name = "Ingest";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const detector = new ProjectDetector();
    const structure = new ProjectStructure();

    const repoPath = config.repoPath;

    const name = detector.detectName(repoPath);
    const packageManager = detector.detectPackageManager(repoPath);
    const framework = detector.detectFramework(repoPath);
    // Explicit config wins over detection: some stacks cannot be inferred from
    // the repo at all, and others are started by hand on a non-default port.
    const devCommand =
      config.devCommand ?? detector.detectDevCommand(repoPath);
    const devPort =
      config.devPort ?? detector.detectDevPort(repoPath, framework);
    const srcDir = structure.detectSrcDir(repoPath, framework);

    return {
      ...appMap,
      project: {
        name,
        path: repoPath,
        framework,
        packageManager,
        devCommand,
        devPort,
        srcDir,
      },
    };
  }
}
