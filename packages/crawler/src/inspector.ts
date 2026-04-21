import type { Page } from "playwright";
import type { InteractiveElement } from "@toetslib/core";

export class PageInspector {
  async inspect(page: Page): Promise<InteractiveElement[]> {
    const elements: InteractiveElement[] = [];

    // Find interactive elements via Playwright locators
    const interactiveSelectors = [
      { selector: "button", type: "button" as const },
      { selector: 'a[href]', type: "link" as const },
      { selector: "input", type: "input" as const },
      { selector: "select", type: "select" as const },
      { selector: 'input[type="checkbox"]', type: "checkbox" as const },
      { selector: '[role="button"]', type: "button" as const },
      { selector: '[role="link"]', type: "link" as const },
      { selector: '[role="tab"]', type: "button" as const },
      { selector: "textarea", type: "input" as const },
    ];

    for (const { selector, type } of interactiveSelectors) {
      try {
        const locator = page.locator(selector);
        const count = await locator.count();

        for (let i = 0; i < count; i++) {
          try {
            const el = locator.nth(i);
            const isVisible = await el.isVisible().catch(() => false);
            if (!isVisible) continue;

            const text = await el.innerText().catch(() => "");
            const ariaRole = await el.getAttribute("role").catch(() => null);
            const ariaLabel = await el.getAttribute("aria-label").catch(() => null);
            const testId = await el.getAttribute("data-testid").catch(() => null);
            const name = await el.getAttribute("name").catch(() => null);
            const id = await el.getAttribute("id").catch(() => null);
            const placeholder = await el.getAttribute("placeholder").catch(() => null);

            // Build best selector
            let bestSelector: string;
            if (testId) {
              bestSelector = `[data-testid="${testId}"]`;
            } else if (ariaLabel) {
              bestSelector = `${type === "button" ? "button" : selector}[aria-label="${ariaLabel}"]`;
            } else if (name) {
              bestSelector = `[name="${name}"]`;
            } else if (id) {
              bestSelector = `#${id}`;
            } else if (text.trim() && text.trim().length < 50) {
              bestSelector = `text="${text.trim()}"`;
            } else {
              bestSelector = selector;
            }

            const displayText = text.trim().slice(0, 80) || placeholder || name || ariaLabel || "";

            elements.push({
              type,
              text: displayText,
              selector: bestSelector,
              ariaRole,
              ariaLabel,
            });
          } catch {
            // Element became stale, skip
          }
        }
      } catch {
        // Selector failed, skip
      }
    }

    // Deduplicate by selector
    const seen = new Set<string>();
    return elements.filter((el) => {
      if (seen.has(el.selector)) return false;
      seen.add(el.selector);
      return true;
    });
  }
}
