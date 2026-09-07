import { saves } from "../../lib/save-coordinator";
import {
  type CollectionRecord,
  DEFAULT_PREFERENCES,
  type KnowledgeRepository,
  makeDefaultVault,
  makeSeedCollections,
  makeSeedNotes,
  normalizeVaultPreferences,
  type NoteRecord,
  type TemplateRecord,
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
    return /^(list|get)/.test(request.operation) ? this.desktop.repositoryExecute<T>(request) : saves.track(() => this.desktop.repositoryExecute<T>(request));
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

  listNotes(vaultId: string) {
    return this.execute<NoteRecord[]>({ operation: "listNotes", vaultId });
  }

  saveNote(note: NoteRecord) {
    return this.execute<void>({ operation: "saveNote", note });
  }

  deleteNote(id: string) {
    return this.execute<void>({ operation: "deleteNote", id });
  }

  listTemplates(vaultId: string) {
    return this.execute<TemplateRecord[]>({ operation: "listTemplates", vaultId });
  }

  saveTemplate(template: TemplateRecord) {
    return this.execute<void>({ operation: "saveTemplate", template });
  }

  deleteTemplate(id: string) {
    return this.execute<void>({ operation: "deleteTemplate", id });
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
    return normalizeVaultPreferences(
      vaultId,
      await this.execute<VaultPreferences | null>({ operation: "getPreferences", vaultId }),
    );
  }

  savePreferences(preferences: VaultPreferences) {
    return this.execute<void>({ operation: "savePreferences", preferences });
  }
}
