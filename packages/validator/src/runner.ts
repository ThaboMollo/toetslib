import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Logger } from "@toetslib/shared";

export interface PlaywrightResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  rawOutput: string;
  jsonReport: unknown | null;
}

export class TestRunner {
  private logger: Logger;

  constructor(verbose = false) {
    this.logger = new Logger(verbose);
  }

  async run(outputDir: string): Promise<PlaywrightResult> {
    const configPath = join(outputDir, "playwright.config.ts");

    if (!existsSync(configPath)) {
      throw new Error(
        `No playwright.config.ts found in ${outputDir}. Run 'toetslib generate' first.`
      );
    }

    this.logger.debug(`Running Playwright tests from ${outputDir}`);

    const result = await this.execPlaywright(outputDir);
    return result;
  }

  private execPlaywright(cwd: string): Promise<PlaywrightResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(
        "npx",
        [
          "playwright",
          "test",
          "--reporter=json,line",
          "--output=test-results",
        ],
        {
          cwd,
          shell: true,
          stdio: "pipe",
          env: {
            ...process.env,
            PLAYWRIGHT_JSON_OUTPUT_NAME: "test-results.json",
          },
        }
      );

      proc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.logger.debug(`[playwright] ${text.trim()}`);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this.logger.debug(`[playwright:err] ${text.trim()}`);
      });

      proc.on("close", () => {
        // Try to read the JSON report
        let jsonReport: unknown | null = null;
        const jsonPath = join(cwd, "test-results.json");
        if (existsSync(jsonPath)) {
          try {
            jsonReport = JSON.parse(readFileSync(jsonPath, "utf-8"));
          } catch {
            // JSON report not parseable
          }
        }

        // Parse counts from stdout
        const counts = this.parseCounts(stdout + stderr);

        resolve({
          ...counts,
          rawOutput: stdout + stderr,
          jsonReport,
        });
      });
    });
  }

  private parseCounts(output: string): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  } {
    // Playwright outputs: "X passed", "X failed", "X skipped"
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const skippedMatch = output.match(/(\d+) skipped/);

    const passed = passedMatch ? parseInt(passedMatch[1]!, 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]!, 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1]!, 10) : 0;

    return {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
    };
  }
}
