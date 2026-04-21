import type { AppMap } from "@toetslib/core";

export function buildTestPlanPrompt(appMap: AppMap): string {
  const routeSummary = appMap.routes
    .map((r) => {
      const formInfo = appMap.forms.find((f) => f.pageRoute === r.path);
      const pageInfo = appMap.pages.find((p) => p.route === r.path);
      const fieldCount = formInfo?.fields.length ?? 0;
      const elementCount = pageInfo?.interactiveElements.length ?? 0;
      return `  - ${r.path} (${r.componentName}, ${r.isPublic ? "public" : "auth-required"}, ${fieldCount} form fields, ${elementCount} interactive elements)`;
    })
    .join("\n");

  const authSummary = `Auth: ${appMap.auth.type}, trial mode: ${appMap.auth.trialMode}, login: ${appMap.auth.loginRoute ?? "none"}`;

  return `Generate a test plan for this React application.

## Application Summary

Framework: ${appMap.project.framework}
Base URL: http://localhost:${appMap.project.devPort}
${authSummary}

## Routes
${routeSummary}

## Forms
${appMap.forms.map((f) => `  - ${f.pageRoute}: ${f.fields.map((ff) => ff.name).join(", ")}`).join("\n")}

## Instructions

Create a JSON test plan. For each route that has meaningful content, decide which test categories apply:
- **smoke**: page loads, key elements visible, no console errors
- **happy-path**: core user flows (fill form, submit, navigate)
- **validation**: form validation errors on bad/missing input
- **edge-case**: empty states, loading states, boundary conditions
- **responsive**: layout works at mobile (375px), tablet (768px), desktop (1280px)

Group tests into spec files by feature area (not by route). For example, employee creation and employee editing can be in the same file if they share a page object.

Respond with ONLY valid JSON matching this structure:
{
  "files": [
    {
      "name": "spec-file-name.spec.ts",
      "pageObject": "page-object-name.page.ts",
      "tests": [
        {
          "name": "descriptive test name",
          "category": "smoke|happy-path|validation|edge-case|responsive",
          "steps": ["step 1 description", "step 2 description"]
        }
      ]
    }
  ],
  "totalTests": 0
}`;
}
