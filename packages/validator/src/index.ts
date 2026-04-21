import type { StageRunner, AppMap, PipelineConfig } from "@toetslib/core";
import { Logger } from "@toetslib/shared";
import { DevServerManager } from "@toetslib/ingest";
import { TestRunner } from "./runner.js";
import { FailureParser } from "./failure-parser.js";
import { ReportWriter } from "./reporter.js";

export { TestRunner } from "./runner.js";
export { FailureParser } from "./failure-parser.js";
export { ReportWriter } from "./reporter.js";

export class ValidatorStage implements StageRunner {
  name = "Validate";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const logger = new Logger(config.verbose);

    // Start dev server for running tests
    const devServer = new DevServerManager(config.verbose);
    const detector = await import("@toetslib/ingest").then(
      (m) => new m.ProjectDetector()
    );
    const workspaceRoot = detector.findWorkspaceRoot(appMap.project.path);
    const baseUrl = config.baseUrl ?? `http://localhost:${appMap.project.devPort}`;

    logger.debug("Starting dev server for test execution");
    await devServer.start(
      appMap.project.path,
      appMap.project.devCommand,
      baseUrl,
      workspaceRoot
    );

    try {
      // Run tests
      logger.start("Running generated tests...");
      const runner = new TestRunner(config.verbose);
      const result = await runner.run(config.outputDir);
      logger.succeed(
        `Tests complete: ${result.passed} passed, ${result.failed} failed`
      );

      // Parse failures
      const parser = new FailureParser();
      let failures = parser.parse(result.jsonReport);

      // Fall back to raw output parsing if JSON report didn't yield results
      if (failures.length === 0 && result.failed > 0) {
        failures = parser.parseFromRawOutput(result.rawOutput);
      }

      // Write diagnostic report
      const reporter = new ReportWriter(config.verbose);
      await reporter.write(result, failures, config.outputDir);

      // Map to TestResult format
      const results = failures.map((f) => ({
        testName: f.testName,
        specFile: f.specFile,
        status: "failed" as const,
        error: f.error,
        healHistory: [],
      }));

      return {
        ...appMap,
        results,
      };
    } finally {
      logger.debug("Stopping dev server");
      await devServer.stop();
    }
  }
}
