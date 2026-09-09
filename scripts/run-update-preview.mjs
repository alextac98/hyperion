import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopRuntime } from "./desktop-runtime.mjs";

const scenario = process.argv.slice(2).find((arg) => arg !== "--") || "success";
if (
  !["success", "download-error", "check-error", "up-to-date"].includes(scenario)
) {
  throw new Error(
    "Choose success, download-error, check-error, or up-to-date.",
  );
}
const directory = await mkdtemp(join(tmpdir(), "hyperion-update-preview-"));
const profile = join(directory, "profile");
await mkdir(profile);
const environment = {
  ...process.env,
  HYPERION_TEST_RENDERER: "1",
  HYPERION_UPDATE_PREVIEW: scenario,
  HYPERION_UPDATE_PREVIEW_PROFILE: profile,
  HYPERION_DATA_DIRECTORY: join(directory, "data"),
};
delete environment.ELECTRON_RUN_AS_NODE;
console.log(
  `Update preview: ${scenario}\nIsolated data: ${directory}\nDownloads are simulated. Restart to update relaunches this preview without replacing any app files.`,
);
const child = spawn(await desktopRuntime(), ["."], {
  env: environment,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
// Retain the temporary profile so it remains available after the simulated restart.
