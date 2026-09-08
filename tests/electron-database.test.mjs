import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';
import { DesktopDatabase } from '../dist-electron/database.js';
import { record, hash } from '../dist-electron/data-format.js';

const time = '2026-01-01T00:00:00.000Z';
const note = (overrides = {}) => record({ id: 'note', vaultId: 'vault', title: 'Persisted note', updatedAt: time, collectionIds: ['collection'], ...overrides }, 'note', true);
const template = () => record({ id: 'template', vaultId: 'vault', name: 'Meeting', updatedAt: time }, 'template', true);
function seed(db) {
  db.repositoryExecute({ operation: 'initialize', vault: record({ id: 'vault', name: 'Test vault', createdAt: time }, 'vault', true), notes: [note()], collections: [record({ id: 'collection', vaultId: 'vault', name: 'Collection', updatedAt: time }, 'collection', true)], preferences: record({ vaultId: 'vault' }, 'preferences', true) });
}
async function fixture(context) {
  const dir = await mkdtemp(join(tmpdir(), 'hyperion-data-test-'));
  const db = new DesktopDatabase({ defaultDirectory: dir });
  context.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  seed(db); return { db, dir };
}
const execute = (db, operation, args = {}) => db.repositoryExecute({ operation, ...args });
const encode = data => Buffer.from(data).toString('base64');
function page(text = 'Hello', sourceId) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  blocks.set('root', new Y.Map([['sys:flavour', 'affine:page'], ['prop:title', new Y.Text('Title')], ['sys:children', Y.Array.from(['p'])]]));
  blocks.set('p', new Y.Map([['sys:flavour', 'affine:paragraph'], ['prop:text', new Y.Text(text)]]));
  if (sourceId) blocks.set('image', new Y.Map([['sys:flavour', 'affine:image'], ['prop:sourceId', sourceId]]));
  return doc;
}
function persisted(db, noteId = 'note', vaultId = 'vault') {
  const doc = new Y.Doc(); for (const update of db.editorPull(vaultId, noteId)) Y.applyUpdate(doc, Buffer.from(update, 'base64')); return doc;
}
function bundleWithChecksum(bundle) { const payload = { ...bundle }; delete payload.checksum; return { ...payload, checksum: hash(JSON.stringify(payload)) }; }

test('SQLite persists validated records, rich documents, immutable assets and history across restart', async context => {
  const { db, dir } = await fixture(context);
  execute(db, 'saveTemplate', { template: template() });
  db.assetSet('vault', 'image', 'image/png', encode([4,5,6]));
  const doc = page('Original', 'image'); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  execute(db, 'captureRevision', { vaultId: 'vault', noteId: 'note', label: 'First' }); db.close();
  const reopened = new DesktopDatabase({ defaultDirectory: dir });
  try {
    assert.equal(execute(reopened, 'listNotes', { vaultId: 'vault' })[0].title, 'Persisted note');
    assert.equal(execute(reopened, 'listTemplates', { vaultId: 'vault' })[0].name, 'Meeting');
    assert.equal(persisted(reopened).getMap('blocks').get('p').get('prop:text').toString(), 'Original');
    assert.equal(reopened.assetGet('vault', 'image').data, encode([4,5,6]));
    assert.equal(execute(reopened, 'listRevisions', { vaultId: 'vault' })[0].label, 'First');
  } finally { reopened.close(); doc.destroy(); }
});

test('compaction preserves edits appended before and after a pull', async context => {
  const { db } = await fixture(context); const doc = page('');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  doc.on('update', update => db.editorPush('vault', 'note', encode(update)));
  const text = doc.getMap('blocks').get('p').get('prop:text');
  for (let i=0; i<40; i++) text.insert(i, 'a');
  assert.equal(db.editorPull('vault', 'note').length, 1);
  text.insert(40, 'NEW');
  assert.equal(persisted(db).getMap('blocks').get('p').get('prop:text').toString(), 'a'.repeat(40) + 'NEW');
  assert.equal(db.editorReplace, undefined); doc.destroy();
});

