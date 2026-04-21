import { join, relative } from "node:path";
import type { Route, ComponentMap } from "@toetslib/core";
import { parseFile, traverse, t, findAllImportSources } from "./ast-utils.js";

export class ComponentMapper {
  private srcDir: string;

  constructor(srcDir: string) {
    this.srcDir = srcDir;
  }

  async map(routes: Route[]): Promise<ComponentMap[]> {
    const components: ComponentMap[] = [];

    for (const route of routes) {
      if (!route.componentFile) continue;

      try {
        const ast = parseFile(route.componentFile);
        const importSources = findAllImportSources(
          ast,
          route.componentFile,
          this.srcDir
        );

        const childComponents: string[] = [];
        const imports: string[] = [];

        // Collect all JSX component usages (uppercase names = components)
        traverse(ast, {
          JSXOpeningElement(path) {
            if (t.isJSXIdentifier(path.node.name)) {
              const name = path.node.name.name;
              // Only track custom components (uppercase first letter)
              if (name[0] === name[0]!.toUpperCase() && name[0] !== name[0]!.toLowerCase()) {
                if (!childComponents.includes(name)) {
                  childComponents.push(name);
                }
              }
            }
          },
        });

        // Collect import paths
        for (const [name, filePath] of importSources) {
          if (childComponents.includes(name)) {
            imports.push(filePath);
          }
        }

        components.push({
          route: route.path,
          pageComponent: route.componentName,
          filePath: route.componentFile,
          childComponents,
          imports,
        });
      } catch {
        // Can't parse file, skip
      }
    }

    return components;
  }
}
