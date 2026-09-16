import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import ts from "typescript";

const nodeModulesDirectory = fileURLToPath(new URL("./node_modules/", import.meta.url));

function readBlocksuitePackageNames(scopeDirectory: string) {
  if (!existsSync(scopeDirectory)) {
    return [];
  }

  return readdirSync(scopeDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => `@blocksuite/${entry.name}`);
}

function findBlocksuitePackages() {
  const packageNames = new Set(
    readBlocksuitePackageNames(join(nodeModulesDirectory, "@blocksuite")),
  );
  const pnpmVirtualStore = join(nodeModulesDirectory, ".pnpm");

  if (existsSync(pnpmVirtualStore)) {
    for (const entry of readdirSync(pnpmVirtualStore, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const scopeDirectory = join(
        pnpmVirtualStore,
        entry.name,
        "node_modules",
        "@blocksuite",
      );
      for (const packageName of readBlocksuitePackageNames(scopeDirectory)) {
        packageNames.add(packageName);
      }
    }
  }

  return [...packageNames].sort();
}

const blocksuitePackages = findBlocksuitePackages();

function transformBlocksuiteDecorators() {
  return {
    name: "hyperion:transform-blocksuite-decorators",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const fileName = id.split("?", 1)[0];
      const isTypeScript = /\.[cm]?tsx?$/.test(fileName);
      const isDecoratedJavaScript = /\.[cm]?jsx?$/.test(fileName) && code.includes("@");
      if (
        !fileName.includes("/node_modules/@blocksuite/") ||
        (!isTypeScript && !isDecoratedJavaScript)
      ) {
        return null;
      }

      const result = ts.transpileModule(code, {
        fileName,
        reportDiagnostics: false,
        compilerOptions: {
          allowJs: true,
          experimentalDecorators: false,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          useDefineForClassFields: false,
        },
      });

      return { code: result.outputText, map: null };
    },
  };
}

// Keep the database creation menu, renderer map and conversions table-only.
function supportedEditorModels() {
  let originalViews = "";
  let originalElements = "";
  const elementsId = "\0hyperion:surface-elements";
  const virtualId = "\0hyperion:supported-database-views";
  return {
    name: "hyperion:supported-database-views",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (source === "./element-model/index.js" && importer?.endsWith("/affine-block-surface/src/surface-model.ts")) {
        originalElements = fileURLToPath(new URL("./element-model/index.ts", pathToFileURL(importer)));
        return elementsId;
      }
      if (source !== "./views/index.js" || !importer?.replaceAll("\\", "/").endsWith("/affine-block-database/src/data-source.ts")) return null;
      originalViews = fileURLToPath(new URL("./views/index.ts", pathToFileURL(importer)));
      return virtualId;
    },
    load(id: string) {
      if (id === elementsId) return `export * from ${JSON.stringify(originalElements)};
        import { elementsCtorMap as allElements } from ${JSON.stringify(originalElements)};
        export const elementsCtorMap = Object.fromEntries(Object.entries(allElements).filter(([type]) => type !== "mindmap"));`;
      if (id !== virtualId) return null;
      return `import { databaseBlockViews as allViews } from ${JSON.stringify(originalViews)};
        export const databaseBlockViews = allViews.filter(view => view.type === "table");
        export const databaseBlockViewMap = Object.fromEntries(databaseBlockViews.map(view => [view.type, view]));
        export const databaseBlockViewConverts = [];`;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    transformBlocksuiteDecorators(),
    supportedEditorModels(),
    vanillaExtractPlugin({
      unstable_mode: "transform",
    }),
    react(),
  ],
  oxc: {
    target: "es2022",
    decorator: {
      legacy: false,
    },
  },
  optimizeDeps: {
    exclude: blocksuitePackages,
    include: ["bind-event-listener", "bytes", "debug", "deepmerge", "extend", "lodash.ismatch", "picocolors"],
    rolldownOptions: {
      plugins: [transformBlocksuiteDecorators()],
      transform: {
        target: "es2022",
        decorator: {
          legacy: false,
        },
      },
    },
  },
  build: {
    target: "es2022",
  },
  resolve: {
    alias: [
      {
        find: "@toeverything/theme/v2",
        replacement: fileURLToPath(new URL("./app/theme/v2.ts", import.meta.url)),
      },
      {
        find: "@toeverything/theme",
        replacement: fileURLToPath(new URL("./app/theme/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
});
