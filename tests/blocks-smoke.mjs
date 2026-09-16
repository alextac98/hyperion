import { app, BrowserWindow } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-blocks-test-"));
  app.setPath("userData", join(directory, "profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  let window;
  const rendererErrors = [];
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(predicate, message) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* The renderer can reload between checks. */
      }
      await wait(100);
    }
    throw new Error(message);
  }
  const saved = () =>
    until(
      () =>
        js(
          `document.querySelector('.save-status')?.textContent.includes('Saved locally')`,
        ),
      "Writes did not finish",
    );
  try {
    await import("../dist-electron/main.js");
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") rendererErrors.push(event.message);
    });
    await until(
      () => js(`Boolean(document.querySelector('affine-slash-menu-widget'))`),
      "Editor did not load",
    );
    const identity = await js(
      `(() => { const store=document.querySelector('doc-title').doc; return {noteId:store.id,vaultId:'hyperion'}; })()`,
    );
    // Use the registered slash-menu action, including its selection context.
    await js(`(() => {
    const widget=document.querySelector('affine-slash-menu-widget');
    const store=widget.std.store;
    for(const flavour of ['affine:embed-youtube','affine:embed-github','affine:embed-figma','affine:embed-loom','affine:frame']) {
      if(store.schema.get(flavour))throw new Error('Retired schema still registered: '+flavour);
      if(widget.std.getView(flavour))throw new Error('Retired view still registered: '+flavour);
    }
    const context={std:widget.std,model:store.getModelsByFlavour('affine:paragraph')[0]};
    const items=typeof widget.config.items==='function'?widget.config.items(context):widget.config.items;
    const disabled=['YouTube','GitHub','Figma','Loom','Mind Map','Frame','Today','Tomorrow','Yesterday','Now','Kanban View'];
    if(items.some(item=>disabled.includes(item.name)))throw new Error('Disabled slash item still present');
    if(!items.some(item=>item.name==='Table View'))throw new Error('Table View was removed');
    const item=items.find(item=>item.name==='Rating');
    if(!item || !item.when(context))throw new Error('Rating slash command is unavailable');
    item.action(context);
  })()`);
    await until(
      () =>
        js(`Boolean(document.querySelector('hyperion-rating .rating-label'))`),
      "Rating did not render",
    );
    await js(
      `(() => {const input=document.querySelector('.rating-label');input.value='Book review';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="Rate 4 out of 5"]').click();})()`,
    );
    await until(
      () =>
        js(`document.querySelector('.rating-summary')?.textContent==='4/5'`),
      "Rating interaction failed",
    );
    await saved();
    await until(
      () =>
        js(
          `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:'hyperion'}).then(notes=>notes.find(note=>note.id===${JSON.stringify(identity.noteId)})?.body.includes('Book review: 4/5'))`,
        ),
      "Rating was not indexed",
    );
    await js(`document.querySelector('doc-title').doc.undo()`);
    await until(
      () =>
        js(
          `document.querySelector('.rating-summary')?.textContent==='Not rated'`,
        ),
      "Undo did not restore score",
    );
    await js(`document.querySelector('doc-title').doc.redo()`);
    await until(
      () =>
        js(`document.querySelector('.rating-summary')?.textContent==='4/5'`),
      "Redo did not restore score",
    );
    // Introduce an unknown block with nested content through real Yjs operations.
    await js(`(() => {
    const store=document.querySelector('doc-title').doc;
    const blocks=store.doc.yBlocks;
    const MapType=blocks.constructor;const ArrayType=blocks.get(store.root.id).get('sys:children').constructor;
    const note=store.getModelsByFlavour('affine:note')[0];
    store.spaceDoc.transact(()=>{
      const children=new ArrayType();children.insert(0,['unknown-child']);
      const child=store.getModelsByFlavour('affine:paragraph')[0].yBlock.clone();
      child.set('sys:id','unknown-child');blocks.set('unknown-child',child);
      blocks.set('unknown-block',new MapType([['sys:id','unknown-block'],['sys:flavour','example:missing'],['sys:version',7],['sys:children',children],['prop:opaque',{nested:['Keep me',42]}]]));
      note.yBlock.get('sys:children').push(['unknown-block']);
    });
  })()`);
    await until(
      () =>
        js(
          `document.querySelector('hyperion-unavailable-block')?.textContent.includes('Unavailable block')`,
        ),
      "Unknown block was hidden",
    );
    await until(
      () =>
        js(
          `document.querySelector('hyperion-unavailable-block .unavailable-block-children')?.textContent.trim().length>0`,
        ),
      "Unavailable block children did not render",
    );
    await saved();
    const opaqueBefore = await js(
      `document.querySelector('doc-title').doc.doc.yBlocks.get('unknown-block').toJSON()`,
    );
    const checkpoint = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'captureRevision',vaultId:'hyperion',noteId:${JSON.stringify(identity.noteId)},label:'Custom blocks'})`,
    );
    // Saving and reopening does not discard an unavailable block or its descendants.
    await js("location.reload()");
    await until(
      () =>
        js(
          `document.querySelector('.rating-summary')?.textContent==='4/5' && Boolean(document.querySelector('hyperion-unavailable-block'))`,
        ),
      "Custom blocks did not survive reopening",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.doc.yBlocks.get('unknown-block').toJSON()`,
      ),
      opaqueBefore,
    );
    await saved();
    // A read-only history preview uses the same registry and disables edits.
    await js(
      `Array.from(document.querySelectorAll('.details-tabs button')).find(button=>button.textContent==='History').click()`,
    );
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.page-history nav button')).some(button=>button.textContent.includes('Custom blocks'))`,
        ),
      "Checkpoint was not listed",
    );
    await js(
      `Array.from(document.querySelectorAll('.page-history nav button')).find(button=>button.textContent.includes('Custom blocks')).click()`,
    );
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.comparison-tabs button')).some(button=>button.textContent==='Saved page')`,
        ),
      "Comparison did not open",
    );
    await js(
      `Array.from(document.querySelectorAll('.comparison-tabs button')).find(button=>button.textContent==='Saved page').click()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('.history-preview hyperion-rating'))`,
        ),
      "History did not render custom block",
    );
    assert.equal(
      await js(
        `document.querySelector('.history-preview .rating-star').disabled`,
      ),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('.history-preview .rating-label').readOnly`,
      ),
      true,
    );
    assert.ok(
      await js(
        `Boolean(document.querySelector('.history-preview hyperion-unavailable-block'))`,
      ),
    );
    await writeFile(
      "/tmp/hyperion-custom-blocks.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Back to editing').click()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('affine-slash-menu-widget')) && !document.querySelector('.history-preview')`,
        ),
      "Editor did not reopen",
    );
    await js(`(() => {
    const widget=document.querySelector('affine-slash-menu-widget');
    const context={std:widget.std,model:widget.std.store.getModelsByFlavour('affine:paragraph')[0]};
    widget.std.selection.fromJSON([{type:'block',blockId:context.model.id}]);
    widget.config.items(context).find(item=>item.name==='Table View').action(context);
  })()`);
    await until(
      () =>
        js(
          `Boolean(document.querySelector('affine-database')?.dataSource?.value)`,
        ),
      "Table did not render",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('affine-database').dataSource.value.viewMetas.map(view=>view.type)`,
      ),
      ["table"],
    );
    assert.equal(
      await js(
        `(() => {try {document.querySelector('affine-database').dataSource.value.viewMetaGet('kanban');return true;}catch {return false;}})()`,
      ),
      false,
    );
    await saved();
    await js(
      `document.querySelector('[aria-label="More page actions"]').click()`,
    );
    await until(
      () => js(`Boolean(document.querySelector('.note-menu'))`),
      "Page menu did not open",
    );
    await js(
      `Array.from(document.querySelectorAll('.note-menu button')).find(button=>button.textContent.includes('Duplicate')).click()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('doc-title')?.doc.id!==${JSON.stringify(identity.noteId)} && document.querySelector('.rating-summary')?.textContent==='4/5'`,
        ),
      "Duplicated custom block did not render",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.doc.yBlocks.get('unknown-block').toJSON()`,
      ),
      opaqueBefore,
    );
    await saved();
    const restored = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'restoreRevision',vaultId:'hyperion',revisionId:${JSON.stringify(checkpoint.id)},asCopy:true})`,
    );
    await js(
      `localStorage.setItem('hyperion:last-note:hyperion',${JSON.stringify(restored.id)});location.reload()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('doc-title')?.doc.id===${JSON.stringify(restored.id)} && document.querySelector('.rating-summary')?.textContent==='4/5'`,
        ),
      "Restored custom block did not render",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.doc.yBlocks.get('unknown-block').toJSON()`,
      ),
      opaqueBefore,
    );
    await saved();
    const exported = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'exportVault',vaultId:'hyperion'})`,
    );
    const imported = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'importVault',bundle:${JSON.stringify(exported)}})`,
    );
    const importedPage = imported.notes?.find((note) =>
      note.body.includes("Book review"),
    );
    const notes = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(imported.vault.id)}})`,
    );
    const page =
      importedPage ?? notes.find((note) => note.body.includes("Book review"));
    assert.ok(page);
    await js(
      `localStorage.setItem('hyperion:current-vault',${JSON.stringify(imported.vault.id)});localStorage.setItem('hyperion:last-note:'+${JSON.stringify(imported.vault.id)},${JSON.stringify(page.id)});location.reload();`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.rating-summary')?.textContent==='4/5' && Boolean(document.querySelector('hyperion-unavailable-block'))`,
        ),
      "Imported blocks did not render",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.doc.yBlocks.get('unknown-block').toJSON()`,
      ),
      opaqueBefore,
    );
    assert.ok(checkpoint);
    await saved();
    assert.deepEqual(rendererErrors, [], "Renderer errors");
    window.destroy();
    console.log(
      "PASS: rating insertion, editing, metadata, undo/redo, unavailable-block children, reopen, read-only history, duplicate, restore, table-only views and portable import",
    );
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(await js("document.body.innerText").catch(() => ""));
      await writeFile(
        "/tmp/hyperion-blocks-failure.png",
        (await window.webContents.capturePage()).toPNG(),
      ).catch(() => {});
    }
    app.exit(1);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
