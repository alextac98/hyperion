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
    assert.equal(app.getName(), '[Dev] Hyperion');
    assert.equal(app.getPath('userData'), join(directory, 'electron-profile'));
    assert.equal(app.isPackaged, false);
    if (process.platform === 'darwin') assert.ok(process.execPath.endsWith('/[Dev] Hyperion.app/Contents/MacOS/Electron'));
    await until(() => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading(); }, 'Window did not load');
    assert.equal(window.getTitle(), '[Dev] Hyperion');
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('renderer:', message); });
    await until(() => js('Boolean(document.querySelector("doc-title")?.doc?.root)'), 'Editor did not load');
    await until(() => js('document.querySelector(".save-status")?.textContent.includes("Saved locally")'), 'Initial save did not finish');
    const identity = await js(`(() => { const store=document.querySelector('doc-title').doc; return { noteId:store.id, vaultId:'hyperion' }; })()`);
    // Edit through the real editor store and wait for the renderer's save acknowledgement.
    await js(`(() => { const store=document.querySelector('doc-title').doc; store.root.props.title.insert('Smoke ', 0); })()`);
    await until(() => js(`window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:'hyperion'}).then(notes=>notes.some(n=>n.title.startsWith('Smoke ')))`), 'Editor title was not persisted');
    await until(() => js('document.querySelector(".save-status")?.textContent.includes("Saved locally")'), 'Edit save did not finish');
    await js(`window.hyperionDesktop.repositoryExecute({operation:'captureAutomaticRevisions'})`);
    const automatic = await js(`window.hyperionDesktop.repositoryExecute({operation:'listRevisions',vaultId:'hyperion',noteId:${JSON.stringify(identity.noteId)}}).then(versions=>versions[0])`);
    await js(`Array.from(document.querySelectorAll('.details-tabs button')).find(button=>button.textContent==='History').click()`);
    await until(() => js('Boolean(document.querySelector(".page-history"))'), 'Page history sidebar did not open');
    assert.equal(await js('Boolean(document.querySelector(".history-dialog"))'), false);
    await js(`(() => { const input=document.querySelector('[aria-label="Version name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Smoke checkpoint'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(150);
    await js(`document.querySelector('.page-history form').requestSubmit()`);
    await until(() => js(`Array.from(document.querySelectorAll('.page-history nav strong')).some(e=>e.textContent==='Smoke checkpoint')`), 'Named version was not saved');
    await until(() => js('document.querySelector(".history-empty")?.textContent.includes("matches")'), 'Identical snapshot showed spurious changes');
    assert.ok(await js(`document.querySelector('.page-history [role=status]')?.textContent.includes('Named the existing version')`));
    const namedVersions = await js(`window.hyperionDesktop.repositoryExecute({operation:'listRevisions',vaultId:'hyperion',noteId:${JSON.stringify(identity.noteId)}})`);
    assert.equal(namedVersions.length, 1); assert.equal(namedVersions[0].id, automatic.id);
    await js(`(() => { const input=document.querySelector('[aria-label="Version name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Duplicate checkpoint'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(150);
    await js(`document.querySelector('.page-history form').requestSubmit()`);
    await until(() => js(`document.querySelector('.page-history [role=status]')?.textContent.includes('No changes since')`), 'Duplicate snapshot was not reported');
    assert.equal(await js(`window.hyperionDesktop.repositoryExecute({operation:'listRevisions',vaultId:'hyperion',noteId:${JSON.stringify(identity.noteId)}}).then(versions=>versions.length)`), 1);
    assert.equal(await js(`document.querySelector('.page-history nav strong')?.textContent`), 'Smoke checkpoint');

    await js(`Array.from(document.querySelectorAll('.page-comparison button')).find(b=>b.textContent==='Back to editing').click()`);
    // Immediately open comparison after editing: capture must drain pending writes.
    await js(`document.querySelector('.note-workspace doc-title').doc.root.props.title.insert('Changed ',0); document.querySelector('.page-history nav button').click();`);
    await until(() => js('document.querySelector(".diff-after .diff-text")?.textContent.includes("Changed Smoke")'), 'Comparison missed pending title edit');
    assert.ok(await js('document.querySelector(".diff-before .diff-text")?.textContent.includes("Smoke")'));
    assert.equal(await js('document.querySelector("[aria-label=Undo]").disabled'), true);
    assert.equal(await js('document.querySelector(".diff-text ins")?.textContent'), 'Changed ');
    assert.ok(await js(`(() => { const a=document.querySelector('.diff-before').getBoundingClientRect(); const b=document.querySelector('.diff-after').getBoundingClientRect(); return Math.abs(a.top-b.top)<1 && a.right<=b.left+1; })()`));
    await js(`Array.from(document.querySelectorAll('.diff-layout button')).find(button=>button.textContent==='Unified').click()`);
    assert.ok(await js(`(() => { const a=document.querySelector('.diff-before').getBoundingClientRect(); const b=document.querySelector('.diff-after').getBoundingClientRect(); return b.top>=a.bottom && Math.abs(a.left-b.left)<1; })()`));
    await js(`Array.from(document.querySelectorAll('.diff-layout button')).find(button=>button.textContent==='Side by side').click()`);

    await window.webContents.capturePage().then(image => writeFileSync('/tmp/hyperion-history-diff.png', image.toPNG()));
    await js(`Array.from(document.querySelectorAll('.comparison-tabs button')).find(b=>b.textContent==='Saved page').click()`);
    await until(() => js('Boolean(document.querySelector(".page-comparison .history-preview doc-title")?.doc?.root)'), 'Historical rich preview did not load');
    assert.equal(await js('document.querySelector(".page-comparison .history-preview doc-title").doc.readonly'), true);
    assert.ok(await js('document.querySelector(".page-comparison .history-preview doc-title").doc.root.props.title.toString().startsWith("Smoke ")'));
    await wait(200);
    await window.webContents.capturePage().then(image => writeFileSync('/tmp/hyperion-history-preview.png', image.toPNG()));
    await js(`Array.from(document.querySelectorAll('.comparison-tabs button')).find(b=>b.textContent==='Current page').click()`);
    await until(() => js('document.querySelector(".page-comparison .history-preview doc-title")?.doc?.root?.props.title.toString().startsWith("Changed Smoke ")'), 'Current rich preview has stale text');
    // The sidebar follows navigation and does not leak the selected page's history.
    await js(`Array.from(document.querySelectorAll('[data-page-id]')).find(row=>row.dataset.pageId!==${JSON.stringify(identity.noteId)}).querySelector('.organizer-page-link').click()`);
    await until(() => js(`!document.querySelector('.page-comparison') && document.querySelector('.note-workspace doc-title')?.doc?.id!==${JSON.stringify(identity.noteId)}`), 'Page navigation retained old comparison');
    await until(() => js(`document.querySelector('.page-history nav')?.getAttribute('aria-busy')==='false'`), 'Next page history did not load');
    assert.equal(await js(`document.querySelector('.page-history')?.textContent.includes('Smoke checkpoint')`), false);
    await js(`document.querySelector('[data-page-id="'+${JSON.stringify(identity.noteId)}+'"] .organizer-page-link').click()`);
    await until(() => js(`Array.from(document.querySelectorAll('.page-history nav button')).some(b=>b.textContent.includes('Smoke checkpoint'))`), 'Original page history did not return');
    await js(`Array.from(document.querySelectorAll('.page-history nav button')).find(b=>b.textContent.includes('Smoke checkpoint')).click()`);
    await until(() => js('Boolean(document.querySelector(".page-comparison"))'), 'Original comparison did not reopen');
    // History stays usable at the desktop minimum window width.
    window.setSize(940, 760);
    await wait(250);
    assert.ok(await js(`(() => { const panel=document.querySelector('.details-panel.history-open').getBoundingClientRect(); const preview=document.querySelector('.page-comparison').getBoundingClientRect(); return panel.width>0 && panel.right<=innerWidth && preview.right<=panel.left+1; })()`));
    await window.webContents.capturePage().then(image=>writeFileSync('/tmp/hyperion-history-narrow.png',image.toPNG()));
    window.setSize(1440, 940);
    const exported = await js(`window.hyperionDesktop.repositoryExecute({operation:'exportVault',vaultId:'hyperion'})`);
    // Restoring in place preserves the current version and reloads the original page.
    await js(`window.confirm=()=>true; Array.from(document.querySelectorAll('.page-comparison button')).find(b=>b.textContent==='Restore this version').click()`);
    await until(() => js(`!document.querySelector('.page-comparison') && document.querySelector('.note-workspace doc-title')?.doc?.root?.props.title.toString().startsWith('Smoke ')`), 'Restored original did not load');
    const history = await js(`window.hyperionDesktop.repositoryExecute({operation:'listRevisions',vaultId:'hyperion',noteId:${JSON.stringify(identity.noteId)}})`);
    assert.ok(history.some(version=>version.label==='Before restore' && version.note.title.startsWith('Changed Smoke ')));
    await js(`Array.from(document.querySelectorAll('.details-tabs button')).find(button=>button.textContent==='History').click()`);
    await until(() => js('Boolean(document.querySelector(".page-history nav button"))'), 'History sidebar did not reopen');
    await js(`Array.from(document.querySelectorAll('.page-history nav button')).find(b=>b.textContent.includes('Smoke checkpoint')).click()`);
    await until(() => js('Boolean(document.querySelector(".page-comparison"))'), 'Comparison did not reopen');
    await js(`Array.from(document.querySelectorAll('.page-comparison button')).find(b=>b.textContent==='Restore as a copy').click()`);
    await until(() => js(`document.querySelector('.note-workspace doc-title')?.doc?.root?.props.title.toString().endsWith('(restored)')`), 'Restored copy did not load after reload');
    assert.equal(exported.version, 9); assert.ok(exported.revisions.some(r=>r.label==='Smoke checkpoint'));
    assert.ok(identity.noteId);
    // Import the real rich bundle, then reload into its new vault and open its document.
    const imported = await js(`window.hyperionDesktop.repositoryExecute({operation:'importVault',bundle:${JSON.stringify(exported)}})`);
    const importedNotes = await js(`window.hyperionDesktop.repositoryExecute({operation:'listNotes',vaultId:${JSON.stringify(imported.vault.id)}})`);
    const importedPage = importedNotes.find(note=>note.title.startsWith('Changed Smoke '));
    assert.ok(importedPage);
    await js(`localStorage.setItem('hyperion:current-vault',${JSON.stringify(imported.vault.id)});localStorage.setItem('hyperion:last-note:'+${JSON.stringify(imported.vault.id)},${JSON.stringify(importedPage.id)});location.reload();`);
    await until(()=>js(`document.querySelector('doc-title')?.doc?.root?.props.title.toString().startsWith('Changed Smoke ')`),'Imported rich page did not load');
    assert.ok(await js(`document.querySelector('doc-title').doc.getModelsByFlavour('affine:paragraph').length > 1`));
    const backup = await js('window.hyperionDesktop.createBackup()'); assert.ok(backup.path.startsWith(directory));
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Settings').click()`);
    await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Data')`),'Data settings tab missing');
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Data').click()`);
    await until(()=>js('Boolean(document.querySelector(".data-recovery"))'),'Backup controls missing');
    await wait(200);
    assert.ok(await js('document.querySelector(".settings-dialog").getBoundingClientRect().bottom <= innerHeight'));
    await window.webContents.capturePage().then(image=>writeFileSync('/tmp/hyperion-data-settings.png',image.toPNG()));
    // Recovery uses the refactored native modal, including page history navigation.
    assert.equal(await js(`document.querySelector('dialog[aria-label="Settings"]')?.matches(':modal')`), true);
    await js(`Array.from(document.querySelectorAll('.settings-dialog button')).find(b=>b.textContent==='Browse page history').click()`);
    await until(()=>js(`document.querySelector('dialog[aria-label="Page history"]')?.matches(':modal')`),'Vault history did not open as a native modal');
    await until(()=>js(`Boolean(document.querySelector('.history-dialog doc-title')?.doc?.root)`),'Vault history rich preview did not load');
    assert.equal(await js(`document.querySelector('.history-dialog doc-title').doc.readonly`), true);
    await js(`document.querySelector('[aria-label="Close history"]').click()`);
    await until(()=>js(`!document.querySelector('dialog[open]')`),'History modal did not close');
    // The branded route works from file:// and must flush pending edits before navigation.
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Settings').click()`);
    await until(()=>js(`Array.from(document.querySelectorAll('.settings-dialog button')).some(b=>b.textContent==='Appearance')`),'Appearance tab missing');
    await js(`Array.from(document.querySelectorAll('.settings-dialog button')).find(b=>b.textContent==='Appearance').click()`);
    await js(`document.querySelector('doc-title').doc.root.props.title.insert('Brand ', 0); document.querySelector('.brand-guide-link').click();`);
    await until(()=>js('Boolean(document.querySelector(".brand-page"))'),'Brand guide did not open in the desktop app');
    assert.equal(await js('Boolean(window.hyperionDesktop)'), true);
    await until(()=>js(`Array.from(document.querySelectorAll('.brand-page img')).every(image=>image.complete && image.naturalWidth>0)`),'Packaged brand images did not load');
    await js(`document.querySelector('.brand-header button').click()`);
    assert.ok(await js(`['light','dark'].includes(document.documentElement.dataset.theme)`));
    await js(`document.querySelector('.brand-back').click()`);
    await until(()=>js(`document.querySelector('doc-title')?.doc?.root?.props.title.toString().startsWith('Brand Changed Smoke')`),'Pending edit was not preserved across the brand guide visit');
    // Real window-close handshake must drain edits before the window disappears.
    await js(`document.querySelector('doc-title').doc.root.props.title.insert('Closing ', 0);`);
    window.close();
    await until(() => BrowserWindow.getAllWindows().length===0, 'Save-aware close did not complete');
    const { DatabaseSync } = await import('node:sqlite');
    const stored = new DatabaseSync(join(directory, 'hyperion.sqlite3'), { readOnly: true });
    assert.ok(stored.prepare("SELECT record FROM notes WHERE id=?").get(importedPage.id).record.includes('Closing Brand Changed Smoke'));
    stored.close();
    console.log('PASS: native editor save, sidebar history, pending-edit diffs, read-only rich previews, in-place restore and restored copy reload, full vault import reload, backup, brand navigation and save-aware close');
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
