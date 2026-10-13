import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PipelineConfig } from "@toetslib/core";

interface ToetslibJson {
  devCommand?: string;
  devPort?: number;
  baseUrl?: string;
  externalServer?: boolean;
  auth?: {
    strategy?: string;
    loginUrl?: string;
    /** Credentials. Selectors belong in `fields`. */
    email?: string;
    password?: string;
    /** CSS selectors for the login form, not credentials. */
    fields?: Record<string, string>;
    submitSelector?: string;
  };
  routes?: string[];
  browserChannel?: string;
  crawl?: {
    maxPages?: number;
    followLinks?: boolean;
    exclude?: string[];
  };
  exclude?: string[];
  outputDir?: string;
  maxHealCycles?: number;
}

const DEFAULT_MAX_PAGES = 150;

/**
 * Paths that are never safe to visit with a real browser session: they end the
 * session or mutate state. Crawling /logout in particular silently invalidates
 * auth for every page that follows.
 */
const DEFAULT_EXCLUDES = ["/logout", "/signout", "/sign-out"];

function parseIntOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
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

  const baseUrl =
    (options.baseUrl as string) || fileConfig.baseUrl || null;

  // An external server is implied by --base-url: the user is pointing at
  // something they started themselves.
  const externalServer =
    options.externalServer === true ||
    fileConfig.externalServer === true ||
    Boolean(options.baseUrl);

  const excludes = [
    ...DEFAULT_EXCLUDES,
    ...(fileConfig.crawl?.exclude ?? fileConfig.exclude ?? []),
  ];

  return {
    repoPath: resolvedPath,
    outputDir: resolve(
      (options.output as string) || fileConfig.outputDir || "./e2e"
    ),
    baseUrl,
    auth: {
      url: (options.authUrl as string) || fileConfig.auth?.loginUrl || null,
      // NOTE: auth.fields holds CSS selectors, so it is deliberately not a
      // credential source. Earlier versions read fields.email here, which fed
      // the selector "#email" in as the login address.
      email: (options.authEmail as string) || fileConfig.auth?.email || null,
      password:
        (options.authPassword as string) || fileConfig.auth?.password || null,
    },
    maxHealCycles: parseInt(
      (options.maxHealCycles as string) ||
        String(fileConfig.maxHealCycles || 3),
      10
    ),
    verbose: (options.verbose as boolean) || false,
    skipValidation: options.validate === false,
    jsonOutput: (options.json as boolean) || false,

    externalServer,
    devCommand:
      (options.devCommand as string) || fileConfig.devCommand || null,
    devPort: parseIntOrNull(options.devPort) ?? fileConfig.devPort ?? null,
    routes: fileConfig.routes ?? [],
    browserChannel:
      (options.browserChannel as string) || fileConfig.browserChannel || null,
    crawl: {
      maxPages:
        parseIntOrNull(options.maxPages) ??
        fileConfig.crawl?.maxPages ??
        DEFAULT_MAX_PAGES,
      followLinks:
        options.followLinks === false
          ? false
          : fileConfig.crawl?.followLinks ?? true,
      exclude: excludes,
    },
  };
}
