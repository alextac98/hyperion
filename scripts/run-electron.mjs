import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { desktopRuntime } from "./desktop-runtime.mjs";
import { developmentInstance } from "../dist-electron/development.js";

const instance = developmentInstance(
  process.cwd(),
  process.env.HYPERION_DEV_BRANCH,
);
const environment = { ...process.env, HYPERION_DEV_BRANCH: instance.branch };
delete environment.ELECTRON_RUN_AS_NODE;

let child;
let renderer;
let stopping = false;
let forceStop;
function terminateChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  forceStop ??= setTimeout(() => child.kill("SIGKILL"), 5000);
}
function stop() {
  stopping = true;
  if (child) terminateChild();
  else renderer?.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  const executable = await desktopRuntime();
  if (!stopping) {
    // Vite installs process-wide exit handlers, so give it its own process.
    renderer = fork(new URL("./development-server.mjs", import.meta.url), [], {
      env: environment,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    renderer.once("exit", () => {
      if (!stopping) terminateChild();
    });
    const url = await new Promise((resolve, reject) => {
      renderer.once("message", ({ url }) => resolve(url));
      renderer.once("error", reject);
      renderer.once("exit", () =>
        reject(new Error("Renderer server stopped before startup completed.")),
      );
    });
    environment.HYPERION_DEV_URL = url;
    console.log(`Hyperion branch: ${instance.branch}\nRenderer: ${url}`);
    if (!stopping) {
      child = spawn(executable, [".", ...process.argv.slice(2)], {
        cwd: process.cwd(),
        env: environment,
        stdio: "inherit",
      });
      process.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          resolve(code ?? (signal === "SIGINT" ? 130 : 143)),
        );
      });
    }
  }
} catch (error) {
  if (!stopping) console.error("Could not start desktop development", error);
  process.exitCode = 1;
} finally {
  stopping = true;
  clearTimeout(forceStop);
  if (renderer && renderer.exitCode === null && renderer.signalCode === null) {
    const exited = once(renderer, "exit");
    renderer.kill("SIGTERM");
    const force = setTimeout(() => renderer.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(force);
  }
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
