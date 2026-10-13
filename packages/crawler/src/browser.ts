import { chromium, type Browser, type BrowserContext } from "playwright";

interface ViewportSize {
  width: number;
  height: number;
}

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
} as const;

export class BrowserManager {
  private browser: Browser | null = null;

  /**
   * @param channel An installed browser to drive ("chrome", "msedge", ...).
   *   Omit to use Playwright's bundled Chromium.
   */
  async launch(channel?: string | null): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
      });
    } catch (error) {
      const detail = (error as Error).message;
      if (!channel && /Executable doesn't exist/i.test(detail)) {
        throw new Error(
          `${detail}\n\nPlaywright's bundled browser is not installed. ` +
            `Run "npx playwright install chromium", or pass ` +
            `--browser-channel chrome to drive an already-installed browser.`
        );
      }
      throw error;
    }
  }

  async newContext(viewport?: ViewportSize): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error("Browser not launched. Call launch() first.");
    }

    return this.browser.newContext({
      viewport: viewport ?? VIEWPORTS.desktop,
      ignoreHTTPSErrors: true,
      locale: "en-ZA",
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
