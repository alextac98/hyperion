import { contextBridge, ipcRenderer } from "electron";

const channels = {
  repositoryExecute: "hyperion:repository-execute",
  storageInfo: "hyperion:storage-info",
  createBackup: "hyperion:create-backup",
  listBackups: "hyperion:list-backups",
  restoreBackup: "hyperion:restore-backup",
  showBackupFolder: "hyperion:show-backup-folder",
  prepareClose: "hyperion:prepare-close",
  rendererReady: "hyperion:renderer-ready",
  closeReady: "hyperion:close-ready",
  chooseStorageLocation: "hyperion:choose-storage-location",
  editorPull: "hyperion:editor-pull",
  editorPush: "hyperion:editor-push",
  editorDelete: "hyperion:editor-delete",
  assetGet: "hyperion:asset-get",
  assetSet: "hyperion:asset-set",
  assetDelete: "hyperion:asset-delete",
  assetList: "hyperion:asset-list",
  localAiStatus: "hyperion:local-ai-status",
} as const;

contextBridge.exposeInMainWorld("hyperionDesktop", Object.freeze({
  repositoryExecute: (request: unknown) => ipcRenderer.invoke(channels.repositoryExecute, request),
  storageInfo: () => ipcRenderer.invoke(channels.storageInfo),
  createBackup: (automatic = false) => ipcRenderer.invoke(channels.createBackup, automatic),
  listBackups: () => ipcRenderer.invoke(channels.listBackups),
  restoreBackup: () => ipcRenderer.invoke(channels.restoreBackup),
  showBackupFolder: () => ipcRenderer.invoke(channels.showBackupFolder),
  onPrepareClose: (callback: () => Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => {
      void callback().then(() => ipcRenderer.invoke(channels.closeReady, token, null),
        (error: unknown) => ipcRenderer.invoke(channels.closeReady, token, error instanceof Error ? error.message : String(error)));
    };
    ipcRenderer.on(channels.prepareClose, listener);
    void ipcRenderer.invoke(channels.rendererReady);
    return () => ipcRenderer.removeListener(channels.prepareClose, listener);
  },
  chooseStorageLocation: () => ipcRenderer.invoke(channels.chooseStorageLocation),
  editorPull: (vaultId: string, documentId: string) => (
    ipcRenderer.invoke(channels.editorPull, vaultId, documentId)
  ),
  editorPush: (vaultId: string, documentId: string, data: string) => (
    ipcRenderer.invoke(channels.editorPush, vaultId, documentId, data)
  ),
  editorDelete: (vaultId: string, documentId: string) => (
    ipcRenderer.invoke(channels.editorDelete, vaultId, documentId)
  ),
  assetGet: (vaultId: string, key: string) => ipcRenderer.invoke(channels.assetGet, vaultId, key),
  assetSet: (vaultId: string, key: string, mimeType: string, data: string) => (
    ipcRenderer.invoke(channels.assetSet, vaultId, key, mimeType, data)
  ),
  assetDelete: (vaultId: string, key: string) => ipcRenderer.invoke(channels.assetDelete, vaultId, key),
  assetList: (vaultId: string) => ipcRenderer.invoke(channels.assetList, vaultId),
  localAiStatus: () => ipcRenderer.invoke(channels.localAiStatus),
}));
