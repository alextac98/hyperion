import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { columnsScenarios } from "./columns-scenarios.mjs";
import { createFirstVault } from "./vault-setup-helpers.mjs";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-columns-test-"));
  app.setPath("userData", join(directory, "profile"));
  app.setVersion("0.0.0");
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  let window;
  let exitCode = 0;
  const errors = [];
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* The renderer can reload. */
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
      "Column writes did not finish",
    );
  try {
    await import("../dist-electron/main.js");
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") {
        errors.push(event.message);
        console.error("Renderer error:", event.message);
      }
    });
    const vaultId = await createFirstVault(js, until);
    await until(
      () =>
        js(
          "Boolean(document.querySelector('affine-drag-handle-widget')?.dragHandleGrabber)",
        ),
      "Editor did not load",
    );
    const fixture = await js(`(${columnsScenarios.toString()})()`);
    console.log(
      "PASS: columns reorder inside boxes, in gaps, whitespace and outer edges; removal collapses two columns without losing content; shared grip unwrap/delete and undo/redo work",
    );
    await js(`(async () => {
      const layout = document.querySelector('[data-block-id="${fixture.id}"]');
      layout.scrollIntoView({block:'center'});
      await new Promise(requestAnimationFrame);
      const drag = document.querySelector('affine-drag-handle-widget');
      drag.std.selection.clear();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await layout.updateComplete;
        const rect = layout.getBoundingClientRect();
        layout.dispatchEvent(new PointerEvent('pointermove', {
          bubbles:true, composed:true,
          clientX:rect.left+40, clientY:rect.top+12,
        }));
        await new Promise(requestAnimationFrame);
        if (drag.anchorBlockId.value === '${fixture.id}' && drag.activeDragHandle === 'block') break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (drag.anchorBlockId.value !== '${fixture.id}') throw new Error('Shared layout grip is missing');
      drag.dragHandleGrabber.click();
      await new Promise(requestAnimationFrame);
    })()`);
    await writeFile(
      "/tmp/hyperion-column-layout-actions.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(`(async () => {
      document.querySelector('.editor-action-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      document.querySelector('[data-block-id="${fixture.id}"] .column-grip').click();
      await new Promise(requestAnimationFrame);
    })()`);
    await writeFile(
      "/tmp/hyperion-column-reorder-actions.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(
      "document.querySelector('.editor-action-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
    );

    // Native typing/Enter and Backspace must stay inside the column, including
    // at the first paragraph where upstream notes normally merge into the title.
    const paragraph = fixture.paragraphIds[0];
    await js(`(async () => {
      const editor = document.querySelector('[data-block-id="${paragraph}"] rich-text').inlineEditor;
      await editor.waitForUpdate();
      document.querySelector('affine-page-root').focus({preventScroll:true});
      editor.focusIndex(0);
      editor.syncInlineRange({index:0,length:0});
      await new Promise(requestAnimationFrame);
    })()`);
    const key = (keyCode) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode });
    };
    key("Backspace");
    await window.webContents.insertText("Typed in column");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${paragraph}').props.text.toString()==='Typed in column'`,
        ),
      "Native typing escaped the column",
    );
    key("Enter");
    await window.webContents.insertText("Next column paragraph");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${fixture.columnIds[0]}').children.some(child=>child.props.text?.toString()==='Next column paragraph')`,
        ),
      "Enter did not create a paragraph inside the column",
    );
    await saved();
    await until(
      () =>
        js(
          `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(vaultId)}}).then(notes=>notes.find(note=>note.id===${JSON.stringify(fixture.noteId)})?.body.includes('Column heading'))`,
        ),
      "Column content was not indexed",
    );
    await js(
      `window.hyperionDesktop.repositoryExecute({operation:'captureRevision',vaultId:${JSON.stringify(vaultId)},noteId:${JSON.stringify(fixture.noteId)},label:'Columns checkpoint'})`,
    );
    await js("location.reload()");
    await until(
      () =>
        js(
          `Boolean(document.querySelector('[data-block-id="${fixture.id}"] .columns-grid'))`,
        ),
      "Columns did not reopen",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${fixture.id}').children.map(child=>child.id)`,
      ),
      fixture.columnIds,
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${fixture.heading}').props.text.yText.toDelta()[0].attributes.bold`,
      ),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getParent('${fixture.nested}').id`,
      ),
      fixture.list,
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${fixture.table}').props.cells['row:column'].text.toString()`,
      ),
      "Column cell",
    );
    console.log("PASS: native editing, indexing and reopened rich content");

    await js(
      `document.querySelector('[aria-label="More page actions"]').click()`,
    );
    await js(
      `Array.from(document.querySelectorAll('.note-menu button')).find(button=>button.textContent.includes('Version history')).click()`,
    );
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.page-history nav button')).some(button=>button.textContent.includes('Columns checkpoint'))`,
        ),
      "History checkpoint did not appear",
    );
    await js(
      `Array.from(document.querySelectorAll('.page-history nav button')).find(button=>button.textContent.includes('Columns checkpoint')).click()`,
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
          "Boolean(document.querySelector('.history-preview hyperion-columns-block'))",
        ),
      "Read-only columns did not render",
    );
    assert.equal(
      await js(
        "document.querySelector('.history-preview hyperion-columns-block').store.readonly",
      ),
      true,
    );
    assert.equal(
      await js(
        "Boolean(document.querySelector('.history-preview .columns-toolbar'))",
      ),
      false,
    );
    assert.equal(
      await js(
        "Boolean(document.querySelector('.history-preview .column-grip'))",
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: native column editing, indexing, reopening rich content and read-only history",
    );
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(
        await js("document.body.innerText").catch(() => "Renderer unavailable"),
      );
      await window.webContents
        .capturePage()
        .then((image) =>
          writeFile("/tmp/hyperion-columns-failure.png", image.toPNG()),
        )
        .catch(() => {});
    }
    exitCode = 1;
  } finally {
    for (const current of BrowserWindow.getAllWindows()) current.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(exitCode);
  }
})();
