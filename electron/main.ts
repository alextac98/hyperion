import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopDatabase, type RepositoryRequest } from "./database.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentUrl = "http://127.0.0.1:3000";
const packagedRendererDirectory = resolve(currentDirectory, "../dist");

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

let mainWindow: BrowserWindow | null = null;
let database: DesktopDatabase | null = null;

function databaseInstance() {
  if (!database) throw new Error("The desktop database is not initialized");
  return database;
}

function isTrustedRendererUrl(value: string) {
  try {
    const url = new URL(value);
    if (app.isPackaged) {
      if (url.protocol !== "file:") return false;
      const rendererPath = fileURLToPath(url);
      const relativePath = relative(packagedRendererDirectory, rendererPath);
      return relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
        && !isAbsolute(relativePath);
    }
    return url.origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

function assertTrustedRenderer(event: IpcMainInvokeEvent) {
  if (!isTrustedRendererUrl(event.senderFrame?.url ?? "")) {
    throw new Error("Rejected an IPC request from an untrusted renderer");
  }
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedRenderer(event);
    return listener(event, ...args);
  });
}

function registerDesktopHandlers() {
  handle(channels.repositoryExecute, (_event, request) => (
    databaseInstance().repositoryExecute(request as RepositoryRequest)
  ));
  handle(channels.storageInfo, () => databaseInstance().storageInfo());
  handle(channels.chooseStorageLocation, async () => {
    const current = databaseInstance().storageInfo();
    const options: Electron.OpenDialogOptions = {
      title: "Choose where Hyperion stores its data",
      defaultPath: current.directory,
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    return result.canceled || !selected
      ? null
      : databaseInstance().setStorageDirectory(selected);
  });
  handle(channels.editorPull, (_event, vaultId, documentId) => (
    databaseInstance().editorPull(String(vaultId), String(documentId))
  ));
  handle(channels.editorPush, (_event, vaultId, documentId, data) => (
    databaseInstance().editorPush(String(vaultId), String(documentId), String(data))
  ));
  handle(channels.editorReplace, (_event, vaultId, documentId, data) => (
    databaseInstance().editorReplace(String(vaultId), String(documentId), String(data))
  ));
  handle(channels.editorDelete, (_event, vaultId, documentId) => (
    databaseInstance().editorDelete(String(vaultId), String(documentId))
  ));
  handle(channels.assetGet, (_event, vaultId, key) => (
    databaseInstance().assetGet(String(vaultId), String(key))
  ));
  handle(channels.assetSet, (_event, vaultId, key, mimeType, data) => (
    databaseInstance().assetSet(String(vaultId), String(key), String(mimeType), String(data))
  ));
  handle(channels.assetDelete, (_event, vaultId, key) => (
    databaseInstance().assetDelete(String(vaultId), String(key))
  ));
  handle(channels.assetList, (_event, vaultId) => databaseInstance().assetList(String(vaultId)));
  handle(channels.localAiStatus, () => ({
    available: false,
    executionTarget: "native",
    reason: "The native local-AI boundary is ready; no voice model provider is bundled yet.",
  }));
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: "#f7f6f2",
    title: "Hyperion",
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  if (app.isPackaged) {
    await window.loadFile(join(currentDirectory, "../dist/index.html"));
  } else {
    await window.loadURL(developmentUrl);
  }
}

app.whenReady().then(async () => {
  const dataDirectoryOverride = process.env.HYPERION_DATA_DIRECTORY?.trim();
  database = new DesktopDatabase(dataDirectoryOverride
    ? { defaultDirectory: dataDirectoryOverride }
    : undefined);
  registerDesktopHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error(error);
  app.quit();
});

app.on("before-quit", () => {
  database?.close();
  database = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
