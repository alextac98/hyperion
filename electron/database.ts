import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, openSync, fsyncSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import { assetReferences, array, bytes, documentBytes, documentMetadata, hash, id, object, record, remapDocument, restoreDocument, string, BUNDLE_VERSION, DOCUMENT_VERSION, type RecordValue } from "./data-format.js";

const DATABASE_FILE = "hyperion.sqlite3";
export const DATABASE_VERSION = 1;
const HISTORY_DAYS = 30;
export type RepositoryRequest = { operation: string; [key: string]: unknown };
export type StorageInfo = { directory: string; databasePath: string; isDefault: boolean };
export type StoredAsset = { mimeType: string; data: string };
export type DesktopDatabaseOptions = { defaultDirectory?: string; locationFile?: string; initialDirectory?: string };
type Row = Record<string, unknown>;
type Revision = { id: string; vaultId: string; noteId: string; createdAt: string; label: string | null; reason: string; documentVersion: number; note: RecordValue; document: string | null; assets: Record<string, string>; contentHash: string };
const now = () => new Date().toISOString();
const sqlRecord = (row: Row) => JSON.parse(String(row.record)) as RecordValue;
function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
const schema = `
CREATE TABLE storage_metadata(key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
INSERT INTO storage_metadata VALUES ('document_version',1);
CREATE TABLE migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE vaults(id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record,'$.id') = id));
CREATE TABLE notes(
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 updated_at TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record,'$.id') = id AND json_extract(record,'$.vaultId') = vault_id),
 parent_id TEXT GENERATED ALWAYS AS (json_extract(record,'$.parentId')) VIRTUAL,
 UNIQUE(vault_id,id), FOREIGN KEY(vault_id,parent_id) REFERENCES notes(vault_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX notes_vault_updated ON notes(vault_id,updated_at DESC);
CREATE TABLE templates(id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, updated_at TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record,'$.id') = id AND json_extract(record,'$.vaultId') = vault_id));
CREATE TABLE collections(id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, name TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record,'$.id') = id AND json_extract(record,'$.vaultId') = vault_id));
CREATE TABLE preferences(vault_id TEXT PRIMARY KEY NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record,'$.vaultId') = vault_id));
CREATE TABLE editor_updates(sequence INTEGER PRIMARY KEY AUTOINCREMENT, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, document_id TEXT NOT NULL, data BLOB NOT NULL);
CREATE INDEX editor_document ON editor_updates(vault_id,document_id,sequence);
CREATE TABLE blobs(hash TEXT PRIMARY KEY NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE assets(vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, asset_key TEXT NOT NULL, hash TEXT NOT NULL REFERENCES blobs(hash), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), PRIMARY KEY(vault_id,asset_key));
CREATE TABLE revisions(id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, note_id TEXT NOT NULL, created_at TEXT NOT NULL, label TEXT, reason TEXT NOT NULL, document_version INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)), document BLOB, content_hash TEXT NOT NULL);
CREATE INDEX revision_page ON revisions(vault_id,note_id,created_at DESC);
CREATE TABLE revision_assets(revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, asset_key TEXT NOT NULL, hash TEXT NOT NULL REFERENCES blobs(hash), PRIMARY KEY(revision_id,asset_key));
`;

export class DesktopDatabase {
  readonly defaultDirectory: string;
  readonly locationFile: string;
  private directory: string;
  private database!: DatabaseSync;
  private closed = false;

