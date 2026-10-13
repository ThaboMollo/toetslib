import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { AppMap } from "@toetslib/core";

type Framework = AppMap["project"]["framework"];
type PackageManager = AppMap["project"]["packageManager"];

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
}

export class ProjectDetector {
  detectPackageManager(dir: string): PackageManager {
    const workspaceRoot = this.findWorkspaceRoot(dir);
    const searchDir = workspaceRoot ?? dir;

    if (existsSync(join(searchDir, "bun.lock"))) return "bun";
    if (existsSync(join(searchDir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(searchDir, "yarn.lock"))) return "yarn";
    if (existsSync(join(searchDir, "package-lock.json"))) return "npm";

    return "npm";
  }

  detectFramework(dir: string): Framework {
    const pkg = this.readPackageJson(dir);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps["next"]) return "nextjs";
    if (allDeps["vite"] && allDeps["@vitejs/plugin-react"]) return "react-vite";
    if (allDeps["react-scripts"]) return "react-cra";

    if (allDeps["vite"]) return "react-vite";

    // No JS manifest to go on. Check for a JVM build before assuming React,
    // otherwise a Spring app silently inherits "npm run dev" on port 5173.
    if (this.isSpringProject(dir)) return "spring-thymeleaf";

    return "react-vite";
  }

  /** A Maven or Gradle build with Spring Boot on the classpath. */
  isSpringProject(dir: string): boolean {
    for (const build of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
      const buildPath = join(dir, build);
      if (!existsSync(buildPath)) continue;
      try {
        if (readFileSync(buildPath, "utf-8").includes("spring-boot")) {
          return true;
        }
      } catch {
        // unreadable build file
      }
    }
    return false;
  }

  detectDevCommand(dir: string): string {
    if (this.isSpringProject(dir)) {
      return existsSync(join(dir, "mvnw"))
        ? "./mvnw spring-boot:run"
        : existsSync(join(dir, "gradlew"))
          ? "./gradlew bootRun"
          : "mvn spring-boot:run";
    }
    const pkg = this.readPackageJson(dir);
    if (pkg.scripts?.["dev"]) return "npm run dev";
    if (pkg.scripts?.["start"]) return "npm run start";
    return "npm run dev";
  }

  detectDevPort(dir: string, framework: Framework): number {
    switch (framework) {
      case "react-vite":
        return this.parseVitePort(dir) ?? 5173;
      case "nextjs":
        return this.parseNextPort(dir) ?? 3000;
      case "react-cra":
        return 3000;
      case "spring-thymeleaf":
        return this.parseSpringPort(dir) ?? 8080;
    }
  }

  detectName(dir: string): string {
    const pkg = this.readPackageJson(dir);
    if (pkg.name) return pkg.name;

    const pom = join(dir, "pom.xml");
    if (existsSync(pom)) {
      try {
        // The first <artifactId> inside <project> may belong to <parent>, so
        // prefer <name> and fall back to the basename rather than guessing.
        const content = readFileSync(pom, "utf-8");
        const name = content.match(/<name>([^<]+)<\/name>/);
        if (name?.[1] && !name[1].includes("$")) return name[1].trim();
      } catch {
        // unreadable pom
      }
    }

    return basename(dir);
  }

  findWorkspaceRoot(dir: string): string | null {
    let current = dir;
    const root = dirname(current);

    while (current !== root) {
      const parent = dirname(current);
      const parentPkg = join(parent, "package.json");

      if (existsSync(parentPkg)) {
        try {
          const pkg = JSON.parse(
            readFileSync(parentPkg, "utf-8")
          ) as PackageJson;
          if (pkg.workspaces && pkg.workspaces.length > 0) {
            return parent;
          }
        } catch {
          // not valid JSON, skip
        }
      }

      if (parent === current) break;
      current = parent;
    }

    return null;
  }

  readPackageJson(dir: string): PackageJson {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return {};
    try {
      return JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
    } catch {
      return {};
    }
  }

  private parseVitePort(dir: string): number | null {
    const configNames = [
      "vite.config.js",
      "vite.config.ts",
      "vite.config.mjs",
      "vite.config.mts",
    ];

    for (const name of configNames) {
      const configPath = join(dir, name);
      if (!existsSync(configPath)) continue;

      try {
        const content = readFileSync(configPath, "utf-8");
        // Match patterns like:
        //   port: 57760
        //   port: 3000,
        //   port: Number(env.PORT)  -- skip these
        const portMatch = content.match(/port\s*:\s*(\d+)/);
        if (portMatch) {
          return parseInt(portMatch[1]!, 10);
        }
      } catch {
        // can't read config
      }
    }

    return null;
  }

  /** server.port from application.yaml/yml/properties, if it is a literal. */
  private parseSpringPort(dir: string): number | null {
    const resourceDir = join(dir, "src", "main", "resources");
    const candidates = [
      "application.yaml",
      "application.yml",
      "application.properties",
    ];

    for (const name of candidates) {
      const configPath = join(resourceDir, name);
      if (!existsSync(configPath)) continue;

      try {
        const content = readFileSync(configPath, "utf-8");

        if (name.endsWith(".properties")) {
          const match = content.match(/^\s*server\.port\s*[=:]\s*(\d+)/m);
          if (match) return parseInt(match[1]!, 10);
          continue;
        }

        // YAML: server.port is nested, and is commonly ${PORT:8080}.
        const serverBlock = content.match(
          /^server:\s*$([\s\S]*?)(?=^\S|\Z)/m
        );
        const scope = serverBlock?.[1] ?? content;
        const placeholder = scope.match(
          /^\s{2,}port:\s*\$\{[A-Za-z0-9_]+:(\d+)\}/m
        );
        if (placeholder) return parseInt(placeholder[1]!, 10);
        const literal = scope.match(/^\s{2,}port:\s*(\d+)\s*$/m);
        if (literal) return parseInt(literal[1]!, 10);
      } catch {
        // can't read config
      }
    }

    return null;
  }

  private parseNextPort(dir: string): number | null {
    const pkg = this.readPackageJson(dir);
    const devScript = pkg.scripts?.["dev"] ?? "";

    // next dev -p 4000
    const portFlag = devScript.match(/-p\s+(\d+)/);
    if (portFlag) {
      return parseInt(portFlag[1]!, 10);
    }

    // next dev --port 4000
    const portLong = devScript.match(/--port\s+(\d+)/);
    if (portLong) {
      return parseInt(portLong[1]!, 10);
    }

    return null;
  }
}
