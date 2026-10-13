import { join } from "node:path";
import type { AppMap, PipelineConfig } from "@toetslib/core";
import { writeFileContent } from "@toetslib/shared";

export class ConfigWriter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async generate(appMap: AppMap, config?: PipelineConfig): Promise<void> {
    // Prefer the URL actually crawled. Falling back to localhost:devPort was
    // previously unconditional, which pointed the generated suite at the wrong
    // host whenever --base-url was used — and guessed https for every Vite app.
    const baseUrl =
      config?.baseUrl ?? `http://localhost:${appMap.project.devPort}`;

    // An externally managed app must not be booted by Playwright: the command
    // either does not exist or takes far longer than a webServer timeout.
    const webServer = config?.externalServer
      ? ""
      : `
  webServer: {
    command: '${appMap.project.devCommand}',
    url: '${baseUrl}',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    ignoreHTTPSErrors: true,
  },`;

    const contents = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: '${baseUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],${webServer}
});
`;

    await writeFileContent(
      join(this.outputDir, "playwright.config.ts"),
      contents
    );
  }
}
