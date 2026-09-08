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
