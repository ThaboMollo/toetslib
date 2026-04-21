import type { Page, BrowserContext } from "playwright";
import type { Route, CrawledPage, NavEdge } from "@toetslib/core";
import { Logger } from "@toetslib/shared";
import { PageInspector } from "./inspector.js";
import { Screenshotter } from "./screenshotter.js";

export class PageNavigator {
  private inspector: PageInspector;
  private screenshotter: Screenshotter;
  private logger: Logger;

  constructor(outputDir: string, verbose = false) {
    this.inspector = new PageInspector();
    this.screenshotter = new Screenshotter(outputDir);
    this.logger = new Logger(verbose);
  }

  async visitRoutes(
    context: BrowserContext,
    routes: Route[],
    baseUrl: string,
    isAuthenticated: boolean
  ): Promise<{ pages: CrawledPage[]; navEdges: NavEdge[] }> {
    const pages: CrawledPage[] = [];
    const navEdges: NavEdge[] = [];
    const page = await context.newPage();

    for (const route of routes) {
      // Skip auth-required routes if not authenticated
      if (!route.isPublic && !isAuthenticated) {
        this.logger.debug(`Skipping auth-required route: ${route.path}`);
        continue;
      }

      try {
        const crawledPage = await this.visitPage(page, route, baseUrl);
        pages.push(crawledPage);

        // Discover navigation links on this page
        const links = await this.discoverLinks(page, baseUrl, routes);
        for (const link of links) {
          navEdges.push({
            from: route.path,
            to: link.path,
            trigger: link.trigger,
            selector: link.selector,
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to crawl ${route.path}: ${(error as Error).message}`
        );
      }
    }

    await page.close();
    return { pages, navEdges };
  }

  private async visitPage(
    page: Page,
    route: Route,
    baseUrl: string
  ): Promise<CrawledPage> {
    const url = `${baseUrl}${route.path}`;
    this.logger.debug(`Visiting: ${url}`);

    // Collect console errors
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];

    const consoleHandler = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    };

    const requestFailedHandler = (request: { url: () => string; failure: () => { errorText: string } | null }) => {
      const failure = request.failure();
      if (failure) {
        networkErrors.push(`${request.url()}: ${failure.errorText}`);
      }
    };

    page.on("console", consoleHandler);
    page.on("requestfailed", requestFailedHandler);

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      // Extra wait for SPA rendering
      await page.waitForTimeout(1500);

      const title = await page.title();

      // Inspect interactive elements
      const interactiveElements = await this.inspector.inspect(page);

      // Take responsive screenshots
      const screenshots = await this.screenshotter.capture(page, route.path);
      const desktopScreenshot = screenshots.find((s) => s.viewport === "desktop");

      return {
        url,
        route: route.path,
        title,
        screenshotPath: desktopScreenshot?.filePath ?? "",
        interactiveElements,
        consoleErrors: consoleErrors.slice(0, 20),
        networkErrors: networkErrors.slice(0, 20),
      };
    } finally {
      page.removeListener("console", consoleHandler);
      page.removeListener("requestfailed", requestFailedHandler);
    }
  }

  private async discoverLinks(
    page: Page,
    baseUrl: string,
    knownRoutes: Route[]
  ): Promise<Array<{ path: string; trigger: "link" | "button"; selector: string }>> {
    const links: Array<{ path: string; trigger: "link" | "button"; selector: string }> = [];
    const knownPaths = new Set(knownRoutes.map((r) => r.path));

    try {
      const anchors = page.locator("a[href]");
      const count = await anchors.count();

      for (let i = 0; i < count; i++) {
        try {
          const el = anchors.nth(i);
          const href = await el.getAttribute("href");
          if (!href) continue;

          // Normalize: only internal links
          let path: string;
          if (href.startsWith("/")) {
            path = href;
          } else if (href.startsWith(baseUrl)) {
            path = href.slice(baseUrl.length);
          } else {
            continue;
          }

          // Strip query params and hash
          path = path.split("?")[0]!.split("#")[0]!;

          if (knownPaths.has(path)) {
            const text = await el.innerText().catch(() => "");
            links.push({
              path,
              trigger: "link",
              selector: text ? `text="${text.trim()}"` : `a[href="${href}"]`,
            });
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Link discovery failed
    }

    // Deduplicate
    const seen = new Set<string>();
    return links.filter((l) => {
      if (seen.has(l.path)) return false;
      seen.add(l.path);
      return true;
    });
  }
}
