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

    // Determine base URL
    const baseUrl = config.baseUrl ?? `http://localhost:${project.devPort}`;

    // Start dev server
    const devServer = new DevServerManager(config.verbose);
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

    try {
      // Launch browser
      const browser = new BrowserManager();
      await browser.launch();

      try {
        const context = await browser.newContext();

        // Attempt authentication
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

        // Visit all routes
        const navigator = new PageNavigator(config.repoPath, config.verbose);
        const { pages, navEdges } = await navigator.visitRoutes(
          context,
          appMap.routes,
          baseUrl,
          isAuthenticated
        );

        // Collect all screenshots and interactions from crawled pages
        const allScreenshots = pages.flatMap((p) => {
          // Screenshots are stored per-page by the screenshotter
          // The page object has the desktop screenshot path
          return [];
        });

        const allInteractions = pages.flatMap((p) => p.interactiveElements);

        await context.close();

        return {
          ...appMap,
          pages,
          interactions: allInteractions,
          navigationGraph: navEdges,
        };
      } finally {
        await browser.close();
      }
    } finally {
      logger.debug("Stopping dev server");
      await devServer.stop();
    }
  }
}
