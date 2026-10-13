import type { AuthConfig } from "@toetslib/core";
import { globFiles, readFileContent } from "@toetslib/shared";

export interface SecurityRule {
  /** The Ant-style pattern as written in the security configuration. */
  pattern: string;
  matches: RegExp;
  /** Null when the rule is permitAll. */
  role: string | null;
}

export interface SpringSecurityModel {
  rules: SecurityRule[];
  loginRoute: string | null;
  /** True when the chain ends in anyRequest().authenticated() or .denyAll(). */
  denyByDefault: boolean;
}

/**
 * Converts a Spring Ant-style path pattern into an anchored regular expression.
 *
 * Spring treats a trailing "/**" as "this path and anything below it", so
 * "/jobs/**" has to match "/jobs" as well as "/jobs/engineer".
 */
export function antPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Two passes via placeholders. Substituting regex directly would let a later
  // rule rewrite what an earlier one inserted: "/**" becomes "(?:/.*)?", whose
  // own "*" was then caught by the single-star rule and turned into
  // "(?:/.[^/]*)?" — matching one path segment but not two.
  const PATH_GLOBSTAR = "\u0000";
  const GLOBSTAR = "\u0001";
  const STAR = "\u0002";

  const body = escaped
    .replace(/\/\*\*/g, PATH_GLOBSTAR)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\*/g, STAR)
    .replaceAll(PATH_GLOBSTAR, "(?:/.*)?")
    .replaceAll(GLOBSTAR, ".*")
    .replaceAll(STAR, "[^/]*");

  return new RegExp(`^${body}$`);
}

/**
 * Index of the ')' closing the '(' at openIndex, or -1 if unbalanced.
 * Quoted strings are skipped so a paren inside a literal cannot throw it off.
 */
function findBalancedClose(src: string, openIndex: number): number {
  let depth = 0;
  let inString = false;

  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i]!;

    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

const AUTHORIZATION_VERB =
  /^[\s)]*\.\s*(permitAll|denyAll|authenticated|fullyAuthenticated|hasAnyRole|hasRole|hasAnyAuthority|hasAuthority)\s*\(([^)]*)\)/;

/**
 * Reads Spring Security's HttpSecurity configuration to find out which URLs are
 * reachable without logging in, and which role each protected prefix needs.
 *
 * This is deliberately a text scan rather than a Java parse: the shapes that
 * matter are stable enough to match directly, and a full parse would add a Java
 * toolchain to the dependency tree for one file.
 */
export class SpringSecurityParser {
  private srcDir: string;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async parse(): Promise<SpringSecurityModel> {
    const files = await globFiles(this.srcDir, [
      "**/*SecurityConfig*.java",
      "**/*SecurityConfiguration*.java",
      "**/security/**/*.java",
      "**/config/**/*.java",
    ]);

    const rules: SecurityRule[] = [];
    let loginRoute: string | null = null;
    let denyByDefault = false;

    for (const file of files) {
      let src: string;
      try {
        src = await readFileContent(file);
      } catch {
        continue;
      }
      if (
        !src.includes("HttpSecurity") &&
        !src.includes("authorizeHttpRequests")
      ) {
        continue;
      }

      if (
        /anyRequest\(\)\s*\.\s*(?:authenticated|denyAll|fullyAuthenticated)\(\)/.test(
          src
        )
      ) {
        denyByDefault = true;
      }

      const login = src.match(/\.loginPage\(\s*"([^"]+)"\s*\)/);
      if (login?.[1]) loginRoute = login[1];

      rules.push(...this.extractMatcherRules(src));
      rules.push(...this.extractPublicPathList(src));
    }

    return { rules, loginRoute, denyByDefault };
  }

