import { join } from "node:path";
import type { AppMap, TestPlan } from "@toetslib/core";
import { LlmClient, writeFileContent } from "@toetslib/shared";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.js";
import { buildTestGenPrompt } from "./prompts/test-gen.js";
import prettier from "prettier";

export class TestWriter {
  private llm: LlmClient;
  private outputDir: string;

  constructor(llm: LlmClient, outputDir: string) {
    this.llm = llm;
    this.outputDir = outputDir;
  }

  async generate(
    appMap: AppMap,
    testPlan: TestPlan,
    pageObjects: Map<string, string>
  ): Promise<void> {
    for (const testFile of testPlan.files) {
      const pageObjectCode = pageObjects.get(testFile.pageObject) ?? "";

      const prompt = buildTestGenPrompt(testFile, pageObjectCode);

      const response = await this.llm.generate({
        system: BASE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 8192,
      });

      const code = this.extractCode(response);
      const formatted = await this.formatCode(code);

      const filePath = join(this.outputDir, "tests", testFile.name);
      await writeFileContent(filePath, formatted);
    }
  }

  private extractCode(response: string): string {
    const match = response.match(/```(?:typescript|ts)?\s*(?::[\w.-]+)?\s*\n([\s\S]*?)\n```/);
    if (match) return match[1]!;
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
