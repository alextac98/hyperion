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
  chooseVaultDirectory: "hyperion:choose-vault-directory",
  openVault: "hyperion:open-vault",
  showVaultFolder: "hyperion:show-vault-folder",
  editorPull: "hyperion:editor-pull",
  editorPush: "hyperion:editor-push",
  editorDelete: "hyperion:editor-delete",
  assetGet: "hyperion:asset-get",
  assetSet: "hyperion:asset-set",
  assetDelete: "hyperion:asset-delete",
  assetList: "hyperion:asset-list",
  localAiStatus: "hyperion:local-ai-status",
} as const;

const closeCallbacks = new Set<() => Promise<void>>();
ipcRenderer.on(channels.prepareClose, (_event, token: string) => {
  // A window acknowledges once, after every save participant has finished.
  void Promise.allSettled([...closeCallbacks].map(callback => Promise.resolve().then(callback)))
    .then(results => {
      const failure = results.find(result => result.status === "rejected");
      const error = failure?.status === "rejected"
        ? (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)) || "Saving failed"
        : null;
      return ipcRenderer.invoke(channels.closeReady, token, error);
    });
});

contextBridge.exposeInMainWorld("hyperionDesktop", Object.freeze({
  platform: process.platform,
  updateTitleBarTheme: (theme: "light" | "dark") => ipcRenderer.invoke("hyperion:title-bar-theme", theme),
  openFeedback: () => ipcRenderer.invoke("hyperion:feedback-open"),
  windowSession: () => ipcRenderer.invoke("hyperion:window-session"),
  detachTab: (request: unknown) => ipcRenderer.invoke("hyperion:detach-tab", request),
  returnTab: (request: unknown) => ipcRenderer.invoke("hyperion:return-tab", request),
  closeWindow: () => ipcRenderer.invoke("hyperion:close-window"),
  beginTabDrag: (request: unknown) => ipcRenderer.invoke("hyperion:begin-tab-drag", request),
  endTabDrag: (token: string) => ipcRenderer.invoke("hyperion:end-tab-drag", token),
  updateTabDrag: (token: string, position: unknown) => ipcRenderer.invoke("hyperion:update-tab-drag", { token, position }),
  updateTabDropTargets: (targets: unknown) => ipcRenderer.invoke("hyperion:tab-drop-targets", targets),
  onTabDropHint: (callback: (target: { groupId: string; index: number } | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, target: { groupId: string; index: number } | null) => callback(target);
    ipcRenderer.on("hyperion:tab-drop-hint", listener);
    return () => { ipcRenderer.removeListener("hyperion:tab-drop-hint", listener); };
  },
  onOpenTab: (callback: (request: { token: string }) => Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { token: string }) => {
      void Promise.resolve().then(() => callback(request)).then(
        () => ipcRenderer.invoke("hyperion:open-tab-ready", request.token, null),
        (error: unknown) => ipcRenderer.invoke("hyperion:open-tab-ready", request.token,
          (error instanceof Error ? error.message : String(error)) || "The page could not open"),
      );
    };
    ipcRenderer.on("hyperion:open-tab", listener);
    return () => { ipcRenderer.removeListener("hyperion:open-tab", listener); };
  },
  workspaceReady: (vaultId: string) => ipcRenderer.invoke("hyperion:workspace-ready", vaultId),
  onEditorUpdate: (callback: (update: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: unknown) => callback(update);
    ipcRenderer.on("hyperion:editor-update", listener);
    return () => ipcRenderer.removeListener("hyperion:editor-update", listener);
  },
  onRepositoryChanged: (callback: (request: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) => callback(request);
    ipcRenderer.on("hyperion:repository-changed", listener);
    return () => ipcRenderer.removeListener("hyperion:repository-changed", listener);
  },
  onNavigate: (callback: (direction: "back" | "forward") => void) => {
    const listener = (_event: Electron.IpcRendererEvent, direction: unknown) => {
      if (direction === "back" || direction === "forward") callback(direction);
    };
    ipcRenderer.on("hyperion:navigate", listener);
    return () => ipcRenderer.removeListener("hyperion:navigate", listener);
  },
  updateState: () => ipcRenderer.invoke("hyperion:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("hyperion:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("hyperion:update-download"),
  installUpdate: () => ipcRenderer.invoke("hyperion:update-install"),
  downloadUpdateManually: () => ipcRenderer.invoke("hyperion:update-manual"),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("hyperion:update-state", listener);
    return () => ipcRenderer.removeListener("hyperion:update-state", listener);
  },
  repositoryExecute: (request: unknown) => ipcRenderer.invoke(channels.repositoryExecute, request),
  storageInfo: () => ipcRenderer.invoke(channels.storageInfo),
  createBackup: (automatic = false) => ipcRenderer.invoke(channels.createBackup, automatic),
  listBackups: () => ipcRenderer.invoke(channels.listBackups),
  restoreBackup: () => ipcRenderer.invoke(channels.restoreBackup),
  showBackupFolder: () => ipcRenderer.invoke(channels.showBackupFolder),
  onPrepareClose: (callback: () => Promise<void>) => {
    closeCallbacks.add(callback);
    void ipcRenderer.invoke(channels.rendererReady);
    return () => closeCallbacks.delete(callback);
  },
  chooseStorageLocation: () => ipcRenderer.invoke(channels.chooseStorageLocation),
  chooseVaultDirectory: () => ipcRenderer.invoke(channels.chooseVaultDirectory),
  openVault: () => ipcRenderer.invoke(channels.openVault),
  showVaultFolder: () => ipcRenderer.invoke(channels.showVaultFolder),
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
