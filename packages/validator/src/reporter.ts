import { join } from "node:path";
import { writeFileContent, Logger } from "@toetslib/shared";
import type { PlaywrightResult } from "./runner.js";
import type { ParsedFailure } from "./failure-parser.js";

interface DiagnosticReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: string;
  };
  failures: Array<{
    test: string;
    file: string;
    category: string;
    error: string;
    selector: string | null;
    expected: string | null;
    actual: string | null;
    fix: string;
  }>;
  recommendations: string[];
}

const FIX_GUIDES: Record<string, string> = {
  selector: [
    "**Selector not found.** The element the test is looking for doesn't match the actual DOM.",
    "1. Open the page in a browser and inspect the target element",
    "2. Check if the element has a `data-testid`, `aria-label`, or unique `role`",
    "3. Update the page object's locator to use `page.getByTestId()`, `page.getByRole()`, or `page.getByLabel()`",
    "4. Avoid CSS class selectors — they break when styles change",
  ].join("\n"),

  timeout: [
    "**Element didn't appear in time.** The page may be loading slowly or the element is conditionally rendered.",
    "1. Check if the element requires data from an API call — the backend may not be running",
    "2. Check if the element is behind an `isAuthenticated` or `isLoading` guard",
    "3. If the element appears after an animation, add `await page.waitForLoadState('networkidle')` before the assertion",
    "4. Increase the assertion timeout: `await expect(locator).toBeVisible({ timeout: 10000 })`",
  ].join("\n"),

  assertion: [
    "**Assertion mismatch.** The element exists but its content doesn't match what the test expects.",
    "1. Check if the expected text has changed (e.g. currency formatting, date format, translations)",
    "2. Use flexible matchers: `toContainText()` instead of `toHaveText()` for partial matches",
    "3. Use regex for values with formatting: `expect(locator).toHaveText(/R\\s?15/)`",
    "4. Check if the value depends on backend data that isn't available in test mode",
  ].join("\n"),

  navigation: [
    "**Navigation failed.** The page couldn't be loaded or a redirect didn't go where expected.",
    "1. Check if the dev server is running and the URL is correct",
    "2. Check if the route requires authentication — you may need to set up auth in the test",
    "3. Check for HTTPS certificate issues — ensure `ignoreHTTPSErrors: true` in playwright.config.ts",
    "4. Check if the route redirects (e.g. `/` redirects to `/payroll` for authenticated users)",
  ].join("\n"),

  unknown: [
    "**Unexpected error.** The failure doesn't match a known pattern.",
    "1. Read the full error message and stack trace in the test results",
    "2. Run the failing test in headed mode: `npx playwright test <file> --headed`",
    "3. Use Playwright's trace viewer: `npx playwright show-trace test-results/<trace>.zip`",
    "4. Check if the test depends on state from a previous test (tests should be independent)",
  ].join("\n"),
};

export class ReportWriter {
  private logger: Logger;

  constructor(verbose = false) {
    this.logger = new Logger(verbose);
  }

  async write(
    result: PlaywrightResult,
    failures: ParsedFailure[],
    outputDir: string
  ): Promise<void> {
    const report = this.buildReport(result, failures);

    // Write JSON report
    await writeFileContent(
      join(outputDir, ".toetslib-report.json"),
      JSON.stringify(report, null, 2)
    );

    // Write human-readable markdown spec
    const markdown = this.buildMarkdownSpec(report, failures);
    await writeFileContent(
      join(outputDir, "DIAGNOSTIC.md"),
      markdown
    );

    // Print summary to console
    this.printSummary(report);
  }

