import { contextBridge, ipcRenderer } from "electron";

const channels = {
  repositoryExecute: "hyperion:repository-execute",
  storageInfo: "hyperion:storage-info",
  chooseStorageLocation: "hyperion:choose-storage-location",
  editorPull: "hyperion:editor-pull",
  editorPush: "hyperion:editor-push",
  editorReplace: "hyperion:editor-replace",
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
  chooseStorageLocation: () => ipcRenderer.invoke(channels.chooseStorageLocation),
  editorPull: (vaultId: string, documentId: string) => (
    ipcRenderer.invoke(channels.editorPull, vaultId, documentId)
  ),
  editorPush: (vaultId: string, documentId: string, data: string) => (
    ipcRenderer.invoke(channels.editorPush, vaultId, documentId, data)
  ),
  editorReplace: (vaultId: string, documentId: string, data: string) => (
    ipcRenderer.invoke(channels.editorReplace, vaultId, documentId, data)
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
