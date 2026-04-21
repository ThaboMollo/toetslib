import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AppMap, TestPlan } from "@toetslib/core";
import { LlmClient, writeFileContent } from "@toetslib/shared";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.js";
import { buildPageObjectPrompt } from "./prompts/page-object.js";
import prettier from "prettier";

export class PageObjectWriter {
  private llm: LlmClient;
  private outputDir: string;

  constructor(llm: LlmClient, outputDir: string) {
    this.llm = llm;
    this.outputDir = outputDir;
  }

  async generate(
    appMap: AppMap,
    testPlan: TestPlan
  ): Promise<Map<string, string>> {
    const pageObjects = new Map<string, string>();
    const neededPageObjects = new Set(testPlan.files.map((f) => f.pageObject));

    for (const poFileName of neededPageObjects) {
      // Find the route this page object is for
      const testFile = testPlan.files.find((f) => f.pageObject === poFileName);
      if (!testFile) continue;

      // Infer route from the test file name
      const route = this.inferRoute(poFileName, appMap);
      if (!route) continue;

      const routeInfo = appMap.routes.find((r) => r.path === route);
      const crawledPage = appMap.pages.find((p) => p.route === route);
      const formSpec = appMap.forms.find((f) => f.pageRoute === route);

      const prompt = buildPageObjectPrompt(
        route,
        routeInfo?.componentName ?? "Page",
        crawledPage,
        formSpec
      );

      // Include screenshot if available
      let response: string;
      if (crawledPage?.screenshotPath) {
        try {
          const screenshotBuffer = readFileSync(crawledPage.screenshotPath);
          const base64 = screenshotBuffer.toString("base64");
          response = await this.llm.generateWithImages({
            system: BASE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
            maxTokens: 4096,
            images: [{ data: base64, mediaType: "image/png" }],
          });
        } catch {
          // Fall back to text-only if image fails
          response = await this.llm.generate({
            system: BASE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
            maxTokens: 4096,
          });
        }
      } else {
        response = await this.llm.generate({
          system: BASE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 4096,
        });
      }

      const code = this.extractCode(response);
      const formatted = await this.formatCode(code);

      const filePath = join(this.outputDir, "pages", poFileName);
      await writeFileContent(filePath, formatted);
      pageObjects.set(poFileName, formatted);
    }

    return pageObjects;
  }

  private inferRoute(poFileName: string, appMap: AppMap): string | null {
    // page-object-name.page.ts -> try to match a route
    const baseName = poFileName.replace(".page.ts", "");

    // Direct matches
    for (const route of appMap.routes) {
      const routeBase = route.path
        .replace(/\//g, "-")
        .replace(/^-/, "")
        .toLowerCase();
      const componentBase = route.componentName.toLowerCase();

      if (
        baseName === routeBase ||
        baseName === componentBase ||
        baseName.includes(componentBase) ||
        componentBase.includes(baseName.replace(/-/g, ""))
      ) {
        return route.path;
      }
    }

    // Fuzzy match: landing -> /, payroll -> /payroll, etc.
    const fuzzyMap: Record<string, string> = {};
    for (const route of appMap.routes) {
      const parts = route.path.split("/").filter(Boolean);
      if (parts.length === 0) {
        fuzzyMap["landing"] = route.path;
        fuzzyMap["home"] = route.path;
        fuzzyMap["root"] = route.path;
      } else {
        fuzzyMap[parts.join("-")] = route.path;
        fuzzyMap[parts[parts.length - 1]!] = route.path;
      }
    }

    return fuzzyMap[baseName] ?? null;
  }

  private extractCode(response: string): string {
    // Extract from markdown code block
    const match = response.match(/```(?:typescript|ts)?\s*(?::[\w.-]+)?\s*\n([\s\S]*?)\n```/);
    if (match) return match[1]!;

    // If no code block, assume the whole response is code
    return response;
  }

  private async formatCode(code: string): Promise<string> {
    try {
      return await prettier.format(code, {
        parser: "typescript",
        singleQuote: true,
        trailingComma: "all",
        printWidth: 100,
      });
    } catch {
      return code;
    }
  }
}
