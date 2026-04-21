export interface ParsedFailure {
  testName: string;
  specFile: string;
  error: string;
  expected: string | null;
  actual: string | null;
  selector: string | null;
  lineNumber: number | null;
  stackTrace: string;
  category: "selector" | "timeout" | "assertion" | "navigation" | "unknown";
}

export class FailureParser {
  parse(jsonReport: unknown): ParsedFailure[] {
    if (!jsonReport || typeof jsonReport !== "object") return [];

    const report = jsonReport as {
      suites?: Array<{
        title: string;
        file: string;
        specs?: Array<{
          title: string;
          tests?: Array<{
            results?: Array<{
              status: string;
              error?: { message?: string; stack?: string };
            }>;
          }>;
        }>;
        suites?: Array<unknown>;
      }>;
    };

    const failures: ParsedFailure[] = [];
    this.walkSuites(report.suites ?? [], failures);
    return failures;
  }

  parseFromRawOutput(output: string): ParsedFailure[] {
    const failures: ParsedFailure[] = [];

    // Match Playwright error blocks:
    // ──── Test title ─────
    //   Error: ...
    const errorBlocks = output.split(/\s+\d+\)\s+/);

    for (const block of errorBlocks.slice(1)) {
      const titleMatch = block.match(/^(.+?)(?:\s+[-─]+)/);
      const errorMatch = block.match(/Error:(.+?)(?:\n\s+at\s|\n\n)/s);

      if (titleMatch) {
        const error = errorMatch ? errorMatch[1]!.trim() : block.slice(0, 200);
        failures.push({
          testName: titleMatch[1]!.trim(),
          specFile: "",
          error,
          expected: null,
          actual: null,
          selector: this.extractSelector(error),
          lineNumber: null,
          stackTrace: block.slice(0, 500),
          category: this.categorize(error),
        });
      }
    }

    return failures;
  }

  private walkSuites(
    suites: Array<{
      title?: string;
      file?: string;
      specs?: Array<{
        title: string;
        tests?: Array<{
          results?: Array<{
            status: string;
            error?: { message?: string; stack?: string };
          }>;
        }>;
      }>;
      suites?: Array<unknown>;
    }>,
    failures: ParsedFailure[]
  ): void {
    for (const suite of suites) {
      const specFile = suite.file ?? "";

      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            if (result.status === "failed" && result.error) {
              const error = result.error.message ?? "Unknown error";
              const stack = result.error.stack ?? "";

              failures.push({
                testName: spec.title,
                specFile,
                error,
                expected: this.extractExpected(error),
                actual: this.extractActual(error),
                selector: this.extractSelector(error),
                lineNumber: this.extractLineNumber(stack),
                stackTrace: stack.slice(0, 500),
                category: this.categorize(error),
              });
            }
          }
        }
      }

      // Recurse into nested suites
      if (suite.suites) {
        this.walkSuites(
          suite.suites as typeof suites,
          failures
        );
      }
    }
  }

  private categorize(
    error: string
  ): ParsedFailure["category"] {
    const lower = error.toLowerCase();

    if (
      lower.includes("locator resolved to 0 elements") ||
      lower.includes("no element matches") ||
      lower.includes("strict mode violation")
    ) {
      return "selector";
    }

    if (
      lower.includes("timeout") ||
      lower.includes("waiting for") ||
      lower.includes("exceeded")
    ) {
      return "timeout";
    }

    if (
      lower.includes("expect(") ||
      lower.includes("expected") ||
      lower.includes("tobetruthy") ||
      lower.includes("tobevisible") ||
      lower.includes("tohavetext") ||
      lower.includes("tohaveurl")
    ) {
      return "assertion";
    }

    if (
      lower.includes("navigation") ||
      lower.includes("goto") ||
      lower.includes("net::err")
    ) {
      return "navigation";
    }

    return "unknown";
  }

  private extractSelector(error: string): string | null {
    // "locator('button:has-text("Save")') resolved to 0 elements"
    const match = error.match(/locator\(['"](.+?)['"]\)/);
    if (match) return match[1]!;

    // "getByRole('button', { name: 'Save' })"
    const roleMatch = error.match(/getBy\w+\(.+?\)/);
    if (roleMatch) return roleMatch[0];

    return null;
  }

  private extractExpected(error: string): string | null {
    const match = error.match(/Expected:\s*(.+?)(?:\n|$)/);
    return match ? match[1]!.trim() : null;
  }

  private extractActual(error: string): string | null {
    const match = error.match(/Received:\s*(.+?)(?:\n|$)/);
    return match ? match[1]!.trim() : null;
  }

  private extractLineNumber(stack: string): number | null {
    const match = stack.match(/:(\d+):\d+\)?$/m);
    return match ? parseInt(match[1]!, 10) : null;
  }
}
