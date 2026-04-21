import type { CrawledPage, FormSpec } from "@toetslib/core";

export function buildPageObjectPrompt(
  route: string,
  componentName: string,
  crawledPage: CrawledPage | undefined,
  formSpec: FormSpec | undefined
): string {
  const elements = crawledPage?.interactiveElements ?? [];
  const fields = formSpec?.fields ?? [];

  const elementList = elements
    .map((e) => `  - [${e.type}] "${e.text}" selector: ${e.selector}${e.ariaLabel ? ` aria-label: "${e.ariaLabel}"` : ""}`)
    .join("\n");

  const fieldList = fields
    .map((f) => `  - ${f.name} (${f.type}, label: "${f.label}", required: ${f.required})`)
    .join("\n");

  return `Generate a Playwright Page Object Model for this page.

## Page Info
- Route: ${route}
- Component: ${componentName}
- Title: ${crawledPage?.title ?? "unknown"}

## Interactive Elements Found by Crawler
${elementList || "  (none found)"}

## Form Fields (from static analysis)
${fieldList || "  (no forms on this page)"}

## Instructions

Generate a TypeScript Page Object class with:
1. A \`page\` property and constructor that takes \`Page\`
2. A \`goto()\` method that navigates to the route
3. Getter properties for each interactive element using the best available selector
4. Helper methods for common actions (e.g., \`fillForm(data)\`, \`submit()\`)
5. Use Playwright's recommended locator strategies (getByRole, getByLabel, getByText)

Name the class \`${componentName}Page\`.

Respond with a single TypeScript code block. No explanations.`;
}