test('invalid records and cross-vault or cyclic relationships are rejected without changing data', async context => {
  const { db } = await fixture(context);
  assert.throws(() => execute(db, 'saveNote', { note: { ...note(), title: 4 } }), /string/);
  assert.throws(() => execute(db, 'saveNote', { note: note({ parentId: 'note' }) }), /hierarchy/);
  assert.throws(() => execute(db, 'saveNote', { note: note({ collectionIds: ['missing'] }) }), /collection/);
  assert.throws(() => execute(db, 'saveNote', { note: note({ vaultId: 'missing' }) }), /vault/);
  assert.equal(execute(db, 'listNotes', { vaultId: 'vault' })[0].parentId, null);
  assert.throws(() => db.editorPush('vault', 'note', 'garbage'), /base64/);
});

test('complete portable bundle restores rich content, assets, templates, links and history into an isolated vault', async context => {
  const { db } = await fixture(context);
  execute(db, 'saveTemplate', { template: template() });
  execute(db, 'saveNote', { note: note({ id: 'child', parentId: 'note', links: [{ targetId: 'note', label: 'Parent', kind: 'manual' }] }) });
  db.assetSet('vault', 'image', 'image/png', encode([1,2,3]));
  const doc = page('Rich content', 'image'); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc))); db.editorPush('vault', 'template:template', encode(Y.encodeStateAsUpdate(doc)));
  execute(db, 'captureRevision', { vaultId: 'vault', noteId: 'note', label: 'Keep forever' });
  const exported = execute(db, 'exportVault', { vaultId: 'vault' });
  const imported = execute(db, 'importVault', { bundle: exported });
  const importedNotes = execute(db, 'listNotes', { vaultId: imported.vault.id });
  const parent = importedNotes.find(n => !n.parentId); const child = importedNotes.find(n => n.parentId);
  assert.notEqual(parent.id, 'note'); assert.equal(child.parentId, parent.id); assert.equal(child.links[0].targetId, parent.id);
  assert.equal(persisted(db, parent.id, imported.vault.id).getMap('blocks').get('p').get('prop:text').toString(), 'Rich content');
  assert.equal(db.assetGet(imported.vault.id, 'image').data, encode([1,2,3]));
  assert.equal(execute(db, 'listRevisions', { vaultId: imported.vault.id })[0].label, 'Keep forever');
  assert.equal(execute(db, 'listTemplates', { vaultId: imported.vault.id }).length, 1);
  assert.equal(execute(db, 'listVaults').length, 2); doc.destroy();
});

test('imports roll back every write on corrupt documents, assets, unsupported versions and missing relationships', async context => {
  const { db } = await fixture(context); const bundle = execute(db, 'exportVault', { vaultId: 'vault' });
  for (const change of [
    b => { b.documentVersion = 999; },
    b => { b.editorDocuments.note = 'invalid'; },
    b => { b.notes[0].parentId = 'missing'; },
    b => { b.blobs.bad = { mimeType: 'text/plain', data: encode([1]) }; },
    b => { b.assets = [{ key: 'missing', hash: 'missing' }]; },
  ]) {
    const bad = structuredClone(bundle); change(bad);
    assert.throws(() => execute(db, 'importVault', { bundle: bundleWithChecksum(bad) }));
    assert.equal(execute(db, 'listVaults').length, 1);
  }
  const corrupt = structuredClone(bundle); corrupt.notes[0].title = 'Tampered';
  assert.throws(() => execute(db, 'importVault', { bundle: corrupt }), /checksum/);
});

