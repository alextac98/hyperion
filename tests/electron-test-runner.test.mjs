import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { desktopRuntime } from "../scripts/desktop-runtime.mjs";

test(
  "Electron smoke runner reports failure after its last window closes",
  { timeout: 15000 },
  async (context) => {
    const cache = resolve("node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(join(cache, "hyperion-runner-test-"));
    const fixture = join(directory, "failure.mjs");
    let child;
    context.after(async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 5000);
        await exited;
        clearTimeout(force);
      }
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(
      fixture,
      `
    import { app, BrowserWindow } from 'electron';
    import assert from 'node:assert/strict';
    void (async () => {
    app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
    app.on('window-all-closed', () => app.quit());
    await app.whenReady();
    const window = new BrowserWindow({ show: false });
    window.destroy();
    // The native close/quit event must not skip assertions or async cleanup.
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      assert.fail('Intentional assertion after closing the last window');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      await new Promise(resolve => setTimeout(resolve, 100));
      app.exit(process.exitCode ?? 0);
    }
    })().catch(error => { console.error(error); app.exit(1); });
  `,
    );
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    child = spawn(
      await desktopRuntime(),
      ["scripts/electron-test-entry.mjs", fixture],
      { env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null, output);
    assert.equal(code, 1, output);
    assert.match(output, /Intentional assertion after closing the last window/);
  },
);
