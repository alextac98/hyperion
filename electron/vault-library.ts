import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DATABASE_FILE,
  DesktopDatabase,
  type RepositoryRequest,
  type StorageInfo,
} from "./database.js";
import { id, object, record, string, type RecordValue } from "./data-format.js";

type Entry = { vault: RecordValue; directory: string };
type Registry = { version: 1; activeVaultId: string | null; entries: Entry[] };
type Connection = { database: DesktopDatabase; release: () => void };
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function folderName(name: string) {
  const candidate =
    Array.from(name.normalize("NFC"), (char) =>
      char.charCodeAt(0) < 32 ? "-" : char,
    )
      .join("")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 80) || "Hyperion";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate)
    ? `Vault ${candidate}`
    : candidate;
}

function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.partial`;
  try {
    const fd = openSync(temporary, "wx");
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

/** Prevent two desktop/development instances from editing the same vault. */
function lock(directory: string) {
  const path = join(directory, ".hyperion.lock");
  const token = randomUUID();
  if (existsSync(path)) {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "This vault is open in another Hyperion window. Close it there and try again.",
      );
    rmSync(path);
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid, token }), {
    flag: "wx",
  });
  return () => {
    if (
      existsSync(path) &&
      JSON.parse(readFileSync(path, "utf8")).token === token
    )
      rmSync(path);
  };
}

/** The registry is app state; every entry is a portable, single-vault database. */
export class VaultLibrary {
  readonly defaultDirectory: string;
  readonly vaultsDirectory: string;
  private readonly registryPath: string;
  private registry: Registry = { version: 1, activeVaultId: null, entries: [] };
  private connections = new Map<string, Connection>();
  private startupError = "";

  constructor(
    options: { defaultDirectory?: string; followLegacyLocation?: boolean } = {},
  ) {
    this.defaultDirectory = resolve(
      options.defaultDirectory ?? join(homedir(), ".config", "hyperion"),
    );
    this.vaultsDirectory = join(this.defaultDirectory, "vaults");
    this.registryPath = join(this.defaultDirectory, "vault-library.json");
    mkdirSync(this.defaultDirectory, { recursive: true });
    if (existsSync(this.registryPath)) {
      const saved = object(
        JSON.parse(readFileSync(this.registryPath, "utf8")),
        "vault library",
      );
      if (saved.version !== 1 || !Array.isArray(saved.entries))
        throw new Error("Unsupported vault library format");
      this.registry = {
        version: 1,
        activeVaultId:
          saved.activeVaultId === null ? null : id(saved.activeVaultId),
        entries: saved.entries.map((value) => {
          const entry = object(value);
          if (!isAbsolute(string(entry.directory)))
            throw new Error("Invalid vault location");
          return {
            vault: record(entry.vault, "vault"),
            directory: resolve(string(entry.directory)),
          };
        }),
      };
    } else {
      let legacy = this.defaultDirectory;
      const pointer = join(this.defaultDirectory, "storage-location");
      if (options.followLegacyLocation !== false && existsSync(pointer))
        legacy = readFileSync(pointer, "utf8").trim() || legacy;
      if (existsSync(join(legacy, DATABASE_FILE)))
        this.migrateLegacy(resolve(legacy));
      else if (legacy !== this.defaultDirectory) {
        this.startupError = `Your previous vault folder was not found at ${legacy}. Reconnect the drive or choose Open existing vault to locate it.`;
      }
      // Retain the legacy pointer when its drive is unavailable on first upgrade.
      if (!this.startupError) this.save(this.registry);
    }
    if (this.registry.activeVaultId) {
      try {
        this.selectVault(this.registry.activeVaultId);
      } catch (error) {
        this.startupError = errorText(error);
      }
    }
  }

  private save(registry: Registry) {
    atomicJson(this.registryPath, registry);
    this.registry = registry;
  }
  private entry(vaultId: string) {
    const entry = this.registry.entries.find(
      (entry) => entry.vault.id === vaultId,
    );
    if (!entry)
      throw new Error(
        "This vault is not open. Choose Open existing vault to locate it.",
      );
    return entry;
  }
  private connect(directory: string): Connection {
    if (!existsSync(join(directory, DATABASE_FILE)))
      throw new Error(
        `Vault not found at ${directory}. Reconnect the drive or use Open existing vault to locate it.`,
      );
    // Reject arbitrary SQLite files before opening/migrating them.
    const input = new DatabaseSync(join(directory, DATABASE_FILE), {
      readOnly: true,
    });
    try {
      if (
        !input
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='vaults'",
          )
          .get()
      )
        throw new Error("This folder does not contain a Hyperion vault.");
    } finally {
      input.close();
    }
    const release = lock(directory);
    try {
      const database = new DesktopDatabase({
        defaultDirectory: directory,
        initialDirectory: directory,
      });
      try {
        database.verifyPayloads();
      } catch (error) {
        database.close();
        throw error;
      }
      return { database, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  private database(
    vaultId = this.registry.activeVaultId ?? "",
  ): DesktopDatabase {
    const entry = this.entry(vaultId);
    let connection = this.connections.get(vaultId);
    if (!connection) {
      connection = this.connect(entry.directory);
      const vaults = connection.database.repositoryExecute({
        operation: "listVaults",
      }) as RecordValue[];
      if (vaults.length !== 1 || vaults[0].id !== vaultId) {
        connection.database.close();
        connection.release();
        throw new Error(
          "The folder no longer contains this vault. Use Open existing vault to inspect it.",
        );
      }
      this.connections.set(vaultId, connection);
    }
    return connection.database;
  }
  private disconnect(vaultId: string) {
    const connection = this.connections.get(vaultId);
    if (connection) {
      connection.database.close();
      connection.release();
      this.connections.delete(vaultId);
    }
  }
  private availableFolder(name: string) {
    mkdirSync(this.vaultsDirectory, { recursive: true });
    const base = join(this.vaultsDirectory, folderName(name));
    let directory = base;
    for (let index = 2; existsSync(directory); index++)
      directory = `${base} ${index}`;
    return directory;
  }
  private claim(directory: string) {
    if (!isAbsolute(directory))
      throw new Error("Choose an absolute folder path.");
    if (existsSync(directory) && readdirSync(directory).length)
      throw new Error(
        "Choose an empty folder. To use a vault already here, choose Open existing vault.",
      );
    mkdirSync(directory, { recursive: true });
    return realpathSync(directory);
  }
  private add(entry: Entry, connection: Connection) {
    if (this.registry.entries.some((item) => item.vault.id === entry.vault.id))
      throw new Error(
        "This vault is already in your vault list. Close it before opening a different copy, or import a backup as a new vault.",
      );
    this.save({
      ...this.registry,
      activeVaultId: String(entry.vault.id),
      entries: [...this.registry.entries, entry],
    });
    this.connections.set(String(entry.vault.id), connection);
    this.startupError = "";
  }
  private migrateLegacy(directory: string) {
    const source = this.connect(directory);
    try {
      this.registerLegacy(source.database, directory);
    } finally {
      source.database.close();
      source.release();
    }
  }
  private registerLegacy(source: DesktopDatabase, directory: string) {
    const created: string[] = [];
    try {
      const vaults = source.repositoryExecute({
        operation: "listVaults",
      }) as RecordValue[];
      if (!vaults.length) return;
      if (
        vaults.some((vault) =>
          this.registry.entries.some((entry) => entry.vault.id === vault.id),
        )
      ) {
        throw new Error(
          "A vault from this database is already open. Close it in the vault menu before opening this copy.",
        );
      }
      let entries: Entry[];
      if (vaults.length === 1) entries = [{ vault: vaults[0], directory }];
      else {
        source.createBackup();
        entries = vaults.map((vault) => {
          const destination = this.availableFolder(String(vault.name));
          mkdirSync(destination);
          created.push(destination);
          source.snapshotTo(destination, String(vault.id));
          const copy = new DesktopDatabase({
            defaultDirectory: destination,
            initialDirectory: destination,
          });
          try {
            copy.createBackup();
          } finally {
            copy.close();
          }
          return { vault, directory: destination };
        });
      }
      // Publish only once every split has been verified. The shared source and
      // its historical backups remain untouched for recovery.
      this.save({
        ...this.registry,
        activeVaultId: String(entries[0].vault.id),
        entries: [...this.registry.entries, ...entries],
      });
    } catch (error) {
      for (const path of created)
        rmSync(path, { recursive: true, force: true });
      throw error;
    }
  }

  setupInfo() {
    return {
      defaultDirectory: this.vaultsDirectory,
      activeVaultId: this.registry.activeVaultId,
      error: this.startupError,
    };
  }
  selectVault(vaultId: string) {
    const database = this.database(id(vaultId));
    const vault = (
      database.repositoryExecute({ operation: "listVaults" }) as RecordValue[]
    )[0];
    this.save({
      ...this.registry,
      activeVaultId: vaultId,
      entries: this.registry.entries.map((entry) =>
        entry.vault.id === vaultId ? { ...entry, vault } : entry,
      ),
    });
    this.startupError = "";
    return database.storageInfo();
  }
  openVault(directory: string) {
    if (!isAbsolute(directory) || !existsSync(directory))
      throw new Error("Choose an existing vault folder.");
    directory = realpathSync(directory);
    const known = this.registry.entries.find(
      (entry) => realpathOrResolved(entry.directory) === directory,
    );
    if (known) {
      this.selectVault(String(known.vault.id));
      return known.vault;
    }
    const connection = this.connect(directory);
    try {
      const vaults = connection.database.repositoryExecute({
        operation: "listVaults",
      }) as RecordValue[];
      if (!vaults.length)
        throw new Error(
          "This folder does not contain a vault yet. Choose Create vault to start a new one.",
        );
      if (vaults.length > 1) {
        this.registerLegacy(connection.database, directory);
        connection.database.close();
        connection.release();
        return vaults[0];
      }
      const vault = vaults[0];
      const previous = this.registry.entries.find(
        (entry) => entry.vault.id === vault.id,
      );
      if (previous && !existsSync(join(previous.directory, DATABASE_FILE))) {
        this.save({
          ...this.registry,
          activeVaultId: String(vault.id),
          entries: this.registry.entries.map((entry) =>
            entry.vault.id === vault.id ? { vault, directory } : entry,
          ),
        });
        this.disconnect(String(vault.id));
        this.connections.set(String(vault.id), connection);
      } else this.add({ vault, directory }, connection);
      return vault;
    } catch (error) {
      connection.database.close();
      connection.release();
      throw error;
    }
  }
  private create(request: RepositoryRequest) {
    const vault = record(request.vault, "vault");
    if (this.registry.entries.some((entry) => entry.vault.id === vault.id))
      throw new Error("Vault already exists");
    const directory = this.claim(
      request.directory
        ? string(request.directory)
        : this.availableFolder(String(vault.name)),
    );
    const release = lock(directory);
    let database: DesktopDatabase | undefined;
    try {
      database = new DesktopDatabase({
        defaultDirectory: directory,
        initialDirectory: directory,
      });
      database.repositoryExecute({
        ...request,
        operation: "initialize",
        notes: request.notes ?? [],
        collections: request.collections ?? [],
      });
      for (const [documentId, data] of Object.entries(
        object(request.documents ?? {}),
      ))
        database.editorPush(String(vault.id), documentId, string(data));
      database.verifyPayloads();
      database.createBackup(true);
      this.add({ vault, directory }, { database, release });
      return vault;
    } catch (error) {
      database?.close();
      release();
      rmSync(join(directory, DATABASE_FILE), { force: true });
      rmSync(join(directory, "backups"), { recursive: true, force: true });
      throw error;
    }
  }
  private importVault(bundle: unknown) {
    const directory = this.claim(this.availableFolder("Imported vault"));
    const release = lock(directory);
    let database: DesktopDatabase | undefined;
    try {
      database = new DesktopDatabase({
        defaultDirectory: directory,
        initialDirectory: directory,
      });
      const result = database.repositoryExecute({
        operation: "importVault",
        bundle,
      }) as { vault: RecordValue; warnings: string[] };
      database.verifyPayloads();
      database.createBackup(true);
      this.add({ vault: result.vault, directory }, { database, release });
      return result;
    } catch (error) {
      database?.close();
      release();
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
  closeVault(vaultId: string) {
    this.entry(vaultId);
    const entries = this.registry.entries.filter(
      (entry) => entry.vault.id !== vaultId,
    );
    this.save({
      ...this.registry,
      entries,
      activeVaultId:
        this.registry.activeVaultId === vaultId
          ? entries[0]
            ? String(entries[0].vault.id)
            : null
          : this.registry.activeVaultId,
    });
    this.disconnect(vaultId);
  }
  moveVault(destination: string): StorageInfo & { warning?: string } {
    const vaultId = this.registry.activeVaultId!;
    const source = this.database(vaultId);
    const entry = this.entry(vaultId);
    const oldDirectory = realpathSync(entry.directory);
    if (!isAbsolute(destination))
      throw new Error("Choose an absolute folder path.");
    const next = realpathOrResolved(destination);
    if (next === oldDirectory) return source.storageInfo();
    const relationship = relative(oldDirectory, next);
    if (
      !relationship.startsWith(`..${sep}`) &&
      relationship !== ".." &&
      !isAbsolute(relationship)
    )
      throw new Error("Choose a folder outside the current vault.");
    const directory = this.claim(next);
    const release = lock(directory);
    let database: DesktopDatabase | undefined;
    try {
      source.snapshotTo(directory);
      if (existsSync(join(oldDirectory, "backups")))
        cpSync(join(oldDirectory, "backups"), join(directory, "backups"), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      database = new DesktopDatabase({
        defaultDirectory: directory,
        initialDirectory: directory,
      });
      database.verifyPayloads();
      this.save({
        ...this.registry,
        entries: this.registry.entries.map((item) =>
          item.vault.id === vaultId ? { ...item, directory } : item,
        ),
      });
    } catch (error) {
      database?.close();
      release();
      rmSync(join(directory, DATABASE_FILE), { force: true });
      rmSync(join(directory, "backups"), { recursive: true, force: true });
      throw error;
    }
    this.disconnect(vaultId);
    this.connections.set(vaultId, { database, release });
    let warning: string | undefined;
    try {
      for (const name of [
        DATABASE_FILE,
        `${DATABASE_FILE}-wal`,
        `${DATABASE_FILE}-shm`,
        "backups",
      ])
        rmSync(join(oldDirectory, name), { recursive: true, force: true });
    } catch {
      warning = `Your vault is now saved at ${directory}. Some old files remain at ${oldDirectory}; you can remove them after checking the new location.`;
    }
    return { ...database.storageInfo(), ...(warning ? { warning } : {}) };
  }
  repositoryExecute(request: RepositoryRequest): unknown {
    object(request);
    switch (request.operation) {
      case "initialize":
        return null;
      case "vaultSetup":
        return this.setupInfo();
      case "suggestVaultDirectory":
        return this.availableFolder(string(request.name));
      case "selectVault":
        return this.selectVault(id(request.vaultId));
      case "closeVault":
        return this.closeVault(id(request.vaultId));
      case "listVaults":
        return this.registry.entries.map((entry) => entry.vault);
      case "createVault":
        return this.create(request);
      case "importVault":
        return this.importVault(request.bundle);
      case "captureAutomaticRevisions":
        return this.registry.activeVaultId &&
          this.connections.has(this.registry.activeVaultId)
          ? this.database().repositoryExecute(request)
          : null;
      case "deleteVault": {
        const vaultId = id(request.id);
        const database = this.database(vaultId);
        database.repositoryExecute(request);
        this.closeVault(vaultId);
        return null;
      }
    }
    const value =
      request.note ??
      request.template ??
      request.collection ??
      request.preferences ??
      request.vault;
    const vaultId =
      request.vaultId ??
      (value && typeof value === "object"
        ? ((value as RecordValue).vaultId ??
          (request.operation === "updateVault"
            ? (value as RecordValue).id
            : undefined))
        : undefined);
    const database = this.database(
      vaultId === undefined ? undefined : id(vaultId),
    );
    const result = database.repositoryExecute(request);
    if (request.operation === "updateVault") {
      const vault = record(request.vault, "vault");
      this.save({
        ...this.registry,
        entries: this.registry.entries.map((entry) =>
          entry.vault.id === vault.id ? { ...entry, vault } : entry,
        ),
      });
    }
    return result;
  }
  storageInfo() {
    return this.registry.activeVaultId
      ? this.database().storageInfo()
      : { directory: this.vaultsDirectory, databasePath: "", isDefault: true };
  }
  createBackup(automatic = false) {
    return this.database().createBackup(automatic);
  }
  listBackups() {
    return this.database().listBackups();
  }
  restoreBackup(source: string, destination: string) {
    return this.database().restoreBackup(source, destination);
  }
  editorPull(vaultId: string, documentId: string) {
    return this.database(vaultId).editorPull(vaultId, documentId);
  }
  editorPush(vaultId: string, documentId: string, data: string) {
    return this.database(vaultId).editorPush(vaultId, documentId, data);
  }
  editorDelete(vaultId: string, documentId: string) {
    return this.database(vaultId).editorDelete(vaultId, documentId);
  }
  assetGet(vaultId: string, key: string) {
    return this.database(vaultId).assetGet(vaultId, key);
  }
  assetSet(vaultId: string, key: string, mimeType: string, data: string) {
    return this.database(vaultId).assetSet(vaultId, key, mimeType, data);
  }
  assetDelete(vaultId: string, key: string) {
    return this.database(vaultId).assetDelete(vaultId, key);
  }
  assetList(vaultId: string) {
    return this.database(vaultId).assetList(vaultId);
  }
  close() {
    for (const vaultId of this.connections.keys()) this.disconnect(vaultId);
  }
}
function realpathOrResolved(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path
    ? resolve(path)
    : join(realpathOrResolved(parent), basename(path));
}
