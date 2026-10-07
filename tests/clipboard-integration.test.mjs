import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startDevelopmentServer } from "../scripts/development-server.mjs";
import { desktopRuntime } from "../scripts/desktop-runtime.mjs";

// Copy serialization differs between Vite's development modules and the built
// renderer. Run the same native clipboard round trip against both.
for (const renderer of ["built", "development"]) {
  test(
    `native clipboard commands in the ${renderer} renderer`,
    { timeout: 120000 },
    async (context) => {
      const directory = await mkdtemp(
        join(tmpdir(), "hyperion-clipboard-server-"),
      );
      let server;
      let child;
      context.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          const force = setTimeout(() => child.kill("SIGKILL"), 5000);
          await exited;
          clearTimeout(force);
        }
        await server?.close();
        await rm(directory, { recursive: true, force: true });
      });
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      delete environment.HYPERION_CLIPBOARD_DEV_URL;
      delete environment.HYPERION_UPDATE_PREVIEW;
      if (renderer === "development") {
        const development = await startDevelopmentServer({
          cacheDir: join(directory, "vite-cache"),
          logLevel: "warn",
          server: { port: 0, watch: null },
        });
        server = development.server;
        environment.HYPERION_CLIPBOARD_DEV_URL = development.url;
      }
      child = spawn(await desktopRuntime(), ["tests/clipboard-smoke.mjs"], {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const [code, signal] = await once(child, "exit");
      assert.equal(signal, null, output);
      assert.equal(code, 0, output);
      context.diagnostic(output.trim());
    },
  );
}
