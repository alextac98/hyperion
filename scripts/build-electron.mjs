import { build } from "esbuild";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const checked = spawnSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "-p",
    "electron/tsconfig.json",
    "--noEmit",
  ],
  { stdio: "inherit" },
);
if (checked.error) throw checked.error;
if (checked.status !== 0) process.exit(checked.status ?? 1);
// Bundle shared source into each public desktop entry, preserving existing artifact paths.
const entries = (await readdir("electron")).filter(
  (name) => name.endsWith(".ts") && name !== "main.ts",
);
await build({
  entryPoints: entries.map((name) => `electron/${name}`),
  outdir: "dist-electron",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
});
await build({
  entryPoints: ["electron/preload.cts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  external: ["electron"],
  platform: "node",
  format: "cjs",
});
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.js",
  bundle: true,
  external: ["electron", "electron-updater", "node:*"],
  platform: "node",
  format: "esm",
});
