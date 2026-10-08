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
    await until(
      () =>
        js(
          window,
          `Boolean(document.querySelector('[data-page-id="'+${JSON.stringify(id)}+'"] .organizer-page-link'))`,
        ),
      "Page navigation did not load",
    );
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
  const mouse = (window, type, point) => {
    const bounds = window.getContentBounds();
    const zoom = window.webContents.getZoomFactor();
    const x = Math.round(point.x * zoom),
      y = Math.round(point.y * zoom);
    window.webContents.sendInputEvent({
      type,
      x,
      y,
      globalX: bounds.x + x,
      globalY: bounds.y + y,
      button: "left",
      clickCount: 1,
    });
  };
  const beginDrag = async (window, id) => {
    window.focus();
    await until(
      () => js(window, "!document.querySelector('.tab-close')?.disabled"),
      "Window is still preparing its tabs",
    );
    await js(
      window,
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
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
    await until(
      () => js(window, `document.body.hasAttribute('data-native-tab-drag-preview')`),
      "Renderer did not switch to the native preview",
    );
    assert.equal(
      await js(window, `Array.from(document.querySelectorAll('.dv-tab-ghost-drag')).every(ghost => getComputedStyle(ghost).display === 'none') && document.querySelectorAll('.dv-tab-ghost-drag').length === 1`),
      true,
      "Dockview's inline styles must not leave a second ghost on the source window",
    );
    const expected = await js(window, `(() => {
      const tab = Array.from(document.querySelectorAll('.dv-tab')).find(tab => tab.dataset.tabPanelId === ${JSON.stringify(JSON.stringify({ view: "note", id }))});
      const box = tab.getBoundingClientRect();
      return {title: tab.querySelector('.workspace-tab-content').title, width: Math.round(box.width), height: Math.round(box.height), emoji: tab.querySelector('.page-icon-glyph')?.textContent ?? null, svg: Boolean(tab.querySelector('.workspace-tab-content > svg'))};
    })()`);
    const actual = await js(dragPreview(), `(() => {
      const tab = document.querySelector('.tab'), box = tab.getBoundingClientRect();
      return {title: tab.querySelector('.tab-title').textContent, width: box.width, height: box.height, emoji: tab.querySelector('.emoji')?.textContent ?? null, svg: Boolean(tab.querySelector('img[src^="data:image/svg+xml,"]')), imageLoaded: Array.from(tab.querySelectorAll('img')).every(image => image.complete && image.naturalWidth > 0)};
    })()`);
    assert.equal(actual.title, expected.title);
    assert.equal(actual.emoji, expected.emoji);
    assert.equal(actual.svg, expected.svg);
    assert.equal(actual.imageLoaded, true, "Preview icons must render");
    assert.equal(actual.width, Math.ceil(expected.width * window.webContents.getZoomFactor()));
    assert.equal(actual.height, Math.ceil(expected.height * window.webContents.getZoomFactor()));
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

  const pointForWindow = async (from, to, id, before = true) => {
    const center = await tabCenter(to, id);
    const box = await js(
      to,
      `(() => {
      const tab = document.elementFromPoint(${center.x},${center.y}).closest('.dv-tab');
      const rect = tab.getBoundingClientRect();
      return {x: ${before} ? rect.left + 3 : rect.right - 3, y: rect.top + rect.height / 2};
    })()`,
    );
    const targetBounds = to.getContentBounds();
    const sourceBounds = from.getContentBounds();
    const targetZoom = to.webContents.getZoomFactor();
    const sourceZoom = from.webContents.getZoomFactor();
    const point = {
      x: Math.round(
        (targetBounds.x + box.x * targetZoom - sourceBounds.x) / sourceZoom,
      ),
      y: Math.round(
        (targetBounds.y + box.y * targetZoom - sourceBounds.y) / sourceZoom,
      ),
    };
    return point;
  };
  const hoverWindow = async (from, to, id, before = true) => {
    const point = await pointForWindow(from, to, id, before);
    mouse(from, "mouseMove", point);
    await until(
      () =>
        js(to, `!document.querySelector('.window-tab-drop-indicator').hidden`),
      "Destination tab strip did not show its insertion marker",
    );
    return point;
  };
  const dropTab = async (from, to, id, anchor, before = true) => {
    await beginDrag(from, id);
    const point = await hoverWindow(from, to, anchor, before);
    mouse(from, "mouseUp", point);
    await activePage(to, id);
    await until(
      () =>
        from.isDestroyed() ||
        js(
          from,
          `!Array.from(document.querySelectorAll('.dv-tab')).some(tab => tab.dataset.tabPanelId === ${JSON.stringify(JSON.stringify({ view: "note", id }))})`,
        ),
      "Cross-window drop did not remove its source tab",
    );
    await until(
      () =>
        !dragPreview() &&
        js(to, "document.querySelector('.window-tab-drop-indicator').hidden"),
      "Cross-window drop left its preview or insertion marker behind",
    );
  };
  const paneTabIds = (window, id) =>
    js(
      window,
      `(() => {
    const tab = Array.from(document.querySelectorAll('.dv-tab')).find(tab => tab.dataset.tabPanelId === ${JSON.stringify(JSON.stringify({ view: "note", id }))});
    return Array.from(tab.closest('.dv-groupview').querySelectorAll('.dv-tab')).map(tab => JSON.parse(tab.dataset.tabPanelId).id ?? 'home');
  })()`,
    );

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
    const originalTitle = await js(source, `${editor}.doc.root.props.title.toString()`);
    const literalTitle = '<img src=x onerror="alert(1)"> & moving tab';
    await js(source, `(() => {const title = ${editor}.doc.root.props.title; title.delete(0, title.length); title.insert(${JSON.stringify(literalTitle)}, 0);})()`);
    await until(
      () => js(source, `Array.from(document.querySelectorAll('.workspace-tab-content')).some(tab => tab.title === ${JSON.stringify(literalTitle)})`),
      "Tab title did not update",
    );
    const originalTheme = await js(source, `document.documentElement.getAttribute('data-theme')`);
    await js(source, `document.documentElement.setAttribute('data-theme', 'dark')`);
    await beginDrag(source, noteId);
    assert.equal(await js(dragPreview(), `getComputedStyle(document.querySelector('.tab')).backgroundColor`), 'rgb(25, 26, 24)', "Preview must retain the source's dark theme");
    assert.equal(
      await js(dragPreview(), `document.querySelector('.tab-title img, .tab-title script') === null`),
      true,
      "Page titles must render as text in the preview",
    );
    // Moving around the source must keep one clean preview despite live drop outlines.
    mouse(source, "mouseMove", { x: 500, y: 400 });
    await wait(100);
    assert.equal(await js(dragPreview(), `document.querySelector('.tab-title').textContent`), literalTitle);
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
    assert.equal(await js(source, `document.querySelector('.dv-tab-ghost-drag') === null && !document.body.hasAttribute('data-native-tab-drag-preview')`), true);
    await js(source, `${originalTheme === null ? "document.documentElement.removeAttribute('data-theme')" : `document.documentElement.setAttribute('data-theme', ${JSON.stringify(originalTheme)})`}`);
    await js(source, `(() => {const title = ${editor}.doc.root.props.title; title.delete(0, title.length); title.insert(${JSON.stringify(originalTitle)}, 0);})()`);
    console.log(
      "PASS: one clean, safely rendered tab preview inside/outside the source; Escape removes both previews and keeps the tab",
    );

    // Exercise a vector icon as well as the initial emoji, through the actual picker.
    await js(source, `document.querySelector('.page-icon-button').click()`);
    await until(() => js(source, `Boolean(document.querySelector('.page-icon-remove'))`), "Page icon picker did not open");
    await js(source, `document.querySelector('.page-icon-remove').click()`);
    await until(() => js(source, `Boolean(document.querySelector('.dv-active-tab .workspace-tab-content > svg'))`), "Removing the emoji did not restore the vector page icon");
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

    // A remote rename of an unmounted page must become the next alias baseline.
    const aliasId = notes.find(note => note.id !== noteId && note.id !== otherId).id;
    assert.equal(await js(source, `Array.from(document.querySelectorAll('doc-title')).some(title => title.doc?.id === ${JSON.stringify(aliasId)})`), false);
    const originalAliasTitle = await js(destination, `(async () => {
      const data = window.hyperionDesktop;
      const note = (await data.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(vaultId)}})).find(note => note.id === ${JSON.stringify(aliasId)});
      await data.repositoryExecute({operation:'saveNote',note:{...note,title:'Remote rename',aliases:[...note.aliases,note.title],updatedAt:new Date().toISOString()}});
      return note.title;
    })()`);
    await until(
      () => js(source, `document.querySelector('[data-page-id="'+${JSON.stringify(aliasId)}+'"] .organizer-page-link')?.textContent.includes('Remote rename')`),
      "Remote title did not reach the unmounted page",
    );
    await js(source, `document.querySelector('[data-page-id="'+${JSON.stringify(aliasId)}+'"] .organizer-page-link').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:250}))`);
    await js(source, `Array.from(document.querySelectorAll('[role=menuitem]')).find(button => button.textContent.trim() === 'Rename').click()`);
    await until(() => js(source, `Boolean(document.querySelector('input[aria-label="Page title"]'))`), "Rename dialog did not open");
    await js(source, `(() => {
      const input = document.querySelector('input[aria-label="Page title"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Local rename');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await js(source, `document.querySelector('input[aria-label="Page title"]').closest('form').requestSubmit()`);
    let renamed;
    await until(async () => {
      renamed = (await js(source, `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(vaultId)}})`)).find(note => note.id === aliasId);
      return renamed.title === 'Local rename';
    }, "Local rename did not save");
    assert.ok(renamed.aliases.includes('Remote rename'), "The remote title must be retained as an alias after a local rename");
    assert.equal(renamed.aliases.filter(alias => alias === originalAliasTitle).length, 1, "The older alias must not be duplicated");
    console.log("PASS: renaming a remotely updated, unmounted page preserves its latest title as an alias");

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
    // A page window on vault A changes the registry while the primary stays on B.
    const registryDirectory = join(directory, "registry-only-vault");
    await js(destination, `(async () => {
      const data = window.hyperionDesktop;
      const vault = (await data.repositoryExecute({operation:'listVaults'})).find(vault => vault.id === ${JSON.stringify(vaultId)});
      const preferences = await data.repositoryExecute({operation:'getPreferences',vaultId:vault.id});
      await data.repositoryExecute({operation:'createVault',directory:${JSON.stringify(registryDirectory)},vault:{...vault,id:'registry-only',name:'Registry-only vault'},preferences:{...preferences,vaultId:'registry-only'},notes:[],collections:[],documents:{}});
    })()`);
    await js(source, "document.querySelector('.workspace-button').click()");
    const registryVisible = () => js(source, `Array.from(document.querySelectorAll('.vault-menu button strong')).some(name => name.textContent === 'Registry-only vault')`);
    await until(registryVisible, "A globally created vault did not reach the primary");
    await js(destination, `window.hyperionDesktop.repositoryExecute({operation:'closeVault',vaultId:'registry-only'})`);
    await until(async () => !(await registryVisible()), "A closed vault remained in another vault's menu");
    await js(source, `window.__openVaultEvents = []; window.__stopVaultEvents = window.hyperionDesktop.onRepositoryChanged(request => {if(request.operation === 'openVault') window.__openVaultEvents.push(request)}); true`);
    const showOpenDialog = dialog.showOpenDialog;
    try {
      dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]});
      assert.equal(await js(destination, `window.hyperionDesktop.openVault()`), null);
      dialog.showOpenDialog = async () => ({canceled:false,filePaths:[join(directory, 'missing-vault')]});
      await assert.rejects(js(destination, `window.hyperionDesktop.openVault()`), /existing vault folder/);
      await wait(100);
      assert.equal(await js(source, `window.__openVaultEvents.length`), 0, "Cancelled or failed opens must not announce a vault");
      dialog.showOpenDialog = async () => ({canceled:false,filePaths:[registryDirectory]});
      assert.equal((await js(destination, `window.hyperionDesktop.openVault()`)).id, 'registry-only');
    } finally {
      dialog.showOpenDialog = showOpenDialog;
    }
    await until(registryVisible, "Opening an existing vault did not refresh another vault's menu");
    assert.equal(await js(source, `window.__openVaultEvents.length`), 1);
    await js(source, `window.__stopVaultEvents(); true`);
    await js(destination, `window.hyperionDesktop.repositoryExecute({operation:'deleteVault',id:'registry-only',vaultId:'registry-only'})`);
    await until(async () => !(await registryVisible()), "A deleted vault remained in another vault's menu");
    assert.equal((await js(source, "window.hyperionDesktop.windowSession()")).vaultId, 'other-vault');
    console.log("PASS: close, open, and delete refresh vault menus across different vaults; failed/cancelled opens emit no change");
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
    source.hide();
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
    assert.equal(
      source.isVisible(),
      true,
      "Returning a page must reveal its primary window",
    );
    console.log(
      "PASS: returning a page saves its pending edit, focuses the primary, and closes the empty page window",
    );

    // Drop into a particular split pane and position, then move between pages.
    await detachFromMenu(source, noteId);
    await until(() => {
      destination = newWindow(source);
      return Boolean(destination);
    }, "Page did not detach for cross-window drops");
    await activePage(destination, noteId);
    destination.setBounds({ x: 1150, y: 60, width: 800, height: 800 });
    await js(source, "document.querySelector('.tab-home').click()");
    await until(
      () => js(source, "document.querySelectorAll('.dv-tab').length>=2"),
      "Primary did not open its Home tab",
    );
    const otherPoint = await tabCenter(source, otherId);
    await js(
      source,
      `document.elementFromPoint(${otherPoint.x},${otherPoint.y}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${otherPoint.x},clientY:${otherPoint.y}}))`,
    );
    await js(
      source,
      "Array.from(document.querySelectorAll('[role=menuitem]')).find(button=>button.textContent==='Split right').click()",
    );
    await until(
      () => js(source, "document.querySelectorAll('.dv-groupview').length===2"),
      "Drop target did not split",
    );
    await dropTab(destination, source, noteId, otherId);
    await until(
      () => destination.isDestroyed(),
      "An empty page source remained open after dropping into the primary",
    );
    assert.deepEqual(
      await paneTabIds(source, otherId),
      [noteId, otherId],
      "Drop must insert before the hovered tab in its pane",
    );
    console.log(
      "PASS: dropping a page onto the primary inserts it in the chosen split pane and closes the empty page window",
    );

    await detachFromMenu(source, noteId);
    await until(() => {
      destination = newWindow(source);
      return Boolean(destination);
    }, "First page did not detach");
    await activePage(destination, noteId);
    destination.setBounds({ x: 1100, y: 60, width: 520, height: 800 });
    await detachFromMenu(source, otherId);
    let secondPage;
    await until(() => {
      secondPage = applicationWindows().find(
        (window) => window !== source && window !== destination,
      );
      return Boolean(secondPage);
    }, "Second page did not detach");
    await activePage(secondPage, otherId);
    secondPage.setBounds({ x: 1680, y: 60, width: 520, height: 800 });
    await dropTab(destination, secondPage, noteId, otherId);
    await until(
      () => destination.isDestroyed(),
      "Empty page-to-page source did not close",
    );
    assert.deepEqual(await paneTabIds(secondPage, otherId), [noteId, otherId]);
    assert.equal(
      applicationWindows().length,
      2,
      "Dropping on a page must reuse that window",
    );
    console.log(
      "PASS: page-to-page dragging reuses the destination window and preserves tab order",
    );

    // The primary still has a Home tab; the returning page goes after it.
    const primaryTab = await js(
      source,
      "JSON.parse(document.querySelector('.dv-tab').dataset.tabPanelId)",
    );
    assert.equal(primaryTab.view, "home");
    await beginDrag(secondPage, noteId);
    const homeBox = await js(
      source,
      "(() => {const r=document.querySelector('.dv-tab').getBoundingClientRect();return{x:r.right-3,y:r.top+r.height/2}})()",
    );
    const a = source.getContentBounds(),
      b = secondPage.getContentBounds();
    const homeDrop = {
      x: Math.round(a.x + homeBox.x - b.x),
      y: Math.round(a.y + homeBox.y - b.y),
    };
    mouse(secondPage, "mouseMove", homeDrop);
    await until(
      () =>
        js(
          source,
          "!document.querySelector('.window-tab-drop-indicator').hidden",
        ),
      "Primary did not highlight Home tab strip",
    );
    mouse(secondPage, "mouseUp", homeDrop);
    await activePage(source, noteId);
    await until(
      () => js(secondPage, "document.querySelectorAll('.dv-tab').length===1"),
      "Page source did not keep just its other tab",
    );
    assert.deepEqual(await paneTabIds(source, noteId), ["home", noteId]);
    assert.equal(secondPage.isDestroyed(), false);

    // Electron zoom changes the relationship between client and screen coordinates.
    secondPage.webContents.setZoomFactor(1.25);
    await wait(200);
    await dropTab(source, secondPage, noteId, otherId, false);
    assert.deepEqual(await paneTabIds(secondPage, otherId), [otherId, noteId]);
    await openPage(source, noteId);
    const count = await js(
      source,
      "document.querySelectorAll('.dv-tab').length",
    );
    await dropTab(secondPage, source, noteId, noteId);
    assert.equal(
      await js(source, "document.querySelectorAll('.dv-tab').length"),
      count,
      "Returning an already-open page must reuse its existing tab",
    );
    assert.deepEqual(await paneTabIds(source, noteId), ["home", noteId]);
    console.log(
      "PASS: dragging from primary to an existing page and back reuses windows and already-open tabs; a nonempty source stays open",
    );

    secondPage.webContents.setZoomFactor(1);
    source.webContents.setZoomFactor(1);
    await wait(200);

    // Cancellation cleans the receiving window too, without moving either tab.
    await beginDrag(secondPage, otherId);
    const cancelledPoint = await hoverWindow(secondPage, source, noteId);
    secondPage.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Escape",
    });
    secondPage.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    mouse(secondPage, "mouseUp", cancelledPoint);
    await until(
      () =>
        !dragPreview() &&
        js(
          source,
          "document.querySelector('.window-tab-drop-indicator').hidden",
        ),
      "Cancelled cross-window drag left a marker",
    );
    assert.equal(secondPage.isDestroyed(), false);
    await activePage(secondPage, otherId);
    assert.equal(applicationWindows().length, 2);
    console.log(
      "PASS: Escape cancels a cross-window drag and clears the destination insertion marker",
    );

    // A receiving renderer must acknowledge success before the source is removed.
    await js(
      secondPage,
      `window.__failOpen = window.hyperionDesktop.onOpenTab(async () => { throw new Error('Injected tab opening failure'); }); true`,
    );
    await beginDrag(source, noteId);
    const failedPoint = await hoverWindow(source, secondPage, otherId);
    mouse(source, "mouseUp", failedPoint);
    await until(
      () =>
        js(
          source,
          "document.querySelector('.data-error-banner')?.textContent.includes('Injected tab opening failure')",
        ),
      "Failed receiving-window acknowledgement was not surfaced",
    );
    await activePage(source, noteId);
    assert.equal(applicationWindows().length, 2);
    assert.ok(
      await tabCenter(source, noteId),
      "Failed drop removed the source tab",
    );
    await js(secondPage, "window.__failOpen()");
    await until(
      () => js(secondPage, "!document.querySelector('.tab-close').disabled"),
      "Receiving window stayed busy after failure",
    );

    // A window that is still saving/closing cannot accept the page.
    await js(
      secondPage,
      `window.__pendingClose = window.hyperionDesktop.onPrepareClose(() => new Promise(resolve => { window.__releaseClose = resolve; })); true`,
    );
    secondPage.close();
    await until(
      () => js(secondPage, "Boolean(window.__releaseClose)"),
      "Page did not begin closing",
    );
    await beginDrag(source, noteId);
    const busyPoint = await pointForWindow(source, secondPage, otherId);
    mouse(source, "mouseMove", busyPoint);
    await wait(100);
    assert.equal(
      await js(
        secondPage,
        "document.querySelector('.window-tab-drop-indicator').hidden",
      ),
      true,
      "A closing window must not advertise accepting a tab",
    );
    mouse(source, "mouseUp", busyPoint);
    await until(
      () =>
        js(
          source,
          "document.querySelector('.data-error-banner')?.textContent.includes('That window is busy')",
        ),
      "Busy receiving window did not preserve the source",
    );
    await activePage(source, noteId);
    assert.equal(applicationWindows().length, 2);
    await js(secondPage, "window.__releaseClose()");
    await until(() => secondPage.isDestroyed(), "Page cleanup did not close");
    console.log(
      "PASS: failed acknowledgements and busy destinations keep the source tab without creating another window",
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
