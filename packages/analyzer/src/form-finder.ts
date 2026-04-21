import type { FormSpec, FormField, ComponentMap } from "@toetslib/core";
import { globFiles } from "@toetslib/shared";
import { parseFile, traverse, t } from "./ast-utils.js";

/**
 * Known form component names and their field types.
 * This mapping covers @lefa/shared components and common React form libraries.
 */
const FORM_COMPONENT_MAP: Record<string, FormField["type"]> = {
  InputField: "text",
  MoneyInput: "money",
  SelectField: "select",
  ThemedDropdown: "select",
  SingleDatePicker: "date",
  RadioButtonCheck: "radio",
  InputArea: "textarea",
  ThemedCheckbox: "checkbox",
  InlineInput: "text",
};

/**
 * HTML form elements and their types.
 */
const HTML_FORM_ELEMENTS: Record<string, FormField["type"]> = {
  input: "text",
  select: "select",
  textarea: "textarea",
};

export class FormFinder {
  private srcDir: string;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async find(componentMaps: ComponentMap[]): Promise<FormSpec[]> {
    const forms: FormSpec[] = [];

    // Scan page component files and their child component files
    const filesToScan = new Set<string>();
    const fileToRoute = new Map<string, string>();

    for (const comp of componentMaps) {
      filesToScan.add(comp.filePath);
      fileToRoute.set(comp.filePath, comp.route);

      for (const importPath of comp.imports) {
        filesToScan.add(importPath);
        if (!fileToRoute.has(importPath)) {
          fileToRoute.set(importPath, comp.route);
        }
      }
    }

    // Group fields by route
    const routeFields = new Map<string, FormField[]>();
    const routeSubmitSelectors = new Map<string, string>();

    for (const filePath of filesToScan) {
      try {
        const fields = this.extractFormFields(filePath);
        const route = fileToRoute.get(filePath);
        if (!route || fields.length === 0) continue;

        const existing = routeFields.get(route) ?? [];
        routeFields.set(route, [...existing, ...fields]);

        // Look for submit handlers
        const submitSelector = this.findSubmitSelector(filePath);
        if (submitSelector) {
          routeSubmitSelectors.set(route, submitSelector);
        }
      } catch {
        // Can't parse file
      }
    }

    // Build FormSpec per route (only if forms found)
    for (const [route, fields] of routeFields) {
      if (fields.length === 0) continue;

      // Deduplicate fields by name
      const seenNames = new Set<string>();
      const uniqueFields: FormField[] = [];
      for (const field of fields) {
        if (!seenNames.has(field.name)) {
          seenNames.add(field.name);
          uniqueFields.push(field);
        }
      }

      forms.push({
        pageRoute: route,
        fields: uniqueFields,
        submitSelector: routeSubmitSelectors.get(route) ?? "",
        validationRules: [],
      });
    }

    return forms;
  }

  private extractFormFields(filePath: string): FormField[] {
    const ast = parseFile(filePath);
    const fields: FormField[] = [];

    traverse(ast, {
      JSXOpeningElement: (path) => {
        const name = t.isJSXIdentifier(path.node.name)
          ? path.node.name.name
          : null;
        if (!name) return;

        // Check known form components
        const knownType = FORM_COMPONENT_MAP[name];
        if (knownType) {
          const field = this.extractFieldFromJsx(path.node, knownType);
          if (field) fields.push(field);
          return;
        }

        // Check HTML form elements
        const htmlType = HTML_FORM_ELEMENTS[name];
        if (htmlType) {
          const field = this.extractFieldFromHtml(path.node, htmlType);
          if (field) fields.push(field);
        }
      },
    });

    return fields;
  }

