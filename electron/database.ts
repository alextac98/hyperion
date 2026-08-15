import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { backup, DatabaseSync, type StatementResultingChanges } from "node:sqlite";

const DATABASE_FILE = "hyperion.sqlite3";

export type RepositoryRequest = {
  operation: string;
  [key: string]: unknown;
};

export type StorageInfo = {
  directory: string;
  databasePath: string;
  isDefault: boolean;
};

export type StoredAsset = {
  mimeType: string;
  data: string;
};

export type DesktopDatabaseOptions = {
  defaultDirectory?: string;
  locationFile?: string;
  initialDirectory?: string;
};

type JsonRecord = Record<string, unknown>;
type RecordRow = { record: string };
type DataRow = { data: Uint8Array };

function required(request: RepositoryRequest, key: string) {
  if (!(key in request)) throw new Error(`Missing repository request field: ${key}`);
  return request[key];
}

function requiredString(request: RepositoryRequest, key: string) {
  const value = required(request, key);
  if (typeof value !== "string") throw new Error(`Repository request field ${key} must be a string`);
  return value;
}

function requiredRecord(request: RepositoryRequest, key: string): JsonRecord {
  const value = required(request, key);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Repository request field ${key} must be an object`);
  }
  return value as JsonRecord;
}

function requiredRecords(request: RepositoryRequest, key: string): JsonRecord[] {
  const value = required(request, key);
  if (!Array.isArray(value)) throw new Error(`Repository request field ${key} must be an array`);
  return value.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Repository request field ${key} must contain objects`);
    }
    return record as JsonRecord;
  });
}

function recordString(record: JsonRecord, key: string) {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Record field ${key} must be a string`);
  return value;
}

function decodeRecords(rows: RecordRow[]) {
  return rows.map(({ record }) => JSON.parse(record) as unknown);
}

function runTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function saveVault(database: DatabaseSync, vault: JsonRecord): StatementResultingChanges {
  return database.prepare(`
    INSERT INTO vaults(id, created_at, record) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, record = excluded.record
  `).run(recordString(vault, "id"), recordString(vault, "createdAt"), JSON.stringify(vault));
}

function saveNote(database: DatabaseSync, note: JsonRecord): StatementResultingChanges {
  return database.prepare(`
    INSERT INTO notes(id, vault_id, updated_at, record) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vault_id = excluded.vault_id,
      updated_at = excluded.updated_at,
      record = excluded.record
  `).run(
    recordString(note, "id"),
    recordString(note, "vaultId"),
    recordString(note, "updatedAt"),
    JSON.stringify(note),
  );
}

function saveCollection(database: DatabaseSync, collection: JsonRecord): StatementResultingChanges {
  return database.prepare(`
    INSERT INTO collections(id, vault_id, name, record) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vault_id = excluded.vault_id,
      name = excluded.name,
      record = excluded.record
  `).run(
    recordString(collection, "id"),
    recordString(collection, "vaultId"),
    recordString(collection, "name"),
    JSON.stringify(collection),
  );
}

function savePreferences(database: DatabaseSync, preferences: JsonRecord): StatementResultingChanges {
  return database.prepare(`
    INSERT INTO preferences(vault_id, record) VALUES (?, ?)
    ON CONFLICT(vault_id) DO UPDATE SET record = excluded.record
  `).run(recordString(preferences, "vaultId"), JSON.stringify(preferences));
}

function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, DATABASE_FILE));
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS vaults (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_vault_updated ON notes(vault_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      name TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collections_vault_name ON collections(vault_id, name);
    CREATE TABLE IF NOT EXISTS preferences (
      vault_id TEXT PRIMARY KEY,
      record TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS editor_updates (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS editor_document
      ON editor_updates(vault_id, document_id, sequence);
    CREATE TABLE IF NOT EXISTS assets (
      vault_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY(vault_id, asset_key)
    );
  `);
  return database;
}

export class DesktopDatabase {
  readonly defaultDirectory: string;
  readonly locationFile: string;
  private directory: string;
  private database: DatabaseSync;
  private closed = false;