  /**
   * Walks each requestMatchers(...) call and pairs it with the authorization
   * verb that follows it.
   *
   * Pairing cannot be done with one regex: an authorizeHttpRequests chain is a
   * single Java statement, so a pattern spanning requestMatchers to hasRole
   * swallows any intervening .permitAll() and mislabels every public path as
   * role-protected.
   */
  private extractMatcherRules(src: string): SecurityRule[] {
    const rules: SecurityRule[] = [];
    const token = "requestMatchers(";

    let cursor = src.indexOf(token);
    while (cursor !== -1) {
      const argsStart = cursor + token.length;
      const argsEnd = findBalancedClose(src, argsStart - 1);
      if (argsEnd === -1) break;

      const args = src.slice(argsStart, argsEnd);

      // Look only as far as the next matcher, so each call is judged by its own
      // verb rather than one further down the chain.
      const rest = src.slice(argsEnd + 1);
      const nextMatcher = rest.indexOf(token);
      const scope = nextMatcher === -1 ? rest : rest.slice(0, nextMatcher);

      const verb = scope.match(AUTHORIZATION_VERB);
      if (verb) {
        const kind = verb[1]!;
        const roleArgs = verb[2] ?? "";
        const role =
          kind === "permitAll"
            ? null
            : [...roleArgs.matchAll(/"([^"]+)"/g)]
                .map((m) => m[1]!)
                .join("|") || kind;

        for (const literal of this.pathLiterals(args)) {
          rules.push({
            pattern: literal,
            matches: antPatternToRegExp(literal),
            role,
          });
        }
      }

      cursor = src.indexOf(token, argsEnd);
    }

    return rules;
  }

  /**
   * The variable form, where public paths are collected into a list first:
   *   var publicPaths = new ArrayList<>(List.of("/", "/jobs", ...));
   *   auth.requestMatchers(publicPaths.toArray(String[]::new)).permitAll()
   * Trusted only when the chain really does call permitAll on that array.
   */
  private extractPublicPathList(src: string): SecurityRule[] {
    if (
      !/requestMatchers\(\s*\w+\s*\.\s*toArray[\s\S]{0,80}?permitAll\(\)/.test(
        src
      )
    ) {
      return [];
    }

    const rules: SecurityRule[] = [];
    const seen = new Set<string>();

    for (const listMatch of src.matchAll(/List\.of\(([\s\S]*?)\)\s*\)?\s*;/g)) {
      for (const literal of this.pathLiterals(listMatch[1] ?? "")) {
        if (seen.has(literal)) continue;
        seen.add(literal);
        rules.push({
          pattern: literal,
          matches: antPatternToRegExp(literal),
          role: null,
        });
      }
    }

    return rules;
  }

  /** Quoted literals that look like URL patterns rather than role names. */
  private pathLiterals(args: string): string[] {
    return [...args.matchAll(/"([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter(
        (literal) => literal.startsWith("/") || literal.startsWith("*")
      );
  }
}

/**
 * Resolves a concrete path against the parsed rules.
 *
 * Longest pattern wins, which approximates Spring's first-match-wins ordering
 * closely enough for crawl planning: specific prefixes are written before broad
 * ones in practice. A permitAll rule wins ties, since an explicitly public path
 * listed alongside a broad guard is intended to be public.
 */
export function classifyPath(
  path: string,
  model: SpringSecurityModel
): { isPublic: boolean; authGuard: string | null } {
  const candidates = model.rules
    .filter((rule) => rule.matches.test(path))
    .sort((a, b) => {
      const byLength = b.pattern.length - a.pattern.length;
      if (byLength !== 0) return byLength;
      if (a.role === null && b.role !== null) return -1;
      if (b.role === null && a.role !== null) return 1;
      return 0;
    });

  const best = candidates[0];
  if (best) {
    return { isPublic: best.role === null, authGuard: best.role };
  }

  // No rule matched. Deny-by-default chains require a session for anything
  // unlisted, so treat it as protected with an unknown role.
  return { isPublic: !model.denyByDefault, authGuard: null };
}

export function toAuthConfig(model: SpringSecurityModel): AuthConfig {
  return {
    type: model.loginRoute ? "redirect" : "none",
    loginRoute: model.loginRoute,
    trialMode: false,
    restrictions: model.rules
      .filter((rule) => rule.role !== null)
      .map((rule) => `${rule.pattern} requires ${rule.role}`),
  };
}
