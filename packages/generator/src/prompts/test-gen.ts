import type { TestFileSpec } from "@toetslib/core";

export function buildTestGenPrompt(
  testFile: TestFileSpec,
  pageObjectCode: string
): string {
  const testList = testFile.tests
    .map((t) => `  - "${t.name}" [${t.category}]\n    Steps: ${t.steps.join(" → ")}`)
    .join("\n");

  return `Generate a Playwright test spec file using the provided page object.

## Page Object Code
\`\`\`typescript
${pageObjectCode}
\`\`\`

## Tests to Generate
${testList}

## Instructions

1. Import the page object from \`../pages/${testFile.pageObject}\`
2. Import \`test\` and \`expect\` from \`@playwright/test\`
3. Use \`test.describe\` to group all tests
4. Use \`test.beforeEach\` to create the page object and navigate if all tests start on the same page
5. Each test should be independent and follow the steps listed above
6. Use web-first assertions (\`await expect(...).toBeVisible()\`)
7. For form tests, create realistic test data inline (South African context: names, ID numbers, etc.)
8. For validation tests, submit with missing/invalid data and assert error messages appear
9. For responsive tests, set viewport with \`page.setViewportSize()\` and assert layout changes

Respond with a single TypeScript code block. No explanations.`;
}
