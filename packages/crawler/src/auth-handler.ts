import type { Page } from "playwright";
import type { PipelineConfig } from "@toetslib/core";
import { Logger } from "@toetslib/shared";

export class AuthHandler {
  private logger: Logger;

  constructor(verbose = false) {
    this.logger = new Logger(verbose);
  }

  async login(
    page: Page,
    baseUrl: string,
    config: PipelineConfig
  ): Promise<boolean> {
    const { auth } = config;

    if (!auth.url || !auth.email || !auth.password) {
      this.logger.debug("No auth credentials provided, skipping login");
      return false;
    }

    const loginUrl = auth.url.startsWith("http")
      ? auth.url
      : `${baseUrl}${auth.url}`;

    this.logger.debug(`Navigating to login: ${loginUrl}`);

    try {
      await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 15000 });

      // Wait for form to be ready
      await page.waitForTimeout(1000);

      // Find and fill email field
      const emailFilled = await this.fillField(page, auth.email, [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        '#email',
        '[autocomplete="email"]',
      ]);

      if (!emailFilled) {
        this.logger.warn("Could not find email input field");
        return false;
      }

      // Find and fill password field
      const passwordFilled = await this.fillField(page, auth.password, [
        'input[type="password"]',
        'input[name="password"]',
        '#password',
        '[autocomplete="current-password"]',
      ]);

      if (!passwordFilled) {
        this.logger.warn("Could not find password input field");
        return false;
      }

      // Find and click submit button
      const submitted = await this.clickSubmit(page, [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'input[type="submit"]',
      ]);

      if (!submitted) {
        this.logger.warn("Could not find submit button");
        return false;
      }

      // Wait for navigation after login
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Check if we're still on the login page (login may have failed)
      const currentUrl = page.url();
      if (currentUrl.includes("/login") || currentUrl.includes("/signin")) {
        this.logger.warn("Still on login page after submit — login may have failed");
        return false;
      }

      this.logger.debug(`Login successful, redirected to: ${currentUrl}`);
      return true;
    } catch (error) {
      this.logger.warn(`Login failed: ${(error as Error).message}`);
      return false;
    }
  }

  private async fillField(
    page: Page,
    value: string,
    selectors: string[]
  ): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 2000 })) {
          await locator.fill(value);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async clickSubmit(
    page: Page,
    selectors: string[]
  ): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 2000 })) {
          await locator.click();
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }
}
