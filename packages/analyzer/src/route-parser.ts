import { join } from "node:path";
import type { Route } from "@toetslib/core";
import { globFiles } from "@toetslib/shared";
import {
  parseFile,
  traverse,
  t,
  resolveImportPath,
  evaluateObjectExpression,
  resolveMemberExpression,
  findAllImportSources,
} from "./ast-utils.js";
import type { File, Node } from "@babel/types";

/**
 * Parses React Router route definitions from a React project.
 *
 * Handles three patterns:
 * 1. Inline <Route path="..." element={<Component />} />
 * 2. Route arrays: const ROUTES = [{ path: "...", element: <Component /> }]
 * 3. Mapped arrays: ROUTES.map(({ path, element }) => <Route ... />)
 *
 * Resolves indirect path references (e.g. constantRoutes.employee.employee -> "/employees/employee")
 * by following imports and evaluating static objects.
 */
export class RouteParser {
  private srcDir: string;
  private resolvedConstants: Map<string, Record<string, unknown>> = new Map();

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async parse(): Promise<Route[]> {
    // Find all JSX/TSX files that might contain routes
    const files = await globFiles(this.srcDir, [
      "**/*.{jsx,tsx,js,ts}",
      "!**/node_modules/**",
      "!**/dist/**",
      "!**/*.test.*",
      "!**/*.spec.*",
    ]);

    const routes: Route[] = [];
    const seenPaths = new Set<string>();

    // First pass: find files that import from react-router-dom
    for (const file of files) {
      let ast: File;
      try {
        ast = parseFile(file);
      } catch {
        continue;
      }

      const hasRouterImport = this.fileImportsRouter(ast);
      if (!hasRouterImport) continue;

      const importSources = findAllImportSources(ast, file, this.srcDir);
      const fileRoutes = this.extractRoutes(ast, file, importSources);

      for (const route of fileRoutes) {
        if (!seenPaths.has(route.path)) {
          seenPaths.add(route.path);
          routes.push(route);
        }
      }
    }

    return routes;
  }

  private fileImportsRouter(ast: File): boolean {
    let found = false;
    traverse(ast, {
      ImportDeclaration(path) {
        if (path.node.source.value === "react-router-dom") {
          found = true;
          path.stop();
        }
      },
    });
    return found;
  }

  private extractRoutes(
    ast: File,
    filePath: string,
    importSources: Map<string, string>
  ): Route[] {
    const routes: Route[] = [];

    // Build a scope of resolved constants for this file
    const scope = this.buildScope(ast, filePath, importSources);

    // Strategy 1: Find inline <Route> JSX elements
    const inlineRoutes = this.findInlineRoutes(ast, scope, filePath, importSources);
    routes.push(...inlineRoutes);

    // Strategy 2: Find route arrays that are .map()'d onto <Route>
    const mappedRoutes = this.findMappedRouteArrays(ast, scope, filePath, importSources);
    routes.push(...mappedRoutes);

    return routes;
  }

