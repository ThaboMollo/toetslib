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

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
    });
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
