import type { Page, BrowserContext } from "playwright";
import type {
  Route,
  CrawledPage,
  NavEdge,
  Screenshot,
  CrawlConfig,
} from "@toetslib/core";
import { Logger } from "@toetslib/shared";
import { PageInspector } from "./inspector.js";
import { Screenshotter } from "./screenshotter.js";

interface DiscoveredLink {
  path: string;
  trigger: "link" | "button";
  selector: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  navEdges: NavEdge[];
  screenshots: Screenshot[];
}

/** A templated path turned into a matcher: /jobs/{slug} -> ^/jobs/[^/]+$ */
function templateToRegExp(path: string): RegExp {
  const escaped = path.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped
    // Placeholders were escaped above, so match the escaped form.
    .replace(/\\\{[^}]*\\\}/g, "[^/]+")
    .replace(/\\\{/g, "[^/]+")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${body}$`);
}

export class PageNavigator {
  private inspector: PageInspector;
  private screenshotter: Screenshotter;
  private logger: Logger;

  constructor(outputDir: string, verbose = false) {
    this.inspector = new PageInspector();
    this.screenshotter = new Screenshotter(outputDir);
    this.logger = new Logger(verbose);
  }

  /**
   * Breadth-first crawl, seeded from the statically discovered routes and
   * expanded by following internal links.
   *
   * Link-following is what makes server-rendered apps crawlable at all: their
   * concrete URLs (/jobs/senior-developer-cape-town) only exist in rendered
   * markup, while static analysis can only see the template (/jobs/{slug}).
   */
  async crawl(
    context: BrowserContext,
    routes: Route[],
    baseUrl: string,
    isAuthenticated: boolean,
    crawlConfig: CrawlConfig
  ): Promise<CrawlResult> {
    const pages: CrawledPage[] = [];
    const navEdges: NavEdge[] = [];
    const screenshots: Screenshot[] = [];

    const page = await context.newPage();

    // Templated routes cannot be fetched, but they tell us which discovered
    // links belong to the app, and which of those need a session.
    const templateMatchers = routes
      .filter((r) => r.templated)
      .map((r) => ({ matches: templateToRegExp(r.path), isPublic: r.isPublic }));

    const exactRoutes = new Map(routes.map((r) => [r.path, r]));

    const queue: string[] = [];
    const queued = new Set<string>();
    const visited = new Set<string>();

    const enqueue = (path: string) => {
      if (queued.has(path)) return;
      if (this.isExcluded(path, crawlConfig.exclude)) {
        this.logger.debug(`Excluded: ${path}`);
        return;
      }
      queued.add(path);
      queue.push(path);
    };

    for (const route of routes) {
      if (route.templated) continue;
      if (!route.isPublic && !isAuthenticated) {
        this.logger.debug(`Skipping auth-required route: ${route.path}`);
        continue;
      }
      enqueue(route.path);
    }

    // Nothing static to go on: start from the root and let links do the work.
    if (queue.length === 0) {
      this.logger.debug("No seed routes available — starting from /");
      enqueue("/");
    }

    while (queue.length > 0 && visited.size < crawlConfig.maxPages) {
      const path = queue.shift()!;
      visited.add(path);

      try {
        const visit = await this.visitPage(page, path, baseUrl);
        pages.push(visit.page);
        screenshots.push(...visit.screenshots);

        const links = await this.discoverLinks(page, baseUrl);
        for (const link of links) {
          navEdges.push({
            from: path,
            to: link.path,
            trigger: link.trigger,
            selector: link.selector,
          });

          if (!crawlConfig.followLinks) continue;
          if (visited.has(link.path) || queued.has(link.path)) continue;
          if (!this.isWorthVisiting(link.path, exactRoutes, templateMatchers, isAuthenticated)) {
            continue;
          }
          enqueue(link.path);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to crawl ${path}: ${(error as Error).message}`
        );
      }
    }

    if (queue.length > 0) {
      this.logger.warn(
        `Reached maxPages (${crawlConfig.maxPages}); ${queue.length} paths left unvisited`
      );
    }

    await page.close();
    return { pages, navEdges, screenshots };
  }

  private isExcluded(path: string, exclude: string[]): boolean {
    return exclude.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );
  }

  /**
   * Whether a discovered link should join the queue.
   *
   * A link found on a reachable page is usually reachable too, so unknown paths
   * are followed. Paths the security config marks protected are skipped while
   * unauthenticated, since they would only ever record a redirect to /login.
   */
  private isWorthVisiting(
    path: string,
    exactRoutes: Map<string, Route>,
    templateMatchers: Array<{ matches: RegExp; isPublic: boolean }>,
    isAuthenticated: boolean
  ): boolean {
    if (isAuthenticated) return true;

    const exact = exactRoutes.get(path);
    if (exact) return exact.isPublic;

    const template = templateMatchers.find((m) => m.matches.test(path));
    if (template) return template.isPublic;

    return true;
  }

  private async visitPage(
    page: Page,
    routePath: string,
    baseUrl: string
  ): Promise<{ page: CrawledPage; screenshots: Screenshot[] }> {
    const url = `${baseUrl}${routePath}`;
    this.logger.debug(`Visiting: ${url}`);

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

      const interactiveElements = await this.inspector.inspect(page);

      const screenshots = await this.screenshotter.capture(page, routePath);
      const desktopScreenshot = screenshots.find((s) => s.viewport === "desktop");

      return {
        page: {
          url,
          route: routePath,
          title,
          screenshotPath: desktopScreenshot?.filePath ?? "",
          interactiveElements,
          consoleErrors: consoleErrors.slice(0, 20),
          networkErrors: networkErrors.slice(0, 20),
        },
        screenshots,
      };
    } finally {
      page.removeListener("console", consoleHandler);
      page.removeListener("requestfailed", requestFailedHandler);
    }
  }

  /**
   * Every internal link on the current page.
   *
   * Unlike the previous implementation this does not filter to statically known
   * routes — unknown paths are exactly the ones worth discovering.
   */
  private async discoverLinks(
    page: Page,
    baseUrl: string
  ): Promise<DiscoveredLink[]> {
    const links: DiscoveredLink[] = [];

    try {
      const anchors = page.locator("a[href]");
      const count = await anchors.count();

      for (let i = 0; i < count; i++) {
        try {
          const el = anchors.nth(i);
          const href = await el.getAttribute("href");
          if (!href) continue;

          // Only internal links.
          let path: string;
          if (href.startsWith("//")) {
            continue;
          } else if (href.startsWith("/")) {
            path = href;
          } else if (href.startsWith(baseUrl)) {
            path = href.slice(baseUrl.length) || "/";
          } else {
            continue;
          }

          // Strip query params and hash: they rarely change the page under test
          // and would otherwise multiply the crawl surface without end.
          path = path.split("?")[0]!.split("#")[0]!;
          if (!path.startsWith("/")) continue;

          // Non-HTML targets have nothing to inspect.
          if (/\.(?:pdf|zip|png|jpe?g|gif|svg|webp|mp4|docx?|xlsx?|csv|txt|xml|ico)$/i.test(path)) {
            continue;
          }

          const text = await el.innerText().catch(() => "");
          links.push({
            path,
            trigger: "link",
            selector: text ? `text="${text.trim()}"` : `a[href="${href}"]`,
          });
        } catch {
          continue;
        }
      }
    } catch {
      // Link discovery failed
    }

    const seen = new Set<string>();
    return links.filter((l) => {
      if (seen.has(l.path)) return false;
      seen.add(l.path);
      return true;
    });
  }
}
