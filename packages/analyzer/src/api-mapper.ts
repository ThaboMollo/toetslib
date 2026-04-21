import type { ApiCall } from "@toetslib/core";
import { globFiles } from "@toetslib/shared";
import { parseFile, traverse, t } from "./ast-utils.js";

export class ApiMapper {
  private srcDir: string;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async map(): Promise<ApiCall[]> {
    const apiCalls: ApiCall[] = [];

    // Find files in api/ directories
    const files = await globFiles(this.srcDir, [
      "**/api/**/*.{js,ts,jsx,tsx}",
      "**/queries/**/*.{js,ts,jsx,tsx}",
      "**/mutations/**/*.{js,ts,jsx,tsx}",
      "!**/node_modules/**",
      "!**/dist/**",
    ]);

    for (const file of files) {
      try {
        const fileApiCalls = this.extractApiCalls(file);
        apiCalls.push(...fileApiCalls);
      } catch {
        // Can't parse file
      }
    }

    // Also scan for endpoint constants files
    const endpointFiles = await globFiles(this.srcDir, [
      "**/endpoints.{js,ts,jsx,tsx}",
      "**/api-endpoints.{js,ts,jsx,tsx}",
      "!**/node_modules/**",
    ]);

    for (const file of endpointFiles) {
      try {
        const endpoints = this.extractEndpointConstants(file);
        apiCalls.push(...endpoints);
      } catch {
        // Can't parse
      }
    }

    // Deduplicate by endpoint
    const seen = new Set<string>();
    return apiCalls.filter((call) => {
      const key = `${call.method}:${call.endpoint}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract API calls from files with TanStack Query hooks.
   * Patterns:
   *   useQuery({ queryFn: () => apiClient.get(ENDPOINT) })
   *   useMutation({ mutationFn: () => apiClient.post(ENDPOINT, data) })
   */
  private extractApiCalls(filePath: string): ApiCall[] {
    const ast = parseFile(filePath);
    const calls: ApiCall[] = [];
    let currentHookName: string | null = null;
    const self = this;

    traverse(ast, {
      // Track the function name we're inside
      FunctionDeclaration(path) {
        if (t.isIdentifier(path.node.id)) {
          currentHookName = path.node.id.name;
        }
      },
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id)) {
          currentHookName = path.node.id.name;
        }
      },

      // Find apiClient.get/post/put/delete calls
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.object)) return;

        const objectName = callee.object.name;
        if (objectName !== "apiClient" && objectName !== "axios") return;

        if (!t.isIdentifier(callee.property)) return;
        const methodName = callee.property.name.toUpperCase();

        if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(methodName))
          return;

        const method = methodName as ApiCall["method"];
        const args = path.node.arguments;

        let endpoint = "";
        if (args.length > 0) {
          endpoint = self.extractEndpointString(args[0]!);
        }

        calls.push({
          endpoint: endpoint || "(dynamic)",
          method,
          sourceFile: filePath,
          hookName: currentHookName?.startsWith("use")
            ? currentHookName
            : null,
        });
      },
    });

    return calls;
  }

  /**
   * Extract endpoint constant definitions.
   * Pattern:
   *   export const ENDPOINTS = {
   *     LIST: '/api/items',
   *     BY_ID: id => `/api/items/${id}`,
   *   }
   */
  private extractEndpointConstants(filePath: string): ApiCall[] {
    const ast = parseFile(filePath);
    const calls: ApiCall[] = [];

    traverse(ast, {
      ObjectProperty(path) {
        const value = path.node.value;

        // String literal: COUNTRIES: '/infra-api/staticdata/countries'
        if (t.isStringLiteral(value) && value.value.startsWith("/")) {
          calls.push({
            endpoint: value.value,
            method: "GET",
            sourceFile: filePath,
            hookName: null,
          });
        }

        // Template literal: `/payroll-api/payroll/${payrollId}/employees`
        if (t.isTemplateLiteral(value) && value.quasis.length > 0) {
          const staticParts = value.quasis
            .map((q) => q.value.cooked ?? q.value.raw)
            .join("{param}");
          if (staticParts.startsWith("/")) {
            calls.push({
              endpoint: staticParts,
              method: "GET",
              sourceFile: filePath,
              hookName: null,
            });
          }
        }

        // Arrow function returning a string/template: id => `/api/items/${id}`
        if (t.isArrowFunctionExpression(value)) {
          const body = value.body;
          if (t.isTemplateLiteral(body) && body.quasis.length > 0) {
            const staticParts = body.quasis
              .map((q) => q.value.cooked ?? q.value.raw)
              .join("{param}");
            if (staticParts.startsWith("/")) {
              calls.push({
                endpoint: staticParts,
                method: "GET",
                sourceFile: filePath,
                hookName: null,
              });
            }
          }
        }
      },
    });

    return calls;
  }

  private extractEndpointString(node: unknown): string {
    const n = node as import("@babel/types").Node;

    if (t.isStringLiteral(n)) return n.value;

    if (t.isTemplateLiteral(n)) {
      return n.quasis
        .map((q) => q.value.cooked ?? q.value.raw)
        .join("{param}");
    }

    // ENDPOINT.SOMETHING(arg) — function call returning a string
    if (t.isCallExpression(n)) {
      if (t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.property)) {
        return `(${n.callee.property.name})`;
      }
    }

    return "";
  }
}
