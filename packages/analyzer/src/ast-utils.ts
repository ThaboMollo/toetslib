import { parse } from "@babel/parser";
import type { TraverseOptions } from "@babel/traverse";
import type { Node, File } from "@babel/types";
import * as t from "@babel/types";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// @babel/traverse is CJS — use require for reliable interop
const _traverse = require("@babel/traverse");
const traverseFn: (ast: File, opts: TraverseOptions) => void =
  typeof _traverse === "function" ? _traverse : _traverse.default;

export function traverse(ast: File, opts: TraverseOptions): void {
  traverseFn(ast, opts);
}

export { t };

export function parseFile(filePath: string): File {
  const code = readFileSync(filePath, "utf-8");
  return parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    sourceFilename: filePath,
  });
}

export function resolveImportPath(
  importSource: string,
  fromFile: string,
  srcDir: string
): string | null {
  // Skip package imports (non-relative)
  if (!importSource.startsWith(".") && !importSource.startsWith("@/")) {
    return null;
  }

  let basePath: string;

  if (importSource.startsWith("@/")) {
    // Alias: @/ -> srcDir
    basePath = join(srcDir, importSource.slice(2));
  } else {
    basePath = resolve(dirname(fromFile), importSource);
  }

  // Try with extensions
  const extensions = ["", ".jsx", ".js", ".tsx", ".ts"];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }

  // Try index files
  for (const ext of [".jsx", ".js", ".tsx", ".ts"]) {
    const candidate = join(basePath, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Evaluate a static object expression to a plain JS object.
 * Handles nested objects with string literal values.
 * Returns null if the expression contains dynamic values.
 */
export function evaluateObjectExpression(
  node: Node
): Record<string, unknown> | null {
  if (!t.isObjectExpression(node)) return null;

  const result: Record<string, unknown> = {};

  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) return null;

    let key: string;
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      key = prop.key.value;
    } else {
      return null;
    }

    if (t.isStringLiteral(prop.value)) {
      result[key] = prop.value.value;
    } else if (t.isObjectExpression(prop.value)) {
      const nested = evaluateObjectExpression(prop.value);
      if (nested === null) return null;
      result[key] = nested;
    } else {
      return null;
    }
  }

  return result;
}

/**
 * Resolve a member expression chain like `constantRoutes.employee.employee`
 * against a resolved object to get the string value.
 */
export function resolveMemberExpression(
  node: Node,
  scope: Record<string, unknown>
): string | null {
  if (t.isStringLiteral(node)) {
    return node.value;
  }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0]!.value.cooked ?? null;
  }

  if (!t.isMemberExpression(node)) return null;

  const chain = getMemberChain(node);
  if (!chain) return null;

  let current: unknown = scope;
  for (const key of chain) {
    if (current === null || current === undefined || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : null;
}

/**
 * Get the chain of property names from a member expression.
 * `constantRoutes.employee.employee` -> ["constantRoutes", "employee", "employee"]
 */
function getMemberChain(node: Node): string[] | null {
  if (t.isIdentifier(node)) {
    return [node.name];
  }

  if (t.isMemberExpression(node) && !node.computed) {
    const objectChain = getMemberChain(node.object);
    if (!objectChain) return null;

    if (t.isIdentifier(node.property)) {
      return [...objectChain, node.property.name];
    }
  }

  return null;
}

/**
 * Find named imports from a specific module in a file AST.
 * Returns a map of localName -> importedName.
 */
export function findImports(
  ast: File,
  moduleSource: string
): Map<string, string> {
  const imports = new Map<string, string>();

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value === moduleSource) {
        for (const specifier of path.node.specifiers) {
          if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
            imports.set(specifier.local.name, specifier.imported.name);
          } else if (t.isImportDefaultSpecifier(specifier)) {
            imports.set(specifier.local.name, "default");
          }
        }
      }
    },
  });

  return imports;
}

/**
 * Find all import declarations in a file and return their resolved paths.
 */
export function findAllImportSources(
  ast: File,
  fromFile: string,
  srcDir: string
): Map<string, string> {
  const sources = new Map<string, string>();

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const resolved = resolveImportPath(source, fromFile, srcDir);
      if (resolved) {
        for (const specifier of path.node.specifiers) {
          sources.set(specifier.local.name, resolved);
        }
      }
    },
  });

  return sources;
}
