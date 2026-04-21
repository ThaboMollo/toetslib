import type { AuthConfig } from "@toetslib/core";
import { globFiles } from "@toetslib/shared";
import { parseFile, traverse, t } from "./ast-utils.js";

export class AuthDetector {
  private srcDir: string;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async detect(): Promise<AuthConfig> {
    const config: AuthConfig = {
      type: "none",
      loginRoute: null,
      trialMode: false,
      restrictions: [],
    };

    const files = await globFiles(this.srcDir, [
      "**/*.{js,ts,jsx,tsx}",
      "!**/node_modules/**",
      "!**/dist/**",
      "!**/*.test.*",
      "!**/*.spec.*",
    ]);

    for (const file of files) {
      try {
        const ast = parseFile(file);
        this.detectAuthPattern(ast, file, config);
        this.detectTrialMode(ast, file, config);
        this.detectLoginRoute(ast, file, config);
      } catch {
        continue;
      }
    }

    return config;
  }

  /**
   * Detect auth context pattern:
   * - AuthProvider / useAuth imports
   * - isAuthenticated usage
   */
  private detectAuthPattern(
    ast: ReturnType<typeof parseFile>,
    filePath: string,
    config: AuthConfig
  ): void {
    traverse(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;

        for (const specifier of path.node.specifiers) {
          if (!t.isImportSpecifier(specifier)) continue;
          const imported = t.isIdentifier(specifier.imported)
            ? specifier.imported.name
            : null;

          if (
            imported === "AuthProvider" ||
            imported === "useAuth" ||
            imported === "SharedAuthProvider"
          ) {
            config.type = "context";
          }
        }
      },

      // Detect isAuthenticated usage
      Identifier(path) {
        if (path.node.name === "isAuthenticated") {
          if (config.type === "none") {
            config.type = "context";
          }
        }
      },
    });
  }

  /**
   * Detect trial/guest mode:
   * - localStorage usage for storing form data
   * - useLocalEmployeeStorage or similar hooks
   * - Conditional rendering based on isAuthenticated
   */
  private detectTrialMode(
    ast: ReturnType<typeof parseFile>,
    filePath: string,
    config: AuthConfig
  ): void {
    traverse(ast, {
      // Look for localStorage calls
      CallExpression(path) {
        const callee = path.node.callee;

        // localStorage.getItem / localStorage.setItem
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "localStorage" })
        ) {
          config.trialMode = true;
        }
      },

      // Look for hooks that manage local storage
      Identifier(path) {
        const name = path.node.name;
        if (
          name === "useLocalEmployeeStorage" ||
          name === "useLocalStorage" ||
          name === "getLocalObject" ||
          name === "setLocalObject"
        ) {
          config.trialMode = true;
        }
      },

      // Look for patterns like: if (!isAuthenticated) { save to localStorage }
      // or: isAuthenticated ? apiCall : localStorageCall
      ConditionalExpression(path) {
        const test = path.node.test;
        if (t.isIdentifier(test, { name: "isAuthenticated" })) {
          config.trialMode = true;
        }
        if (
          t.isUnaryExpression(test, { operator: "!" }) &&
          t.isIdentifier(test.argument, { name: "isAuthenticated" })
        ) {
          config.trialMode = true;
        }
      },
    });
  }

  /**
   * Detect login route:
   * - Navigate to '/login' patterns
   * - Route path containing 'login'
   */
  private detectLoginRoute(
    ast: ReturnType<typeof parseFile>,
    filePath: string,
    config: AuthConfig
  ): void {
    if (config.loginRoute) return;

    traverse(ast, {
      StringLiteral(path) {
        if (
          path.node.value === "/login" ||
          path.node.value.endsWith("/login")
        ) {
          config.loginRoute = path.node.value;
        }
      },
    });
  }
}
