// Run with: env -u ELECTRON_RUN_AS_NODE pnpm exec electron tests/electron-smoke.mjs
import { app, BrowserWindow } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
const testDirectory = dirname(fileURLToPath(import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hyperion-ui-test-'));
  app.setPath("userData", join(directory, "electron-profile"));
  process.env.HYPERION_DATA_DIRECTORY = directory;
  process.env.HYPERION_TEST_RENDERER = '1';
  let window;
  const until = async (predicate, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) { try { if (await predicate()) return; } catch { /* Renderer can reload between checks. */ } await wait(100); }
    throw new Error(message);
  };
  const js = source => window.webContents.executeJavaScript(source, true);
  try {
    await import(pathToFileURL(join(testDirectory, '../dist-electron/main.js')).href);
    await until(() => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading(); }, 'Window did not load');
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('renderer:', message); });
    await until(() => js('Boolean(document.querySelector("doc-title")?.doc?.root)'), 'Editor did not load');
    await until(() => js('document.querySelector(".save-status")?.textContent.includes("Saved locally")'), 'Initial save did not finish');
    const identity = await js(`(() => { const store=document.querySelector('doc-title').doc; return { noteId:store.id, vaultId:'hyperion' }; })()`);
    // Edit through the real editor store and wait for the renderer's save acknowledgement.
    await js(`(() => { const store=document.querySelector('doc-title').doc; store.root.props.title.insert('Smoke ', 0); })()`);
    await until(() => js(`window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:'hyperion'}).then(notes=>notes.some(n=>n.title.startsWith('Smoke ')))`), 'Editor title was not persisted');
    await until(() => js('document.querySelector(".save-status")?.textContent.includes("Saved locally")'), 'Edit save did not finish');
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='History').click()`);
    await until(() => js('Boolean(document.querySelector(".history-dialog"))'), 'History dialog did not open');
    await js(`(() => { const input=document.querySelector('[aria-label="Version name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Smoke checkpoint'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(150);
    await js(`document.querySelector('.history-dialog form').requestSubmit()`);
    await until(() => js(`Array.from(document.querySelectorAll('.history-body nav strong')).some(e=>e.textContent==='Smoke checkpoint')`), 'Named version was not saved');
    await until(() => js('Boolean(document.querySelector(".history-preview doc-title")?.doc?.root)'), 'Historical rich preview did not load');
    assert.equal(await js('document.querySelector(".history-preview doc-title").doc.readonly'), true);
    await window.webContents.capturePage().then(image => writeFileSync('/tmp/hyperion-history-preview.png', image.toPNG()));
    await js(`document.querySelector('[aria-label="Close history"]').click()`);
    const exported = await js(`window.hyperionDesktop.repositoryExecute({operation:'exportVault',vaultId:'hyperion'})`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='History').click()`);
    await until(() => js('Boolean(document.querySelector(".history-preview doc-title")?.doc?.root)'), 'History preview did not reopen');
    await js(`Array.from(document.querySelectorAll('.history-dialog button')).find(b=>b.textContent==='Restore as a copy').click()`);
    await until(() => js(`document.querySelector('doc-title')?.doc?.root?.props.title.toString().endsWith('(restored)')`), 'Restored copy did not load after reload');
    assert.equal(exported.version, 9); assert.ok(exported.revisions.some(r=>r.label==='Smoke checkpoint'));
    assert.ok(identity.noteId);
    // Import the real rich bundle, then reload into its new vault and open its document.
    const imported = await js(`window.hyperionDesktop.repositoryExecute({operation:'importVault',bundle:${JSON.stringify(exported)}})`);
    const importedNotes = await js(`window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(imported.vault.id)}})`);
    const importedPage = importedNotes.find(note=>note.title.startsWith('Smoke '));
    assert.ok(importedPage);
    await js(`localStorage.setItem('hyperion:current-vault',${JSON.stringify(imported.vault.id)});localStorage.setItem('hyperion:last-note:'+${JSON.stringify(imported.vault.id)},${JSON.stringify(importedPage.id)});location.reload();`);
    await until(()=>js(`document.querySelector('doc-title')?.doc?.root?.props.title.toString().startsWith('Smoke ')`),'Imported rich page did not load');
    assert.ok(await js(`document.querySelector('doc-title').doc.getModelsByFlavour('affine:paragraph').length > 1`));
    const backup = await js('window.hyperionDesktop.createBackup()'); assert.ok(backup.path.startsWith(directory));
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Settings').click()`);
    await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Data')`),'Data settings tab missing');
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Data').click()`);
    await until(()=>js('Boolean(document.querySelector(".data-recovery"))'),'Backup controls missing');
    await wait(200);
    assert.ok(await js('document.querySelector(".settings-dialog").getBoundingClientRect().bottom <= innerHeight'));
    await window.webContents.capturePage().then(image=>writeFileSync('/tmp/hyperion-data-settings.png',image.toPNG()));
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Done').click()`);
    // Real window-close handshake must drain edits before the window disappears.
    await js(`document.querySelector('doc-title').doc.root.props.title.insert('Closing ', 0);`);
    window.close();
    await until(() => BrowserWindow.getAllWindows().length===0, 'Save-aware close did not complete');
    const { DatabaseSync } = await import('node:sqlite');
    const stored = new DatabaseSync(join(directory, 'hyperion.sqlite3'), { readOnly: true });
    assert.ok(stored.prepare("SELECT record FROM notes WHERE id=?").get(importedPage.id).record.includes('Closing Smoke'));
    stored.close();
    console.log('PASS: native editor save, named history, rich preview, restored copy reload, full vault import reload, backup and save-aware close');
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(await js('document.body.innerText').catch(()=>''));
      await window.webContents.capturePage().then(image=>writeFileSync('/tmp/hyperion-smoke-failure.png',image.toPNG())).catch(()=>{});
    }
    app.exit(1);
  } finally { await rm(directory, { recursive: true, force: true }).catch(()=>{}); }
})().catch(error=>{ console.error(error); app.exit(1); });
