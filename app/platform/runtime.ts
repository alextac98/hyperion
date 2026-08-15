import { IndexedDBBlobSource, IndexedDBDocSource } from "@blocksuite/affine/sync";
import type { KnowledgeRepository } from "../lib/local-database";
import { IndexedDbKnowledgeRepository } from "../lib/local-database";
import type { LocalAiStatus, StorageInfo } from "./desktop-api";
import { createElectronEditorStorage } from "./desktop/electron-editor-storage";
import { ElectronKnowledgeRepository } from "./desktop/electron-repository";

export type { LocalAiStatus, StorageInfo } from "./desktop-api";

const desktop = typeof window !== "undefined" ? window.hyperionDesktop : undefined;

export const knowledgeRepository: KnowledgeRepository = desktop
  ? new ElectronKnowledgeRepository(desktop)
  : new IndexedDbKnowledgeRepository();

export const platformRuntime = {
  kind: desktop ? "desktop" as const : "web" as const,
  capabilities: {
    configurableStorage: Boolean(desktop),
    nativeLocalAi: Boolean(desktop),
  },
  createEditorStorage(vaultId: string) {
    return desktop
      ? createElectronEditorStorage(desktop, vaultId)
      : {
          doc: new IndexedDBDocSource(`hyperion-blocks-${vaultId}`),
          blobs: new IndexedDBBlobSource(`hyperion-assets-${vaultId}`),
        };
  },
  deleteEditorDocument(vaultId: string, documentId: string) {
    return desktop
      ? desktop.editorDelete(vaultId, documentId)
      : Promise.resolve();
  },
  async getStorageInfo(): Promise<StorageInfo | null> {
    return desktop ? desktop.storageInfo() : null;
  },
  async chooseStorageLocation(): Promise<StorageInfo | null> {
    return desktop ? desktop.chooseStorageLocation() : null;
  },
  getLocalAiStatus(): Promise<LocalAiStatus> {
    if (!desktop) {
      return Promise.resolve({
        available: false,
        executionTarget: "browser",
        reason: "Native local-AI providers are only exposed by the desktop runtime.",
      });
    }
    return desktop.localAiStatus();
  },
};
