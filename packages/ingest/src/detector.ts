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

    return "react-vite";
  }

  detectDevCommand(dir: string): string {
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
    }
  }

  detectName(dir: string): string {
    const pkg = this.readPackageJson(dir);
    return pkg.name ?? basename(dir);
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
