import * as Y from "yjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DesktopDatabase, DATABASE_VERSION } from '../dist-electron/database.js';
import { documentState, vaultState } from './migration-fixture-state.mjs';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/migrations');
const manifest = JSON.parse(readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = file => JSON.parse(readFileSync(join(fixtureDirectory, file), 'utf8'));
const execute = (db, operation, args = {}) => db.repositoryExecute({ operation, vaultId: 'fixture-vault', ...args });

async function fixture(context, name) {
  const entry = manifest.fixtures.find(item => item.name === name);
  assert.ok(entry, `Unknown fixture: ${name}`);
  const source = join(fixtureDirectory, entry.file);
  assert.equal(digest(source), entry.sha256, 'Frozen database fixture changed; do not regenerate it with current code');
  const directory = await mkdtemp(join(tmpdir(), 'hyperion-migration-test-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
    assert.equal(digest(source), entry.sha256, 'The test must never modify its source fixture');
  });
  const path = join(directory, 'hyperion.sqlite3');
  await copyFile(source, path);
  return { entry, directory, path, source, expected: readJson(entry.expected) };
}

function inspect(path, action) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return action(db); } finally { db.close(); }
}
function rawState(path) {
  return inspect(path, db => {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const tables = schema.filter(row => row.type === 'table').map(row => String(row.name));
    return {
      version: Number(db.prepare('PRAGMA user_version').get().user_version), schema,
      // File layout/journal headers can change on open; every schema object and row must survive.
      tables: Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()])),
    };
  });
}
function migrationBackups(directory) {
  const folder = join(directory, 'backups');
  return existsSync(folder) ? readdirSync(folder).filter(name => name.startsWith('migration-') && name.endsWith('.sqlite3')).map(name => join(folder, name)) : [];
}
function assertVersions(path) {
  inspect(path, db => {
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), DATABASE_VERSION);
    assert.deepEqual(db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => Number(row.version)), Array.from({ length: DATABASE_VERSION }, (_, index) => index + 1));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}

for (const entry of manifest.fixtures) {
  test(`${entry.name}: upgrade preserves the frozen data contract and reopening is idempotent`, async context => {
    const { directory, path, source, expected } = await fixture(context, entry.name);
    const original = rawState(source);
    assert.equal(original.version, entry.schemaVersion);
    let db = new DesktopDatabase({ defaultDirectory: directory });
    try { assert.deepEqual(vaultState(db), expected); } finally { db.close(); }
    assertVersions(path);
    const backups = migrationBackups(directory);
    assert.equal(backups.length, entry.schemaVersion < DATABASE_VERSION ? 1 : 0);
    if (backups[0]) {
      assert.deepEqual(rawState(backups[0]), original, 'Pre-upgrade backup must contain the original schema and every row');
      inspect(backups[0], copy => assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'));
    }
    const afterUpgrade = rawState(path);
    db = new DesktopDatabase({ defaultDirectory: directory });
    try { assert.deepEqual(vaultState(db), expected); } finally { db.close(); }
    assert.deepEqual(rawState(path), afterUpgrade, 'Reopening must not rerun migrations or change stored data');
    assert.deepEqual(migrationBackups(directory), backups, 'Reopening must not create another migration backup');
  });
}

test('a late migration failure rolls back schema, records, documents, assets and version markers', async context => {
  const { directory, path } = await fixture(context, 'prototype-v0');
  const legacy = new DatabaseSync(path);
  try {
    const child = JSON.parse(legacy.prepare('SELECT record FROM notes WHERE id=?').get('child').record);
    legacy.prepare('UPDATE notes SET record=? WHERE id=?').run(JSON.stringify({ ...child, parentId: 'missing-parent' }), 'child');
  } finally { legacy.close(); }
  const before = rawState(path);
  // The existing migration detects this after rebuilding and repopulating tables.
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => new DesktopDatabase({ defaultDirectory: directory }), /hierarchy/);
    assert.deepEqual(rawState(path), before, 'Failed upgrade left partial writes behind');
  }
  const backups = migrationBackups(directory);
  assert.equal(backups.length, 2);
  for (const backup of backups) assert.deepEqual(rawState(backup), before);
});

