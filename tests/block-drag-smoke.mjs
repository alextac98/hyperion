import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockDragScenarios } from "./block-drag-scenarios.mjs";
import { blockActionsScenarios } from "./block-actions-scenarios.mjs";
import { createFirstVault } from "./vault-setup-helpers.mjs";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-block-drag-test-"));
  app.setPath("userData", join(directory, "profile"));
  // Standalone Electron test files have no application manifest/version.
  app.setVersion("0.0.0");
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  let window;
  const errors = [];
  let exitCode = 0;
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* The renderer may still be loading. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  };
  const saved = () =>
    until(
      () =>
        js(
          "document.querySelector('.save-status')?.textContent.includes('Saved locally')",
        ),
      "Block moves were not saved",
    );
  try {
    await import("../dist-electron/main.js");
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    const vaultId = await createFirstVault(js, until);
    await js(
      "window.addEventListener('unhandledrejection', event => { window.blockDragErrors ??= []; window.blockDragErrors.push(event.reason?.stack ?? String(event.reason)); })",
    );
    await until(
      () =>
        js(
          "Boolean(document.querySelector('affine-drag-handle-widget')?.dragHandleGrabber)",
        ),
      "Drag widget did not render",
    );
    const fixture = await js(`(${blockDragScenarios.toString()})()`);
    console.log(
      "PASS: block dragging closes open menus; six-dot grip, formatting, nested lists, tables, custom blocks, multiple selection, undo/redo, keyboard and cancellation",
    );
    // Use actual pointer input: synthetic click() skips the native hover styles
    // that can move the grip before a user's mouse-down reaches it.
    for (const id of fixture.expected) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
      const point = await js(`(async () => {
        const widget = document.querySelector('affine-drag-handle-widget');
        widget.std.selection.clear();
        widget.std.host.focus({preventScroll:true});
        const block = widget.std.view.getBlock(${JSON.stringify(id)});
        block.scrollIntoView({block:'center'});
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const rect = block.getBoundingClientRect();
        return {x:Math.round(rect.left+40), y:Math.round(rect.top+12)};
      })()`);
      for (let attempt = 0; attempt < 2; attempt++) {
        window.webContents.sendInputEvent({ type: "mouseMove", ...point });
        await js("new Promise(requestAnimationFrame)");
      }
      await until(
        () =>
          js(
            `document.querySelector('affine-drag-handle-widget').anchorBlockId.value === ${JSON.stringify(id)}`,
          ),
        "Native pointer did not reveal the expected block grip",
      );
      const bounds = () =>
        js(`(() => {
        const rect = document.querySelector('affine-drag-handle-widget').dragHandleGrabber.getBoundingClientRect();
        return {left:rect.left, top:rect.top, width:rect.width, height:rect.height};
      })()`);
      const before = await bounds();
      const clickPoint = {
        x: Math.round(before.left + before.width / 2),
        y: Math.round(before.top + before.height - 1),
      };
      window.webContents.sendInputEvent({ type: "mouseMove", ...clickPoint });
      await until(
        () =>
          js(
            "document.querySelector('affine-drag-handle-widget').isDragHandleHovered",
          ),
        "Native pointer did not enter the grip",
      );
      await js("new Promise(requestAnimationFrame)");
      const hovered = await bounds();
      for (const key of Object.keys(before))
        assert.ok(
          Math.abs(before[key] - hovered[key]) < 0.5,
          `Hover changed the grip ${key} for ${id}: ${before[key]} -> ${hovered[key]}`,
        );
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...clickPoint,
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...clickPoint,
      });
      await until(
        () =>
          js(
            "Boolean(document.querySelector('.editor-action-menu[aria-label=\"Block actions\"]'))",
          ),
        "Clicking the original grip position missed its menu",
      );
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(
        () => js("!document.querySelector('.editor-action-menu')"),
        "Native Escape did not dismiss the grip menu",
      );
    }
    console.log(
      "PASS: native pointer hover keeps the grip and click target fixed for paragraphs, headings, lists, tables and custom blocks",
    );
    assert.deepEqual(await js("window.blockDragErrors ?? []"), []);
    await js(
      `(${blockActionsScenarios.toString()})(${JSON.stringify({ table: fixture.expected.at(-1), custom: fixture.expected[0] })})`,
    );
    assert.deepEqual(await js("window.blockDragErrors ?? []"), []);
    console.log(
      "PASS: shared block menu, keyboard navigation, move/delete/undo/redo, nested lists, tables, custom blocks and last-block focus",
    );
    await saved();
    await js(
      `window.hyperionDesktop.repositoryExecute({operation:'captureRevision',vaultId:${JSON.stringify(vaultId)},noteId:${JSON.stringify(fixture.noteId)},label:'Block drag checkpoint'})`,
    );
    await js("location.reload()");
    await until(
      () =>
        js(
          `Boolean(document.querySelector('doc-title')?.doc.getModelById(${JSON.stringify(fixture.paragraph)}))`,
        ),
      "Moved blocks did not reopen",
    );
    assert.deepEqual(
      await js(`(() => {
      const store = document.querySelector('doc-title').doc;
      const expected = ${JSON.stringify(fixture.expected)};
      return store.getModelById(${JSON.stringify(fixture.parentId)}).children.filter(model => expected.includes(model.id)).map(model => model.id);
    })()`),
      fixture.expected,
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getParent(${JSON.stringify(fixture.child)})?.id`,
      ),
      fixture.list,
    );
    assert.ok(
      await js(
        `document.querySelector('doc-title').doc.getModelById(${JSON.stringify(fixture.paragraph)}).props.text.yText.toDelta()[0].attributes.bold`,
      ),
    );
    await saved();

    // Open an actual read-only history editor with its own scope and drag widget.
    console.log(
      "PASS: reordered blocks, nested children and rich text survive reopening",
    );
    await js(
      `document.querySelector('[aria-label="More page actions"]').click()`,
    );
    await js(
      `Array.from(document.querySelectorAll('.note-menu button')).find(button=>button.textContent.includes('Version history')).click()`,
    );
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.page-history nav button')).some(button=>button.textContent.includes('Block drag checkpoint'))`,
        ),
      "History checkpoint did not appear",
    );
    await js(
      `Array.from(document.querySelectorAll('.page-history nav button')).find(button=>button.textContent.includes('Block drag checkpoint')).click()`,
    );
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.comparison-tabs button')).some(button=>button.textContent==='Saved page')`,
        ),
      "History comparison did not open",
    );
    await js(
      `Array.from(document.querySelectorAll('.comparison-tabs button')).find(button=>button.textContent==='Saved page').click()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('.history-preview affine-drag-handle-widget')?.dragHandleGrabber)`,
        ),
      "History editor did not render",
    );
    assert.equal(
      await js(`(async () => {
      const widget = document.querySelector('.history-preview affine-drag-handle-widget');
      const block = widget.std.view.getBlock(${JSON.stringify(fixture.paragraph)});
      const rect = block.getBoundingClientRect();
      block.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true,clientX:rect.left+40,clientY:rect.top+12}));
      await new Promise(requestAnimationFrame);
      return widget.store.readonly && widget.activeDragHandle === null && widget.dragHandleContainer.style.display === 'none';
    })()`),
      true,
    );
    console.log("PASS: read-only history has no draggable grip");
    assert.equal(
      await js(`(() => {
      const widget = document.querySelector('.history-preview affine-drag-handle-widget');
      widget.dragHandleGrabber.click();
      return !document.querySelector('.editor-action-menu');
    })()`),
      true,
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(
        await js(
          "({text:document.body.innerText, errors:window.blockDragErrors})",
        ).catch(() => "Renderer unavailable"),
      );
    }
    exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
    app.exit(exitCode);
  }
})();
