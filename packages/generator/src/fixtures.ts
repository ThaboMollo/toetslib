import { join } from "node:path";
import type { AppMap } from "@toetslib/core";
import { writeFileContent } from "@toetslib/shared";

export class FixtureWriter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async generate(appMap: AppMap): Promise<void> {
    await this.writeBaseFixture();
    await this.writeTestData(appMap);
    if (appMap.auth.type !== "none" && appMap.auth.loginRoute) {
      await this.writeAuthSetup(appMap);
    }
  }

  private async writeBaseFixture(): Promise<void> {
    const code = `import { test as base } from '@playwright/test';

export const test = base;
export { expect } from '@playwright/test';
`;

    await writeFileContent(
      join(this.outputDir, "fixtures", "base.fixture.ts"),
      code
    );
  }

  private async writeTestData(appMap: AppMap): Promise<void> {
    // Generate realistic test data based on detected form fields
    const dataEntries: string[] = [];

    for (const form of appMap.forms) {
      const objName = this.formRouteToVarName(form.pageRoute);
      const fields: string[] = [];

      for (const field of form.fields) {
        const value = this.generateTestValue(field.name, field.type);
        fields.push(`  ${field.name}: ${JSON.stringify(value)}`);
      }

      if (fields.length > 0) {
        dataEntries.push(
          `export const ${objName}Data = {\n${fields.join(",\n")},\n};`
        );
      }
    }

    const code = `// Auto-generated test data for form filling
// Adjust values to match your application's requirements

${dataEntries.join("\n\n")}
`;

    await writeFileContent(
      join(this.outputDir, "fixtures", "test-data.ts"),
      code
    );
  }

  private async writeAuthSetup(appMap: AppMap): Promise<void> {
    const code = `import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('${appMap.auth.loginRoute}');

  // Fill login form — update selectors to match your app
  await page.getByLabel('Email').fill(process.env.TEST_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');
  await page.getByRole('button', { name: /log in|sign in/i }).click();

  // Wait for redirect after login
  await page.waitForURL('**/${appMap.routes.find((r) => r.isPublic && r.path !== "/")?.path ?? ""}**');

  // Save auth state
  await page.context().storageState({ path: AUTH_FILE });
});
`;

    await writeFileContent(
      join(this.outputDir, "fixtures", "auth.setup.ts"),
      code
    );
  }

  private formRouteToVarName(route: string): string {
    if (route === "/") return "landing";
    return route
      .replace(/^\//, "")
      .replace(/\//g, "_")
      .replace(/-/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
  }

  private generateTestValue(fieldName: string, fieldType: string): string {
    const name = fieldName.toLowerCase();

    // Name fields
    if (name.includes("firstname") || name === "first_name") return "Thabo";
    if (name.includes("lastname") || name === "last_name") return "Molefe";
    if (name.includes("name") && !name.includes("user")) return "Test User";

    // Contact fields
    if (name.includes("email")) return "test@example.com";
    if (name.includes("phone") || name.includes("whatsapp")) return "0712345678";

    // ID/Tax
    if (name.includes("idnumber") || name === "id_number") return "9001015009087";
    if (name.includes("taxnumber") || name === "tax_number") return "1234567890";
    if (name.includes("passport")) return "A12345678";
    if (name.includes("asylum")) return "ASY123456";

    // Address
    if (name.includes("line1") || name.includes("street")) return "123 Test Street";
    if (name.includes("line2")) return "Unit 4";
    if (name.includes("city")) return "Johannesburg";
    if (name.includes("postal") || name.includes("zip")) return "2000";

    // Employment
    if (name.includes("position") || name.includes("title") || name.includes("contracttitle")) return "Software Developer";
    if (name.includes("salary") || name.includes("gross")) return "25000";
    if (name.includes("leave")) return "15";

    // Money
    if (fieldType === "money") return "15000.00";

    // Date
    if (fieldType === "date") return "2024-01-15";

    // Select
    if (fieldType === "select") return "";

    // Message/textarea
    if (name.includes("message") || fieldType === "textarea") return "This is a test message.";

    // Default
    return "test-value";
  }
}
