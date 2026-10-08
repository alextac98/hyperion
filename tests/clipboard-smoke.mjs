import { app, BrowserWindow, clipboard, Menu } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirstVault } from "./vault-setup-helpers.mjs";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-clipboard-test-"));
  app.setPath("userData", join(directory, "profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  if (process.env.HYPERION_CLIPBOARD_DEV_URL) {
    app.setAppPath(directory);
    process.env.HYPERION_DEV_BRANCH = "clipboard-test";
    process.env.HYPERION_DEV_URL = process.env.HYPERION_CLIPBOARD_DEV_URL;
    delete process.env.HYPERION_TEST_RENDERER;
  }
  let window;
  let previousClipboard;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const js = (source) => window.webContents.executeJavaScript(source);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await wait(100);
    }
    throw new Error(message);
  };
  const command = async (name) => {
    app.focus({ steal: true });
    window.focus();
    window.webContents.focus();
    await until(
      () => window.isFocused() && window.webContents.isFocused(),
      "Clipboard test window did not get focus",
    );
    if (process.platform === "darwin") {
      Menu.sendActionToFirstResponder(`${name}:`);
    } else {
      window.webContents[name]();
    }
  };
  const scope = (noteId) =>
    `Array.from(document.querySelectorAll('affine-slash-menu-widget')).find(widget=>widget.std.store.id===${JSON.stringify(noteId)}).std`;
  const paragraphText = (noteId, blockId) =>
    `${scope(noteId)}.store.getModelById(${JSON.stringify(blockId)}).props.text.toString()`;
  const select = async (noteId, blockId, index, length) => {
    await js(`(async () => {
      const std=${scope(noteId)};
      const editor=std.host.querySelector('[data-block-id="${blockId}"] rich-text').inlineEditor;
      await editor.waitForUpdate();
      std.host.querySelector('affine-page-root').focus({preventScroll:true});
      std.event.active=true;
      const range=editor.toDomRange({index:${index},length:${length}});
      if(!range) throw new Error('Could not highlight editor text');
      const selection=document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    await until(
      () =>
        js(
          `${scope(noteId)}.selection.value.some(selection=>selection.from?.blockId===${JSON.stringify(blockId)} && selection.from.index===${index} && selection.from.length===${length})`,
        ),
      "Editor selection did not settle",
    );
    await until(
      () =>
        js(
          `document.getSelection()?.toString() === ${paragraphText(noteId, blockId)}.slice(${index},${index + length}) && ${scope(noteId)}.host.contains(document.getSelection()?.anchorNode)`,
        ),
      "Native editor selection did not settle",
    );
  };
  const preparePage = (text) =>
    js(`(() => {
    const store=document.querySelector('.workspace-panel[data-workspace-active="true"] doc-title').doc;
    const block=store.getModelsByFlavour('affine:paragraph')[0];
    block.props.text.delete(0,block.props.text.length);
    block.props.text.insert(${JSON.stringify(text)},0);
    return {noteId:store.id,blockId:block.id};
  })()`);
  try {
    await import("../dist-electron/main.js");
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    await until(() => window.isVisible(), "Window did not become visible");
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error("renderer:", event.message);
    });
    previousClipboard = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };
    await createFirstVault(js, until);
    const first = await preparePage("First page clipboard");
    await js(
      `${scope(first.noteId)}.store.getModelById(${JSON.stringify(first.blockId)}).props.text.format(0,5,{bold:true})`,
    );
    await select(first.noteId, first.blockId, 0, 10);

    // A stale page dispatcher must not consume a native text field's command.
    await js(`(() => {
      const input=document.createElement('input');
      input.id='clipboard-test-field';
      input.value='Native field';
      document.body.append(input);
      input.focus();input.select();
      ${scope(first.noteId)}.event.active=true;
    })()`);
    clipboard.writeImage(await window.webContents.capturePage());
    await command("copy");
    await until(
      () => clipboard.readText() === "Native field",
      "Page editor intercepted native field copy",
    );
    await command("cut");
    await until(
      () => js(`document.querySelector('#clipboard-test-field').value===''`),
      "Native field cut failed",
    );
    await command("paste");
    await until(
      () =>
        js(
          `document.querySelector('#clipboard-test-field').value==='Native field'`,
        ),
      "Native field paste failed",
    );
    assert.equal(
      await js(paragraphText(first.noteId, first.blockId)),
      "First page clipboard",
    );
    await js(`document.querySelector('#clipboard-test-field').remove()`);

    // Clipboard events must reactivate their destination even if focus tracking
    // deactivated its dispatcher while its DOM selection remained intact.
    await select(first.noteId, first.blockId, 0, 10);
    await js(`${scope(first.noteId)}.event.active=false`);
    clipboard.writeImage(await window.webContents.capturePage());
    await command("copy");
    await until(
      () => clipboard.readText() === "First page",
      "Editor copy failed",
    );
    assert.ok(
      clipboard.readImage().isEmpty(),
      "Text copy left the earlier screenshot on the clipboard",
    );
    assert.ok(
      clipboard.readHTML().includes("data-blocksuite-snapshot"),
      "Editor copy lost rich block data",
    );

    // Paste the copied selection into a new paragraph below, without replacing
    // the clipboard in the test. This also exercises snapshot decompression.
    const pastedBlockId = await js(`(() => {
      const store=${scope(first.noteId)}.store;
      const source=store.getModelById(${JSON.stringify(first.blockId)});
      const parent=store.getParent(source);
      return store.addBlock('affine:paragraph',{},parent,parent.children.indexOf(source)+1);
    })()`);
    await until(
      () =>
        js(
          `!!${scope(first.noteId)}.host.querySelector('[data-block-id="${pastedBlockId}"] rich-text')?.inlineEditor`,
        ),
      "Paste destination did not render",
    );
    await select(first.noteId, pastedBlockId, 0, 0);
    await command("paste");
    await until(
      () => js(`${paragraphText(first.noteId, pastedBlockId)}==='First page'`),
      "Copied text did not paste below the source",
    );
    assert.deepEqual(
      await js(
        `${scope(first.noteId)}.store.getModelById(${JSON.stringify(pastedBlockId)}).props.text.yText.toDelta()`,
      ),
      [{ insert: "First", attributes: { bold: true } }, { insert: " page" }],
      "Copy/paste lost the selection's formatting",
    );
    await js(
      `${scope(first.noteId)}.store.deleteBlock(${scope(first.noteId)}.store.getModelById(${JSON.stringify(pastedBlockId)}))`,
    );
    await select(first.noteId, first.blockId, 0, 10);
    await js(`${scope(first.noteId)}.event.active=false`);
    await command("cut");
    await until(
      () => js(`${paragraphText(first.noteId, first.blockId)}===' clipboard'`),
      "Editor cut did not update its model",
    );
    clipboard.writeText("Replacement");
    await select(first.noteId, first.blockId, 0, 0);
    await js(`${scope(first.noteId)}.event.active=false`);
    await command("paste");
    await until(
      () =>
        js(
          `${paragraphText(first.noteId, first.blockId)}==='Replacement clipboard'`,
        ),
      "Editor paste did not update its model",
    );

    // A native field inside a custom block is still responsible for its own
    // clipboard, even though it is inside the editor host.
    await js(`(() => {
      const input=document.createElement('textarea');
      input.id='clipboard-test-field';input.value='Embedded field';
      ${scope(first.noteId)}.host.append(input);
      input.focus();input.select();
      ${scope(first.noteId)}.event.active=true;
    })()`);
    await command("cut");
    await until(
      () => js(`document.querySelector('#clipboard-test-field').value===''`),
      "Embedded field cut was intercepted",
    );
    assert.equal(clipboard.readText(), "Embedded field");
    await command("paste");
    await until(
      () =>
        js(
          `document.querySelector('#clipboard-test-field').value==='Embedded field'`,
        ),
      "Embedded field paste was intercepted",
    );
    await js(`document.querySelector('#clipboard-test-field').remove()`);

    // Retained tabs may still have BlockSuite selections and document listeners.
    await select(first.noteId, first.blockId, 0, 11);
    await js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await until(
      () =>
        js(
          `document.querySelector('.workspace-panel[data-workspace-active="true"] doc-title')?.doc.id!==${JSON.stringify(first.noteId)} && Boolean(document.querySelector('.workspace-panel[data-workspace-active="true"] affine-slash-menu-widget'))`,
        ),
      "Second page did not load",
    );
    const second = await preparePage("Second page clipboard");
    await select(second.noteId, second.blockId, 0, 11);
    await js(`${scope(first.noteId)}.event.active=true`);
    clipboard.writeText("Clipboard sentinel");
    await command("copy");
    await until(
      () => clipboard.readText() === "Second page",
      "Background tab intercepted copy",
    );
    await js(`${scope(first.noteId)}.event.active=true`);
    await command("cut");
    await until(
      () =>
        js(`${paragraphText(second.noteId, second.blockId)}===' clipboard'`),
      "Background tab intercepted cut",
    );
    clipboard.writeText("Pasted page");
    await select(second.noteId, second.blockId, 0, 0);
    await js(`${scope(first.noteId)}.event.active=true`);
    await command("paste");
    await until(
      () =>
        js(
          `${paragraphText(second.noteId, second.blockId)}==='Pasted page clipboard'`,
        ),
      "Background tab intercepted paste",
    );
    assert.equal(
      await js(paragraphText(first.noteId, first.blockId)),
      "Replacement clipboard",
    );
    await until(
      () =>
        js(
          `document.querySelector('.save-status')?.textContent.includes('Saved locally')`,
        ),
      "Clipboard edits did not save",
    );
    console.log(
      "PASS: native clipboard commands, screenshot replacement, formatted text copy/paste below, embedded fields, and retained tab isolation",
    );
  } catch (error) {
    console.error(error);
    console.error("Clipboard:", clipboard.readText());
    if (window)
      console.error(
        await js(
          `({focus:document.activeElement?.tagName,body:document.body.innerText})`,
        ),
      );
    process.exitCode = 1;
  } finally {
    if (previousClipboard) clipboard.write(previousClipboard);
    window?.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
})();
