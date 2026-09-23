import { makeStarterPages } from "../lib/starter-vault";
import { saves } from "../lib/save-coordinator";
import {
  type CollectionRecord,
  DEFAULT_PREFERENCES,
  type KnowledgeRepository,
  normalizeVaultPreferences,
  type NoteRecord,
  type TemplateRecord,
  type VaultPreferences,
  type VaultRecord,
} from "../lib/local-database";
import type { HyperionDataApi, RepositoryRequest } from "./desktop-api";

function timestamp() {
  return new Date().toISOString();
}

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly data: HyperionDataApi) {}

  private execute<T>(request: RepositoryRequest) {
    return /^(list|get)/.test(request.operation)
      ? this.data.repositoryExecute<T>(request)
      : saves.track(() => this.data.repositoryExecute<T>(request));
  }

  async initialize() {
    await this.execute<void>({ operation: "initialize" });
  }

  listVaults() {
    return this.execute<VaultRecord[]>({ operation: "listVaults" });
  }

  async createVault(
    name: string,
    options: { directory?: string; starterNotes?: boolean } = {},
  ) {
    const now = timestamp();
    const vault: VaultRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled vault",
      description: "Personal knowledge base",
      color: ["#6f63d9", "#4b8f8c", "#b77a42", "#b45f73"][
        Math.floor(Math.random() * 4)
      ],
      createdAt: now,
      updatedAt: now,
    };
    const pages = options.starterNotes ? makeStarterPages(vault.id) : [];
    const documents = pages.length
      ? await (
          await import("../editor/editor-client")
        ).createStarterDocuments(pages)
      : {};
    // Creation is an explicit transaction under the UI's data-operation barrier.
    // A rejected destination must not become a background save retry.
    await this.data.repositoryExecute<void>({
      operation: "createVault",
      directory: options.directory,
      notes: pages.map((page) => page.note),
      collections: [],
      documents,
      vault,
      preferences: { vaultId: vault.id, ...DEFAULT_PREFERENCES },
    });
    return vault;
  }

  updateVault(vault: VaultRecord) {
    return this.execute<void>({
      operation: "updateVault",
      vault: { ...vault, updatedAt: timestamp() },
    });
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
    return this.execute<TemplateRecord[]>({
      operation: "listTemplates",
      vaultId,
    });
  }

  saveTemplate(template: TemplateRecord) {
    return this.execute<void>({ operation: "saveTemplate", template });
  }

  deleteTemplate(id: string) {
    return this.execute<void>({ operation: "deleteTemplate", id });
  }

  listCollections(vaultId: string) {
    return this.execute<CollectionRecord[]>({
      operation: "listCollections",
      vaultId,
    });
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
      await this.execute<VaultPreferences | null>({
        operation: "getPreferences",
        vaultId,
      }),
    );
  }

  savePreferences(preferences: VaultPreferences) {
    return this.execute<void>({ operation: "savePreferences", preferences });
  }
}
