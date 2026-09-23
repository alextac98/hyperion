import { createFirstVault } from "./vault-setup-helpers.mjs";
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
    const vaultId = await createFirstVault(js, until);
    await until(
      () => js(`Boolean(document.querySelector('affine-slash-menu-widget'))`),
      "Editor did not load",
    );
    const identity = await js(
      `(() => { const store=document.querySelector('doc-title').doc; return {noteId:store.id,vaultId:${JSON.stringify(vaultId)}}; })()`,
    );
    // Use the registered slash-menu action, including its selection context.
    await js(`(() => {
    const widget=document.querySelector('affine-slash-menu-widget');
    const store=widget.std.store;
    for(const flavour of ['affine:embed-youtube','affine:embed-github','affine:embed-figma','affine:embed-loom','affine:frame','hyperion:rating']) {
      if(store.schema.get(flavour))throw new Error('Retired schema still registered: '+flavour);
      if(widget.std.getView(flavour))throw new Error('Retired view still registered: '+flavour);
    }
    const context={std:widget.std,model:store.getModelsByFlavour('affine:paragraph')[0]};
    const items=typeof widget.config.items==='function'?widget.config.items(context):widget.config.items;
    const disabled=['YouTube','GitHub','Figma','Loom','Mind Map','Frame','Today','Tomorrow','Yesterday','Now','Kanban View','Rating'];
    if(items.some(item=>disabled.includes(item.name)))throw new Error('Disabled slash item still present');
    if(!items.some(item=>item.name==='Table View'))throw new Error('Table View was removed');
    const item=items.find(item=>item.name==='Date');
    if(!item || !item.when(context))throw new Error('Date slash command is unavailable');
    context.std.selection.fromJSON([{type:"text",from:{blockId:context.model.id,index:0,length:0},to:null}]);
    item.action(context);
  })()`);
    await until(
      () => js(`Boolean(document.querySelector('hyperion-date-picker'))`),
      "Date picker did not open",
    );
    await js(
      `(() => {const input=document.querySelector('hyperion-date-picker').shadowRoot.querySelector('input');input.value='2/30/2030';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('hyperion-date-picker')?.shadowRoot.querySelector('.error'))`,
        ),
      "Invalid date was accepted",
    );
    await js(
      `(() => {const input=document.querySelector('hyperion-date-picker').shadowRoot.querySelector('input');input.value='6/15/2030';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15' && !document.querySelector('hyperion-date-picker')`,
        ),
      "Manual date entry failed",
    );
    await saved();
    await until(
      () =>
        js(
          `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(vaultId)}}).then(notes=>notes.find(note=>note.id===${JSON.stringify(identity.noteId)})?.body.includes('2030-06-15'))`,
        ),
      "Date was not indexed",
    );
    await js(`document.querySelector('doc-title').doc.undo()`);
    await until(
      () => js(`!document.querySelector('.hyperion-inline-date')`),
      "Undo did not clear date",
    );
    await js(`document.querySelector('doc-title').doc.redo()`);
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15'`,
        ),
      "Redo did not restore date",
    );
    await js(`document.querySelector('.hyperion-inline-date').click()`);
    await until(
      () =>
        js(
          `Boolean(document.querySelector('hyperion-date-picker').shadowRoot.querySelector('[data-date="2030-06-16"]'))`,
        ),
      "Calendar did not reopen at saved month",
    );
    await js(
      `document.querySelector('hyperion-date-picker').shadowRoot.querySelector('[data-date="2030-06-16"]').click()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-16'`,
        ),
      "Calendar selection failed",
    );
    await js(`document.querySelector('doc-title').doc.undo()`);
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15'`,
        ),
      "Calendar selection undo failed",
    );
    const addParagraph = async (value = "") => {
      const id = await js(
        `(() => {const store=document.querySelector('doc-title').doc;const TextType=store.getModelsByFlavour('affine:paragraph')[0].props.text.constructor;return store.addBlock('affine:paragraph',{type:'text',text:new TextType(${JSON.stringify(value)})},store.getModelsByFlavour('affine:note')[0]);})()`,
      );
      await until(
        () =>
          js(
            `Boolean(document.querySelector('[data-block-id="${id}"] rich-text')?.inlineEditor)`,
          ),
        "Paragraph did not render",
      );
      return id;
    };
    const focus = async (id, index) => {
      await js(
        `(async () => {const editor=document.querySelector('[data-block-id="${id}"] rich-text').inlineEditor;await editor.waitForUpdate();await new Promise(requestAnimationFrame);document.querySelector("affine-page-root").focus({preventScroll:true});editor.focusIndex(${index});await editor.waitForUpdate();editor.syncInlineRange({index:${index},length:0});await new Promise(requestAnimationFrame);})()`,
      );
      await until(
        () =>
          js(
            `document.querySelector('affine-slash-menu-widget').std.selection.value.some(s=>s.from?.blockId==='${id}' && s.from.index===${index}) && document.activeElement.isContentEditable && document.getSelection()?.anchorNode?.parentElement?.closest('[data-block-id]')?.dataset.blockId==='${id}'`,
          ),
        "Caret not positioned",
      );
    };
    const key = (keyCode, character = false) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode });
      if (character)
        window.webContents.sendInputEvent({ type: "char", keyCode });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode });
    };
    const choose = async (date) => {
      await until(
        () =>
          js(
            `Boolean(document.querySelector('hyperion-date-picker')?.shadowRoot.querySelector('input'))`,
          ),
        "Date picker did not open",
      );
      await js(
        `(() => {const input=document.querySelector('hyperion-date-picker').shadowRoot.querySelector('input');input.value=${JSON.stringify(date)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
      );
      await until(
        () => js(`!document.querySelector('hyperion-date-picker')`),
        "Date picker did not close",
      );
    };
    console.log("PASS: date picker, manual entry, index, undo and editing");
    // Native // opens the existing slash picker, filtered to Date, without inserting.
    const shortcutId = await addParagraph();
    await focus(shortcutId, 0);
    key("/", true);
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.toString()==='/'`,
        ),
      "First slash was not typed",
    );
    key("/");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.toString()==='/date'`,
        ),
      "Double slash did not search for date",
    );
    assert.equal(
      await js(`Boolean(document.querySelector('hyperion-date-picker'))`),
      false,
    );
    assert.equal(
      await js(`document.querySelectorAll('.hyperion-inline-date').length`),
      1,
    );
    await until(
      () =>
        js(
          `document.querySelector('affine-slash-menu')?.shadowRoot.querySelector('inner-slash-menu')?.menu[0]?.name==='Date'`,
        ),
      "Slash picker did not filter to Date",
    );
    await writeFile(
      "/tmp/hyperion-date-search.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    key("Enter");
    await until(
      () => js(`Boolean(document.querySelector('hyperion-date-picker'))`),
      "Enter did not select Date from the slash picker",
    );
    const selectedDate = await js(
      `document.querySelector('hyperion-date-picker').value`,
    );
    const today = await js(
      `(() => { const date=new Date(); return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'); })()`,
    );
    assert.equal(selectedDate, today);
    const paragraphCount = await js(
      `document.querySelector('doc-title').doc.getModelsByFlavour('affine:paragraph').length`,
    );
    // Use the focus supplied by opening the picker; do not repair it in the test.
    key("Enter");
    await until(
      () =>
        js(
          `!document.querySelector('hyperion-date-picker') && document.querySelector('[data-block-id="${shortcutId}"] time')?.dateTime===${JSON.stringify(today)}`,
        ),
      "Enter did not confirm the default date",
    );
    await js(
      `document.querySelector('[data-block-id="${shortcutId}"] .hyperion-inline-date').click()`,
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getModelsByFlavour('affine:paragraph').length`,
      ),
      paragraphCount,
      "Confirming a date created a new paragraph",
    );
    const monthBefore = await js(
      `document.querySelector('hyperion-date-picker').shadowRoot.querySelector('.month strong').textContent`,
    );
    await js(
      `document.querySelector('hyperion-date-picker').shadowRoot.querySelector('[aria-label="Next month"]').click()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('hyperion-date-picker').shadowRoot.querySelector('.month strong').textContent!==${JSON.stringify(monthBefore)}`,
        ),
      "Month navigation failed",
    );
    await wait(200); // Allow the compositor to paint the updated calendar.
    await writeFile(
      "/tmp/hyperion-date-picker.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    assert.equal(
      await js(
        `document.activeElement===document.querySelector('hyperion-date-picker') && document.activeElement.shadowRoot.activeElement?.tagName==='INPUT'`,
      ),
      true,
      "Picker did not retain input focus",
    );
    await js(
      `document.querySelector('hyperion-date-picker').shadowRoot.querySelector('input').select()`,
    );
    for (const character of "2031-01-02") key(character, true);
    key("Enter");
    await until(
      () =>
        js(
          `!document.querySelector('hyperion-date-picker') && document.querySelector('[data-block-id="${shortcutId}"] time')?.dateTime==='2031-01-02'`,
        ),
      "Native date typing and Enter failed",
    );
    await until(
      () => js(`document.querySelectorAll('.hyperion-inline-date').length===2`),
      "Shortcut did not insert inline date",
    );
    assert.equal(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.length`,
      ),
      1,
    );

    await until(
      () =>
        js(
          `document.activeElement?.isContentEditable && document.querySelector('[data-block-id="${shortcutId}"] rich-text').inlineEditor.getInlineRange()?.index===1`,
        ),
      "Choosing a date did not restore text focus",
    );
    key("x", true);
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.toString()===' x'`,
        ),
      "Typing after a date failed",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.yText.toDelta()`,
      ),
      [
        { insert: " ", attributes: { hyperionDate: "2031-01-02" } },
        { insert: "x" },
      ],
    );
    key("Backspace");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${shortcutId}').props.text.length===1`,
        ),
      "Deleting text after the date failed",
    );
    console.log("PASS: native // search, Enter selection and continued typing");
    await js(
      `document.querySelector('[data-block-id="${shortcutId}"] .hyperion-inline-date').click()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('hyperion-date-picker')?.shadowRoot.querySelector('input'))`,
        ),
      "Date did not reopen",
    );
    await js(
      `(() => {const input=document.querySelector('hyperion-date-picker').shadowRoot.querySelector('input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    key("Enter");
    await until(
      () =>
        js(
          `!document.querySelector('hyperion-date-picker') && document.querySelector('[data-block-id="${shortcutId}"] time')?.dateTime==='2031-01-02'`,
        ),
      "Enter did not confirm the existing selected date with an empty field",
    );
    await js(
      `document.querySelector('[data-block-id="${shortcutId}"] .hyperion-inline-date').click()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('hyperion-date-picker')?.shadowRoot.querySelector('input'))`,
        ),
      "Date did not reopen after Enter",
    );
    key("Escape");
    await until(
      () =>
        js(
          `!document.querySelector('hyperion-date-picker') && document.activeElement.isContentEditable`,
        ),
      "Escape did not return focus to the editor",
    );
    assert.equal(
      await js(
        `document.querySelector('[data-block-id="${shortcutId}"] time').dateTime`,
      ),
      "2031-01-02",
    );
    // Inline insertion keeps surrounding prose, formatting, and the same paragraph.
    const proseId = await addParagraph("Before after");
    await js(
      `document.querySelector('doc-title').doc.getModelById('${proseId}').props.text.format(7,5,{bold:true})`,
    );
    await focus(proseId, 7);
    key("/", true);
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${proseId}').props.text.toString()==='Before /after'`,
        ),
      "Slash in prose was not typed",
    );
    key("/");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${proseId}').props.text.toString()==='Before /dateafter'`,
        ),
      "Prose search failed",
    );
    await until(
      () =>
        js(
          `document.querySelector('affine-slash-menu')?.shadowRoot.querySelector('inner-slash-menu')?.menu[0]?.name==='Date'`,
        ),
      "Prose picker did not filter",
    );
    key("Enter");
    await choose("2032-04-05");
    await until(
      () =>
        js(
          `Boolean(document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date'))`,
        ),
      "Inline date did not render in prose",
    );
    assert.deepEqual(
      await js(
        `document.querySelector('doc-title').doc.getModelById('${proseId}').props.text.yText.toDelta()`,
      ),
      [
        { insert: "Before " },
        { insert: " ", attributes: { hyperionDate: "2032-04-05" } },
        { insert: "after", attributes: { bold: true } },
      ],
    );
    await wait(200); // Capture the committed inline rendering.
    await writeFile(
      "/tmp/hyperion-inline-date.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await focus(proseId, 8);
    key("Backspace");
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${proseId}').props.text.toString()==='Before after'`,
        ),
      "Backspace did not delete the date",
    );
    await js(`document.querySelector('doc-title').doc.undo()`);
    await until(
      () =>
        js(
          `Boolean(document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date'))`,
        ),
      "Undo did not restore deleted date",
    );
    await focus(proseId, 7);
    key("Delete");
    await until(
      () =>
        js(
          `!document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date')`,
        ),
      "Delete did not remove the date",
    );
    await js(`document.querySelector('doc-title').doc.undo()`);
    await until(
      () =>
        js(
          `Boolean(document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date'))`,
        ),
      "Undo did not restore date after Delete",
    );
    await js(
      `document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date').focus()`,
    );
    key("Backspace");
    await until(
      () =>
        js(
          `!document.querySelector('[data-block-id="${proseId}"] .hyperion-inline-date')`,
        ),
      "Focused chip was not deletable",
    );
    await js(
      `document.querySelector('doc-title').doc.deleteBlock(document.querySelector('doc-title').doc.getModelById('${proseId}'))`,
    );
    console.log("PASS: surrounding formatting, Backspace, Delete and undo");
    // The second slash in a URL must remain ordinary text.
    const urlId = await js(
      `(() => {const store=document.querySelector('doc-title').doc;const TextType=store.getModelsByFlavour('affine:paragraph')[0].props.text.constructor;return store.addBlock('affine:paragraph',{type:'text',text:new TextType('https:/')},store.getModelsByFlavour('affine:note')[0]);})()`,
    );
    await until(
      () =>
        js(
          `Boolean(document.querySelector('[data-block-id="${urlId}"] rich-text')?.inlineEditor)`,
        ),
      "URL paragraph did not render",
    );
    await js(
      `document.querySelector('[data-block-id="${urlId}"] rich-text').inlineEditor.focusEnd()`,
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "/" });
    window.webContents.sendInputEvent({ type: "char", keyCode: "/" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "/" });
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${urlId}')?.props.text.toString()==='https://'`,
        ),
      "URL was intercepted by the shortcut",
    );
    assert.equal(
      await js(`document.querySelectorAll('.hyperion-inline-date').length`),
      2,
    );
    await js(
      `(() => {const text=document.querySelector('doc-title').doc.getModelById('${urlId}').props.text;text.delete(0,text.length);text.insert('/',0,{code:true});})()`,
    );
    await js(
      `document.querySelector('[data-block-id="${urlId}"] rich-text').inlineEditor.focusEnd()`,
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "/" });
    window.webContents.sendInputEvent({ type: "char", keyCode: "/" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "/" });
    await until(
      () =>
        js(
          `document.querySelector('doc-title').doc.getModelById('${urlId}')?.props.text.toString()==='//'`,
        ),
      "Inline code was intercepted by the shortcut",
    );
    assert.equal(
      await js(`document.querySelectorAll('.hyperion-inline-date').length`),
      2,
    );
    await js(
      `document.querySelector('doc-title').doc.deleteBlock(document.querySelector('doc-title').doc.getModelById('${urlId}'))`,
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
      `window.hyperionDesktop.repositoryExecute({operation:'captureRevision',vaultId:${JSON.stringify(vaultId)},noteId:${JSON.stringify(identity.noteId)},label:'Custom blocks'})`,
    );
    // Saving and reopening does not discard an unavailable block or its descendants.
    await js("location.reload()");
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15' && Boolean(document.querySelector('hyperion-unavailable-block'))`,
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
          `Boolean(document.querySelector('.history-preview .hyperion-inline-date'))`,
        ),
      "History did not render custom block",
    );
    assert.equal(
      await js(
        `document.querySelector('.history-preview .hyperion-inline-date time')?.dateTime`,
      ),
      "2030-06-15",
    );
    assert.equal(
      await js(
        `document.querySelectorAll('.history-preview .hyperion-inline-date[role="button"]').length`,
      ),
      0,
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
          `document.querySelector('doc-title')?.doc.id!==${JSON.stringify(identity.noteId)} && document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15'`,
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
      `window.hyperionDesktop.repositoryExecute({operation:'restoreRevision',vaultId:${JSON.stringify(vaultId)},revisionId:${JSON.stringify(checkpoint.id)},asCopy:true})`,
    );
    await js(
      `localStorage.setItem('hyperion:last-note:'+${JSON.stringify(vaultId)},${JSON.stringify(restored.id)});location.reload()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('doc-title')?.doc.id===${JSON.stringify(restored.id)} && document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15'`,
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
      `window.hyperionDesktop.repositoryExecute({operation:'exportVault',vaultId:${JSON.stringify(vaultId)}})`,
    );
    const imported = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'importVault',bundle:${JSON.stringify(exported)}})`,
    );
    const importedPage = imported.notes?.find((note) =>
      note.body.includes("2030-06-15"),
    );
    const notes = await js(
      `window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(imported.vault.id)}})`,
    );
    const page =
      importedPage ?? notes.find((note) => note.body.includes("2030-06-15"));
    assert.ok(page);
    await js(
      `localStorage.setItem('hyperion:current-vault',${JSON.stringify(imported.vault.id)});localStorage.setItem('hyperion:last-note:'+${JSON.stringify(imported.vault.id)},${JSON.stringify(page.id)});location.reload();`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.hyperion-inline-date time')?.dateTime==='2030-06-15' && Boolean(document.querySelector('hyperion-unavailable-block'))`,
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
      "PASS: date insertion, // shortcut, URL preservation, calendar and manual entry, metadata, undo/redo, unavailable-block children, reopen, read-only history, duplicate, restore, table-only views and portable import",
    );
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(
        await js(
          `JSON.stringify({selection:document.querySelector('affine-slash-menu-widget')?.std.selection.value, paragraphs:document.querySelector('doc-title')?.doc.getModelsByFlavour('affine:paragraph').map(m=>({id:m.id,text:m.props.text.toString()})),active:document.activeElement?.tagName})`,
        ).catch(() => ""),
      );
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