test('restore as copy and in place preserve subsequent history and recover deleted attachments', async context => {
  const { db } = await fixture(context);
  db.assetSet('vault', 'image', 'image/png', encode([1,2]));
  const doc = page('Monday', 'image'); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const monday = execute(db, 'captureRevision', { vaultId: 'vault', noteId: 'note', label: 'Monday' });
  doc.getMap('blocks').get('p').get('prop:text').insert(6, ' Friday'); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc))); db.assetDelete('vault', 'image');
  execute(db, 'restoreRevision', { vaultId: 'vault', revisionId: monday.id, asCopy: false });
  assert.equal(persisted(db).getMap('blocks').get('p').get('prop:text').toString(), 'Monday');
  const revisions = execute(db, 'listRevisions', { vaultId: 'vault' });
  const before = revisions.find(r => r.label === 'Before restore');
  const fullBefore = execute(db, 'getRevision', { vaultId: 'vault', revisionId: before.id }); const old = new Y.Doc(); Y.applyUpdate(old, Buffer.from(fullBefore.document, 'base64'));
  assert.equal(old.getMap('blocks').get('p').get('prop:text').toString(), 'Monday Friday');
  const copy = execute(db, 'restoreRevision', { vaultId: 'vault', revisionId: monday.id, asCopy: true }); assert.notEqual(copy.id, 'note');
  assert.equal(db.assetGet('vault', 'image').data, encode([1,2]));
  assert.throws(() => db.assetSet('vault', 'image', 'image/png', encode([9])), /immutable/);
  old.destroy(); doc.destroy();
});

test('deletion reparents children and preserves restorable page history', async context => {
  const { db } = await fixture(context); execute(db, 'saveNote', { note: note({ id: 'child', parentId: 'note' }) });
  execute(db, 'deleteNote', { id: 'note' }); assert.equal(execute(db, 'listNotes', { vaultId: 'vault' })[0].parentId, null);
  const revision = execute(db, 'listRevisions', { vaultId: 'vault', noteId: 'note' })[0];
  execute(db, 'restoreRevision', { vaultId: 'vault', revisionId: revision.id, asCopy: false });
  assert.equal(execute(db, 'listNotes', { vaultId: 'vault' }).length, 2);
});

test('automatic history deduplicates unchanged pages and retention preserves named and newest versions', async context => {
  const { db, dir } = await fixture(context);
  execute(db, 'captureAutomaticRevisions'); execute(db, 'captureAutomaticRevisions');
  assert.equal(execute(db, 'listRevisions', { vaultId: 'vault' }).length, 1);
  execute(db, 'captureRevision', { vaultId: 'vault', noteId: 'note', label: 'Named' });
  const connection = new DatabaseSync(join(dir, 'hyperion.sqlite3'));
  connection.prepare('UPDATE revisions SET created_at=?').run('2000-01-01T00:00:00.000Z'); connection.close();
  execute(db, 'saveNote', { note: note({ title: 'Changed' }) }); execute(db, 'captureAutomaticRevisions');
  const revisions = execute(db, 'listRevisions', { vaultId: 'vault' }); assert.equal(revisions.length, 2); assert.ok(revisions.some(r => r.label === 'Named'));
});

test('verified SQLite backups restore into a separate folder and automatic retention keeps ten', async context => {
  const { db, dir } = await fixture(context); const manual = db.createBackup();
  for (let i=0; i<12; i++) db.createBackup(true);
  assert.equal(db.listBackups().filter(b => b.name.startsWith('automatic')).length, 10);
  assert.ok(existsSync(manual.path));
  const restored = db.restoreBackup(manual.path, join(dir, 'restored'));
  const copy = new DesktopDatabase({ initialDirectory: restored.directory });
  try { assert.equal(execute(copy, 'listNotes', { vaultId: 'vault' }).length, 1); } finally { copy.close(); }
  assert.throws(() => db.restoreBackup(manual.path, dir), /existing/);
  assert.equal(execute(db, 'listNotes', { vaultId: 'vault' }).length, 1);
});

test('changing storage folders preserves and remembers all data', async context => {
  const { db, dir } = await fixture(context); const custom = join(dir, 'custom');
  await db.setStorageDirectory(custom); db.close(); const reopened = new DesktopDatabase({ defaultDirectory: dir });
  try { assert.equal(reopened.storageInfo().directory, custom); assert.equal(execute(reopened, 'listVaults')[0].id, 'vault'); } finally { reopened.close(); }
});