  constructor(options: DesktopDatabaseOptions = {}) {
    this.defaultDirectory = resolve(options.defaultDirectory ?? join(homedir(), ".config", "hyperion"));
    this.locationFile = resolve(options.locationFile ?? join(this.defaultDirectory, "storage-location"));
    const rememberedDirectory = options.initialDirectory ?? this.readRememberedDirectory();
    this.directory = resolve(rememberedDirectory || this.defaultDirectory);
    this.database = openDatabase(this.directory);
  }

  private readRememberedDirectory() {
    try {
      return readFileSync(this.locationFile, "utf8").trim();
    } catch {
      return "";
    }
  }

  private ensureOpen() {
    if (this.closed) throw new Error("The Hyperion database is closed");
  }

  storageInfo(): StorageInfo {
    this.ensureOpen();
    return {
      directory: this.directory,
      databasePath: join(this.directory, DATABASE_FILE),
      isDefault: this.directory === this.defaultDirectory,
    };
  }

  async setStorageDirectory(directory: string): Promise<StorageInfo> {
    this.ensureOpen();
    if (!directory.trim() || !isAbsolute(directory)) {
      throw new Error("The storage directory must be an absolute path");
    }

    const nextDirectory = resolve(directory);
    if (nextDirectory === this.directory) return this.storageInfo();

    mkdirSync(nextDirectory, { recursive: true });
    const nextDatabasePath = join(nextDirectory, DATABASE_FILE);
    if (!existsSync(nextDatabasePath)) {
      await backup(this.database, nextDatabasePath);
    }

    const previousDirectory = this.directory;
    this.database.close();
    let nextDatabase: DatabaseSync | undefined;
    try {
      nextDatabase = openDatabase(nextDirectory);
      mkdirSync(this.defaultDirectory, { recursive: true });
      writeFileSync(this.locationFile, nextDirectory, "utf8");
      this.database = nextDatabase;
      this.directory = nextDirectory;
      return this.storageInfo();
    } catch (error) {
      nextDatabase?.close();
      this.database = openDatabase(previousDirectory);
      throw error;
    }
  }

