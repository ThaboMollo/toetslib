import type { ApiCall, Route } from "@toetslib/core";
import { globFiles, readFileContent } from "@toetslib/shared";
import {
  classifyPath,
  SpringSecurityParser,
  type SpringSecurityModel,
} from "./spring-security-parser.js";

type HttpMethod = ApiCall["method"];

interface Mapping {
  paths: string[];
  methods: HttpMethod[];
  /** Offset of the annotation in the source, used to pair it with a method. */
  index: number;
}

const MAPPING_ANNOTATION =
  /@(Get|Post|Put|Delete|Patch|Request)Mapping\b(?:\s*\(([\s\S]*?)\))?/g;

/** Annotation attributes whose string values are not URL paths. */
const NON_PATH_ATTRIBUTES =
  /\b(?:produces|consumes|headers|params|name)\s*=\s*(?:\{[^}]*\}|"[^"]*")/g;

const CLASS_DECLARATION = /\b(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/;

/**
 * Extracts HTTP routes from Spring MVC controllers.
 *
 * Only GET mappings are crawlable, so those become Routes; every other verb is
 * recorded as an ApiCall so the generator still knows the write surface exists.
 *
 * Paths carrying a @PathVariable placeholder are marked templated: they seed the
 * crawler's known-path set (so a discovered link to /jobs/some-slug is
 * recognised as belonging to the app) but are never fetched literally.
 */
export class SpringRouteParser {
  private srcDir: string;
  private securityParser: SpringSecurityParser;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
    this.securityParser = new SpringSecurityParser(srcDir);
  }

  async parse(): Promise<{
    routes: Route[];
    apiCalls: ApiCall[];
    security: SpringSecurityModel;
  }> {
    const security = await this.securityParser.parse();

    const files = await globFiles(this.srcDir, [
      "**/*.java",
      "!**/target/**",
      "!**/build/**",
      "!**/*Test.java",
      "!**/*Tests.java",
    ]);

    const routes: Route[] = [];
    const apiCalls: ApiCall[] = [];
    const seenRoutes = new Set<string>();

    for (const file of files) {
      let src: string;
      try {
        src = await readFileContent(file);
      } catch {
        continue;
      }

      if (!/@(?:Rest)?Controller\b/.test(src)) continue;

      const className = src.match(CLASS_DECLARATION)?.[1] ?? "UnknownController";
      const classDeclIndex = src.search(CLASS_DECLARATION);
      const mappings = this.collectMappings(src);

      // An annotation above the class declaration is the shared path prefix.
      const classMapping = mappings.find(
        (m) => classDeclIndex >= 0 && m.index < classDeclIndex
      );
      const prefixes =
        classMapping && classMapping.paths.length > 0
          ? classMapping.paths
          : [""];

      for (const mapping of mappings) {
        if (mapping === classMapping) continue;

        const methodName = this.methodNameAfter(src, mapping.index);

        for (const prefix of prefixes) {
          for (const rawPath of mapping.paths.length > 0 ? mapping.paths : [""]) {
            const path = joinPaths(prefix, rawPath);

            for (const method of mapping.methods) {
              if (method !== "GET") {
                apiCalls.push({
                  endpoint: path,
                  method,
                  sourceFile: file,
                  hookName: methodName,
                });
                continue;
              }

              const key = `GET ${path}`;
              if (seenRoutes.has(key)) continue;
              seenRoutes.add(key);

              const { isPublic, authGuard } = classifyPath(path, security);
              routes.push({
                path,
                componentFile: file,
                componentName: methodName
                  ? `${className}.${methodName}`
                  : className,
                isPublic,
                authGuard,
                templated: isTemplated(path),
              });
            }
          }
        }
      }
    }

    routes.sort((a, b) => a.path.localeCompare(b.path));
    return { routes, apiCalls, security };
  }

  private collectMappings(src: string): Mapping[] {
    const mappings: Mapping[] = [];

    for (const match of src.matchAll(MAPPING_ANNOTATION)) {
      const verb = match[1]!;
      const args = match[2] ?? "";
      mappings.push({
        paths: extractPaths(args),
        methods: resolveMethods(verb, args),
        index: match.index ?? 0,
      });
    }

    return mappings;
  }

  /** The Java method name declared immediately after an annotation. */
  private methodNameAfter(src: string, index: number): string | null {
    const window = src.slice(index, index + 600);
    // Skip any further annotations, then match "ReturnType name(".
    const match = window.match(
      /\n\s*(?:public|protected|private)\s+[\w<>,\[\]\s?.]+?\s+(\w+)\s*\(/
    );
    return match?.[1] ?? null;
  }
}

/** Which HTTP verbs an annotation covers. */
function resolveMethods(verb: string, args: string): HttpMethod[] {
  if (verb !== "Request") {
    const direct: Record<string, HttpMethod> = {
      Get: "GET",
      Post: "POST",
      Put: "PUT",
      Delete: "DELETE",
      Patch: "PUT",
    };
    return [direct[verb] ?? "GET"];
  }

  // @RequestMapping(method = RequestMethod.GET) — or several, or none, in
  // which case Spring maps every verb and we only care about GET.
  const methods = [...args.matchAll(/RequestMethod\s*\.\s*(\w+)/g)]
    .map((m) => m[1]!.toUpperCase())
    .filter((m): m is HttpMethod =>
      ["GET", "POST", "PUT", "DELETE"].includes(m)
    );

  return methods.length > 0 ? methods : ["GET"];
}

/** URL paths declared in a mapping annotation's arguments. */
function extractPaths(args: string): string[] {
  if (!args.trim()) return [];

  // Drop attributes whose strings are media types or header matchers, so their
  // values are not mistaken for paths.
  const cleaned = args.replace(NON_PATH_ATTRIBUTES, "");

  const explicit = cleaned.match(/\b(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/);
  const scope = explicit ? explicit[1]! : cleaned;

  const literals = [...scope.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  return literals.filter((literal) => !literal.includes("="));
}

function joinPaths(prefix: string, path: string): string {
  const left = prefix.replace(/\/+$/, "");
  const right = path.replace(/^\/+/, "");

  if (!left && !right) return "/";
  if (!right) return left || "/";

  const joined = `${left}/${right}`;
  return joined.startsWith("/") ? joined : `/${joined}`;
}

/** Spring {var}, Spring {var:regex}, or a wildcard — not literally fetchable. */
function isTemplated(path: string): boolean {
  return path.includes("{") || path.includes("*");
}
