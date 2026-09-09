import type { UpdateState } from "../../electron/updates";
import type { NoteRecord } from "../lib/local-database";
export type RevisionCapture = PageRevision & { captureStatus: "created" | "named" | "reused" };
export type PageSnapshot = { note: NoteRecord; document?: string | null };
export type PageComparison = { revision: PageRevision; current: PageSnapshot };
export type PageRevision = {
  id: string; vaultId: string; noteId: string; createdAt: string; label: string | null;
  reason: string; documentVersion: number; note: NoteRecord; document?: string | null;
  assets?: Record<string, string>; contentHash: string;
};
export type RepositoryRequest = {
  operation: string;
  [key: string]: unknown;
};

export type StorageInfo = {
  directory: string;
  databasePath: string;
  isDefault: boolean;
};

export type LocalAiStatus = {
  available: boolean;
  executionTarget: "browser" | "native";
  reason: string;
};

export type StoredAsset = {
  mimeType: string;
  data: string;
};

export interface HyperionDesktopApi {
  updateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  downloadUpdateManually(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  repositoryExecute<T>(request: RepositoryRequest): Promise<T>;
  storageInfo(): Promise<StorageInfo>;
  createBackup(automatic?: boolean): Promise<{ name: string; path: string }>;
  listBackups(): Promise<Array<{ name: string; path: string }>>;
  restoreBackup(): Promise<StorageInfo | null>;
  showBackupFolder(): Promise<void>;
  onPrepareClose(callback: () => Promise<void>): () => void;
  chooseStorageLocation(): Promise<StorageInfo | null>;
  editorPull(vaultId: string, documentId: string): Promise<string[]>;
  editorPush(vaultId: string, documentId: string, data: string): Promise<void>;
  editorDelete(vaultId: string, documentId: string): Promise<void>;
  assetGet(vaultId: string, key: string): Promise<StoredAsset | null>;
  assetSet(vaultId: string, key: string, mimeType: string, data: string): Promise<void>;
  assetDelete(vaultId: string, key: string): Promise<void>;
  assetList(vaultId: string): Promise<string[]>;
  localAiStatus(): Promise<LocalAiStatus>;
}

declare global {
  interface Window {
    hyperionDesktop?: HyperionDesktopApi;
  }
}
