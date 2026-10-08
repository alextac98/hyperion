import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { desktopRuntime } from "./desktop-runtime.mjs";
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  await desktopRuntime(),
  [
    fileURLToPath(new URL("./electron-test-entry.mjs", import.meta.url)),
    process.argv[2] ?? "tests/electron-smoke.mjs",
    ...process.argv.slice(3),
  ],
  { env: environment, stdio: "inherit" },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
