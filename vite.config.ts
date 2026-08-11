import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const blocksuitePackages = readdirSync(
  fileURLToPath(new URL("./node_modules/@blocksuite/", import.meta.url)),
  { withFileTypes: true },
)
  .filter(entry => entry.isDirectory())
  .map(entry => `@blocksuite/${entry.name}`);

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

export default defineConfig({
  plugins: [
    transformBlocksuiteDecorators(),
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
