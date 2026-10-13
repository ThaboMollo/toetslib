import { join } from "node:path";
import type {
  StageRunner,
  AppMap,
  PipelineConfig,
  Route,
} from "@toetslib/core";
import { RouteParser } from "./route-parser.js";
import { ComponentMapper } from "./component-map.js";
import { FormFinder } from "./form-finder.js";
import { ApiMapper } from "./api-mapper.js";
import { AuthDetector } from "./auth-detector.js";
import { SpringRouteParser } from "./spring-route-parser.js";
import {
  classifyPath,
  toAuthConfig,
  type SpringSecurityModel,
} from "./spring-security-parser.js";

export { RouteParser } from "./route-parser.js";
export { ComponentMapper } from "./component-map.js";
export { FormFinder } from "./form-finder.js";
export { ApiMapper } from "./api-mapper.js";
export { AuthDetector } from "./auth-detector.js";
export { SpringRouteParser } from "./spring-route-parser.js";
export {
  SpringSecurityParser,
  classifyPath,
  antPatternToRegExp,
} from "./spring-security-parser.js";

interface AnalysisResult {
  appMap: AppMap;
  /** Present only for Spring projects; drives seed-route classification. */
  security: SpringSecurityModel | null;
}

export class AnalyzerStage implements StageRunner {
  name = "Analyze";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const srcDir = join(appMap.project.path, appMap.project.srcDir);

    const { appMap: analyzed, security } =
      appMap.project.framework === "spring-thymeleaf"
        ? await this.analyzeSpring(appMap, srcDir)
        : await this.analyzeReact(appMap, srcDir);

    return {
      ...analyzed,
      routes: mergeSeedRoutes(analyzed.routes, config.routes, security),
    };
  }

  /**
   * Server-rendered Spring MVC. Templates are resolved at runtime by view name,
   * so there is no component graph to walk and no client-side API calls to
   * extract: the controller annotations are the whole static picture, and forms
   * are discovered live during the crawl instead.
   */
  private async analyzeSpring(
    appMap: AppMap,
    srcDir: string
  ): Promise<AnalysisResult> {
    const parser = new SpringRouteParser(srcDir);
    const { routes, apiCalls, security } = await parser.parse();

    return {
      appMap: {
        ...appMap,
        routes,
        components: [],
        forms: [],
        apiCalls,
        auth: toAuthConfig(security),
      },
      security,
    };
  }

  private async analyzeReact(
    appMap: AppMap,
    srcDir: string
  ): Promise<AnalysisResult> {
    const routeParser = new RouteParser(srcDir);
    const routes = await routeParser.parse();

    const componentMapper = new ComponentMapper(srcDir);
    const components = await componentMapper.map(routes);

    const formFinder = new FormFinder(srcDir);
    const forms = await formFinder.find(components);

    const apiMapper = new ApiMapper(srcDir);
    const apiCalls = await apiMapper.map();

    const authDetector = new AuthDetector(srcDir);
    const auth = await authDetector.detect();

    return {
      appMap: { ...appMap, routes, components, forms, apiCalls, auth },
      security: null,
    };
  }
}

/**
 * Adds operator-supplied seed paths to the discovered routes.
 *
 * These cover what static analysis cannot see: paths served by a view resolver,
 * a framework toetsLib has no parser for, or a concrete instance of a templated
 * route (a real job slug standing in for /jobs/{slug}).
 */
function mergeSeedRoutes(
  routes: Route[],
  seeds: string[],
  security: SpringSecurityModel | null
): Route[] {
  if (seeds.length === 0) return routes;

  const known = new Set(routes.map((r) => r.path));
  const merged = [...routes];

  for (const seed of seeds) {
    const path = seed.startsWith("/") ? seed : `/${seed}`;
    if (known.has(path)) continue;
    known.add(path);

    const classified = security
      ? classifyPath(path, security)
      : { isPublic: true, authGuard: null };

    merged.push({
      path,
      componentFile: "<configured>",
      componentName: "ConfiguredRoute",
      isPublic: classified.isPublic,
      authGuard: classified.authGuard,
      templated: path.includes("{") || path.includes("*"),
    });
  }

  return merged;
}
