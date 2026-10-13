import type { StageRunner, AppMap, PipelineConfig } from "@toetslib/core";
import { Logger } from "@toetslib/shared";
import { DevServerManager } from "@toetslib/ingest";
import { BrowserManager } from "./browser.js";
import { PageNavigator } from "./navigator.js";
import { AuthHandler } from "./auth-handler.js";

export { BrowserManager } from "./browser.js";
export { PageNavigator } from "./navigator.js";
export { PageInspector } from "./inspector.js";
export { Screenshotter } from "./screenshotter.js";
export { AuthHandler } from "./auth-handler.js";

export class CrawlerStage implements StageRunner {
  name = "Crawl";

  async execute(appMap: AppMap, config: PipelineConfig): Promise<AppMap> {
    const logger = new Logger(config.verbose);
    const { project } = appMap;

    const baseUrl = config.baseUrl ?? `http://localhost:${project.devPort}`;

    // When the app is already running, do not install dependencies or spawn a
    // dev server. Stacks toetsLib cannot boot (Spring Boot, Rails, Django) are
    // reachable only this way, and npm install would fail outright in a repo
    // with no package.json.
    const devServer = config.externalServer
      ? null
      : new DevServerManager(config.verbose);

    if (devServer) {
      const detector = await import("@toetslib/ingest").then(
        (m) => new m.ProjectDetector()
      );
      const workspaceRoot = detector.findWorkspaceRoot(project.path);

      logger.debug(`Starting dev server at ${baseUrl}`);
      await devServer.start(
        project.path,
        project.devCommand,
        baseUrl,
        workspaceRoot
      );
    } else {
      logger.info(`Using already-running app at ${baseUrl}`);
      await this.requireReachable(baseUrl);
    }

    try {
      const browser = new BrowserManager();
      await browser.launch(config.browserChannel);

      try {
        const context = await browser.newContext();

        const authHandler = new AuthHandler(config.verbose);
        const page = await context.newPage();
        const isAuthenticated = await authHandler.login(page, baseUrl, config);
        await page.close();

        if (isAuthenticated) {
          logger.info("Authenticated successfully — will crawl all routes");
        } else if (config.auth.email) {
          logger.warn("Authentication failed — crawling public routes only");
        } else {
          logger.debug("No auth configured — crawling public routes only");
        }

        const navigator = new PageNavigator(config.repoPath, config.verbose);
        const { pages, navEdges, screenshots } = await navigator.crawl(
          context,
          appMap.routes,
          baseUrl,
          isAuthenticated,
          config.crawl
        );

        const allInteractions = pages.flatMap((p) => p.interactiveElements);

        logger.info(
          `Crawled ${pages.length} pages, ${screenshots.length} screenshots, ${navEdges.length} nav edges`
        );

        await context.close();

        return {
          ...appMap,
          pages,
          interactions: allInteractions,
          // Previously dropped: the generator sends these to the model as
          // visual context, so losing them silently degraded every test.
          screenshots,
          navigationGraph: navEdges,
        };
      } finally {
        await browser.close();
      }
    } finally {
      if (devServer) {
        logger.debug("Stopping dev server");
        await devServer.stop();
      }
    }
  }

  /** Fail with a clear message rather than 30s timeouts on every route. */
  private async requireReachable(baseUrl: string): Promise<void> {
    try {
      const response = await fetch(baseUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      // Any HTTP response proves something is listening; 404 at the root is
      // fine for an app whose landing page lives elsewhere.
      if (response.status >= 500) {
        throw new Error(`responded ${response.status}`);
      }
    } catch (error) {
      throw new Error(
        `No app reachable at ${baseUrl} (${(error as Error).message}). ` +
          `Start it first, or drop --external-server to let toetsLib boot it.`
      );
    }
  }
}
