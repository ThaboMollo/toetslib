import type { StageRunner, AppMap, PipelineConfig } from "@toetslib/core";
import { LlmClient, Logger } from "@toetslib/shared";
import { TestPlanner } from "./planner.js";
import { PageObjectWriter } from "./page-objects.js";
import { TestWriter } from "./test-writer.js";
import { FixtureWriter } from "./fixtures.js";
import { ConfigWriter } from "./config-writer.js";

export { TestPlanner } from "./planner.js";
export { PageObjectWriter } from "./page-objects.js";
export { TestWriter } from "./test-writer.js";
export { FixtureWriter } from "./fixtures.js";
export { ConfigWriter } from "./config-writer.js";

export class GeneratorStage implements StageRunner {
  name = "Generate";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const logger = new Logger(config.verbose);
    const llm = new LlmClient();

    // Pass 1: Generate test plan
    logger.start("Generating test plan...");
    const planner = new TestPlanner(llm);
    const testPlan = await planner.plan(appMap);
    logger.succeed(
      `Test plan: ${testPlan.files.length} spec files, ${testPlan.totalTests} tests`
    );

    // Pass 2: Generate page objects
    logger.start("Generating page objects...");
    const poWriter = new PageObjectWriter(llm, config.outputDir);
    const pageObjects = await poWriter.generate(appMap, testPlan);
    logger.succeed(`Generated ${pageObjects.size} page objects`);

    // Pass 3: Generate test code
    logger.start("Generating test code...");
    const testWriter = new TestWriter(llm, config.outputDir);
    await testWriter.generate(appMap, testPlan, pageObjects);
    logger.succeed(`Generated ${testPlan.files.length} spec files`);

    // Generate fixtures and config
    logger.start("Generating fixtures and config...");
    const fixtureWriter = new FixtureWriter(config.outputDir);
    await fixtureWriter.generate(appMap);

    const configWriter = new ConfigWriter(config.outputDir);
    await configWriter.generate(appMap, config);
    logger.succeed("Fixtures and playwright.config.ts generated");

    // Report token usage
    const usage = llm.getUsage();
    logger.info(
      `Token usage: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache hits`
    );

    return {
      ...appMap,
      testPlan,
    };
  }
}
