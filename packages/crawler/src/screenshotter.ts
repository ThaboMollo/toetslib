import type { Page } from "playwright";
import type { Screenshot } from "@toetslib/core";
import { writeFileContent } from "@toetslib/shared";
import { join } from "node:path";
import { VIEWPORTS } from "./browser.js";

export class Screenshotter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = join(outputDir, ".toetslib", "screenshots");
  }

  async capture(
    page: Page,
    route: string
  ): Promise<Screenshot[]> {
    const screenshots: Screenshot[] = [];
    const safeName = route.replace(/\//g, "_").replace(/^_/, "") || "root";

    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const vp = viewportName as "mobile" | "tablet" | "desktop";

      try {
        await page.setViewportSize(viewport);
        // Small wait for responsive layout to settle
        await page.waitForTimeout(300);

        const fileName = `${safeName}-${vp}.png`;
        const filePath = join(this.outputDir, fileName);
        const buffer = await page.screenshot({ fullPage: true });

        await writeFileContent(filePath, "");
        const { writeFile } = await import("node:fs/promises");
        await writeFile(filePath, buffer);

        screenshots.push({
          route,
          viewport: vp,
          filePath,
          width: viewport.width,
          height: viewport.height,
        });
      } catch {
        // Screenshot failed for this viewport, skip
      }
    }

    return screenshots;
  }
}