test('failure to create a pre-migration backup prevents the migration', async context => {
  const { directory, path } = await fixture(context, 'prototype-v0');
  // A file where a directory is needed fails consistently without permission tricks.
  await writeFile(join(directory, 'backups'), 'Backup folder is unavailable');
  const before = rawState(path);
  assert.throws(() => new DesktopDatabase({ defaultDirectory: directory }), error => ['EEXIST', 'ENOTDIR'].includes(error.code));
  assert.deepEqual(rawState(path), before);
});

test('a newer database version is rejected before any writes', async context => {
  const { directory, path } = await fixture(context, 'desktop-v1');
  const future = new DatabaseSync(path);
  try { future.exec(`PRAGMA user_version=${DATABASE_VERSION + 1}`); } finally { future.close(); }
  const before = readFileSync(path);
  assert.throws(() => new DesktopDatabase({ defaultDirectory: directory }), /newer Hyperion/);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(migrationBackups(directory), []);
});

test('a frozen named version restores rich content and deleted attachments after opening the database', async context => {
  const { directory, expected } = await fixture(context, 'desktop-v1');
  const db = new DesktopDatabase({ defaultDirectory: directory });
  try {
    const historical = expected.revisions.find(revision => revision.id === manifest.historyRevisionId);
    assert.ok(historical);
    assert.equal(db.assetList('fixture-vault').includes('attachment'), false, 'Fixture must exercise an editor-deleted asset');
    assert.equal(expected.assets.find(asset => asset.key === 'attachment').deleted, true);
    const restored = execute(db, 'restoreRevision', { revisionId: historical.id, asCopy: true });
    assert.notEqual(restored.id, historical.noteId);
    const actual = vaultState(db);
    const restoredDocument = actual.documents[restored.id];
    const expectedDocument = structuredClone(historical.decodedDocument);
    expectedDocument.root['prop:title'] = { text: [{ insert: `${historical.note.title} (restored)` }] };
    assert.deepEqual(restoredDocument, expectedDocument);
    assert.deepEqual(actual.documents.parent, expected.documents.parent, 'Restoring a copy changed the live original');
    assert.equal(db.assetList('fixture-vault').includes('attachment'), true, 'Restoration must reactivate the attachment');
    const assetHash = historical.assets.attachment;
    assert.equal(db.assetGet('fixture-vault', 'attachment').data, expected.blobs[assetHash].data);
    const originalRevision = { ...historical };
    delete originalRevision.decodedDocument;
    assert.deepEqual(execute(db, 'getRevision', { revisionId: historical.id }), originalRevision);
    assert.ok(documentState(originalRevision.document).p['prop:text'].text.some(part => part.attributes?.bold));
  } finally { db.close(); }
});

function addRetiredDocuments(path, corrupt = false) {
  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare("SELECT DISTINCT document_id FROM editor_updates WHERE vault_id='fixture-vault' AND document_id != 'hyperion:vault' ORDER BY document_id").all();
    for (const {document_id: documentId} of rows) {
      const doc=new Y.Doc();
      for (const row of db.prepare("SELECT data FROM editor_updates WHERE vault_id='fixture-vault' AND document_id=? ORDER BY sequence").all(documentId)) Y.applyUpdate(doc,row.data);
      const blocks=doc.getMap('blocks');
      const root=[...blocks.values()].find(block=>block.get('sys:flavour')==='affine:page');
      if (root) {
        blocks.set('retired-youtube',new Y.Map([['sys:id','retired-youtube'],['sys:flavour','affine:embed-youtube'],['sys:version',1],['prop:caption','Remove this video']]));
        root.get('sys:children').push(['retired-youtube']);
        db.prepare("INSERT INTO editor_updates(vault_id,document_id,data) VALUES ('fixture-vault',?,?)").run(documentId,Y.encodeStateAsUpdate(doc));
      }
      doc.destroy();
    }
    if(corrupt) db.prepare("INSERT INTO editor_updates(vault_id,document_id,data) VALUES ('fixture-vault','zz-corrupt',?)").run(new Uint8Array([255]));
  } finally {db.close();}
}