  constructor(options: DesktopDatabaseOptions = {}) {
    this.defaultDirectory = resolve(options.defaultDirectory ?? join(homedir(), ".config", "hyperion"));
    this.locationFile = resolve(options.locationFile ?? join(this.defaultDirectory, "storage-location"));
    let remembered = "";
    try { remembered = readFileSync(this.locationFile, "utf8").trim(); } catch { /* First launch. */ }
    this.directory = resolve(options.initialDirectory ?? (remembered || this.defaultDirectory));
    this.open();
  }
  private open() {
    mkdirSync(this.directory, { recursive: true });
    const db = new DatabaseSync(join(this.directory, DATABASE_FILE));
    this.database = db;
    try {
      const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
      if (version > DATABASE_VERSION) throw new Error("This database was created by a newer Hyperion. Update the app before opening it.");
      if (version > 0 && Number(db.prepare("SELECT value FROM storage_metadata WHERE key='document_version'").get()?.value) !== DOCUMENT_VERSION) throw new Error("Unsupported live document format; update Hyperion before opening this database");
      db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      if (version === 0) this.migratePrototype();
      this.checkIntegrity();
    } catch (error) { db.close(); throw error; }
  }
  private migratePrototype() {
    const db = this.database;
    const tables = ["vaults", "notes", "templates", "collections", "preferences", "editor_updates", "assets"];
    const exists = (table: string) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    const legacy = Object.fromEntries(tables.map(table => [table, exists(table) ? db.prepare(`SELECT * FROM ${table}`).all() : []])) as Record<string, Row[]>;
    if (exists("vaults")) {
      mkdirSync(join(this.directory, "backups"), { recursive: true });
      this.snapshotFile(join(this.directory, "backups", `migration-0-${Date.now()}-${randomUUID()}.sqlite3`), false);
    }
    transaction(db, () => {
      for (const table of [...tables].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
      db.exec(schema);
      for (const [table, kind] of [["vaults", "vault"], ["collections", "collection"], ["notes", "note"], ["templates", "template"], ["preferences", "preferences"]] as const) {
        for (const row of legacy[table]) this.put(kind, record(sqlRecord(row), kind, true));
      }
      for (const row of legacy.editor_updates) {
        documentBytes(Buffer.from(row.data as Uint8Array).toString("base64"));
        db.prepare("INSERT INTO editor_updates(vault_id,document_id,data) VALUES (?,?,?)").run(String(row.vault_id), String(row.document_id), row.data as Uint8Array);
      }
      for (const row of legacy.assets) this.assetSet(String(row.vault_id), String(row.asset_key), String(row.mime_type), Buffer.from(row.data as Uint8Array).toString("base64"));
      this.validateRelationships();
      db.prepare("INSERT INTO migrations VALUES (1,?,?)").run("Desktop integrity, portable backups and page revisions", now());
      db.exec("PRAGMA user_version=1");
    });
  }
  private ensureOpen() { if (this.closed) throw new Error("The Hyperion database is closed"); }
  private rows(table: string, vaultId?: string) {
    return vaultId === undefined ? this.database.prepare(`SELECT * FROM ${table}`).all() : this.database.prepare(`SELECT * FROM ${table} WHERE vault_id=?`).all(vaultId);
  }
  private put(kind: "vault" | "note" | "template" | "collection" | "preferences", value: unknown) {
    const r = record(value, kind);
    const db = this.database;
    if (kind === "preferences") db.prepare("INSERT INTO preferences VALUES (?,?) ON CONFLICT(vault_id) DO UPDATE SET record=excluded.record").run(String(r.vaultId), JSON.stringify(r));
    else if (kind === "vault") db.prepare("INSERT INTO vaults VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(String(r.id), String(r.createdAt), JSON.stringify(r));
    else {
      const table = kind === "note" ? "notes" : kind === "template" ? "templates" : "collections";
      const old = db.prepare(`SELECT vault_id FROM ${table} WHERE id=?`).get(String(r.id));
      if (old && old.vault_id !== r.vaultId) throw new Error("Cannot move a record between vaults");
      const field = kind === "collection" ? "name" : "updated_at";
      db.prepare(`INSERT INTO ${table}(id,vault_id,${field},record) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET ${field}=excluded.${field},record=excluded.record`).run(String(r.id), String(r.vaultId), String(r[kind === "collection" ? "name" : "updatedAt"]), JSON.stringify(r));
    }
    return r;
  }
  private validateRelationships() {
    const notes = this.rows("notes").map(sqlRecord);
    const noteMap = new Map(notes.map(n => [n.id, n]));
    const collections = new Map(this.rows("collections").map(sqlRecord).map(c => [c.id, c]));
    const templates = new Map(this.rows("templates").map(sqlRecord).map(t => [t.id, t]));
    for (const note of notes) {
      const visited = new Set([note.id]); let parent = note.parentId;
      while (parent !== null) {
        const ancestor = noteMap.get(parent);
        if (!ancestor || ancestor.vaultId !== note.vaultId || visited.has(parent)) throw new Error("Invalid page hierarchy: missing parent, cross-vault parent, or cycle");
        visited.add(parent); parent = ancestor.parentId;
      }
      for (const collectionId of note.collectionIds as string[]) if (collections.get(collectionId)?.vaultId !== note.vaultId) throw new Error("Invalid collection membership");
      // Links may target deleted pages; preserve their permanent identities.
      for (const link of note.links as RecordValue[]) if (noteMap.has(link.targetId) && noteMap.get(link.targetId)!.vaultId !== note.vaultId) throw new Error("Cross-vault page link");
    }
    for (const pref of this.rows("preferences").map(sqlRecord)) for (const templateId of Object.values(pref.defaultTemplateIds as RecordValue)) {
      if (templateId !== null && templates.get(templateId)?.vaultId !== pref.vaultId) throw new Error("Invalid default template");
    }
  }
  checkIntegrity() {
    const db = this.database;
    if (db.prepare("PRAGMA quick_check").get()!.quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity check failed");
    for (const [table, kind] of [["vaults", "vault"], ["notes", "note"], ["templates", "template"], ["collections", "collection"], ["preferences", "preferences"]] as const) {
      for (const row of this.rows(table)) record(sqlRecord(row), kind);
    }
    this.validateRelationships();
  }
  storageInfo(): StorageInfo { this.ensureOpen(); return { directory: this.directory, databasePath: join(this.directory, DATABASE_FILE), isDefault: this.directory === this.defaultDirectory }; }
  private snapshotFile(path: string, verify = true) {
    const temporary = `${path}.partial`;
    try {
      this.database.prepare("VACUUM INTO ?").run(temporary);
      const copy = new DatabaseSync(temporary, { readOnly: true });
      try {
        if (copy.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok") throw new Error("Backup verification failed");
        if (verify && copy.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup relationships are invalid");
      } finally { copy.close(); }
      const descriptor = openSync(temporary, "r");
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      if (existsSync(path)) throw new Error("Backup destination already exists");
      renameSync(temporary, path);
    } catch (error) { if (existsSync(temporary)) unlinkSync(temporary); throw error; }
  }
  createBackup(automatic = false) {
    this.ensureOpen(); this.checkIntegrity();
    const directory = join(this.directory, "backups"); mkdirSync(directory, { recursive: true });
    const name = `${automatic ? "automatic" : "manual"}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite3`;
    this.snapshotFile(join(directory, name));
    if (automatic) for (const file of readdirSync(directory).filter(n => n.startsWith("automatic-") && n.endsWith(".sqlite3")).sort().reverse().slice(10)) unlinkSync(join(directory, file));
    return { name, path: join(directory, name) };
  }
  listBackups() {
    const directory = join(this.directory, "backups");
    return existsSync(directory) ? readdirSync(directory).filter(n => n.endsWith(".sqlite3")).sort().reverse().map(name => ({ name, path: join(directory, name) })) : [];
  }
  restoreBackup(source: string, destination: string) {
    if (!isAbsolute(source) || !isAbsolute(destination)) throw new Error("Choose absolute backup and destination paths");
    mkdirSync(destination, { recursive: true });
    const path = join(destination, DATABASE_FILE);
    if (existsSync(path)) throw new Error("Choose a folder without an existing Hyperion database");
    const input = new DatabaseSync(source, { readOnly: true });
    const temp = `${path}.partial`;
    let published = false;
    try {
      if (input.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok") throw new Error("Invalid backup");
      const version = Number(input.prepare("PRAGMA user_version").get()!.user_version);
      if (version > DATABASE_VERSION) throw new Error("Open this backup with a newer Hyperion version first");
      if (!input.prepare("SELECT name FROM sqlite_master WHERE name='vaults'").get()) throw new Error("Not a Hyperion backup");
      input.prepare("VACUUM INTO ?").run(temp);
      if (existsSync(path)) throw new Error("Restore destination already exists");
      renameSync(temp, path); published = true;
      const restored = new DesktopDatabase({ initialDirectory: destination, defaultDirectory: destination });
      try { restored.verifyPayloads(); } finally { restored.close(); }
      return { directory: destination, databasePath: path, isDefault: false };
    } catch (error) { if (existsSync(temp)) unlinkSync(temp); if (published && existsSync(path)) unlinkSync(path); throw error; }
    finally { input.close(); }
  }
  private validateDocumentAssets(vaultId: string, document: Uint8Array, assets = this.revisionAssets(vaultId)) {
    for (const key of assetReferences(document)) if (!Object.hasOwn(assets, key)) throw new Error(`Missing attachment: ${key}`);
  }
  private verifyPayloads() {
    this.checkIntegrity();
    for (const row of this.rows("blobs")) if (hash(row.data as Uint8Array) !== row.hash) throw new Error("Asset checksum mismatch");
    for (const row of this.database.prepare("SELECT DISTINCT vault_id,document_id FROM editor_updates").all()) {
      const data = this.fullDocument(String(row.vault_id), String(row.document_id))!;
      documentBytes(data.toString("base64")); this.validateDocumentAssets(String(row.vault_id), data);
    }
    for (const row of this.rows("revisions")) {
      const revision = this.decodeRevision(row);
      if (revision.documentVersion !== DOCUMENT_VERSION) throw new Error("Unsupported historical document format");
      record(revision.note, "note");
      if (revision.document) this.validateDocumentAssets(revision.vaultId, documentBytes(revision.document), revision.assets);
    }
  }
  async setStorageDirectory(directory: string): Promise<StorageInfo> {
    this.ensureOpen(); if (!isAbsolute(directory)) throw new Error("The storage directory must be an absolute path");
    const next = resolve(directory); if (next === this.directory) return this.storageInfo();
    mkdirSync(next, { recursive: true });
    if (!existsSync(join(next, DATABASE_FILE))) this.snapshotFile(join(next, DATABASE_FILE));
    const previous = this.database; const oldDirectory = this.directory;
    let nextDatabase: DatabaseSync | undefined;
    try {
      this.directory = next; this.open(); nextDatabase = this.database;
      mkdirSync(this.defaultDirectory, { recursive: true });
      writeFileSync(`${this.locationFile}.partial`, next, "utf8"); renameSync(`${this.locationFile}.partial`, this.locationFile);
      previous.close(); return this.storageInfo();
    } catch (error) { nextDatabase?.close(); this.directory = oldDirectory; this.database = previous; throw error; }
  }

  repositoryExecute(request: RepositoryRequest): unknown {
    this.ensureOpen(); object(request);
    const db = this.database;
    switch (string(request.operation)) {
      case "initialize": return transaction(db, () => {
        if (this.rows("vaults").length) return null;
        this.put("vault", request.vault);
        for (const collection of array(request.collections)) this.put("collection", collection);
        for (const note of array(request.notes)) this.put("note", note);
        this.put("preferences", request.preferences); this.validateRelationships(); return null;
      });
      case "listVaults": return this.rows("vaults").map(sqlRecord).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      case "createVault": return transaction(db, () => { this.put("vault", request.vault); this.put("preferences", request.preferences); this.validateRelationships(); return null; });
      case "updateVault": this.put("vault", request.vault); return null;
      case "deleteVault": return transaction(db, () => { db.prepare("DELETE FROM vaults WHERE id=?").run(id(request.id)); return null; });
      case "listNotes": return this.rows("notes", id(request.vaultId)).map(sqlRecord).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      case "listTemplates": return this.rows("templates", id(request.vaultId)).map(sqlRecord);
      case "listCollections": return this.rows("collections", id(request.vaultId)).map(sqlRecord);
      case "saveNote": case "saveTemplate": case "saveCollection": case "savePreferences": return transaction(db, () => {
        const kind = { saveNote: "note", saveTemplate: "template", saveCollection: "collection", savePreferences: "preferences" }[request.operation] as "note" | "template" | "collection" | "preferences";
        this.put(kind, request[kind]); this.validateRelationships(); return null;
      });
      case "saveNotes": return transaction(db, () => { for (const note of array(request.notes)) this.put("note", note); this.validateRelationships(); return null; });
      case "deleteNote": return transaction(db, () => {
        const noteId = id(request.id); const row = db.prepare("SELECT * FROM notes WHERE id=?").get(noteId);
        if (!row) return null;
        const note = sqlRecord(row); this.captureRevision(String(note.vaultId), noteId, "Before deletion", "deletion");
        for (const child of this.rows("notes", String(note.vaultId)).map(sqlRecord)) if (child.parentId === noteId) this.put("note", { ...child, parentId: note.parentId });
        db.prepare("DELETE FROM notes WHERE id=?").run(noteId);
        this.editorDelete(String(note.vaultId), noteId); this.validateRelationships(); return null;
      });
      case "deleteTemplate": return transaction(db, () => {
        const templateId = id(request.id);
        for (const pref of this.rows("preferences").map(sqlRecord)) {
          const defaults = pref.defaultTemplateIds as RecordValue;
          for (const key of ["note", "journal"]) if (defaults[key] === templateId) defaults[key] = null;
          this.put("preferences", pref);
        }
        const row = db.prepare("SELECT vault_id FROM templates WHERE id=?").get(templateId);
        if (row) this.editorDelete(String(row.vault_id), `template:${templateId}`);
        db.prepare("DELETE FROM templates WHERE id=?").run(templateId); return null;
      });
      case "deleteCollection": return transaction(db, () => {
        const collectionId = id(request.id);
        for (const note of this.rows("notes").map(sqlRecord)) this.put("note", { ...note, collectionIds: (note.collectionIds as string[]).filter(value => value !== collectionId) });
        db.prepare("DELETE FROM collections WHERE id=?").run(collectionId); return null;
      });
      case "getPreferences": { const row = db.prepare("SELECT record FROM preferences WHERE vault_id=?").get(id(request.vaultId)); return row ? sqlRecord(row) : null; }
      case "exportVault": return transaction(db, () => this.exportVault(id(request.vaultId)));
      case "importVault": return this.importVault(request.bundle);
      case "captureRevision": return transaction(db, () => this.captureRevision(id(request.vaultId), id(request.noteId), request.label == null ? null : string(request.label).trim() || null, "manual"));
      case "captureAutomaticRevisions": return transaction(db, () => {
        for (const note of this.rows("notes").map(sqlRecord)) this.captureRevision(String(note.vaultId), String(note.id), null, "automatic");
        db.prepare("DELETE FROM revisions WHERE label IS NULL AND reason='automatic' AND created_at < ? AND id NOT IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY vault_id,note_id ORDER BY created_at DESC,rowid DESC) AS position FROM revisions) WHERE position=1)").run(new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString());
        return null;
      });
      case "listRevisions": return this.listRevisions(id(request.vaultId), request.noteId == null ? undefined : id(request.noteId), false).map(revision => { const summary: Partial<Revision> = { ...revision }; delete summary.document; delete summary.assets; return summary; });
      case "getRevision": return this.getRevision(id(request.vaultId), id(request.revisionId));
      case "restoreRevision": return transaction(db, () => this.restoreRevision(id(request.vaultId), id(request.revisionId), request.asCopy === true));
      default: throw new Error(`Unknown repository operation: ${request.operation}`);
    }
  }
  editorPull(vaultId: string, documentId: string) {
    this.ensureOpen(); id(vaultId); id(documentId);
    // Read and compact under the same write lock. No renderer-side replacement API.
    return transaction(this.database, () => {
      const rows = this.database.prepare("SELECT data FROM editor_updates WHERE vault_id=? AND document_id=? ORDER BY sequence").all(vaultId, documentId);
      if (rows.length > 32) {
        const merged = Y.mergeUpdates(rows.map(row => row.data as Uint8Array));
        this.replaceDocument(vaultId, documentId, merged);
        return [Buffer.from(merged).toString("base64")];
      }
      return rows.map(row => Buffer.from(row.data as Uint8Array).toString("base64"));
    });
  }
  private fullDocument(vaultId: string, documentId: string): Buffer | null {
    const rows = this.database.prepare("SELECT data FROM editor_updates WHERE vault_id=? AND document_id=? ORDER BY sequence").all(vaultId, documentId);
    return rows.length ? Buffer.from(Y.mergeUpdates(rows.map(row => row.data as Uint8Array))) : null;
  }
  editorPush(vaultId: string, documentId: string, data: string) {
    this.ensureOpen(); id(vaultId); id(documentId);
    this.database.prepare("INSERT INTO editor_updates(vault_id,document_id,data) VALUES (?,?,?)").run(vaultId, documentId, documentBytes(data));
  }
  private replaceDocument(vaultId: string, documentId: string, data: Uint8Array) {
    this.editorDelete(vaultId, documentId);
    this.database.prepare("INSERT INTO editor_updates(vault_id,document_id,data) VALUES (?,?,?)").run(vaultId, documentId, data);
  }
  editorDelete(vaultId: string, documentId: string) {
    this.ensureOpen(); this.database.prepare("DELETE FROM editor_updates WHERE vault_id=? AND document_id=?").run(id(vaultId), id(documentId));
  }
  assetGet(vaultId: string, key: string): StoredAsset | null {
    const row = this.database.prepare("SELECT mime_type,data FROM assets JOIN blobs USING(hash) WHERE vault_id=? AND asset_key=?").get(id(vaultId), id(key));
    return row ? { mimeType: String(row.mime_type), data: Buffer.from(row.data as Uint8Array).toString("base64") } : null;
  }
  assetSet(vaultId: string, key: string, mimeType: string, data: string) {
    this.ensureOpen(); id(vaultId); id(key); string(mimeType);
    const decoded = bytes(data); const digest = hash(decoded);
    const old = this.database.prepare("SELECT hash FROM assets WHERE vault_id=? AND asset_key=?").get(vaultId, key);
    if (old && old.hash !== digest) throw new Error("Assets are immutable; use a new asset key for changed content");
    this.database.prepare("INSERT OR IGNORE INTO blobs VALUES (?,?,?)").run(digest, mimeType, decoded);
    this.database.prepare("INSERT INTO assets(vault_id,asset_key,hash) VALUES (?,?,?) ON CONFLICT(vault_id,asset_key) DO UPDATE SET deleted=0").run(vaultId, key, digest);
  }
  assetDelete(vaultId: string, key: string) {
    this.ensureOpen(); this.database.prepare("UPDATE assets SET deleted=1 WHERE vault_id=? AND asset_key=?").run(id(vaultId), id(key));
  }
  assetList(vaultId: string) { return this.database.prepare("SELECT asset_key FROM assets WHERE vault_id=? AND deleted=0 ORDER BY asset_key").all(id(vaultId)).map(row => String(row.asset_key)); }

  private revisionAssets(vaultId: string) {
    // Conservatively retain every asset in the vault, including editor-deleted keys.
    // This supports unknown rich block types without dropping historical attachments.
    return Object.fromEntries(this.rows("assets", vaultId).map(row => [String(row.asset_key), String(row.hash)]));
  }
  private captureRevision(vaultId: string, noteId: string, label: string | null, reason: string): Revision {
    const row = this.database.prepare("SELECT record FROM notes WHERE id=? AND vault_id=?").get(noteId, vaultId);
    if (!row) throw new Error("Page not found");
    const document = this.fullDocument(vaultId, noteId)?.toString("base64") ?? null;
    const note = { ...sqlRecord(row), ...(document ? documentMetadata(documentBytes(document)) : null) };
    const assets = this.revisionAssets(vaultId);
    const contentHash = hash(JSON.stringify({ note: { ...note, updatedAt: undefined }, document, assets }));
    const previousRow = this.database.prepare("SELECT * FROM revisions WHERE vault_id=? AND note_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(vaultId, noteId);
    const previous = previousRow ? this.decodeRevision(previousRow) : undefined;
    if (!label && previous?.contentHash === contentHash) return previous;
    const revision: Revision = { id: randomUUID(), vaultId, noteId, createdAt: now(), label, reason, documentVersion: DOCUMENT_VERSION, note, document, assets, contentHash };
    this.insertRevision(revision); return revision;
  }
  private insertRevision(revision: Revision) {
    if (revision.documentVersion !== DOCUMENT_VERSION) throw new Error("Unsupported historical document format");
    if (revision.document) this.validateDocumentAssets(revision.vaultId, documentBytes(revision.document), revision.assets);
    this.database.prepare("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(revision.id, revision.vaultId, revision.noteId, revision.createdAt, revision.label, revision.reason, revision.documentVersion, JSON.stringify(revision.note), revision.document === null ? null : documentBytes(revision.document), revision.contentHash);
    for (const [key, digest] of Object.entries(revision.assets)) this.database.prepare("INSERT INTO revision_assets VALUES (?,?,?)").run(revision.id, key, digest);
  }
  private decodeRevision(row: Row, withPayload = true): Revision {
    return { id: String(row.id), vaultId: String(row.vault_id), noteId: String(row.note_id), createdAt: String(row.created_at), label: row.label === null ? null : String(row.label), reason: String(row.reason), documentVersion: Number(row.document_version), note: sqlRecord(row), document: row.document ? Buffer.from(row.document as Uint8Array).toString("base64") : null, assets: withPayload ? Object.fromEntries(this.database.prepare("SELECT asset_key,hash FROM revision_assets WHERE revision_id=?").all(String(row.id)).map(asset => [String(asset.asset_key), String(asset.hash)])) : {}, contentHash: String(row.content_hash) };
  }
  private listRevisions(vaultId: string, noteId?: string, withPayload = true) {
    const fields = withPayload ? "*" : "id,vault_id,note_id,created_at,label,reason,document_version,record,NULL AS document,content_hash";
    return (noteId ? this.database.prepare(`SELECT ${fields} FROM revisions WHERE vault_id=? AND note_id=? ORDER BY created_at DESC,rowid DESC`).all(vaultId, noteId) : this.database.prepare(`SELECT ${fields} FROM revisions WHERE vault_id=? ORDER BY created_at DESC,rowid DESC`).all(vaultId)).map(row => this.decodeRevision(row, withPayload));
  }
  private getRevision(vaultId: string, revisionId: string) {
    const row = this.database.prepare("SELECT * FROM revisions WHERE vault_id=? AND id=?").get(vaultId, revisionId);
    if (!row) throw new Error("Version not found");
    return this.decodeRevision(row);
  }
  private restoreRevision(vaultId: string, revisionId: string, asCopy: boolean) {
    const revision = this.getRevision(vaultId, revisionId);
    if (revision.documentVersion !== DOCUMENT_VERSION) throw new Error("Unsupported historical document format");
    const existing = this.database.prepare("SELECT record FROM notes WHERE vault_id=? AND id=?").get(vaultId, revision.noteId);
    if (!asCopy && existing) this.captureRevision(vaultId, revision.noteId, "Before restore", "restore");
    const noteId = asCopy ? randomUUID() : revision.noteId;
    const note: RecordValue = { ...revision.note, id: noteId, vaultId, title: asCopy ? `${revision.note.title} (restored)` : revision.note.title, archived: false, trashed: false, updatedAt: now() };
    if (note.parentId && !this.database.prepare("SELECT id FROM notes WHERE vault_id=? AND id=?").get(vaultId, String(note.parentId))) note.parentId = null;
    note.collectionIds = (note.collectionIds as string[]).filter(key => this.database.prepare("SELECT id FROM collections WHERE vault_id=? AND id=?").get(vaultId, key));
    this.put("note", note);
    if (revision.document) {
      const current = this.fullDocument(vaultId, noteId) ?? Y.encodeStateAsUpdate(new Y.Doc());
      this.replaceDocument(vaultId, noteId, restoreDocument(current, documentBytes(revision.document), asCopy ? String(note.title) : undefined));
    } else this.editorDelete(vaultId, noteId);
    for (const [key, digest] of Object.entries(revision.assets)) this.database.prepare("INSERT INTO assets(vault_id,asset_key,hash) VALUES (?,?,?) ON CONFLICT(vault_id,asset_key) DO UPDATE SET deleted=0").run(vaultId, key, digest);
    this.validateRelationships(); this.captureRevision(vaultId, noteId, "Restored version", "restore");
    return note;
  }
  private exportVault(vaultId: string) {
    const vault = this.database.prepare("SELECT record FROM vaults WHERE id=?").get(vaultId);
    if (!vault) throw new Error("Vault not found");
    const notes = this.rows("notes", vaultId).map(sqlRecord); const templates = this.rows("templates", vaultId).map(sqlRecord);
    const editorDocuments = Object.fromEntries(notes.flatMap(note => { const data = this.fullDocument(vaultId, String(note.id)); return data ? [[String(note.id), data.toString("base64")]] : []; }));
    const templateDocuments = Object.fromEntries(templates.flatMap(template => { const data = this.fullDocument(vaultId, `template:${template.id}`); return data ? [[String(template.id), data.toString("base64")]] : []; }));
    const revisions = this.listRevisions(vaultId);
    const assets = this.rows("assets", vaultId).map(row => ({ key: row.asset_key, hash: row.hash, deleted: Boolean(row.deleted) }));
    const digests = new Set([...assets.map(a => String(a.hash)), ...revisions.flatMap(r => Object.values(r.assets))]);
    const blobs = Object.fromEntries([...digests].map(digest => { const row = this.database.prepare("SELECT * FROM blobs WHERE hash=?").get(digest)!; return [digest, { mimeType: row.mime_type, data: Buffer.from(row.data as Uint8Array).toString("base64") }]; }));
    for (const encoded of [...Object.values(editorDocuments), ...Object.values(templateDocuments)]) this.validateDocumentAssets(vaultId, documentBytes(encoded));
    const payload = { format: "hyperion-vault", version: BUNDLE_VERSION, documentVersion: DOCUMENT_VERSION, exportedAt: now(), vault: sqlRecord(vault), notes, templates, collections: this.rows("collections", vaultId).map(sqlRecord), preferences: sqlRecord(this.database.prepare("SELECT record FROM preferences WHERE vault_id=?").get(vaultId)!), editorDocuments, templateDocuments, revisions, assets, blobs };
    return { ...payload, checksum: hash(JSON.stringify(payload)) };
  }
  private importVault(value: unknown) {
    const bundle = object(value, "vault bundle");
    if (bundle.format !== "hyperion-vault" || !Number.isInteger(bundle.version) || Number(bundle.version) < 1 || Number(bundle.version) > BUNDLE_VERSION) throw new Error("Unsupported vault format");
    const modern = bundle.version === BUNDLE_VERSION;
    if (modern) {
      if (bundle.documentVersion !== DOCUMENT_VERSION) throw new Error("Unsupported document format");
      const { checksum, ...payload } = bundle;
      if (checksum !== hash(JSON.stringify(payload))) throw new Error("Vault checksum mismatch");
    }
    const sourceVault = record(bundle.vault, "vault", !modern); const vaultId = randomUUID();
    const notes = array(bundle.notes).map(v => record(v, "note", !modern));
    const templates = array(bundle.templates ?? []).map(v => record(v, "template", !modern));
    const collections = array(bundle.collections).map(v => record(v, "collection", !modern));
    const preferences = record(bundle.preferences, "preferences", !modern);
    const revisions = array(bundle.revisions ?? []).map(v => object(v));
    const ids = new Map<string, string>();
    for (const r of [...notes, ...templates, ...collections]) {
      if (r.vaultId !== sourceVault.id || ids.has(String(r.id))) throw new Error("Duplicate ID or inconsistent vault membership");
      ids.set(String(r.id), randomUUID());
    }
    for (const r of revisions) if (!ids.has(id(r.noteId))) ids.set(id(r.noteId), randomUUID());
    const mapped = (key: unknown) => key === null ? null : ids.get(id(key)) ?? (() => { throw new Error("Unresolved imported reference"); })();
    const vault = { ...sourceVault, id: vaultId, name: `${sourceVault.name} import`, createdAt: now(), updatedAt: now() };
    // All writes, document decoding, checksums, and relationship checks roll back together.
    return transaction(this.database, () => {
      this.put("vault", vault);
      for (const c of collections) this.put("collection", { ...c, id: mapped(c.id), vaultId });
      for (const n of notes) this.put("note", { ...n, id: mapped(n.id), vaultId, parentId: mapped(n.parentId), collectionIds: (n.collectionIds as string[]).map(mapped), links: (n.links as RecordValue[]).map(link => ({ ...link, targetId: ids.get(String(link.targetId)) ?? link.targetId })) });
      for (const t of templates) this.put("template", { ...t, id: mapped(t.id), vaultId });
      this.put("preferences", { ...preferences, vaultId, defaultTemplateIds: Object.fromEntries(Object.entries(preferences.defaultTemplateIds as RecordValue).map(([key, value]) => [key, mapped(value)])) });
      for (const [digest, raw] of Object.entries(object(bundle.blobs ?? {}))) {
        const blob = object(raw); const data = bytes(blob.data);
        if (hash(data) !== digest) throw new Error("Asset checksum mismatch");
        this.database.prepare("INSERT OR IGNORE INTO blobs VALUES (?,?,?)").run(digest, string(blob.mimeType), data);
      }
      for (const raw of array(bundle.assets ?? [])) { const asset = object(raw); this.database.prepare("INSERT INTO assets VALUES (?,?,?,?)").run(vaultId, id(asset.key), string(asset.hash), asset.deleted ? 1 : 0); }
      for (const [field, prefix, records] of [["editorDocuments", "", notes], ["templateDocuments", "template:", templates]] as const) {
        for (const [key, encoded] of Object.entries(object(bundle[field] ?? {}))) {
          if (!records.some(r => r.id === key)) throw new Error("Document has no owning record");
          this.replaceDocument(vaultId, `${prefix}${mapped(key)}`, documentBytes(remapDocument(string(encoded), ids)));
        }
      }
      for (const r of revisions) {
        const original = record(r.note, "note");
        if (original.id !== r.noteId || original.vaultId !== sourceVault.id || r.vaultId !== sourceVault.id) throw new Error("Invalid history ownership");
        const note = { ...original, id: mapped(original.id), vaultId, parentId: original.parentId ? ids.get(String(original.parentId)) ?? null : null, collectionIds: (original.collectionIds as string[]).flatMap(key => ids.has(key) ? [ids.get(key)!] : []), links: (original.links as RecordValue[]).map(link => ({ ...link, targetId: ids.get(String(link.targetId)) ?? link.targetId })) };
        const revision: Revision = { id: randomUUID(), vaultId, noteId: String(mapped(r.noteId)), createdAt: string(r.createdAt), label: r.label === null ? null : string(r.label), reason: string(r.reason), documentVersion: Number(r.documentVersion), note, document: r.document === null ? null : remapDocument(string(r.document), ids), assets: object(r.assets) as Record<string,string>, contentHash: "" };
        if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error("Invalid revision date");
        revision.contentHash = hash(JSON.stringify({ note: { ...note, updatedAt: undefined }, document: revision.document, assets: revision.assets }));
        this.insertRevision(revision);
      }
      this.validateRelationships();
      if (modern) for (const row of this.database.prepare("SELECT DISTINCT document_id FROM editor_updates WHERE vault_id=?").all(vaultId)) this.validateDocumentAssets(vaultId, this.fullDocument(vaultId, String(row.document_id))!);
      return { vault, warnings: modern ? [] : ["This legacy export does not contain attachments. Images and files absent from the export cannot be recovered."] };
    });
  }
  close() { if (!this.closed) { this.database.close(); this.closed = true; } }
}
