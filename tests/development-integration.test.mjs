import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startDevelopmentServer } from "../scripts/development-server.mjs";
import { desktopRuntime } from "../scripts/desktop-runtime.mjs";
import { resetDevelopmentData } from "../scripts/reset-development.mjs";

// Requires a graphical session (or Xvfb), like the existing Electron smoke test.
test(
  "three worktrees use their own renderers, profiles and data, including matching branch labels",
  { timeout: 90000 },
  async (context) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "hyperion-development-")),
    );
    const children = [];
    const servers = [];
    context.after(async () => {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          const force = setTimeout(() => child.kill("SIGKILL"), 5000);
          await exited;
          clearTimeout(force);
        }),
      );
      await Promise.all(servers.map(({ server }) => server.close()));
      await rm(directory, { recursive: true, force: true });
    });
    const executable = await desktopRuntime();
    const appData = join(directory, "profiles");
    await mkdir(appData);
    async function launch(root, branch, url) {
      const env = {
        ...process.env,
        HYPERION_DEV_BRANCH: branch,
        HYPERION_DEV_URL: url,
        HYPERION_TEST_APP_DATA: appData,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.HYPERION_TEST_RENDERER;
      delete env.HYPERION_UPDATE_PREVIEW;
      delete env.HYPERION_DATA_DIRECTORY;
      const child = spawn(executable, [root], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      children.push(child);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Instance timed out: ${output}`)),
          30000,
        );
        child.once("message", (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ exited: code, output });
        });
      });
      return { child, ready };
    }
    const running = [];
    for (const [index, branch] of [
      "feature/search",
      "feature/search",
      "feature/editor",
    ].entries()) {
      const root = join(directory, `worktree-${index}`);
      await mkdir(root);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "hyperion-development-fixture",
          version: "0.0.0",
          main: fileURLToPath(
            new URL("./fixtures/development-instance.mjs", import.meta.url),
          ),
        }),
      );
      await writeFile(
        join(root, "index.html"),
        `<html><body>${branch}</body></html>`,
      );
      const renderer = await startDevelopmentServer({
        root,
        configFile: false,
        logLevel: "silent",
      });
      servers.push(renderer);
      const instance = await launch(root, branch, renderer.url);
      const result = await instance.ready;
      assert.equal(result.branch, branch, JSON.stringify(result));
      assert.equal(result.title, `[Dev] Hyperion — ${branch}`);
      assert.equal(result.url, `${renderer.url}/`);
      assert.equal(result.body.trim(), branch);
      assert.equal(result.profile, join(root, ".hyperion-dev", "profile"));
      assert.equal(result.sessionData, result.profile);
      // Before first-run setup, storageInfo reports the worktree's vault parent;
      // no active vault database exists yet.
      assert.equal(
        result.data.directory,
        join(root, ".hyperion-dev", "desktop", "vaults"),
      );
      assert.equal(result.data.databasePath, "");
      assert.equal(result.data.isDefault, true);
      assert.throws(
        () => resetDevelopmentData(root, branch),
        /Stop the development instance/,
      );
      running.push({ ...instance, root, result });
    }
    assert.equal(new Set(running.map(({ result }) => result.url)).size, 3);
    assert.equal(new Set(running.map(({ result }) => result.profile)).size, 3);
    // Branch labels do not change the worktree's single-instance lock.
    const duplicate = await launch(
      running[0].root,
      "renamed-label",
      servers[1].url,
    );
    assert.equal((await duplicate.ready).exited, 0);
    const closed = once(running[0].child, "exit", {
      signal: AbortSignal.timeout(10000),
    });
    running[0].child.send("close");
    await closed;
    await servers[0].server.close();
    resetDevelopmentData(running[0].root, "feature/search");
    for (let index = 1; index < running.length; index++) {
      const child = running[index].child;
      assert.equal(child.exitCode, null);
      const reply = once(child, "message", {
        signal: AbortSignal.timeout(10000),
      });
      child.send("check");
      assert.equal(
        (await reply)[0].data.directory,
        running[index].result.data.directory,
      );
      assert.ok((await fetch(servers[index].url)).ok);
    }
  },
);

test(
  "the launcher passes its renderer URL and stops both child processes",
  { timeout: 45000 },
  async (context) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "hyperion-launcher-")),
    );
    await mkdir(join(directory, "profiles"));
    await writeFile(
      join(directory, "index.html"),
      "<html><body>Launcher test</body></html>",
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "hyperion-launcher-fixture",
        version: "0.0.0",
        main: fileURLToPath(
          new URL("./fixtures/development-instance.mjs", import.meta.url),
        ),
      }),
    );
    const env = {
      ...process.env,
      HYPERION_DEV_BRANCH: "launcher-test",
      HYPERION_DATA_DIRECTORY: join(directory, "data"),
      HYPERION_TEST_APP_DATA: join(directory, "profiles"),
    };
    delete env.HYPERION_TEST_RENDERER;
    delete env.HYPERION_UPDATE_PREVIEW;
    const launcher = spawn(
      process.execPath,
      [fileURLToPath(new URL("../scripts/run-electron.mjs", import.meta.url))],
      {
        cwd: directory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    context.after(async () => {
      if (launcher.exitCode === null && launcher.signalCode === null) {
        const exited = once(launcher, "exit");
        launcher.kill("SIGTERM");
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    });
    let output = "";
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Launcher timed out: ${output}`)),
        25000,
      );
      launcher.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/INSTANCE_READY (.+)\n/);
        if (match) {
          clearTimeout(timer);
          resolve(JSON.parse(match[1]));
        }
      });
      launcher.stderr.on("data", (chunk) => {
        output += chunk;
      });
      launcher.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      launcher.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Launcher exited ${code}: ${output}`));
      });
    });
    assert.equal(result.branch, "launcher-test");
    assert.equal(result.body.trim(), "Launcher test");
    assert.ok((await fetch(result.url)).ok);
    const exited = once(launcher, "exit", {
      signal: AbortSignal.timeout(12000),
    });
    launcher.kill("SIGTERM");
    await exited;
    assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
    await assert.rejects(fetch(result.url));
  },
);
