import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PipelineConfig } from "@toetslib/core";

interface ToetslibJson {
  devCommand?: string;
  devPort?: number;
  baseUrl?: string;
  auth?: {
    strategy?: string;
    loginUrl?: string;
    fields?: Record<string, string>;
    submitSelector?: string;
  };
  exclude?: string[];
  outputDir?: string;
  maxHealCycles?: number;
}

export function loadConfig(
  repoPath: string,
  options: Record<string, unknown>
): PipelineConfig {
  const resolvedPath = resolve(repoPath);

  let fileConfig: ToetslibJson = {};
  const configCandidates = options.config
    ? [options.config as string]
    : [
        join(resolvedPath, ".toetslib.json"),
        join(resolvedPath, "toetslib.json"),
      ];
  for (const candidate of configCandidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf-8");
      fileConfig = JSON.parse(raw) as ToetslibJson;
      break;
    }
  }

  return {
    repoPath: resolvedPath,
    outputDir: resolve(
      (options.output as string) || fileConfig.outputDir || "./e2e"
    ),
    baseUrl: fileConfig.baseUrl || null,
    auth: {
      url: (options.authUrl as string) || fileConfig.auth?.loginUrl || null,
      email: (options.authEmail as string) || fileConfig.auth?.fields?.email || null,
      password: (options.authPassword as string) || fileConfig.auth?.fields?.password || null,
    },
    maxHealCycles: parseInt(
      (options.maxHealCycles as string) ||
        String(fileConfig.maxHealCycles || 3),
      10
    ),
    verbose: (options.verbose as boolean) || false,
    skipValidation: options.validate === false,
    jsonOutput: (options.json as boolean) || false,
  };
}
