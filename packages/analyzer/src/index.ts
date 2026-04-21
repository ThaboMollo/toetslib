import { join } from "node:path";
import type { StageRunner, AppMap, PipelineConfig } from "@toetslib/core";
import { RouteParser } from "./route-parser.js";
import { ComponentMapper } from "./component-map.js";
import { FormFinder } from "./form-finder.js";
import { ApiMapper } from "./api-mapper.js";
import { AuthDetector } from "./auth-detector.js";

export { RouteParser } from "./route-parser.js";
export { ComponentMapper } from "./component-map.js";
export { FormFinder } from "./form-finder.js";
export { ApiMapper } from "./api-mapper.js";
export { AuthDetector } from "./auth-detector.js";

export class AnalyzerStage implements StageRunner {
  name = "Analyze";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const srcDir = join(appMap.project.path, appMap.project.srcDir);

    // Parse routes
    const routeParser = new RouteParser(srcDir);
    const routes = await routeParser.parse();

    // Map components
    const componentMapper = new ComponentMapper(srcDir);
    const components = await componentMapper.map(routes);

    // Find forms
    const formFinder = new FormFinder(srcDir);
    const forms = await formFinder.find(components);

    // Map API calls
    const apiMapper = new ApiMapper(srcDir);
    const apiCalls = await apiMapper.map();

    // Detect auth patterns
    const authDetector = new AuthDetector(srcDir);
    const auth = await authDetector.detect();

    return {
      ...appMap,
      routes,
      components,
      forms,
      apiCalls,
      auth,
    };
  }
}
