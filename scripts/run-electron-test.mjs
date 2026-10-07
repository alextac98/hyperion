import { spawn } from "node:child_process";
import { desktopRuntime } from "./desktop-runtime.mjs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
// Launch with app metadata: Electron 43 reports version "0.0" for a bare test
// script, which electron-updater correctly rejects before the window can open.
const directory = await mkdtemp(join(tmpdir(), "hyperion-test-launcher-"));
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  join(directory, "package.json"),
  JSON.stringify({
    name: "hyperion-test",
    version,
    main: resolve(process.argv[2] ?? "tests/electron-smoke.mjs"),
  }),
);
try {
  const child = spawn(
    await desktopRuntime(),
    [directory, ...process.argv.slice(3)],
    { env: environment, stdio: "inherit" },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", reject);
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
