import { createFirstVault } from "./vault-setup-helpers.mjs";
import { app, BrowserWindow } from "electron";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-meeting-test-"));
  app.setAppPath(process.cwd());
  // Electron starts a direct .mjs test with its default version instead of package.json.
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  app.getVersion = () => manifest.version;
  app.setPath("userData", join(directory, "profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = "1";
  let window;
  const rendererErrors = [];
  const js = (source) => window.webContents.executeJavaScript(source, true);
  async function until(predicate, message) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* renderer is opening */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  const storeExpression = `document.querySelector('affine-slash-menu-widget').std.store`;
  const blockExpression = `document.querySelector('hyperion-meeting-block')`;
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
      "Editor did not open",
    );
    const noteId = await js(`${storeExpression}.id`);
    const originalTitle = await js(
      `${storeExpression}.root.props.title.toString()`,
    );
    const today = await js(
      `(() => { const now = new Date(); return [String(now.getFullYear()).padStart(4, '0'), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); })()`,
    );
    await js(`(() => {
      const widget = document.querySelector('affine-slash-menu-widget');
      const context = { std: widget.std, model: widget.std.store.getModelsByFlavour('affine:paragraph')[0] };
      const items = typeof widget.config.items === 'function' ? widget.config.items(context) : widget.config.items;
      const item = items.find(item => item.name === 'Meeting');
      if (!item?.when(context)) throw new Error('Meeting slash command is unavailable');
      item.action(context);
    })()`);
    await until(
      () =>
        js(
          `Boolean(${blockExpression}?.querySelector('.meeting-notes-editor rich-text'))`,
        ),
      "Meeting block did not render",
    );
    const meetingId = await js(`${blockExpression}.model.id`);
    assert.equal(await js(`${blockExpression}.model.props.date`), today);
    assert.equal(
      await js(`${blockExpression}.querySelector('.meeting-date').value`),
      today,
    );
    const notesId = await js(`${blockExpression}.model.children[0].id`);
    await js(`${storeExpression}.undo()`);
    await until(
      () =>
        js(
          `${storeExpression}.getModelsByFlavour('hyperion:meeting').length === 0`,
        ),
      "Undo did not remove the inserted meeting",
    );
    assert.equal(
      await js(
        `${storeExpression}.doc.yBlocks.has(${JSON.stringify(notesId)})`,
      ),
      false,
      "Insertion undo left orphan notes",
    );
    await js(`${storeExpression}.redo()`);
    await until(
      () =>
        js(
          `Boolean(${blockExpression}?.querySelector('.meeting-notes-editor rich-text'))`,
        ),
      "Redo did not restore meeting notes",
    );
    assert.equal(await js(`${blockExpression}.model.id`), meetingId);
    assert.equal(await js(`${blockExpression}.model.props.date`), today);
    async function typeInto(label, value) {
      await js(
        `(() => { const input = ${blockExpression}.querySelector('[aria-label=${JSON.stringify(label)}]'); input.focus(); })()`,
      );
      key("a", ["control"]);
      await until(
        () =>
          js(
            `(() => { const input = ${blockExpression}.querySelector('[aria-label=${JSON.stringify(label)}]'); return input.selectionStart === 0 && input.selectionEnd === input.value.length; })()`,
          ),
        `${label} could not select all its text`,
      );
      let typed = "";
      for (const character of value) {
        await window.webContents.insertText(character);
        await new Promise((resolve) => setTimeout(resolve, 25));
        typed += character;
        assert.equal(
          await js(
            `${blockExpression}.querySelector('[aria-label=${JSON.stringify(label)}]').selectionEnd`,
          ),
          typed.length,
          `${label} lost its caret`,
        );
        assert.equal(
          await js(
            `document.activeElement === ${blockExpression}.querySelector('[aria-label=${JSON.stringify(label)}]')`,
          ),
          true,
          `${label} lost focus while typing`,
        );
      }
      assert.equal(
        await js(
          `${blockExpression}.querySelector('[aria-label=${JSON.stringify(label)}]').value`,
        ),
        value,
      );
      await js(`document.activeElement.blur()`);
    }
    await typeInto("Meeting title", "Product planning");
    function key(keyCode, modifiers = [], character = false) {
      window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode,
        modifiers,
      });
      if (character)
        window.webContents.sendInputEvent({ type: "char", keyCode, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    }
    const notesExpression = `${blockExpression}.querySelector('.meeting-notes-editor')`;
    const notesTextExpression = `${blockExpression}.model.children[0].children[0].props.text`;
    await js(
      `${notesExpression}.querySelector('rich-text').inlineEditor.focusEnd()`,
    );
    await until(
      () =>
        js(
          `Boolean(${notesExpression}.contains(window.getSelection()?.anchorNode))`,
        ),
      "Notes did not acquire a caret",
    );
    let typedNotes = "";
    for (const character of "Launch on Friday") {
      key(character, [], true);
      typedNotes += character;
      await until(
        () =>
          js(
            `${notesTextExpression}.toString() === ${JSON.stringify(typedNotes)}`,
          ),
        "Could not continue typing meeting notes",
      );
      assert.equal(
        await js(
          `${notesExpression}.contains(window.getSelection()?.anchorNode)`,
        ),
        true,
        "Notes lost their caret",
      );
    }
    await js(
      `${storeExpression}.captureSync(); ${notesExpression}.querySelector('rich-text').inlineEditor.setInlineRange({index:0,length:6})`,
    );
    key("b", ["control"]);
    await until(
      () =>
        js(
          `${notesTextExpression}.yText.toDelta()[0]?.attributes?.bold === true`,
        ),
      "Notes bold shortcut did not work",
    );
    key("z", ["control"]);
    await until(
      () => js(`!${notesTextExpression}.yText.toDelta()[0]?.attributes?.bold`),
      "Notes undo did not work",
    );
    key("z", ["control", "shift"]);
    await until(
      () =>
        js(
          `${notesTextExpression}.yText.toDelta()[0]?.attributes?.bold === true`,
        ),
      "Notes redo did not work",
    );
    await js(
      `${notesExpression}.querySelector('rich-text').inlineEditor.focusStart()`,
    );
    key("Backspace");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      await js(`${notesTextExpression}.toString()`),
      "Launch on Friday",
      "Backspace moved notes into the page title",
    );
    assert.equal(
      await js(`${storeExpression}.root.props.title.toString()`),
      originalTitle,
    );
    // Enter must create another native paragraph inside the meeting, not on the page.
    await js(
      `${notesExpression}.querySelector('rich-text').inlineEditor.focusEnd()`,
    );
    key("Enter");
    await until(
      () => js(`${blockExpression}.model.children[0].children.length === 2`),
      "Enter did not create a note paragraph",
    );
    key("a", ["control"]);
    await until(
      () =>
        js(
          `(() => { const selection = document.querySelector('affine-slash-menu-widget').std.selection.value.find(selection => selection.type === 'text'); const children = ${blockExpression}.model.children[0].children; return selection?.from.blockId === children[0].id && selection?.to?.blockId === children[1].id; })()`,
        ),
      "Select All escaped meeting notes",
    );
    await js(
      `${notesExpression}.querySelectorAll('rich-text')[1].inlineEditor.focusEnd()`,
    );
    for (const character of "[] ") {
      key(character, [], true);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await until(
      () =>
        js(
          `${blockExpression}.model.children[0].children[1].flavour === 'affine:list' && ${blockExpression}.model.children[0].children[1].props.type === 'todo'`,
        ),
      "Notes did not create a checklist",
    );
    for (const character of "Follow up") {
      key(character, [], true);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await until(
      () =>
        js(
          `${blockExpression}.model.children[0].children[1].props.text.toString() === 'Follow up'`,
        ),
      "Could not type a checklist item",
    );
    await js(
      `${notesExpression}.querySelector('.affine-list-block__todo-prefix').click()`,
    );
    await until(
      () =>
        js(
          `${blockExpression}.model.children[0].children[1].props.checked === true`,
        ),
      "Checklist could not be checked",
    );
    await js(
      `${notesExpression}.querySelector('affine-list rich-text').inlineEditor.focusEnd()`,
    );
    key("Enter");
    await until(
      () => js(`${blockExpression}.model.children[0].children.length === 3`),
      "Checklist Enter failed",
    );
    key("Enter");
    await until(
      () =>
        js(
          `${blockExpression}.model.children[0].children[2].flavour === 'affine:paragraph'`,
        ),
      "Could not exit the checklist",
    );
    for (const character of "/table") {
      key(character, [], true);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await until(
      () =>
        js(
          `document.querySelector('affine-slash-menu')?.shadowRoot.querySelector('inner-slash-menu')?.menu[0]?.name === 'Table'`,
        ),
      "Notes slash menu did not offer Table",
    );
    key("Enter");
    await until(
      () =>
        js(
          `Boolean(${notesExpression}.querySelector('affine-table')) && ${blockExpression}.model.children[0].children.some(model => model.flavour === 'affine:table')`,
        ),
      "Notes slash command did not insert a table",
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-transcript"]').click()`,
    );
    await typeInto("Meeting transcript", "Alex: the draft is ready.");
    assert.equal(
      await js(
        `${storeExpression}.getModelsByFlavour('hyperion:meeting')[0].props.transcript`,
      ),
      "Alex: the draft is ready.",
    );
    // Exercise native file inputs with a real PCM WAV and a text transcript.
    await js(`(() => {
      const bytes = new Uint8Array(44 + 16000 * 2); const view = new DataView(bytes.buffer);
      const str = (offset, text) => [...text].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
      str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, bytes.length - 44, true);
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'planning.wav', { type: 'audio/wav' }));
      const input = ${blockExpression}.querySelector('.meeting-audio-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(
      () =>
        js(
          `Boolean(${blockExpression}.querySelector('audio')?.readyState >= 1)`,
        ),
      "Imported audio did not load",
    );
    assert.equal(
      await js(`${blockExpression}.querySelector('audio').duration`),
      1,
    );
    assert.equal(
      await js(`${blockExpression}.querySelector('[download]').download`),
      "planning.wav",
    );
    assert.equal(
      await js(
        `Object.keys(${blockExpression}.model.props.references.assets).length`,
      ),
      1,
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-summary"]').click()`,
    );
    assert.match(
      await js(`${blockExpression}.textContent`),
      /AI summaries aren’t available yet/,
    );
    // Read-only history uses the same view and cannot edit or record.
    await js(`${storeExpression}.readonly = true`);
    await until(
      () =>
        js(
          `!Array.from(${blockExpression}.querySelectorAll('button')).some(button => button.textContent.trim() === 'Record microphone')`,
        ),
      "Read-only controls did not update",
    );
    assert.equal(
      await js(`${blockExpression}.querySelector('.meeting-title').readOnly`),
      true,
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-notes"]').click()`,
    );
    await until(
      () =>
        js(`${notesExpression}.getAttribute('contenteditable') === 'false'`),
      "Read-only notes remained editable",
    );
    assert.equal(
      await js(`${notesExpression}.querySelector('rich-text').readonly`),
      true,
    );
    await js(`${storeExpression}.readonly = false`);
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-transcript"]').click()`,
    );
    await js(
      `Array.from(${blockExpression}.querySelectorAll('button')).find(button => button.textContent.trim() === 'Remove audio').click()`,
    );
    await until(
      () => js(`!${blockExpression}.model.props.recording`),
      "Audio removal failed",
    );
    await js(`${storeExpression}.undo()`);
    await until(
      () =>
        js(`${blockExpression}.model.props.recording?.name === 'planning.wav'`),
      "Undo did not restore recording",
    );
    // Reopen persisted document and verify searchable projection and audio.
    await until(
      () =>
        js(
          `document.querySelector('.save-status')?.textContent.includes('Saved locally')`,
        ),
      "Meeting did not save",
    );
    window.webContents.reload();
    await until(
      () => js(`Boolean(${blockExpression})`),
      "Meeting did not reopen",
    );
    assert.equal(
      await js(
        `${blockExpression}.model.children[0].children[0].props.text.toString()`,
      ),
      "Launch on Friday",
    );
    assert.equal(
      await js(`${notesTextExpression}.yText.toDelta()[0]?.attributes?.bold`),
      true,
      "Notes formatting did not survive reopening",
    );
    assert.equal(
      await js(
        `${blockExpression}.model.children[0].children.find(model => model.flavour === 'affine:list').props.text.toString()`,
      ),
      "Follow up",
    );
    assert.equal(
      await js(
        `${blockExpression}.model.children[0].children.some(model => model.flavour === 'affine:table')`,
      ),
      true,
    );
    assert.equal(
      await js(`${blockExpression}.model.props.transcript`),
      "Alex: the draft is ready.",
    );
    const records = await js(
      `window.hyperionDesktop.repositoryExecute({ operation: 'listNotes', vaultId: ${JSON.stringify(vaultId)} })`,
    );
    assert.match(
      records.find((note) => note.id === noteId).body,
      /Launch on Friday[\s\S]*Follow up/,
    );
    assert.match(
      records.find((note) => note.id === noteId).body,
      /Alex: the draft is ready/,
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-transcript"]').click()`,
    );
    await until(
      () => js(`${blockExpression}.querySelector('audio')?.readyState >= 1`),
      "Saved audio did not play after reopen",
    );
    // Test the real MediaRecorder with synthetic microphone audio; no hardware required.
    await js(
      `Array.from(${blockExpression}.querySelectorAll('button')).find(button => button.textContent.trim() === 'Remove audio').click()`,
    );
    await until(
      () =>
        js(
          `Array.from(${blockExpression}.querySelectorAll('button')).some(button => button.textContent.trim() === 'Record microphone')`,
        ),
      "Recording button did not appear",
    );
    await js(`(() => {
      window.__meetingAudioContext = new AudioContext();
      const oscillator = window.__meetingAudioContext.createOscillator(); const destination = window.__meetingAudioContext.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
      Array.from(${blockExpression}.querySelectorAll('button')).find(button => button.textContent.trim() === 'Record microphone').click();
    })()`);
    await until(
      () =>
        js(
          `document.querySelector('.meeting-recording-status')?.textContent.includes('Recording')`,
        ),
      "Microphone recording did not begin",
    );
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.ok(
      (await js(
        `Object.keys(${blockExpression}.model.props.references.assets).length`,
      )) >= 1,
      "Recording chunk was not saved incrementally",
    );
    await js(
      `Array.from(document.querySelectorAll('.sidebar button')).find(button => button.textContent.trim() === 'Home').click()`,
    );
    await until(
      () => js(`Boolean(document.querySelector('.note-card'))`),
      "Could not navigate while recording",
    );
    assert.match(
      await js(
        `document.querySelector('.meeting-recording-status').textContent`,
      ),
      /Recording/,
    );
    await js(
      `document.querySelector('.meeting-recording-status button').click()`,
    );
    await until(
      () => js(`!document.querySelector('.meeting-recording-status')`),
      "Recording did not finish",
    );
    await js(
      `document.querySelector('[data-page-id="' + ${JSON.stringify(noteId)} + '"] .organizer-page-link').click()`,
    );
    await until(
      () => js(`Boolean(${blockExpression})`),
      "Meeting did not return after navigation",
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-transcript"]').click()`,
    );
    assert.equal(
      await js(`${blockExpression}.model.props.recording.state`),
      "ready",
    );
    await until(
      () => js(`${blockExpression}.querySelector('audio')?.readyState >= 1`),
      "Recorded audio did not load",
    );
    assert.equal(
      await js(`${blockExpression}.querySelector('audio').error`),
      null,
    );
    await until(
      () =>
        js(
          `(() => { const audio = ${blockExpression}.querySelector('audio'); return Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime < .1 && !audio.seeking; })()`,
        ),
      "Recorded audio did not discover its duration",
    );
    await js(`${blockExpression}.querySelector('audio').currentTime = 1`);
    await until(
      () => js(`${blockExpression}.querySelector('audio').currentTime >= .9`),
      "Recorded audio cannot seek",
    );
    await js(`window.__meetingAudioContext.close()`);
    // Simulate reopening a saved prefix after an unexpected recording interruption.
    await js(
      `(() => { const block = ${blockExpression}; block.store.updateBlock(block.model, { recording: { ...block.model.props.recording, state: 'capturing' } }); })()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.save-status')?.textContent.includes('Saved locally')`,
        ),
      "Interrupted recording metadata did not save",
    );
    window.webContents.reload();
    await until(
      () => js(`Boolean(${blockExpression})`),
      "Meeting did not reopen for recording recovery",
    );
    await js(
      `${blockExpression}.querySelector('[role=tab][id$="-transcript"]').click()`,
    );
    await until(
      () => js(`${blockExpression}?.textContent.includes('Interrupted')`),
      "Interrupted recording was not identified in Transcript & recording",
    );
    await until(
      () => js(`${blockExpression}.querySelector('audio')?.readyState >= 1`),
      "Recovered recording did not load",
    );
    await js(
      `Array.from(${blockExpression}.querySelectorAll('button')).find(button => button.textContent.trim() === 'Keep recovered audio').click()`,
    );
    assert.equal(
      await js(`${blockExpression}.model.props.recording.state`),
      "ready",
    );
    await js(
      `Array.from(document.querySelectorAll('.sidebar button')).find(button => button.textContent.trim() === 'Settings').click()`,
    );
    await until(
      () => js(`Boolean(document.querySelector('.settings-dialog'))`),
      "Settings did not open",
    );
    await js(
      `Array.from(document.querySelectorAll('.settings-dialog nav button')).find(button => button.textContent.trim() === 'Blocks').click()`,
    );
    await until(
      () => js(`Boolean(document.querySelector('.settings-content select'))`),
      "Block settings did not open",
    );
    await js(
      `(() => { const select = document.querySelector('.settings-content select'); select.value = 'summary'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await until(
      () =>
        js(
          `window.hyperionDesktop.repositoryExecute({ operation:'getPreferences',vaultId:${JSON.stringify(vaultId)} }).then(preferences => preferences.meetingDefaultTab === 'summary')`,
        ),
      "Meeting settings did not persist",
    );
    await js(`document.querySelector('[aria-label="Close settings"]').click()`);
    window.webContents.reload();
    await until(
      () =>
        js(
          `Boolean(${blockExpression}?.querySelector('[id$="-summary"][aria-selected="true"]'))`,
        ),
      "Default meeting tab was not applied after reopening",
    );
    // Journal defaults use stored metadata even when the entry has been renamed.
    await js(`(async () => {
      const notes = await window.hyperionDesktop.repositoryExecute({ operation: 'listNotes', vaultId: ${JSON.stringify(vaultId)} });
      const source = notes.find(note => note.id === ${JSON.stringify(noteId)});
      await window.hyperionDesktop.repositoryExecute({ operation: 'saveNote', note: {
        ...source, id: crypto.randomUUID(), title: 'Renamed journal', body: '',
        kind: 'journal', journalDate: '2030-06-15', favorite: true,
        tags: [], links: [], aliases: [], parentId: null, icon: null,
      } });
    })()`);
    window.webContents.reload();
    await until(
      () =>
        js(
          `Array.from(document.querySelectorAll('.sidebar button')).some(button => button.textContent.trim().endsWith('Renamed journal'))`,
        ),
      "Journal fixture did not appear",
    );
    await js(
      `Array.from(document.querySelectorAll('.sidebar button')).find(button => button.textContent.trim().endsWith('Renamed journal')).click()`,
    );
    const journalWidget = `document.querySelector('.workspace-panel:not([hidden]) [data-journal-date="2030-06-15"] affine-slash-menu-widget')`;
    const journalMeeting = `document.querySelector('.workspace-panel:not([hidden]) hyperion-meeting-block')`;
    await until(
      () => js(`Boolean(${journalWidget})`),
      "Journal editor did not open with its stored date",
    );
    await js(`(() => {
      const widget = ${journalWidget};
      const context = { std: widget.std, model: widget.std.store.getModelsByFlavour('affine:paragraph')[0] };
      const items = typeof widget.config.items === 'function' ? widget.config.items(context) : widget.config.items;
      items.find(item => item.name === 'Meeting').action(context);
    })()`);
    await until(
      () => js(`Boolean(${journalMeeting})`),
      "Journal meeting did not render",
    );
    assert.equal(await js(`${journalMeeting}.model.props.date`), "2030-06-15");
    await js(
      `(() => { const input = ${journalMeeting}.querySelector('.meeting-date'); input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('.save-status')?.textContent.includes('Saved locally')`,
        ),
      "Cleared journal meeting date did not save",
    );
    window.webContents.reload();
    await until(
      () => js(`Boolean(${journalMeeting})`),
      "Journal meeting did not reopen",
    );
    assert.equal(
      await js(`${journalMeeting}.model.props.date`),
      "",
      "Reopening repopulated an intentionally cleared date",
    );
    assert.deepEqual(rendererErrors, []);
    console.log(
      "Meeting integration passed: local/journal date defaults, cleared-date persistence, insertion undo/redo, continuous typing/carets, rich formatting, notes undo/redo, editing boundaries, checklists, slash tables, notes/transcript, audio import/playback/seek, read-only view, undo, reopen, indexing, recording across navigation, interrupted-recording recovery, and settings persistence.",
    );
  } catch (error) {
    console.error(error);
    console.error("Renderer errors:", rendererErrors);
    if (window)
      console.error(
        await js(
          `JSON.stringify({ blocks: document.querySelector('affine-slash-menu-widget')?.std.store.getModelsByFlavour('hyperion:meeting').map(model => ({ id:model.id,props:model.props })), cards: document.querySelectorAll('hyperion-meeting-block').length, unavailable: Array.from(document.querySelectorAll('hyperion-unavailable-block')).map(element=>element.textContent) })`,
        ).catch(String),
      );
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
})();
