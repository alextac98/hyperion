import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFirstVault } from "./vault-setup-helpers.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const applicationWindows = () =>
  BrowserWindow.getAllWindows().filter(
    (window) => window.getTitle() !== "Hyperion tab drag preview",
  );
const dragPreview = () =>
  BrowserWindow.getAllWindows().find(
    (window) => window.getTitle() === "Hyperion tab drag preview",
  );
const editor = `document.querySelector('.workspace-panel[data-workspace-active="true"] doc-title')`;
// Electron delays app.ready until its ESM entry has finished evaluating.
// Keep the native lifecycle checks outside top-level await.
async function run() {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-windows-"));
  app.setPath("userData", join(directory, "profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  // Failed saves remain observable without an unattended native modal.
  const messages = [];
  dialog.showMessageBox = async (...args) => {
    messages.push(args.at(-1));
    return { response: 0 };
  };
  const deadline = setTimeout(() => {
    console.error("Window smoke test timed out");
    app.exit(1);
  }, 120000);
  const until = async (predicate, message) => {
    const limit = Date.now() + 30000;
    while (Date.now() < limit) {
      if (await predicate()) return;
      await wait(100);
    }
    throw new Error(message);
  };
  const js = (window, source) =>
    window.webContents.executeJavaScript(source, true);
  const activePage = (window, id) =>
    until(
      () => js(window, `${editor}?.doc?.id === ${JSON.stringify(id)}`),
      `Editor ${id} did not become active`,
    );
  const openPage = async (window, id) => {
    await until(() => js(window, `Boolean(document.querySelector('[data-page-id="'+${JSON.stringify(id)}+'"] .organizer-page-link'))`), "Page navigation did not load");
    await js(
      window,
      `document.querySelector('[data-page-id="'+${JSON.stringify(id)}+'"] .organizer-page-link').click()`,
    );
    await activePage(window, id);
  };
  const tabCenter = (window, id) =>
    js(
      window,
      `(() => {
  const tab = Array.from(document.querySelectorAll('.dv-tab')).find(tab => tab.dataset.tabPanelId === ${JSON.stringify(JSON.stringify({ view: "note", id }))});
  const box = tab.getBoundingClientRect(); return { x: Math.round(box.x + 24), y: Math.round(box.y + box.height / 2) };
})()`,
    );
  const mouse = (window, type, point) =>
    window.webContents.sendInputEvent({
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  const beginDrag = async (window, id) => {
    const point = await tabCenter(window, id);
    mouse(window, "mouseMove", point);
    mouse(window, "mouseDown", point);
    mouse(window, "mouseMove", { x: point.x + 20, y: point.y });
    await until(
      () =>
        js(
          window,
          `document.querySelector('.workspace-layout-viewport').hasAttribute('data-tab-dragging')`,
        ),
      "Tab drag did not start",
    );
    await until(
      () => dragPreview()?.isVisible(),
      "Native tab preview did not appear",
    );
    assert.equal(
      dragPreview().isFocusable(),
      false,
      "The tab preview must not steal focus",
    );
    return point;
  };
  const newWindow = (source) =>
    applicationWindows().find((window) => window !== source);
  const detachFromMenu = async (window, id) => {
    const point = await tabCenter(window, id);
    await js(
      window,
      `document.elementFromPoint(${point.x}, ${point.y}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${point.x}, clientY: ${point.y} }))`,
    );
    await js(
      window,
      `Array.from(document.querySelectorAll('[role=menuitem]')).find(button => button.textContent === 'Move to new window').click()`,
    );
  };

  try {
    await import(pathToFileURL(resolve("dist-electron/main.js")).href);
    let source;
    await until(() => {
      source = applicationWindows()[0];
      return source && !source.webContents.isLoading();
    }, "Primary window did not load");
    source.setBounds({ x: 40, y: 60, width: 1000, height: 800 });
    const vaultId = await createFirstVault(
      (sourceCode) => js(source, sourceCode),
      until,
    );
    const noteId = await js(source, `${editor}.doc.id`);
    const notes = await js(
      source,
      `window.hyperionDesktop.repositoryExecute({ operation: 'listNotes', vaultId: ${JSON.stringify(vaultId)} })`,
    );
    const otherId = notes.find((note) => note.id !== noteId).id;
    await openPage(source, otherId);
    await openPage(source, noteId);

    const outside = { x: 1300, y: 130 };
    await beginDrag(source, noteId);
    mouse(source, "mouseMove", outside);
    source.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    source.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    mouse(source, "mouseUp", outside);
    await wait(300);
    assert.equal(
      dragPreview(),
      undefined,
      "Escape must remove the drag preview",
    );
    assert.equal(
      applicationWindows().length,
      1,
      "Escape must cancel detachment",
    );
    console.log(
      "PASS: dragging outside then pressing Escape keeps the tab in its window",
    );

    await beginDrag(source, noteId);
    mouse(source, "mouseMove", { x: 500, y: 400 });
    mouse(source, "mouseUp", { x: 500, y: 400 });
    await wait(300);
    assert.equal(
      applicationWindows().length,
      1,
      "An in-window drop must not detach",
    );

    const splitTarget = await js(
      source,
      `(() => {
      const box=document.querySelector('.dv-content-container').getBoundingClientRect();
      return {x:Math.round(box.right-12),y:Math.round(box.top+box.height/2)};
    })()`,
    );
    await beginDrag(source, noteId);
    mouse(source, "mouseMove", splitTarget);
    mouse(source, "mouseUp", splitTarget);
    await until(
      () => js(source, "document.querySelectorAll('.dv-groupview').length===2"),
      "In-window tab drag did not split the pane",
    );
    assert.equal(applicationWindows().length, 1);
    console.log(
      "PASS: in-window tab drags still split panes without opening another window",
    );

    await js(source, `${editor}.doc.root.props.title.insert('Detached ', 0)`);
    await beginDrag(source, noteId);
    mouse(source, "mouseMove", outside);
    mouse(source, "mouseUp", outside);
    let destination;
    await until(() => {
      destination = newWindow(source);
      return Boolean(destination);
    }, "Drag outside did not create a native window");
    await activePage(destination, noteId);
    await until(
      () =>
        js(
          source,
          `!Array.from(document.querySelectorAll('.dv-tab')).some(tab => tab.dataset.tabPanelId === ${JSON.stringify(JSON.stringify({ view: "note", id: noteId }))})`,
        ),
      "Transferred tab remained in source window",
    );
    assert.ok(
      await js(
        destination,
        `${editor}.doc.root.props.title.toString().startsWith('Detached ')`,
      ),
      "Pending edit was lost during detachment",
    );
    assert.equal(
      await js(destination, "document.querySelectorAll('.dv-tab').length"),
      1,
      "Destination must contain just the transferred tab",
    );
    const sourceSession = await js(
      source,
      "window.hyperionDesktop.windowSession()",
    );
    const destinationSession = await js(
      destination,
      "window.hyperionDesktop.windowSession()",
    );
    assert.notEqual(sourceSession.id, destinationSession.id);
    assert.equal(sourceSession.kind, "primary");
    assert.equal(destinationSession.kind, "page");
    assert.equal(destinationSession.vaultId, vaultId);
    assert.equal(
      await js(
        destination,
        "Boolean(document.querySelector('.sidebar, .tab-home'))",
      ),
      false,
    );
    assert.equal(
      await js(
        destination,
        "document.querySelector('.app-shell').dataset.windowKind",
      ),
      "page",
    );
    assert.equal(
      dragPreview(),
      undefined,
      "Releasing the tab must remove the preview",
    );
    destination.setSize(520, 700);
    await wait(150);
    assert.ok(
      await js(
        destination,
        "document.querySelector('.topbar').scrollWidth <= innerWidth",
      ),
      "Page controls must fit a narrow window",
    );
    destination.setSize(840, 820);
    console.log(
      "PASS: releasing a tab outside opens a native window with its pending edit, and removes only the transferred tab",
    );

    await openPage(source, noteId);
    await js(destination, `${editor}.doc.root.props.title.insert('Live ', 0)`);
    await until(
      () =>
        js(
          source,
          `${editor}.doc.root.props.title.toString().startsWith('Live Detached ')`,
        ),
      "Editor updates did not reach source",
    );
    await Promise.all([
      js(source, `${editor}.doc.root.props.title.insert('A ', 0)`),
      js(destination, `${editor}.doc.root.props.title.insert('B ', 0)`),
    ]);
    await until(async () => {
      const [a, b] = await Promise.all([
        js(source, `${editor}.doc.root.props.title.toString()`),
        js(destination, `${editor}.doc.root.props.title.toString()`),
      ]);
      return a === b && a.includes("A ") && a.includes("B ");
    }, "Concurrent edits did not converge");
    await until(
      async () =>
        (
          await js(source, "document.querySelector('.save-status').textContent")
        ).includes("Saved locally") &&
        (
          await js(
            destination,
            "document.querySelector('.save-status').textContent",
          )
        ).includes("Saved locally"),
      "Synchronized edits did not settle",
    );
    console.log(
      "PASS: edits synchronize in both directions and concurrent Yjs edits converge",
    );

    const destinationTabs = await js(
      destination,
      "Array.from(document.querySelectorAll('.dv-tab')).map(tab => tab.dataset.tabPanelId)",
    );
    source.reload();
    await activePage(source, noteId);
    destination.reload();
    await activePage(destination, noteId);
    assert.deepEqual(
      await js(
        destination,
        "Array.from(document.querySelectorAll('.dv-tab')).map(tab => tab.dataset.tabPanelId)",
      ),
      destinationTabs,
    );
    assert.equal(
      await js(source, "document.querySelectorAll('.dv-tab').length"),
      2,
      "Source session was overwritten by destination",
    );
    console.log(
      "PASS: both windows reload their own tab sessions independently",
    );

    const originalStorage = await js(
      destination,
      "window.hyperionDesktop.storageInfo()",
    );
    await assert.rejects(
      js(
        source,
        `window.hyperionDesktop.repositoryExecute({operation:'closeVault',vaultId:${JSON.stringify(vaultId)}})`,
      ),
      /other windows/,
    );
    await assert.rejects(
      js(
        source,
        `window.hyperionDesktop.repositoryExecute({operation:'deleteNote',id:${JSON.stringify(noteId)}})`,
      ),
      /other windows/,
    );
    await js(
      destination,
      `(async () => {
    const data=window.hyperionDesktop;
    const vault=(await data.repositoryExecute({operation:'listVaults'}))[0];
    const preferences=await data.repositoryExecute({operation:'getPreferences',vaultId:vault.id});
    await data.repositoryExecute({operation:'createVault',vault:{...vault,id:'other-vault',name:'Other vault'},preferences:{...preferences,vaultId:'other-vault'},notes:[],collections:[],documents:{}});
  })()`,
    );
    await js(source, "document.querySelector('.workspace-button').click()");
    await until(
      () =>
        js(
          source,
          "Array.from(document.querySelectorAll('.vault-menu button')).some(button=>button.textContent.includes('Other vault'))",
        ),
      "Other vault did not appear",
    );
    await js(
      source,
      "Array.from(document.querySelectorAll('.vault-menu button')).find(button=>button.textContent.includes('Other vault')).click()",
    );
    await until(
      () =>
        js(
          source,
          "document.querySelector('.workspace-copy strong')?.textContent==='Other vault' && Boolean(document.querySelector('.home-view'))",
        ),
      "Source did not switch vaults",
    );
    assert.deepEqual(
      await js(destination, "window.hyperionDesktop.storageInfo()"),
      originalStorage,
      "A different window's vault selection redirected storage",
    );
    const backup = await js(
      destination,
      "window.hyperionDesktop.createBackup()",
    );
    assert.ok(backup.path.startsWith(originalStorage.directory));
    assert.equal(
      (await js(source, "window.hyperionDesktop.windowSession()")).vaultId,
      "other-vault",
    );
    await js(source, "document.querySelector('.workspace-button').click()");
    await js(
      source,
      `Array.from(document.querySelectorAll('.vault-menu button')).find(button=>!button.textContent.includes('Other vault') && button.querySelector('strong')).click()`,
    );
    await activePage(source, noteId);
    console.log(
      "PASS: vault selection and backups stay local to each window; shared-vault destructive operations are rejected",
    );

    await assert.rejects(
      js(
        source,
        `window.hyperionDesktop.detachTab({ vaultId: 'foreign-vault', location: { view: 'home' } })`,
      ),
      /different vault/,
    );
    await assert.rejects(
      js(
        source,
        `window.hyperionDesktop.detachTab({ vaultId: ${JSON.stringify(vaultId)}, location: { view: 'note', id: 'missing' } })`,
      ),
      /no longer available/,
    );
    assert.equal(applicationWindows().length, 2);

    app.once("browser-window-created", (_event, window) =>
      setTimeout(() => window.destroy(), 0),
    );
    await detachFromMenu(source, noteId);
    await until(
      () => js(source, "Boolean(document.querySelector('.data-error-banner'))"),
      "Failed transfer was not surfaced",
    );
    assert.equal(applicationWindows().length, 2);
    assert.ok(
      await tabCenter(source, noteId),
      "A failed transfer must keep the original tab",
    );
    console.log(
      "PASS: a destination that fails to open leaves the source tab intact",
    );

    // A failed close saves nothing and keeps both windows usable. The save acknowledgement
    // must be scoped to the requesting renderer, even when tokens arrive concurrently.
    await js(
      destination,
      `window.__failClose = window.hyperionDesktop.onPrepareClose(async () => { throw new Error('Injected save failure'); }); true`,
    );
    source.close();
    await until(
      () =>
        messages.some((message) =>
          message.detail?.includes("Injected save failure"),
        ),
      "Failed save was not surfaced",
    );
    assert.equal(source.isDestroyed(), false);
    assert.equal(destination.isDestroyed(), false);
    await js(destination, "window.__failClose()");
    console.log(
      "PASS: a failed page-window save keeps the primary and all page windows open",
    );

    // A return acknowledges the destination before removing the page tab/window.
    await js(
      destination,
      `${editor}.doc.root.props.title.insert('Returned ', 0)`,
    );
    await js(
      destination,
      "document.querySelector('[aria-label=\"Move to main window\"]').click()",
    );
    await until(
      () => destination.isDestroyed(),
      "Returning the final page did not close its page window",
    );
    await activePage(source, noteId);
    assert.ok(
      await js(
        source,
        `${editor}.doc.root.props.title.toString().startsWith('Returned ')`,
      ),
    );
    assert.equal(source.isDestroyed(), false);
    console.log(
      "PASS: returning a page saves its pending edit, focuses the primary, and closes the empty page window",
    );

    // Closing the primary owns the entire set of page windows, including saves.
    await detachFromMenu(source, noteId);
    await until(() => {
      destination = newWindow(source);
      return Boolean(destination);
    }, "Menu did not create page window");
    await activePage(destination, noteId);
    const databasePath = (
      await js(destination, "window.hyperionDesktop.storageInfo()")
    ).databasePath;
    await js(
      destination,
      `${editor}.doc.root.props.title.insert('Primary close saved ', 0)`,
    );
    app.removeAllListeners("window-all-closed");
    source.close();
    await until(
      () => applicationWindows().length === 0,
      "Closing the primary did not save and close its page windows",
    );
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const stored = new DatabaseSync(databasePath, { readOnly: true });
    assert.ok(
      stored
        .prepare("SELECT record FROM notes WHERE id=?")
        .get(noteId)
        .record.includes("Primary close saved Returned "),
    );
    stored.close();
    console.log(
      "PASS: closing the primary saves pending edits and closes its page windows",
    );

    // macOS can reopen the primary while the app remains running; then quit all.
    app.emit("activate");
    await until(() => {
      source = applicationWindows()[0];
      return source && !source.webContents.isLoading();
    }, "Primary did not reopen");
    await openPage(source, noteId);
    await detachFromMenu(source, noteId);
    await until(() => {
      destination = newWindow(source);
      return Boolean(destination);
    }, "Reopened primary did not detach");
    await activePage(destination, noteId);
    await js(
      destination,
      `${editor}.doc.root.props.title.insert('Quit saved ', 0)`,
    );

    app.once("will-quit", () => {
      try {
        // main.ts closes the writable database before this listener runs.
        const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
        const db = new DatabaseSync(databasePath, { readOnly: true });
        const note = JSON.parse(
          db.prepare("SELECT record FROM notes WHERE id=?").get(noteId).record,
        );
        assert.ok(
          note.title.startsWith("Quit saved Primary close saved Returned "),
        );
        db.close();
        console.log("PASS: app quit saves pending edits across all windows");
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
    app.quit();
  } catch (error) {
    console.error(error.stack);
    for (const window of BrowserWindow.getAllWindows()) {
      await window.webContents
        .capturePage()
        .then((image) =>
          writeFileSync("/tmp/hyperion-window-failure.png", image.toPNG()),
        )
        .catch(() => {});
      window.destroy();
    }
    app.exit(1);
  } finally {
    // Cleanup after Electron completes the quit/save handshake, not before it.
    app.once("will-quit", () => {
      clearTimeout(deadline);
      rmSync(directory, { recursive: true, force: true });
    });
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
