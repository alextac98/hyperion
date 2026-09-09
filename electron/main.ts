import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import updater from "electron-updater";
import { createUpdates } from "./updates.js";
import { createUpdatePreview } from "./update-preview.js";
import { DesktopDatabase, type RepositoryRequest } from "./database.js";

const updatePreview = !app.isPackaged && Boolean(process.env.HYPERION_UPDATE_PREVIEW);
if (updatePreview) {
  const profile = process.env.HYPERION_UPDATE_PREVIEW_PROFILE;
  if (!profile) throw new Error("Use pnpm dev:updates to launch the isolated preview.");
  app.setPath("userData", profile);
}
const currentDirectory = dirname(fileURLToPath(import.meta.url));
app.setName("Hyperion");
const applicationName = app.isPackaged ? "Hyperion" : "[Dev] Hyperion";
if (!app.isPackaged) {
  // Preserve the existing profile (including preview/test overrides) on rename.
  const userData = app.getPath("userData");
  app.setName(applicationName);
  app.setPath("userData", userData);
}
const applicationIcon = app.isPackaged
  ? join(process.resourcesPath, "hyperion-icon.png")
  : resolve(currentDirectory, "../build/icon-development.png");
const developmentUrl = "http://127.0.0.1:3000";
const useBuiltRenderer = app.isPackaged || process.env.HYPERION_TEST_RENDERER === "1";
const packagedRendererDirectory = resolve(currentDirectory, "../dist");
const { autoUpdater } = updater;

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

let mainWindow: BrowserWindow | null = null;
let database: DesktopDatabase | null = null;
let updateCheckStarted = false;
let closeToken: string | null = null;
let closeApproved = false;
let quitting = false;
let rendererReady = false;

function showAppMessageBox(options: Electron.MessageBoxOptions) {
  return mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

const previewInstalled = process.argv.includes("--update-preview-installed");
const previewVersion = app.getVersion().replace(/^(\d+\.\d+\.)(\d+).*$/, (_match, prefix, patch) => `${prefix}${Number(patch) + 1}`);
const updateDriver = updatePreview ? createUpdatePreview(
  process.env.HYPERION_UPDATE_PREVIEW!, previewVersion, previewInstalled,
  () => {
    app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== "--update-preview-installed"), "--update-preview-installed"] });
    app.quit();
  },
) : autoUpdater;
const updates = createUpdates(updateDriver, updatePreview && previewInstalled ? previewVersion : app.getVersion(),
  updatePreview ? null : !app.isPackaged ? "Updates are available in the installed desktop app."
    : process.platform === "linux" && !process.env.APPIMAGE ? "Run the AppImage to use in-app updates." : null,
  state => { if (state.status === "error") closeApproved = false; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("hyperion:update-state", { ...state, preview: updatePreview }); });
let installRequested = false;
function registerAutoUpdater() {
  if (updateCheckStarted) return;
  updateCheckStarted = true;
  const startup = setTimeout(() => { void updates.check(true); }, updatePreview ? 2_000 : 15_000);
  const interval = setInterval(() => { void updates.check(true); }, 4 * 60 * 60 * 1000);
  app.once("will-quit", () => { clearTimeout(startup); clearInterval(interval); });
}

function databaseInstance() {
  if (!database) throw new Error("The desktop database is not initialized");
  return database;
}

function isTrustedRendererUrl(value: string) {
  try {
    const url = new URL(value);
    if (useBuiltRenderer) {
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
  handle("hyperion:update-state", () => ({ ...updates.getState(), ...(updatePreview ? { preview: true } : {}) }));
  handle("hyperion:update-check", () => updates.check());
  handle("hyperion:update-download", () => updates.download());
  handle("hyperion:update-manual", () => shell.openExternal("https://github.com/alextac98/hyperion/releases/latest"));
  handle("hyperion:update-install", () => {
    if (!rendererReady || closeToken || !updates.prepareInstall()) return updates.getState();
    installRequested = true;
    closeToken = randomUUID();
    mainWindow?.webContents.send(channels.prepareClose, closeToken);
    return updates.getState();
  });
  handle(channels.repositoryExecute, (_event, request) => (
    databaseInstance().repositoryExecute(request as RepositoryRequest)
  ));
  handle(channels.storageInfo, () => databaseInstance().storageInfo());
  handle(channels.createBackup, (_event, automatic) => databaseInstance().createBackup(automatic === true));
  handle(channels.listBackups, () => databaseInstance().listBackups());
  handle(channels.showBackupFolder, async () => {
    const folder = join(databaseInstance().storageInfo().directory, "backups");
    mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
  handle(channels.restoreBackup, async () => {
    const source = await dialog.showOpenDialog({ title: "Choose a Hyperion database backup", properties: ["openFile"], filters: [{ name: "Hyperion SQLite backup", extensions: ["sqlite3"] }] });
    if (source.canceled || !source.filePaths[0]) return null;
    const target = await dialog.showOpenDialog({ title: "Restore into a separate folder", properties: ["openDirectory", "createDirectory"] });
    if (target.canceled || !target.filePaths[0]) return null;
    return databaseInstance().restoreBackup(source.filePaths[0], target.filePaths[0]);
  });
  handle(channels.rendererReady, () => { rendererReady = true; });
  handle(channels.closeReady, async (_event, token, error) => {
    if (token !== closeToken) return;
    closeToken = null;
    if (error) {
      quitting = false;
      if (installRequested) { installRequested = false; updates.saveFailed(); }
      await showAppMessageBox({ type: "error", message: "Hyperion could not finish saving", detail: String(error) + "\nYour window will remain open. Retry saving before closing.", buttons: ["Keep working"] });
      return;
    }
    closeApproved = true;
    if (installRequested) { installRequested = false; updates.install(); if (updates.getState().status === "error") closeApproved = false; return; }
    if (quitting) app.quit(); else mainWindow?.close();
  });
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
  const windowTitle = updatePreview ? `${applicationName} — Update preview (simulated)` : applicationName;
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: "#f7f6f2",
    title: windowTitle,
    icon: applicationIcon,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (!app.isPackaged) {
    window.on("page-title-updated", event => {
      event.preventDefault();
      window.setTitle(windowTitle);
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-start-loading", () => { rendererReady = false; });
  window.on("close", event => {
    if (closeApproved || !rendererReady) return;
    event.preventDefault();
    if (!closeToken) { closeToken = randomUUID(); window.webContents.send(channels.prepareClose, closeToken); }
  });
  window.on("closed", () => {
    closeApproved = false; closeToken = null;
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  if (useBuiltRenderer) {
    await window.loadFile(join(currentDirectory, "../dist/index.html"));
  } else {
    await window.loadURL(developmentUrl);
  }
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  app.dock?.setIcon(applicationIcon);
  app.setAboutPanelOptions({ applicationName, iconPath: applicationIcon });
  const dataDirectoryOverride = process.env.HYPERION_DATA_DIRECTORY?.trim();
  database = new DesktopDatabase(dataDirectoryOverride
    ? { defaultDirectory: dataDirectoryOverride }
    : undefined);
  database.repositoryExecute({ operation: "captureAutomaticRevisions" });
  database.createBackup(true);
  registerDesktopHandlers();
  await createWindow();
  registerAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error(error);
  dialog.showErrorBox("Hyperion could not open your data", `${error instanceof Error ? error.message : String(error)}\nYour existing data and any pre-migration backup have been preserved.`);
  app.quit();
});

app.on("before-quit", event => {
  quitting = true;
  if (mainWindow && !closeApproved) { event.preventDefault(); mainWindow.close(); }
});
app.on("will-quit", () => { database?.close(); database = null; });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
