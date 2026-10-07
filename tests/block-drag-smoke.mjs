import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockDragScenarios } from "./block-drag-scenarios.mjs";
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
    await until(
      () =>
        js(
          "Boolean(document.querySelector('affine-drag-handle-widget')?.dragHandleGrabber)",
        ),
      "Drag widget did not render",
    );
    const fixture = await js(`(${blockDragScenarios.toString()})()`);
    console.log(
      "PASS: block dragging, six-dot grip, formatting, nested lists, tables, custom blocks, multiple selection, undo/redo, keyboard and cancellation",
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
