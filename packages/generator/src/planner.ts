import type { AppMap, TestPlan } from "@toetslib/core";
import { LlmClient } from "@toetslib/shared";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.js";
import { buildTestPlanPrompt } from "./prompts/test-plan.js";

export class TestPlanner {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  async plan(appMap: AppMap): Promise<TestPlan> {
    const prompt = buildTestPlanPrompt(appMap);

    const response = await this.llm.generate({
      system: BASE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 8192,
    });

    const testPlan = this.parseTestPlan(response);
    return testPlan;
  }

  private parseTestPlan(response: string): TestPlan {
    // Extract JSON from the response (may be wrapped in markdown code block)
    let jsonStr = response;

    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!;
    }

    // Try to find raw JSON object
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr) as TestPlan;

      // Validate and fix totalTests
      const actualTotal = parsed.files.reduce(
        (sum, f) => sum + f.tests.length,
        0
      );
      parsed.totalTests = actualTotal;

      return parsed;
    } catch (error) {
      throw new Error(
        `Failed to parse test plan JSON from LLM response: ${(error as Error).message}\nResponse: ${response.slice(0, 500)}`
      );
    }
  }
}
