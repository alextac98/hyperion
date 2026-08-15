import {
  type CollectionRecord,
  DEFAULT_PREFERENCES,
  type KnowledgeRepository,
  makeDefaultVault,
  makeSeedCollections,
  makeSeedNotes,
  normalizePageIcon,
  type NoteRecord,
  type VaultPreferences,
  type VaultRecord,
} from "../../lib/local-database";
import type { HyperionDesktopApi, RepositoryRequest } from "../desktop-api";

function timestamp() {
  return new Date().toISOString();
}

export class ElectronKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly desktop: HyperionDesktopApi) {}

  private execute<T>(request: RepositoryRequest) {
    return this.desktop.repositoryExecute<T>(request);
  }

  async initialize() {
    const vault = makeDefaultVault();
    await this.execute<void>({
      operation: "initialize",
      vault,
      notes: makeSeedNotes(),
      collections: makeSeedCollections(),
      preferences: { vaultId: vault.id, ...DEFAULT_PREFERENCES },
    });
  }

  listVaults() {
    return this.execute<VaultRecord[]>({ operation: "listVaults" });
  }

  async createVault(name: string) {
    const now = timestamp();
    const vault: VaultRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled vault",
      description: "Personal knowledge base",
      color: ["#6f63d9", "#4b8f8c", "#b77a42", "#b45f73"][Math.floor(Math.random() * 4)],
      createdAt: now,
      updatedAt: now,
    };
    await this.execute<void>({
      operation: "createVault",
      vault,
      preferences: { vaultId: vault.id, ...DEFAULT_PREFERENCES },
    });
    return vault;
  }

  updateVault(vault: VaultRecord) {
    return this.execute<void>({ operation: "updateVault", vault: { ...vault, updatedAt: timestamp() } });
  }

  deleteVault(id: string) {
    return this.execute<void>({ operation: "deleteVault", id });
  }

  async listNotes(vaultId: string) {
    const notes = await this.execute<NoteRecord[]>({ operation: "listNotes", vaultId });
    return notes.map((note) => ({
      ...note,
      icon: normalizePageIcon(note.icon),
      aliases: note.aliases ?? [],
      links: note.links ?? [],
      parentId: note.parentId ?? null,
      sortOrder: Number.isFinite(note.sortOrder) ? note.sortOrder : 0,
    }));
  }

  saveNote(note: NoteRecord) {
    return this.execute<void>({ operation: "saveNote", note });
  }

  deleteNote(id: string) {
    return this.execute<void>({ operation: "deleteNote", id });
  }

  listCollections(vaultId: string) {
    return this.execute<CollectionRecord[]>({ operation: "listCollections", vaultId });
  }

  saveCollection(collection: CollectionRecord) {
    return this.execute<void>({ operation: "saveCollection", collection });
  }

  deleteCollection(id: string) {
    return this.execute<void>({ operation: "deleteCollection", id });
  }

  async getPreferences(vaultId: string) {
    return (await this.execute<VaultPreferences | null>({ operation: "getPreferences", vaultId }))
      ?? { vaultId, ...DEFAULT_PREFERENCES };
  }

  savePreferences(preferences: VaultPreferences) {
    return this.execute<void>({ operation: "savePreferences", preferences });
  }
}