  private buildReport(
    result: PlaywrightResult,
    failures: ParsedFailure[]
  ): DiagnosticReport {
    const passRate =
      result.total > 0
        ? `${Math.round((result.passed / result.total) * 100)}%`
        : "N/A";

    return {
      summary: {
        total: result.total,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        passRate,
      },
      failures: failures.map((f) => ({
        test: f.testName,
        file: f.specFile,
        category: f.category,
        error: f.error,
        selector: f.selector,
        expected: f.expected,
        actual: f.actual,
        fix: FIX_GUIDES[f.category] ?? FIX_GUIDES["unknown"]!,
      })),
      recommendations: this.buildRecommendations(failures),
    };
  }

  private buildMarkdownSpec(
    report: DiagnosticReport,
    failures: ParsedFailure[]
  ): string {
    const lines: string[] = [];

    lines.push("# toetsLib Diagnostic Report");
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total tests | ${report.summary.total} |`);
    lines.push(`| Passed | ${report.summary.passed} |`);
    lines.push(`| Failed | ${report.summary.failed} |`);
    lines.push(`| Skipped | ${report.summary.skipped} |`);
    lines.push(`| Pass rate | ${report.summary.passRate} |`);
    lines.push("");

    if (report.failures.length === 0) {
      lines.push("All tests passed. No issues found.");
      return lines.join("\n");
    }

    // Group failures by category
    const byCategory = new Map<string, typeof report.failures>();
    for (const f of report.failures) {
      const list = byCategory.get(f.category) ?? [];
      list.push(f);
      byCategory.set(f.category, list);
    }

    lines.push("## Failures");
    lines.push("");

    let issueNum = 1;
    for (const [category, categoryFailures] of byCategory) {
      const label = category.charAt(0).toUpperCase() + category.slice(1);
      lines.push(`### ${label} Issues (${categoryFailures.length})`);
      lines.push("");

      for (const f of categoryFailures) {
        lines.push(`#### Issue ${issueNum}: ${f.test}`);
        lines.push("");
        lines.push(`**File:** \`${f.file}\``);
        lines.push(`**Error:** \`${f.error.slice(0, 200)}\``);
        if (f.selector) {
          lines.push(`**Selector:** \`${f.selector}\``);
        }
        if (f.expected && f.actual) {
          lines.push(`**Expected:** \`${f.expected}\``);
          lines.push(`**Actual:** \`${f.actual}\``);
        }
        lines.push("");
        lines.push("**How to fix:**");
        lines.push("");
        lines.push(f.fix);
        lines.push("");
        issueNum++;
      }
    }

    if (report.recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("*Generated by toetsLib*");

    return lines.join("\n");
  }

  private buildRecommendations(failures: ParsedFailure[]): string[] {
    const recs: string[] = [];
    const categories = new Set(failures.map((f) => f.category));

    if (categories.has("selector")) {
      recs.push(
        "Add `data-testid` attributes to key interactive elements. This makes selectors stable across style changes."
      );
    }

    if (categories.has("timeout")) {
      recs.push(
        "Ensure the backend API is running during tests, or mock API responses with Playwright's route interception."
      );
    }

    if (categories.has("navigation")) {
      recs.push(
        "Check that all routes are accessible without authentication, or configure auth credentials in `.toetslib.json`."
      );
    }

    if (failures.length > 5) {
      recs.push(
        "Consider running tests with `--headed` and `--debug` flags to visually inspect failures: `npx playwright test --headed --debug`"
      );
    }

    if (failures.length === 0) {
      recs.push(
        "All tests pass. Consider adding more edge case tests for form validation and error states."
      );
    }

    return recs;
  }

  private printSummary(report: DiagnosticReport): void {
    this.logger.info("");
    this.logger.info(`Results: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped (${report.summary.passRate})`);

    if (report.failures.length > 0) {
      this.logger.info("");

      const byCategory = new Map<string, number>();
      for (const f of report.failures) {
        byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
      }

      for (const [category, count] of byCategory) {
        this.logger.warn(`  ${count} ${category} issue${count > 1 ? "s" : ""}`);
      }

      this.logger.info("");
      this.logger.info("See DIAGNOSTIC.md for detailed fix instructions.");
    }
  }
}
