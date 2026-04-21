#!/usr/bin/env node
import { Command } from "commander";
import { Pipeline } from "@toetslib/core";
import { IngestStage } from "@toetslib/ingest";
import { AnalyzerStage } from "@toetslib/analyzer";
import { CrawlerStage } from "@toetslib/crawler";
import { GeneratorStage } from "@toetslib/generator";
import { ValidatorStage } from "@toetslib/validator";
import { loadConfig } from "./config.js";

const program = new Command();

program
  .name("toetslib")
  .description(
    "AI-powered Playwright e2e test generator. Analyzes React repos and generates comprehensive test suites."
  )
  .version("0.1.0");

function createPipeline(repoPath: string, options: Record<string, unknown>) {
  const config = loadConfig(repoPath, options);
  const stages = {
    ingest: new IngestStage(),
    analyze: new AnalyzerStage(),
    crawl: new CrawlerStage(),
    generate: new GeneratorStage(),
    validate: new ValidatorStage(),
  };
  return new Pipeline(stages, config);
}

program
  .command("generate")
  .description("Full pipeline: analyze repo, crawl app, generate and validate tests")
  .argument("<repo-path>", "Path to the target repository")
  .option("-o, --output <dir>", "Output directory for generated tests", "./e2e")
  .option("--auth-url <url>", "Login page URL for authenticated testing")
  .option("--auth-email <email>", "Test account email")
  .option("--auth-password <password>", "Test account password")
  .option("--config <path>", "Path to .toetslib.json config file")
  .option("--max-heal-cycles <n>", "Max self-healing cycles", "3")
  .option("--no-validate", "Skip validation stage")
  .option("--verbose", "Verbose logging")
  .option("--json", "Output as JSON")
  .action(async (repoPath: string, options: Record<string, unknown>) => {
    const pipeline = createPipeline(repoPath, options);
    const target = options.validate === false ? "generate" : undefined;
    const appMap = await pipeline.run(target as "generate" | undefined);
    if (options.json) {
      console.log(JSON.stringify(appMap, null, 2));
    }
  });

program
  .command("analyze")
  .description("Static analysis only: detect framework, extract routes, forms, APIs")
  .argument("<repo-path>", "Path to the target repository")
  .option("--config <path>", "Path to .toetslib.json config file")
  .option("--verbose", "Verbose logging")
  .option("--json", "Output AppMap as JSON")
  .action(async (repoPath: string, options: Record<string, unknown>) => {
    const pipeline = createPipeline(repoPath, options);
    const appMap = await pipeline.run("analyze");
    if (options.json) {
      console.log(JSON.stringify(appMap, null, 2));
    }
  });

program
  .command("crawl")
  .description("Analyze + crawl: start the app and discover pages with a headless browser")
  .argument("<repo-path>", "Path to the target repository")
  .option("--auth-url <url>", "Login page URL")
  .option("--auth-email <email>", "Test account email")
  .option("--auth-password <password>", "Test account password")
  .option("--config <path>", "Path to .toetslib.json config file")
  .option("--verbose", "Verbose logging")
  .option("--json", "Output AppMap as JSON")
  .action(async (repoPath: string, options: Record<string, unknown>) => {
    const pipeline = createPipeline(repoPath, options);
    const appMap = await pipeline.run("crawl");
    if (options.json) {
      console.log(JSON.stringify(appMap, null, 2));
    }
  });

program
  .command("validate")
  .description("Run existing tests and self-heal failures")
  .argument("<repo-path>", "Path to the target repository")
  .option("-o, --output <dir>", "Directory containing tests", "./e2e")
  .option("--max-heal-cycles <n>", "Max self-healing cycles", "3")
  .option("--config <path>", "Path to .toetslib.json config file")
  .option("--verbose", "Verbose logging")
  .option("--json", "Output results as JSON")
  .action(async (repoPath: string, options: Record<string, unknown>) => {
    const pipeline = createPipeline(repoPath, options);
    const appMap = await pipeline.run("validate");
    if (options.json) {
      console.log(JSON.stringify(appMap, null, 2));
    }
  });

program.parse();