  private extractFieldFromJsx(
    node: { attributes: Array<unknown> },
    fieldType: FormField["type"]
  ): FormField | null {
    const attrs = node.attributes as Array<unknown>;
    let name = "";
    let label = "";
    let required = false;

    for (const attr of attrs) {
      if (!t.isJSXAttribute(attr as any)) continue;
      const jsxAttr = attr as { name: { name?: string }; value: unknown };
      if (!t.isJSXIdentifier(jsxAttr.name as any)) continue;

      const attrName = (jsxAttr.name as { name: string }).name;
      const attrValue = jsxAttr.value;

      if (attrName === "name" && t.isStringLiteral(attrValue as any)) {
        name = (attrValue as { value: string }).value;
      }
      if (
        (attrName === "inputLabel" || attrName === "selectLabel" || attrName === "label") &&
        t.isStringLiteral(attrValue as any)
      ) {
        label = (attrValue as { value: string }).value;
      }
      if (attrName === "required") {
        required = true;
      }
    }

    // Try to extract name from handleChange pattern: handleChange('fieldName', ...)
    if (!name) {
      name = this.extractNameFromHandler(attrs) ?? "";
    }

    if (!name && !label) return null;

    // Check if label ends with * (required indicator)
    if (label.endsWith("*")) {
      required = true;
      label = label.slice(0, -1).trim();
    }

    return {
      name: name || label.toLowerCase().replace(/\s+/g, "_"),
      type: fieldType,
      label: label || name,
      required,
      selector: name ? `[name="${name}"]` : "",
    };
  }

  private extractFieldFromHtml(
    node: { attributes: Array<unknown> },
    defaultType: FormField["type"]
  ): FormField | null {
    const attrs = node.attributes as Array<unknown>;
    let name = "";
    let label = "";
    let type = defaultType;
    let required = false;

    for (const attr of attrs) {
      if (!t.isJSXAttribute(attr as any)) continue;
      const jsxAttr = attr as { name: { name?: string }; value: unknown };
      if (!t.isJSXIdentifier(jsxAttr.name as any)) continue;

      const attrName = (jsxAttr.name as { name: string }).name;
      const attrValue = jsxAttr.value;

      if (attrName === "name" && t.isStringLiteral(attrValue as any)) {
        name = (attrValue as { value: string }).value;
      }
      if (attrName === "placeholder" && t.isStringLiteral(attrValue as any)) {
        label = (attrValue as { value: string }).value;
      }
      if (attrName === "type" && t.isStringLiteral(attrValue as any)) {
        const htmlType = (attrValue as { value: string }).value;
        if (htmlType === "number") type = "number";
        if (htmlType === "date") type = "date";
        if (htmlType === "checkbox") type = "checkbox";
        if (htmlType === "radio") type = "radio";
      }
      if (attrName === "required") {
        required = true;
      }
    }

    if (!name && !label) return null;

    return {
      name: name || label.toLowerCase().replace(/\s+/g, "_"),
      type,
      label: label || name,
      required,
      selector: name ? `[name="${name}"]` : "",
    };
  }

  /**
   * Extract field name from handleChange callback pattern:
   * handleChange('fieldName', e.target.value, validateFn)
   */
  private extractNameFromHandler(attrs: Array<unknown>): string | null {
    for (const attr of attrs) {
      if (!t.isJSXAttribute(attr as any)) continue;
      const jsxAttr = attr as { name: { name?: string }; value: unknown };
      if (!t.isJSXIdentifier(jsxAttr.name as any)) continue;

      const attrName = (jsxAttr.name as { name: string }).name;
      if (attrName !== "handleChange" && attrName !== "onChange") continue;

      const attrValue = jsxAttr.value;
      if (!t.isJSXExpressionContainer(attrValue as any)) continue;

      const expr = (attrValue as { expression: unknown }).expression;
      if (!t.isArrowFunctionExpression(expr as any)) continue;

      const body = (expr as { body: unknown }).body;
      if (!t.isCallExpression(body as any)) continue;

      const args = (body as { arguments: unknown[] }).arguments;
      if (args.length > 0 && t.isStringLiteral(args[0] as any)) {
        return (args[0] as { value: string }).value;
      }
    }

    return null;
  }

  private findSubmitSelector(filePath: string): string | null {
    const ast = parseFile(filePath);
    let found: string | null = null;

    traverse(ast, {
      JSXOpeningElement: (path) => {
        if (found) return;
        const name = t.isJSXIdentifier(path.node.name)
          ? path.node.name.name
          : null;

        // Look for ThemedButton or button with save/submit text
        if (name === "ThemedButton" || name === "button") {
          for (const attr of path.node.attributes) {
            if (!t.isJSXAttribute(attr)) continue;
            if (!t.isJSXIdentifier(attr.name)) continue;

            if (attr.name.name === "onClick" || attr.name.name === "type") {
              if (
                t.isStringLiteral(attr.value) &&
                attr.value.value === "submit"
              ) {
                found = 'button[type="submit"]';
              }
            }
          }
        }
      },
    });

    return found;
  }
}