  repositoryExecute(request: RepositoryRequest): unknown {
    this.ensureOpen();
    switch (requiredString(request, "operation")) {
      case "initialize": {
        const row = this.database.prepare("SELECT COUNT(*) AS count FROM vaults").get() as { count: number };
        if (Number(row.count) === 0) {
          runTransaction(this.database, () => {
            saveVault(this.database, requiredRecord(request, "vault"));
            for (const note of requiredRecords(request, "notes")) saveNote(this.database, note);
            for (const collection of requiredRecords(request, "collections")) {
              saveCollection(this.database, collection);
            }
            savePreferences(this.database, requiredRecord(request, "preferences"));
          });
        }
        return null;
      }
      case "listVaults":
        return decodeRecords(this.database.prepare("SELECT record FROM vaults ORDER BY created_at").all() as RecordRow[]);
      case "createVault":
        return runTransaction(this.database, () => {
          saveVault(this.database, requiredRecord(request, "vault"));
          savePreferences(this.database, requiredRecord(request, "preferences"));
          return null;
        });
      case "updateVault":
        saveVault(this.database, requiredRecord(request, "vault"));
        return null;
      case "deleteVault": {
        const id = requiredString(request, "id");
        return runTransaction(this.database, () => {
          for (const [table, column] of [
            ["vaults", "id"],
            ["notes", "vault_id"],
            ["collections", "vault_id"],
            ["preferences", "vault_id"],
            ["editor_updates", "vault_id"],
            ["assets", "vault_id"],
          ] as const) {
            this.database.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id);
          }
          return null;
        });
      }
      case "listNotes":
        return decodeRecords(this.database.prepare(
          "SELECT record FROM notes WHERE vault_id = ? ORDER BY updated_at DESC",
        ).all(requiredString(request, "vaultId")) as RecordRow[]);
      case "saveNote":
        saveNote(this.database, requiredRecord(request, "note"));
        return null;
      case "deleteNote":
        this.database.prepare("DELETE FROM notes WHERE id = ?").run(requiredString(request, "id"));
        return null;
      case "listCollections":
        return decodeRecords(this.database.prepare(
          "SELECT record FROM collections WHERE vault_id = ? ORDER BY name",
        ).all(requiredString(request, "vaultId")) as RecordRow[]);
      case "saveCollection":
        saveCollection(this.database, requiredRecord(request, "collection"));
        return null;
      case "deleteCollection": {
        const id = requiredString(request, "id");
        return runTransaction(this.database, () => {
          this.database.prepare("DELETE FROM collections WHERE id = ?").run(id);
          const rows = this.database.prepare("SELECT record FROM notes").all() as RecordRow[];
          for (const row of rows) {
            const note = JSON.parse(row.record) as JsonRecord;
            const collectionIds = Array.isArray(note.collectionIds) ? note.collectionIds : [];
            const remaining = collectionIds.filter((collectionId) => collectionId !== id);
            if (remaining.length !== collectionIds.length) {
              saveNote(this.database, { ...note, collectionIds: remaining });
            }
          }
          return null;
        });
      }
      case "getPreferences": {
        const row = this.database.prepare(
          "SELECT record FROM preferences WHERE vault_id = ?",
        ).get(requiredString(request, "vaultId")) as RecordRow | undefined;
        return row ? JSON.parse(row.record) as unknown : null;
      }
      case "savePreferences":
        savePreferences(this.database, requiredRecord(request, "preferences"));
        return null;
      default:
        throw new Error(`Unknown repository operation: ${request.operation}`);
    }
  }

  editorPull(vaultId: string, documentId: string) {
    this.ensureOpen();
    const rows = this.database.prepare(`
      SELECT data FROM editor_updates
      WHERE vault_id = ? AND document_id = ?
      ORDER BY sequence
    `).all(vaultId, documentId) as DataRow[];
    return rows.map(({ data }) => Buffer.from(data).toString("base64"));
  }

  editorPush(vaultId: string, documentId: string, data: string) {
    this.ensureOpen();
    this.database.prepare(`
      INSERT INTO editor_updates(vault_id, document_id, data) VALUES (?, ?, ?)
    `).run(vaultId, documentId, Buffer.from(data, "base64"));
  }

  editorReplace(vaultId: string, documentId: string, data: string) {
    this.ensureOpen();
    runTransaction(this.database, () => {
      this.database.prepare(
        "DELETE FROM editor_updates WHERE vault_id = ? AND document_id = ?",
      ).run(vaultId, documentId);
      this.editorPush(vaultId, documentId, data);
    });
  }

  editorDelete(vaultId: string, documentId: string) {
    this.ensureOpen();
    this.database.prepare(
      "DELETE FROM editor_updates WHERE vault_id = ? AND document_id = ?",
    ).run(vaultId, documentId);
  }

  assetGet(vaultId: string, key: string): StoredAsset | null {
    this.ensureOpen();
    const row = this.database.prepare(`
      SELECT mime_type AS mimeType, data FROM assets WHERE vault_id = ? AND asset_key = ?
    `).get(vaultId, key) as { mimeType: string; data: Uint8Array } | undefined;
    return row ? { mimeType: row.mimeType, data: Buffer.from(row.data).toString("base64") } : null;
  }

  assetSet(vaultId: string, key: string, mimeType: string, data: string) {
    this.ensureOpen();
    this.database.prepare(`
      INSERT INTO assets(vault_id, asset_key, mime_type, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(vault_id, asset_key) DO UPDATE SET
        mime_type = excluded.mime_type,
        data = excluded.data
    `).run(vaultId, key, mimeType, Buffer.from(data, "base64"));
  }

  assetDelete(vaultId: string, key: string) {
    this.ensureOpen();
    this.database.prepare("DELETE FROM assets WHERE vault_id = ? AND asset_key = ?").run(vaultId, key);
  }

  assetList(vaultId: string) {
    this.ensureOpen();
    return (this.database.prepare(
      "SELECT asset_key AS assetKey FROM assets WHERE vault_id = ? ORDER BY asset_key",
    ).all(vaultId) as { assetKey: string }[]).map(({ assetKey }) => assetKey);
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}
