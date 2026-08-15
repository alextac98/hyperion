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
  repositoryExecute<T>(request: RepositoryRequest): Promise<T>;
  storageInfo(): Promise<StorageInfo>;
  chooseStorageLocation(): Promise<StorageInfo | null>;
  editorPull(vaultId: string, documentId: string): Promise<string[]>;
  editorPush(vaultId: string, documentId: string, data: string): Promise<void>;
  editorReplace(vaultId: string, documentId: string, data: string): Promise<void>;
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
