import { createFirstVault } from "./vault-setup-helpers.mjs";
// Run with: node scripts/run-electron-test.mjs tests/history-pause-smoke.mjs
import { app, BrowserWindow } from "electron";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAUSE_MS = 4000;

(async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-history-pause-"));
  app.setPath("userData", join(directory, "electron-profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  process.env.HYPERION_HISTORY_PAUSE_MS = String(PAUSE_MS);
  let window;
  const until = async (predicate, message, timeout = 25000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* Renderer can reload between checks. */
      }
      await wait(100);
    }
    throw new Error(message);
  };
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const active = `document.querySelector('.workspace-panel[data-workspace-active="true"] .note-workspace')`;
  const editor = `${active}?.querySelector('doc-title')`;
  const click = (selector, text) =>
    js(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  try {
    await import(pathToFileURL(join(testDirectory, "../dist-electron/main.js")).href);
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) console.error("renderer:", message);
    });
    const vaultId = await createFirstVault(js, until);
    await until(() => js(`Boolean(${editor}?.doc?.root)`), "Editor did not load");
    await until(
      () => js('document.querySelector(".save-status")?.textContent.includes("Saved locally")'),
      "Initial save did not finish",
    );
    const noteId = await js(`${editor}.doc.id`);
    const versions = (id = noteId) =>
      js(
        `window.hyperionDesktop.repositoryExecute({operation:'listRevisions',vaultId:${JSON.stringify(vaultId)},noteId:${JSON.stringify(id)}})`,
      );
    // Let edits from creating the vault settle into their own version first.
    await wait(PAUSE_MS + 500);
    const baseline = (await versions()).length;

    // Record any appearance of the blocking overlay while typing.
    await js(`(() => {
      window.__overlaySeen = Boolean(document.querySelector('.data-operation-overlay'));
      new MutationObserver(() => {
        if (document.querySelector('.data-operation-overlay')) window.__overlaySeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    })()`);
    // Place a real caret at the end of the title and type with native input events.
    await js(`(() => {
      const editable = ${editor}.querySelector('[contenteditable="true"]');
      editable.focus();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    const typed = " typed in one session";
    const typingStarted = Date.now();
    for (const character of typed) {
      window.webContents.insertText(character);
      await wait(150);
    }
    // Keep typing past the pause length as long as each gap is shorter.
    while (Date.now() - typingStarted < PAUSE_MS * 1.5) {
      window.webContents.insertText(".");
      await wait(500);
    }
    assert.equal((await versions()).length, baseline, "no version while writing continuously");
    await until(
      () => js(`${editor}.doc.root.props.title.toString().includes(${JSON.stringify(typed)})`),
      "Typed text did not reach the editor",
    );
    await until(async () => (await versions()).length === baseline + 1, "Pause did not save a version", PAUSE_MS * 3);
    const [latest] = await versions();
    assert.equal(latest.reason, "automatic");
    assert.ok(latest.note.title.includes(typed), "the version contains the whole burst");
    await wait(500);
    assert.equal((await versions()).length, baseline + 1, "one version for the whole burst");
    assert.equal(await js("window.__overlaySeen"), false, "saving history must not cover the editor");
    assert.equal(
      await js(`(() => {
        const editable = ${editor}.querySelector('[contenteditable="true"]');
        const selection = getSelection();
        return Boolean(selection.rangeCount && editable.contains(selection.focusNode));
      })()`),
      true,
      "the caret stays where the user was typing",
    );
    window.webContents.insertText("!");
    await until(
      () => js(`${editor}.doc.root.props.title.toString().endsWith('!')`),
      "Typing did not continue at the caret after saving history",
    );

    // Closing a page's tab saves its version without waiting for the pause.
    const beforeLeave = (await versions()).length;
    await js(`${editor}.doc.root.props.title.insert(' before leaving', ${editor}.doc.root.props.title.length)`);
    await until(
      () =>
        js(
          `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(vaultId)}}).then(notes=>notes.find(n=>n.id===${JSON.stringify(noteId)})?.title.endsWith(' before leaving'))`,
        ),
      "Edit before leaving was not persisted",
    );
    // Opening other pages adds tabs; closing the page's tab is leaving it.
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await until(() => js(`!${editor} || ${editor}.doc.id !== ${JSON.stringify(noteId)}`), "The page tab did not close");
    await until(
      async () => (await versions()).length === beforeLeave + 1,
      "Closing the page tab did not save its version",
      PAUSE_MS - 500,
    );
    assert.ok((await versions())[0].note.title.endsWith(" before leaving"));

    // The checkpoint interval is configurable and can be disabled.
    const preferences = () =>
      js(
        `window.hyperionDesktop.repositoryExecute({operation:'getPreferences',vaultId:${JSON.stringify(vaultId)}})`,
      );
    await click(".sidebar button", "Settings");
    await until(() => js(`Array.from(document.querySelectorAll('.settings-body nav button')).some(b=>b.textContent.trim()==='Data')`), "Settings did not open");
    await click(".settings-body nav button", "Data");
    const toggle = `document.querySelector('input[aria-label="Save versions during long writing sessions"]')`;
    const minutes = `document.querySelector('.settings-content input[type="number"]')`;
    await until(() => js(`Boolean(${toggle})`), "Checkpoint setting is missing");
    assert.equal(await js(`${toggle}.checked`), true, "checkpoints are on by default");
    assert.equal(await js(`${minutes}.value`), "60", "the default interval is one hour");
    await js(`${toggle}.click()`);
    await until(async () => (await preferences()).historyCheckpointMinutes === null, "Disabling checkpoints was not saved");
    assert.equal(await js(`${minutes}`), null);
    await js(`${toggle}.click()`);
    await until(async () => (await preferences()).historyCheckpointMinutes === 60, "Re-enabling checkpoints was not saved");
    await until(() => js(`Boolean(${minutes})`), "Interval input did not return");
    await js(`(() => {
      const input = ${minutes};
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '30');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.blur();
    })()`);
    await until(async () => (await preferences()).historyCheckpointMinutes === 30, "Custom interval was not saved");

    console.log(
      "PASS: typing is uninterrupted, a burst becomes one version after the pause, closing a page tab saves it, and the checkpoint interval is configurable",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
})();
