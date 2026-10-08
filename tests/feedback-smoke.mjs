import assert from "node:assert/strict";
import { app, BrowserWindow, shell } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFirstVault } from "./vault-setup-helpers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
async function run() {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-feedback-test-"));
  app.setPath("userData", join(directory, "profile"));
  // Direct script launches report "0.0" instead of loading our package's
  // version. Supply a fixture version, as a packaged application would.
  const getVersion = app.getVersion;
  app.getVersion = () => "0.3.0-feedback-test";
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";

  // Exercise the real IPC and preload without launching a browser or submitting
  // an issue. This also lets the native UI exercise a failed handoff and retry.
  const opened = [];
  let fail = false;
  const openExternal = shell.openExternal;
  shell.openExternal = async (url) => {
    if (fail) throw new Error("No browser available");
    opened.push(url);
  };

  let window;
  let exitCode = 0;
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(message);
  };
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async (path) => {
    // Let Chromium paint the latest DOM and finish the menu's opening animation.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await writeFile(path, (await window.webContents.capturePage()).toPNG());
  };
  const menuFits = () =>
    js(`(() => {
  const bounds = document.querySelector('.page-context-menu').getBoundingClientRect();
  return bounds.left >= 8 && bounds.top >= 8 &&
    bounds.right <= innerWidth - 7 && bounds.bottom <= innerHeight - 7;
})()`);

  try {
    await import(new URL("../dist-electron/main.js", import.meta.url).href);
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    await until(
      () =>
        js("Boolean(document.querySelector('.vault-setup .feedback-button'))"),
      "Setup feedback did not appear",
    );
    assert.equal(
      opened.length,
      0,
      "Feedback must only open after a user action",
    );
    await capture("/tmp/hyperion-feedback-setup.png");

    fail = true;
    await click(".vault-setup .feedback-button");
    await until(
      () =>
        js(
          "document.querySelector('.feedback-error')?.textContent.includes('Could not open GitHub')",
        ),
      "Failed handoff was not reported",
    );
    fail = false;
    await click(".vault-setup .feedback-button");
    await until(() => opened.length === 1, "Setup retry did not open feedback");
    const expectedUrl = opened[0];
    const url = new URL(expectedUrl);
    assert.equal(
      url.origin + url.pathname,
      "https://github.com/alextac98/hyperion/issues/new",
    );
    assert.equal(url.searchParams.get("template"), "feedback.md");
    assert.ok(
      url.searchParams.get("body").includes(`- Hyperion: ${app.getVersion()}`),
    );
    assert.ok(
      url.searchParams.get("body").includes(process.getSystemVersion()),
    );
    assert.ok(
      url.searchParams.get("body").includes(`- Architecture: ${process.arch}`),
    );
    assert.ok(expectedUrl.length < 2081);

    await createFirstVault(js, until);
    await js(
      `document.querySelector('doc-title').doc.root.props.title.insert('Private feedback smoke ', 0)`,
    );
    await until(
      () =>
        js(
          "document.querySelector('.save-status')?.textContent.includes('Saved locally')",
        ),
      "Editor did not finish saving",
    );
    await click(".sidebar-footer .feedback-button");
    await until(() => opened.length === 2, "Sidebar feedback did not open");
    assert.equal(
      opened[1],
      expectedUrl,
      "The handoff must not include page or vault content",
    );

    await js(`document.querySelector('.organizer-page-link').dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: innerWidth - 2, clientY: innerHeight - 2,
  }))`);
    await until(
      () =>
        js(
          "Boolean(document.querySelector('.page-context-menu .feedback-button'))",
        ),
      "Context feedback did not appear",
    );
    await until(menuFits, "Context menu overflowed the window");
    await capture("/tmp/hyperion-feedback-menu.png");
    assert.equal(await menuFits(), true);
    await js(`document.querySelector('.page-context-menu').dispatchEvent(new KeyboardEvent('keydown', {
    key: 'End', bubbles: true, cancelable: true,
  }))`);
    assert.equal(
      await js("document.activeElement.classList.contains('feedback-button')"),
      true,
    );
    fail = true;
    await click(".page-context-menu .feedback-button");
    await until(
      () =>
        js(
          "Boolean(document.querySelector('.page-context-menu .feedback-error'))",
        ),
      "Context handoff error was not shown",
    );
    await until(menuFits, "Context menu overflowed after showing an error");
    fail = false;
    await click(".page-context-menu .feedback-button");
    await until(
      () => opened.length === 3,
      "Context feedback retry did not open",
    );
    await until(
      () => js("!document.querySelector('.page-context-menu')"),
      "Context menu did not close after handoff",
    );
    assert.equal(opened[2], expectedUrl);

    // The bridge accepts no URL or report content from the renderer.
    await js(
      "window.hyperionDesktop.openFeedback('https://example.com', { body: 'Private content' })",
    );
    assert.equal(opened[3], expectedUrl);
    const untrusted = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(root, "dist-electron/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await untrusted.loadURL("about:blank");
    await assert.rejects(
      () =>
        untrusted.webContents.executeJavaScript(
          "window.hyperionDesktop.openFeedback()",
          true,
        ),
      /untrusted renderer/,
    );
    assert.equal(opened.length, 4);
    untrusted.destroy();
    console.log(
      "PASS: setup, sidebar, keyboard context menu, browser failure/retry, bounded system-only handoff, and trusted IPC",
    );
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      await writeFile(
        "/tmp/hyperion-feedback-failure.png",
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    exitCode = 1;
  } finally {
    app.getVersion = getVersion;
    shell.openExternal = openExternal;
    app.removeAllListeners("window-all-closed");
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    app.emit("will-quit");
    await rm(directory, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
