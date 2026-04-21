import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppMap } from "@toetslib/core";

type Framework = AppMap["project"]["framework"];

export class ProjectStructure {
  detectSrcDir(dir: string, framework: Framework): string {
    switch (framework) {
      case "nextjs": {
        if (existsSync(join(dir, "app"))) return "app";
        if (existsSync(join(dir, "src", "app"))) return "src/app";
        if (existsSync(join(dir, "pages"))) return "pages";
        if (existsSync(join(dir, "src", "pages"))) return "src/pages";
        if (existsSync(join(dir, "src"))) return "src";
        return ".";
      }
      case "react-vite":
      case "react-cra": {
        if (existsSync(join(dir, "src"))) return "src";
        return ".";
      }
    }
  }

  detectEntryPoint(dir: string, srcDir: string): string | null {
    const fullSrcDir = join(dir, srcDir);
    const candidates = [
      "main.tsx",
      "main.jsx",
      "index.tsx",
      "index.jsx",
      "App.tsx",
      "App.jsx",
    ];

    for (const candidate of candidates) {
      if (existsSync(join(fullSrcDir, candidate))) {
        return candidate;
      }
    }

    return null;
  }

  detectBaseUrl(
    port: number,
    dir: string,
    framework: Framework
  ): string {
    if (framework === "react-vite") {
      const viteConfigs = [
        "vite.config.js",
        "vite.config.ts",
        "vite.config.mjs",
        "vite.config.mts",
      ];

      for (const name of viteConfigs) {
        const configPath = join(dir, name);
        if (!existsSync(configPath)) continue;

        try {
          const content = readFileSync(configPath, "utf-8");
          if (
            content.includes("https:") &&
            (content.includes("httpsConfig") ||
              content.includes("key:") ||
              content.includes("cert:"))
          ) {
            return `https://localhost:${port}`;
          }
        } catch {
          // skip
        }
      }
    }

    return `http://localhost:${port}`;
  }
}