test('prototype migration creates a backup and rolls back invalid legacy data', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperion-migration-')); context.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'hyperion.sqlite3'); const old = new DatabaseSync(path);
  old.exec('CREATE TABLE vaults(id TEXT PRIMARY KEY,created_at TEXT,record TEXT); CREATE TABLE notes(id TEXT PRIMARY KEY,vault_id TEXT,updated_at TEXT,record TEXT);');
  old.prepare('INSERT INTO vaults VALUES (?,?,?)').run('vault', time, JSON.stringify({ id:'vault', name:'Legacy', createdAt:time }));
  old.prepare('INSERT INTO notes VALUES (?,?,?,?)').run('note','vault',time,JSON.stringify({ id:'note',vaultId:'vault',title:'Old',updatedAt:time,parentId:'missing' })); old.close();
  assert.throws(() => new DesktopDatabase({ defaultDirectory:dir }), /hierarchy/);
  const unchanged = new DatabaseSync(path); assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version,0);
  assert.equal(JSON.parse(unchanged.prepare('SELECT record FROM notes').get().record).parentId,'missing');
  unchanged.prepare('UPDATE notes SET record=?').run(JSON.stringify({ id:'note',vaultId:'vault',title:'Old',updatedAt:time })); unchanged.close();
  const upgraded = new DesktopDatabase({ defaultDirectory:dir }); try { assert.equal(execute(upgraded,'listNotes',{vaultId:'vault'})[0].parentId,null); } finally { upgraded.close(); }
  assert.ok(readdirSync(join(dir,'backups')).some(n=>n.startsWith('migration-')));
});

test('newer databases are rejected without rewriting them', async context => {
  const dir=await mkdtemp(join(tmpdir(),'hyperion-future-')); context.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'hyperion.sqlite3');const db=new DatabaseSync(path);db.exec('PRAGMA user_version=999');db.close();
  const before=readFileSync(path);assert.throws(()=>new DesktopDatabase({defaultDirectory:dir}),/newer/);assert.deepEqual(readFileSync(path),before);
});

test('modern exports and imports reject missing embedded attachments', async context => {
  const { db } = await fixture(context);
  const doc = page('Image', 'missing-image');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  assert.throws(() => execute(db, 'exportVault', { vaultId: 'vault' }), /Missing attachment/);
  db.assetSet('vault', 'missing-image', 'image/png', encode([1]));
  const exported = execute(db, 'exportVault', { vaultId: 'vault' });
  exported.assets = []; exported.blobs = {};
  assert.throws(() => execute(db, 'importVault', { bundle: bundleWithChecksum(exported) }), /Missing attachment/);
  assert.equal(execute(db, 'listVaults').length, 1); doc.destroy();
});

test('rich inline formatting and embedded page references survive portable remapping', async context => {
  const { db } = await fixture(context);
  execute(db, 'saveNote', { note: note({ id: 'target' }) });
  const doc = page(''); const text = doc.getMap('blocks').get('p').get('prop:text');
  text.insert(0, 'Linked page', { bold: true, reference: { type: 'LinkedPage', pageId: 'target' } });
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const imported = execute(db, 'importVault', { bundle: execute(db, 'exportVault', { vaultId: 'vault' }) });
  const notes = execute(db, 'listNotes', { vaultId: imported.vault.id });
  const encoded = execute(db, 'exportVault', { vaultId: imported.vault.id }).editorDocuments;
  const pageId = Object.keys(encoded)[0];
  const restored = persisted(db, pageId, imported.vault.id);
  const delta = restored.getMap('blocks').get('p').get('prop:text').toDelta()[0];
  assert.equal(delta.insert, 'Linked page'); assert.equal(delta.attributes.bold, true);
  assert.ok(notes.some(n => n.id === delta.attributes.reference.pageId));
  assert.notEqual(delta.attributes.reference.pageId, 'target'); doc.destroy(); restored.destroy();
});

test('unknown document fields abort import without silently dropping content', async context => {
  const { db } = await fixture(context); const doc = page(); doc.getMap('future-content').set('secret', 'Keep me');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const bundle = execute(db, 'exportVault', { vaultId: 'vault' });
  assert.throws(() => execute(db, 'importVault', { bundle }), /Unsupported document fields/);
  assert.equal(execute(db, 'listVaults').length, 1); doc.destroy();
});