  /**
   * Build a scope object mapping variable names to their resolved values.
   * Follows imports to resolve constant objects like `constantRoutes`.
   */
  private buildScope(
    ast: File,
    filePath: string,
    importSources: Map<string, string>
  ): Record<string, unknown> {
    const scope: Record<string, unknown> = {};

    traverse(ast, {
      ImportDeclaration: (path) => {
        const source = path.node.source.value;
        const resolved = resolveImportPath(source, filePath, this.srcDir);
        if (!resolved) return;

        for (const specifier of path.node.specifiers) {
          const localName = specifier.local.name;

          // Check if we already resolved this file's constants
          if (this.resolvedConstants.has(resolved)) {
            const constants = this.resolvedConstants.get(resolved)!;
            if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
              const importedName = specifier.imported.name;
              if (importedName in constants) {
                scope[localName] = constants[importedName];
              }
            }
            continue;
          }

          // Try to resolve the imported file's exports
          try {
            const importedAst = parseFile(resolved);
            const exports = this.resolveExports(importedAst);
            this.resolvedConstants.set(resolved, exports);

            if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
              const importedName = specifier.imported.name;
              if (importedName in exports) {
                scope[localName] = exports[importedName];
              }
            }
          } catch {
            // Can't parse imported file
          }
        }
      },
    });

    return scope;
  }

  /**
   * Resolve all named exports from a file that are static objects or values.
   */
  private resolveExports(ast: File): Record<string, unknown> {
    const exports: Record<string, unknown> = {};

    traverse(ast, {
      ExportNamedDeclaration(path) {
        const decl = path.node.declaration;
        if (t.isVariableDeclaration(decl)) {
          for (const declarator of decl.declarations) {
            if (t.isIdentifier(declarator.id) && declarator.init) {
              if (t.isObjectExpression(declarator.init)) {
                const value = evaluateObjectExpression(declarator.init);
                if (value) {
                  exports[declarator.id.name] = value;
                }
              }
            }
          }
        }
      },
    });

    return exports;
  }

  /**
   * Find inline <Route path={...} element={...} /> JSX elements.
   */
  private findInlineRoutes(
    ast: File,
    scope: Record<string, unknown>,
    filePath: string,
    importSources: Map<string, string>
  ): Route[] {
    const routes: Route[] = [];

    traverse(ast, {
      JSXElement: (path) => {
        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name) || opening.name.name !== "Route") {
          return;
        }

        // Check if this Route is created inline (not inside a .map callback)
        const routePath = this.extractJsxAttribute(opening, "path", scope);
        const componentName = this.extractElementComponent(opening);

        if (routePath && componentName) {
          const componentFile = importSources.get(componentName) ?? null;
          routes.push({
            path: routePath,
            componentFile: componentFile ?? "",
            componentName,
            isPublic: true, // Default, may be overridden
            authGuard: null,
          });
        }
      },
    });

    return routes;
  }

  /**
   * Find route arrays that are mapped to <Route> elements:
   * PUBLIC_ROUTES.map(({ path, element }) => <Route ... />)
   *
   * Also detects auth gating: {isAuthenticated && ADMIN_ROUTES.map(...)}
   */
  private findMappedRouteArrays(
    ast: File,
    scope: Record<string, unknown>,
    filePath: string,
    importSources: Map<string, string>
  ): Route[] {
    const routes: Route[] = [];

    // Find the route array files (e.g., router/index.jsx)
    // Look for imports of arrays that contain route objects
    const routeArrayFiles = new Set<string>();

    traverse(ast, {
      CallExpression: (path) => {
        // Look for ARRAY.map() patterns
        if (
          t.isMemberExpression(path.node.callee) &&
          t.isIdentifier(path.node.callee.property, { name: "map" }) &&
          t.isIdentifier(path.node.callee.object)
        ) {
          const arrayName = path.node.callee.object.name;
          const sourceFile = importSources.get(arrayName);

          if (sourceFile) {
            routeArrayFiles.add(sourceFile);

            // Detect auth gating: {isAuthenticated && ADMIN_ROUTES.map(...)}
            let isPublic = true;
            const parentPath = path.parentPath;
            if (parentPath && t.isLogicalExpression(parentPath.node, { operator: "&&" })) {
              // The left side of && is the auth condition
              isPublic = false;
            }

            // Parse the route array file to get routes
            try {
              const arrayFileRoutes = this.parseRouteArrayFile(
                sourceFile,
                arrayName,
                isPublic
              );
              routes.push(...arrayFileRoutes);
            } catch {
              // Can't parse
            }
          }
        }
      },
    });

    return routes;
  }

  /**
   * Parse a file that exports route arrays (e.g., router/index.jsx).
   * Extracts routes from array declarations like:
   *   const PUBLIC_ROUTES = [
   *     { path: constantRoutes.employee.employee, element: <Employee />, exact: true },
   *   ];
   */
  private parseRouteArrayFile(
    filePath: string,
    arrayName: string,
    isPublic: boolean
  ): Route[] {
    const routes: Route[] = [];
    const ast = parseFile(filePath);

    // Build scope for this file (resolve constantRoutes etc.)
    const importSources = findAllImportSources(ast, filePath, this.srcDir);
    const scope = this.buildScope(ast, filePath, importSources);

    traverse(ast, {
      VariableDeclarator: (path) => {
        if (!t.isIdentifier(path.node.id, { name: arrayName })) return;
        if (!t.isArrayExpression(path.node.init)) return;

        for (const elem of path.node.init.elements) {
          if (!t.isObjectExpression(elem)) continue;

          let routePath: string | null = null;
          let componentName: string | null = null;

          for (const prop of elem.properties) {
            if (!t.isObjectProperty(prop)) continue;
            if (!t.isIdentifier(prop.key)) continue;

            if (prop.key.name === "path") {
              routePath = resolveMemberExpression(prop.value, scope);
            }

            if (prop.key.name === "element" && t.isJSXElement(prop.value)) {
              const opening = prop.value.openingElement;
              if (t.isJSXIdentifier(opening.name)) {
                componentName = opening.name.name;
              }
            }
          }

          if (routePath && componentName) {
            const componentFile = importSources.get(componentName) ?? "";
            routes.push({
              path: routePath,
              componentFile,
              componentName,
              isPublic,
              authGuard: isPublic ? null : "isAuthenticated",
            });
          }
        }
      },
    });

    return routes;
  }

  /**
   * Extract the value of a JSX attribute, resolving references if needed.
   */
  private extractJsxAttribute(
    opening: Node & { attributes: Array<Node> },
    attrName: string,
    scope: Record<string, unknown>
  ): string | null {
    for (const attr of opening.attributes) {
      if (
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name, { name: attrName })
      ) {
        if (t.isStringLiteral(attr.value)) {
          return attr.value.value;
        }
        if (
          t.isJSXExpressionContainer(attr.value) &&
          attr.value.expression
        ) {
          return resolveMemberExpression(attr.value.expression as Node, scope);
        }
      }
    }
    return null;
  }

  /**
   * Extract the component name from a JSX element attribute:
   * element={<Component />} -> "Component"
   */
  private extractElementComponent(
    opening: Node & { attributes: Array<Node> }
  ): string | null {
    for (const attr of opening.attributes) {
      if (
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name, { name: "element" })
      ) {
        if (
          t.isJSXExpressionContainer(attr.value) &&
          t.isJSXElement(attr.value.expression)
        ) {
          const elemOpening = attr.value.expression.openingElement;
          if (t.isJSXIdentifier(elemOpening.name)) {
            return elemOpening.name.name;
          }
        }
      }
    }
    return null;
  }
}
