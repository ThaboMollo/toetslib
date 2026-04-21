import { join } from "node:path";
import type { AppMap } from "@toetslib/core";
import { writeFileContent } from "@toetslib/shared";

export class ConfigWriter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async generate(appMap: AppMap): Promise<void> {
    const baseUrl = `http${appMap.project.framework === "react-vite" ? "s" : ""}://localhost:${appMap.project.devPort}`;

    const config = `import { defineConfig, devices } from '@playwright/test';

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
  ],
  webServer: {
    command: '${appMap.project.devCommand}',
    url: '${baseUrl}',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    ignoreHTTPSErrors: true,
  },
});
`;

    await writeFileContent(
      join(this.outputDir, "playwright.config.ts"),
      config
    );
  }
}