test('page comparison reads coherent current rich content without adding history and rejects mismatched pages', async context => {
  const { db } = await fixture(context); const doc = page('Before');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const revision = execute(db, 'captureRevision', { vaultId: 'vault', noteId: 'note', label: 'Checkpoint' });
  doc.getMap('blocks').get('p').get('prop:text').insert(6, ' after');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const comparison = execute(db, 'compareRevision', { vaultId: 'vault', noteId: 'note', revisionId: revision.id });
  assert.equal(comparison.revision.id, revision.id);
  assert.ok(comparison.current.note.body.includes('Before after'));
  assert.notEqual(comparison.revision.document, comparison.current.document);
  assert.equal(execute(db, 'listRevisions', { vaultId: 'vault', noteId: 'note' }).length, 1);
  assert.throws(() => execute(db, 'compareRevision', { vaultId: 'vault', noteId: 'other', revisionId: revision.id }), /another page/);
  assert.throws(() => execute(db, 'compareRevision', { vaultId: 'other', noteId: 'note', revisionId: revision.id }), /not found/);
  doc.destroy();
});

test('unchanged captures reuse snapshots, promote automatic versions and preserve existing names', async context => {
  const { db } = await fixture(context); const doc = page('Original');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  execute(db, 'captureAutomaticRevisions');
  const first = execute(db, 'listRevisions', { vaultId:'vault', noteId:'note' })[0];
  const named = execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Checkpoint' });
  assert.equal(named.id, first.id); assert.equal(named.createdAt, first.createdAt); assert.equal(named.captureStatus, 'named');
  const again = execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Another name' });
  assert.equal(again.id, first.id); assert.equal(again.label, 'Checkpoint'); assert.equal(again.captureStatus, 'reused');
  // A transient edit produces new CRDT bytes, but no changed page values.
  const text = doc.getMap('blocks').get('p').get('prop:text');
  text.insert(0, 'Temporary '); text.delete(0, 10);
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  db.assetSet('vault', 'unrelated-asset', 'image/png', encode([1,2,3]));
  execute(db, 'saveNote', { note: { ...named.note, updatedAt:'2026-02-01T00:00:00.000Z' } });
  execute(db, 'captureAutomaticRevisions');
  const unchanged = execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Still unchanged' });
  assert.equal(unchanged.id, first.id);
  assert.equal(execute(db, 'listRevisions', { vaultId:'vault', noteId:'note' }).length, 1);
  // Formatting is real content even when its plain text matches.
  text.format(0, 8, { bold:true }); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const formatted = execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Formatted' });
  assert.equal(formatted.captureStatus, 'created'); assert.notEqual(formatted.id, first.id);
  // Returning to older content after an intervening version is a new transition.
  text.format(0, 8, { bold:null }); db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  assert.equal(execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Unformatted' }).captureStatus, 'created');
  doc.destroy();
});

test('deduplication supports old snapshot hashes and still records metadata, attachments and layout edits', async context => {
  const { db, dir } = await fixture(context); const doc = page('Original');
  db.editorPush('vault', 'note', encode(Y.encodeStateAsUpdate(doc)));
  const first = execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Original' });
  const connection = new DatabaseSync(join(dir, 'hyperion.sqlite3'));
  connection.prepare('UPDATE revisions SET content_hash=? WHERE id=?').run(hash(JSON.stringify({ note:{...first.note,updatedAt:undefined}, document:first.document, assets:first.assets })),first.id);
  connection.close();
  assert.equal(execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Same' }).id, first.id);
  execute(db, 'saveNote', { note:note({tags:['new']}) });
  assert.equal(execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Tagged' }).captureStatus, 'created');
  db.assetSet('vault','image','image/png',encode([7]));
  doc.getMap('blocks').set('image', new Y.Map([['sys:flavour','affine:image'],['prop:sourceId','image']]));
  db.editorPush('vault','note',encode(Y.encodeStateAsUpdate(doc)));
  assert.equal(execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Image' }).captureStatus, 'created');
  doc.getMap('blocks').get('root').get('sys:children').insert(0,['image']);
  db.editorPush('vault','note',encode(Y.encodeStateAsUpdate(doc)));
  assert.equal(execute(db, 'captureRevision', { vaultId:'vault', noteId:'note', label:'Layout' }).captureStatus, 'created');
  doc.destroy();
});