test('v2 removes retired page/template content, updates metadata and keeps a complete pre-migration backup', async context => {
  const {directory,path}=await fixture(context,'desktop-v1');
  addRetiredDocuments(path);
  const original=rawState(path);
  const db=new DesktopDatabase({defaultDirectory:directory});
  try {
    assertVersions(path);
    const backups=migrationBackups(directory); assert.equal(backups.length,1); assert.deepEqual(rawState(backups[0]),original);
    const exported=execute(db,'exportVault');
    for (const encoded of [...Object.values(exported.editorDocuments),...Object.values(exported.templateDocuments)]) {
      const doc=new Y.Doc();Y.applyUpdate(doc,Buffer.from(encoded,'base64'));
      assert.equal(doc.getMap('blocks').has('retired-youtube'),false);
      for(const block of doc.getMap('blocks').values()) assert.ok(!block.get('sys:children')?.toArray().includes('retired-youtube'));
      doc.destroy();
    }
    assert.ok(exported.notes.every(note=>!note.body.includes('Remove this video')));
    // Existing revision payloads remain archival originals; restoring runs the retirement policy.
    assert.deepEqual(inspect(path,sql=>sql.prepare('SELECT * FROM revisions').all()),inspect(backups[0],sql=>sql.prepare('SELECT * FROM revisions').all()));
  } finally {db.close();}
  const after=rawState(path);const reopened=new DesktopDatabase({defaultDirectory:directory});reopened.close();
  assert.deepEqual(rawState(path),after);assert.equal(migrationBackups(directory).length,1);
});

test('v2 migration rolls all documents and the version back if any document is corrupt', async context => {
  const {directory,path}=await fixture(context,'desktop-v1');addRetiredDocuments(path,true);
  const before=rawState(path);
  assert.throws(()=>new DesktopDatabase({defaultDirectory:directory}));
  assert.deepEqual(rawState(path),before);
  assert.deepEqual(rawState(migrationBackups(directory)[0]),before);
});

test('import and restore refresh search metadata when retired blocks are removed', async context => {
  const {directory}=await fixture(context,'desktop-v1');
  const db=new DesktopDatabase({defaultDirectory:directory});context.after(()=>db.close());
  const doc=new Y.Doc();const blocks=doc.getMap('blocks');
  blocks.set('root',new Y.Map([['sys:flavour','affine:page'],['prop:title',new Y.Text('Retired content test')],['sys:children',Y.Array.from(['keep','video'])]]));
  blocks.set('keep',new Y.Map([['sys:flavour','affine:paragraph'],['prop:text',new Y.Text('Keep this text')]]));
  blocks.set('video',new Y.Map([['sys:flavour','affine:embed-youtube'],['prop:caption','Remove this video']]));
  const old=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');doc.destroy();
  const bundle=execute(db,'exportVault');
  bundle.editorDocuments.parent=old;bundle.notes.find(note=>note.id==='parent').body='Remove this video';
  const templateId=bundle.templates[0].id;bundle.templateDocuments[templateId]=old;bundle.templates[0].body='Remove this video';
  const payload={...bundle};delete payload.checksum;
  bundle.checksum=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const {vault}=execute(db,'importVault',{bundle});
  const imported=db.repositoryExecute({operation:'exportVault',vaultId:vault.id});
  const page=imported.notes.find(note=>note.title==='Retired content test');
  assert.equal(page.body,'Keep this text');assert.equal(imported.templates.find(template=>template.title==='Retired content test').body,'Keep this text');
  // Seed an archival payload through the storage boundary, as an older app would.
  db.editorDelete(vault.id,page.id);db.editorPush(vault.id,page.id,old);
  const revision=db.repositoryExecute({operation:'captureRevision',vaultId:vault.id,noteId:page.id,label:'Older content'});
  assert.ok(revision.note.body.includes('Remove this video'));
  const restored=db.repositoryExecute({operation:'restoreRevision',vaultId:vault.id,revisionId:revision.id,asCopy:true});
  assert.equal(restored.body,'Keep this text');
  const after=db.repositoryExecute({operation:'exportVault',vaultId:vault.id});
  assert.equal(after.notes.find(note=>note.id===restored.id).body,'Keep this text');
  assert.equal(after.revisions.find(item=>item.id===revision.id).document,old);
});
