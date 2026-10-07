import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import updater from "electron-updater";
import { createUpdates } from "./updates.js";
import { createUpdatePreview } from "./update-preview.js";
import type { RepositoryRequest } from "./database.js";
import { VaultLibrary } from "./vault-library.js";
import { developmentInstance, developmentRendererUrl } from "./development.js";
import { feedbackIssueUrl } from "./feedback.js";
import {
  detachedTabRequest,
  tabDragRequest,
  tabDragPosition,
  tabDropTargets,
  type WindowSession,
  type DetachedTabRequest,
  type TabDropTargets,
  type TabDropTarget,
} from "./window-session.js";
import { createTabDragPreview } from "./tab-drag-preview.js";

const updatePreview = !app.isPackaged && Boolean(process.env.HYPERION_UPDATE_PREVIEW);
const useBuiltRenderer = app.isPackaged || process.env.HYPERION_TEST_RENDERER === "1";
const development = !useBuiltRenderer && !updatePreview
  ? developmentInstance(app.getAppPath(), process.env.HYPERION_DEV_BRANCH)
  : null;
if (updatePreview) {
  const profile = process.env.HYPERION_UPDATE_PREVIEW_PROFILE;
  if (!profile) throw new Error("Use pnpm dev:updates to launch the isolated preview.");
  app.setPath("userData", profile);
}
const currentDirectory = dirname(fileURLToPath(import.meta.url));
app.setName("Hyperion");
const applicationName = app.isPackaged ? "Hyperion"
  : development ? `[Dev] Hyperion — ${development.branch}` : "[Dev] Hyperion";
if (!app.isPackaged) {
  // Separate the development lock and browser storage from the installed app,
  // while preserving explicit preview/test profiles.
  const userData = app.getPath("userData");
  app.setName(applicationName);
  const profile = development
    ? development.profileDirectory
    : !updatePreview && userData === join(app.getPath("appData"), "Hyperion")
    ? join(app.getPath("appData"), "Hyperion Development")
    : userData;
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  if (development) app.setPath("sessionData", profile);
}
const applicationIcon = app.isPackaged
  ? join(process.resourcesPath, "hyperion-icon.png")
  : resolve(currentDirectory, "../build/icon-development.png");
const developmentUrl = useBuiltRenderer ? "" : developmentRendererUrl(process.env.HYPERION_DEV_URL);
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

let mainWindow: BrowserWindow | null = null;
let database: VaultLibrary | null = null;
let updateCheckStarted = false;
type WindowState = {
  session: WindowSession;
  rendererReady: boolean;
  workspaceLoaded: boolean;
  closeApproved: boolean;
  pending?: {
    token: string;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  ready?: { resolve: () => void; reject: (error: Error) => void };
  detaching: boolean;
  focusOrder: number;
  dropTargets: TabDropTargets;
  drag?: {
    token: string;
    location: DetachedTabRequest["location"];
    preview: ReturnType<typeof createTabDragPreview>;
    position?: { x: number; y: number };
  };
  navigation?: {
    token: string;
    resolve: () => void;
    reject: (error: Error) => void;
  };
};
const windows = new Map<BrowserWindow, WindowState>();
let focusOrder = 0;
let dropHint: { source: BrowserWindow; window: BrowserWindow; target: TabDropTarget } | null = null;
let quitApproved = false;
let preparingQuit = false;

function clearTabDropHint() {
  if (dropHint && !dropHint.window.isDestroyed())
    dropHint.window.webContents.send("hyperion:tab-drop-hint", null);
  dropHint = null;
}

function stopTabDrag(window: BrowserWindow) {
  const state = windows.get(window);
  state?.drag?.preview.dispose();
  if (state) state.drag = undefined;
  if (dropHint?.source === window || dropHint?.window === window) clearTabDropHint();
}

function tabDropDestination(source: BrowserWindow, point: { x: number; y: number }) {
  // A window covering a tab strip must block that strip, even if it cannot
  // receive the tab. The preview is not part of this application-window map.
  const candidates = [...windows].sort((a, b) => b[1].focusOrder - a[1].focusOrder);
  for (const [window, state] of candidates) {
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) continue;
    const bounds = window.getBounds();
    if (point.x < bounds.x || point.y < bounds.y || point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height) continue;
    if (window === source) return null;
    const content = window.getContentBounds();
    const zoom = window.webContents.getZoomFactor();
    const x = (point.x - content.x) / zoom;
    const y = (point.y - content.y) / zoom;
    const strip = state.dropTargets.targets.find(({ rect }) =>
      x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height);
    if (!strip) return null;
    const before = strip.tabs.findIndex(tab => x < tab.midpoint);
    return { window, target: { groupId: strip.groupId, index: before < 0 ? strip.tabs.length : before } };
  }
  return null;
}

function canReceiveTab(destination: WindowState, vaultId: string | null) {
  return destination.workspaceLoaded && !destination.navigation && !destination.pending && !destination.detaching
    && !destination.dropTargets.disabled && !preparingQuit
    && (destination.session.kind === "primary" || destination.session.vaultId === vaultId);
}

function updateTabDropHint(source: BrowserWindow) {
  const state = windows.get(source);
  const drag = state?.drag;
  const candidate = drag?.position && (drag.location.view === "note" || drag.location.view === "template")
    ? tabDropDestination(source, drag.position) : null;
  const next = candidate && canReceiveTab(windows.get(candidate.window)!, state!.session.vaultId) ? candidate : null;
  if (next && dropHint?.source === source && dropHint.window === next.window
    && dropHint.target.groupId === next.target.groupId && dropHint.target.index === next.target.index) return;
  clearTabDropHint();
  if (next) {
    dropHint = { source, ...next };
    next.window.webContents.send("hyperion:tab-drop-hint", next.target);
  }
}

async function openTabInWindow(window: BrowserWindow, request: DetachedTabRequest, target?: TabDropTarget) {
  const state = windows.get(window)!;
  if (state.session.kind === "page" && state.session.vaultId !== request.vaultId)
    throw new Error("That page window belongs to a different vault. Your tab remains in its original window.");
  if (!canReceiveTab(state, request.vaultId))
    throw new Error("That window is busy. Try again once it finishes.");
  // Resume rendering before awaiting the destination's acknowledgement.
  if (window.isMinimized()) window.restore();
  window.show();
  await new Promise<void>((resolve, reject) => {
    const token = randomUUID();
    const timeout = setTimeout(() => {
      if (state.navigation?.token === token) state.navigation = undefined;
      reject(new Error("The destination did not finish opening the page. Your tab remains in its original window."));
    }, 30_000);
    state.navigation = {
      token,
      resolve: () => { clearTimeout(timeout); resolve(); },
      reject: error => { clearTimeout(timeout); reject(error); },
    };
    window.webContents.send("hyperion:open-tab", { ...request, token, target });
  });
  if (window.isDestroyed()) throw new Error("The destination window was closed.");
  if (window.isMinimized()) window.restore();
  window.focus();
}

function senderWindow(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.has(window))
    throw new Error("Unknown application window");
  return window;
}
function senderState(event: IpcMainInvokeEvent) {
  return windows.get(senderWindow(event))!;
}
function senderVault(event: IpcMainInvokeEvent) {
  return senderState(event).session.vaultId ?? undefined;
}
function broadcast(channel: string, value: unknown, except?: BrowserWindow) {
  for (const window of windows.keys())
    if (window !== except && !window.isDestroyed())
      window.webContents.send(channel, value);
}
function requireExclusiveVault(
  vaultId: string | undefined,
  owner: BrowserWindow,
) {
  if (
    vaultId &&
    [...windows].some(
      ([window, state]) =>
        window !== owner && state.session.vaultId === vaultId,
    )
  )
    throw new Error(
      "This operation removes or replaces saved data. Close the other windows showing this vault and try again.",
    );
}
function prepareWindow(window: BrowserWindow): Promise<void> {
  const state = windows.get(window);
  if (!state || state.closeApproved || !state.rendererReady)
    return Promise.resolve();
  if (state.pending)
    return Promise.reject(
      new Error(
        "This window is already preparing to close. Try again once saving finishes.",
      ),
    );
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    state.pending = { token, resolve, reject };
    window.webContents.send(channels.prepareClose, token);
  });
}
async function prepareAllWindows() {
  for (const window of windows.keys()) stopTabDrag(window);
  if ([...windows.values()].some((state) => state.detaching))
    throw new Error("Wait for the tab to finish moving before quitting.");
  const results = await Promise.allSettled(
    [...windows.keys()].map(prepareWindow),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    for (const state of windows.values()) state.closeApproved = false;
    throw failure.reason;
  }
}

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
const updates = createUpdates(
  updateDriver,
  updatePreview && previewInstalled ? previewVersion : app.getVersion(),
  updatePreview
    ? null
    : !app.isPackaged
      ? "Updates are available in the installed desktop app."
      : process.platform === "linux" && !process.env.APPIMAGE
        ? "Run the AppImage to use in-app updates."
        : null,
  (state) => {
    if (state.status === "error") {
      quitApproved = false;
      for (const state of windows.values()) state.closeApproved = false;
    }
    broadcast("hyperion:update-state", { ...state, preview: updatePreview });
  },
);
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
  handle("hyperion:feedback-open", () => shell.openExternal(feedbackIssueUrl({
    version: app.getVersion(),
    platform: process.platform,
    systemVersion: process.getSystemVersion(),
    arch: process.arch,
  })));
  handle("hyperion:window-session", (event) => senderState(event).session);
  handle("hyperion:close-window", (event) => {
    senderWindow(event).close();
  });
  handle("hyperion:begin-tab-drag", async (event, value) => {
    const source = senderWindow(event);
    const state = senderState(event);
    if (state.pending || state.detaching || state.navigation || preparingQuit) return false;
    const request = tabDragRequest.parse(value);
    for (const window of windows.keys()) stopTabDrag(window);
    const preview = createTabDragPreview(source, request.rect);
    state.drag = { token: request.token, location: request.location, preview };
    try {
      await preview.ready;
      return state.drag?.token === request.token && !preview.window.isDestroyed() && preview.window.isVisible();
    } catch (error) {
      if (state.drag?.token === request.token) stopTabDrag(source);
      else preview.dispose();
      throw error;
    }
  });
  handle("hyperion:end-tab-drag", (event, token) => {
    const state = senderState(event);
    if (!state.drag || state.drag.token !== token) return;
    stopTabDrag(senderWindow(event));
  });
  handle("hyperion:update-tab-drag", (event, value) => {
    const state = senderState(event);
    const request = tabDragPosition.parse(value);
    if (!state.drag || state.drag.token !== request.token) return;
    state.drag.position = request.position;
    updateTabDropHint(senderWindow(event));
  });
  handle("hyperion:tab-drop-targets", (event, value) => {
    senderState(event).dropTargets = tabDropTargets.parse(value);
    for (const [window, state] of windows)
      if (state.drag) updateTabDropHint(window);
  });
  handle("hyperion:open-tab-ready", (event, token, error) => {
    const state = senderState(event);
    if (!state.navigation || state.navigation.token !== token) return;
    const navigation = state.navigation;
    state.navigation = undefined;
    if (error) navigation.reject(new Error(String(error)));
    else navigation.resolve();
  });
  handle("hyperion:return-tab", async (event, value) => {
    const state = senderState(event);
    if (state.session.kind !== "page" || state.detaching || state.pending || state.navigation || preparingQuit)
      throw new Error("Wait for the current window operation to finish.");
    const request = detachedTabRequest.parse(value);
    if (request.vaultId !== state.session.vaultId)
      throw new Error("The page belongs to a different vault.");
    assertAvailableLocation(request);
    const primary = [...windows].find(([, state]) => state.session.kind === "primary")?.[0];
    if (!primary || primary.isDestroyed())
      throw new Error("The main window is no longer open.");
    state.detaching = true;
    try {
      await openTabInWindow(primary, request);
    } finally {
      state.detaching = false;
    }
  });
  handle("hyperion:workspace-ready", (event, vaultId) => {
    const state = senderState(event);
    if (vaultId !== state.session.vaultId)
      throw new Error("Unexpected workspace vault");
    state.workspaceLoaded = true;
    state.ready?.resolve();
    state.ready = undefined;
  });
  handle("hyperion:detach-tab", async (event, value) => {
    const source = senderWindow(event);
    const state = senderState(event);
    if (state.detaching || state.pending || state.navigation || preparingQuit)
      throw new Error("Wait for the current window operation to finish.");
    const request = detachedTabRequest.parse(value);
    if (request.vaultId !== state.session.vaultId)
      throw new Error("The tab belongs to a different vault.");
    assertAvailableLocation(request);
    state.detaching = true;
    try {
      const destination = request.position ? tabDropDestination(source, request.position) : null;
      if (destination) await openTabInWindow(destination.window, request, destination.target);
      else await createWindow(request);
    } finally {
      state.detaching = false;
    }
    if (source.isDestroyed()) throw new Error("The source window was closed.");
  });
  handle("hyperion:update-state", () => ({
    ...updates.getState(),
    ...(updatePreview ? { preview: true } : {}),
  }));
  handle("hyperion:update-check", () => updates.check());
  handle("hyperion:update-download", () => updates.download());
  handle("hyperion:update-manual", () =>
    shell.openExternal("https://github.com/alextac98/hyperion/releases/latest"),
  );
  handle("hyperion:update-install", async () => {
    if (preparingQuit || !updates.prepareInstall()) return updates.getState();
    preparingQuit = true;
    try {
      await prepareAllWindows();
      quitApproved = true;
      updates.install();
    } catch {
      updates.saveFailed();
    } finally {
      preparingQuit = false;
    }
    return updates.getState();
  });
  handle(channels.repositoryExecute, (event, value) => {
    const request = value as RepositoryRequest;
    const state = senderState(event);
    const record = (request.note ??
      request.template ??
      request.collection ??
      request.preferences ??
      request.vault) as Record<string, unknown> | undefined;
    const vaultId =
      request.vaultId ??
      record?.vaultId ??
      (request.operation === "updateVault" ? record?.id : undefined) ??
      state.session.vaultId;
    const scoped = vaultId ? { ...request, vaultId } : request;
    if (request.operation === "selectVault" && state.session.kind === "page" && request.vaultId !== state.session.vaultId)
      throw new Error("Choose vaults in the main window. This page window belongs to its original vault.");
    if (
      ["closeVault", "deleteVault", "deleteNote", "deleteTemplate"].includes(request.operation) ||
      (request.operation === "restoreRevision" && request.asCopy !== true)
    )
      requireExclusiveVault(
        String(request.operation === "deleteVault" ? request.id : vaultId),
        senderWindow(event),
      );
    const result = databaseInstance().repositoryExecute(scoped);
    if (request.operation === "selectVault") {
      state.session.vaultId = String(request.vaultId);
      state.workspaceLoaded = false;
    }
    if (
      !/^(list|get|initialize|selectVault|vaultSetup|suggest|export|capture)/.test(
        request.operation,
      )
    )
      broadcast("hyperion:repository-changed", scoped, senderWindow(event));
    return result;
  });
  handle(channels.storageInfo, (event) =>
    databaseInstance().storageInfo(senderVault(event)),
  );
  handle(channels.createBackup, (event, automatic) =>
    databaseInstance().createBackup(automatic === true, senderVault(event)),
  );
  handle(channels.listBackups, (event) =>
    databaseInstance().listBackups(senderVault(event)),
  );
  handle(channels.showBackupFolder, async (event) => {
    const folder = join(
      databaseInstance().storageInfo(senderVault(event)).directory,
      "backups",
    );
    mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  handle(channels.restoreBackup, async (event) => {
    const source = await dialog.showOpenDialog({
      title: "Choose a Hyperion database backup",
      properties: ["openFile"],
      filters: [{ name: "Hyperion SQLite backup", extensions: ["sqlite3"] }],
    });
    if (source.canceled || !source.filePaths[0]) return null;
    const target = await dialog.showOpenDialog({
      title: "Restore into a separate folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (target.canceled || !target.filePaths[0]) return null;
    return databaseInstance().restoreBackup(
      source.filePaths[0],
      target.filePaths[0],
      senderVault(event),
    );
  });
  handle(channels.rendererReady, (event) => {
    senderState(event).rendererReady = true;
  });
  handle(channels.closeReady, (event, token, error) => {
    const state = senderState(event);
    if (!state.pending || token !== state.pending.token) return;
    const pending = state.pending;
    state.pending = undefined;
    if (error) {
      pending.reject(new Error(String(error)));
      return;
    }
    state.closeApproved = true;
    pending.resolve();
  });
  handle(channels.chooseStorageLocation, async (event) => {
    const window = senderWindow(event);
    const vaultId = senderVault(event);
    requireExclusiveVault(vaultId, window);
    const current = databaseInstance().storageInfo(vaultId);
    const options: Electron.OpenDialogOptions = {
      title: "Move this vault to an empty folder",
      defaultPath: current.directory,
      properties: ["openDirectory", "createDirectory"],
    };
    const result = await dialog.showOpenDialog(window, options);
    const selected = result.filePaths[0];
    return result.canceled || !selected
      ? null
      : databaseInstance().moveVault(selected, vaultId);
  });
  handle(channels.chooseVaultDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose an empty folder for your new vault",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(channels.openVault, async () => {
    const result = await dialog.showOpenDialog({
      title: "Open an existing Hyperion vault folder",
      properties: ["openDirectory"],
    });
    return result.canceled || !result.filePaths[0]
      ? null
      : databaseInstance().openVault(result.filePaths[0]);
  });
  handle(channels.showVaultFolder, async (event) => {
    const error = await shell.openPath(
      databaseInstance().storageInfo(senderVault(event)).directory,
    );
    if (error) throw new Error(error);
  });
  handle(channels.editorPull, (_event, vaultId, documentId) =>
    databaseInstance().editorPull(String(vaultId), String(documentId)),
  );
  handle(channels.editorPush, (event, vaultId, documentId, data) => {
    databaseInstance().editorPush(
      String(vaultId),
      String(documentId),
      String(data),
    );
    broadcast(
      "hyperion:editor-update",
      { vaultId, documentId, data },
      senderWindow(event),
    );
  });
  handle(channels.editorDelete, (event, vaultId, documentId) => {
    requireExclusiveVault(String(vaultId), senderWindow(event));
    return databaseInstance().editorDelete(String(vaultId), String(documentId));
  });
  handle(channels.assetGet, (_event, vaultId, key) =>
    databaseInstance().assetGet(String(vaultId), String(key)),
  );
  handle(channels.assetSet, (_event, vaultId, key, mimeType, data) =>
    databaseInstance().assetSet(
      String(vaultId),
      String(key),
      String(mimeType),
      String(data),
    ),
  );
  handle(channels.assetDelete, (_event, vaultId, key) =>
    databaseInstance().assetDelete(String(vaultId), String(key)),
  );
  handle(channels.assetList, (_event, vaultId) =>
    databaseInstance().assetList(String(vaultId)),
  );
  handle(channels.localAiStatus, () => ({
    available: false,
    executionTarget: "native",
    reason:
      "The native local-AI boundary is ready; no voice model provider is bundled yet.",
  }));
}

function assertAvailableLocation(request: DetachedTabRequest) {
  const { location, vaultId } = request;
  if (location.view !== "note" && location.view !== "template")
    throw new Error("Only page and template tabs can open a page window.");
  // This also verifies that the vault is still registered and accessible.
  const notes = databaseInstance().repositoryExecute({
    operation: "listNotes",
    vaultId,
  }) as Array<{ id: string; archived: boolean; trashed: boolean }>;
  if (
    location.view === "note" &&
    !notes.some(
      (note) => note.id === location.id && !note.archived && !note.trashed,
    )
  )
    throw new Error("This page is no longer available.");
  if (location.view === "template") {
    const templates = databaseInstance().repositoryExecute({
      operation: "listTemplates",
      vaultId,
    }) as Array<{ id: string }>;
    if (!templates.some((template) => template.id === location.id))
      throw new Error("This template is no longer available.");
  }
}

async function createWindow(detached?: DetachedTabRequest) {
  const point =
    detached?.position ??
    (detached ? screen.getCursorScreenPoint() : undefined);
  const area = point
    ? screen.getDisplayNearestPoint(point).workArea
    : undefined;
  const width = area ? Math.min(840, area.width) : 1440;
  const height = area ? Math.min(820, area.height) : 940;
  const windowTitle = updatePreview
    ? `${applicationName} — Update preview (simulated)`
    : applicationName;
  const window = new BrowserWindow({
    width,
    height,
    ...(point && area
      ? {
          x: Math.round(
            Math.max(
              area.x,
              Math.min(point.x - 160, area.x + area.width - width),
            ),
          ),
          y: Math.round(
            Math.max(
              area.y,
              Math.min(point.y - 32, area.y + area.height - height),
            ),
          ),
        }
      : {}),
    minWidth: detached ? 480 : 940,
    minHeight: detached ? 400 : 640,
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
  const state: WindowState = {
    session: {
      id: detached ? randomUUID() : "main",
      kind: detached ? "page" : "primary",
      vaultId: detached?.vaultId ?? null,
      location: detached?.location ?? null,
    },
    rendererReady: false,
    workspaceLoaded: false,
    closeApproved: false,
    detaching: false,
    focusOrder: ++focusOrder,
    dropTargets: { disabled: true, targets: [] },
  };
  windows.set(window, state);
  window.on("focus", () => { state.focusOrder = ++focusOrder; });
  if (detached) window.setMenuBarVisibility(false);
  // The source tab is retained until the destination has restored its workspace.
  const workspaceReady = detached
    ? new Promise<void>((resolve, reject) => {
        state.ready = { resolve, reject };
      })
    : Promise.resolve();
  const readyTimeout = detached
    ? setTimeout(
        () =>
          state.ready?.reject(
            new Error(
              "The new window did not finish opening. Your tab remains in its original window.",
            ),
          ),
        30_000,
      )
    : undefined;

  if (!app.isPackaged) {
    window.on("page-title-updated", (event, title) => {
      event.preventDefault();
      window.setTitle(detached ? title : windowTitle);
    });
  }
  // Windows/Linux mouse thumb buttons arrive as native browser commands.
  window.on("app-command", (_event, command) => {
    if (command === "browser-backward" || command === "browser-forward") {
      window.webContents.send(
        "hyperion:navigate",
        command === "browser-backward" ? "back" : "forward",
      );
    }
  });
  // macOS mouse drivers (including Logi Options+) can emit native swipes
  // instead of DOM thumb-button events or Windows/Linux browser commands.
  window.on("swipe", (_event, direction) => {
    if (direction === "left" || direction === "right") {
      window.webContents.send(
        "hyperion:navigate",
        direction === "left" ? "back" : "forward",
      );
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-start-loading", () => {
    stopTabDrag(window);
    state.dropTargets = { disabled: true, targets: [] };
    state.navigation?.reject(new Error("The destination window reloaded before the page opened."));
    state.navigation = undefined;
    state.rendererReady = false;
    state.workspaceLoaded = false;
    state.closeApproved = false;
  });
  window.on("close", (event) => {
    if (state.closeApproved) return;
    if (state.session.kind === "primary" && windows.size > 1) {
      event.preventDefault();
      if (preparingQuit) return;
      preparingQuit = true;
      void prepareAllWindows().then(() => {
        for (const [page, pageState] of windows)
          if (pageState.session.kind === "page") page.close();
        window.close();
      }, error => {
        void dialog.showMessageBox(window, {
          type: "error",
          message: "Hyperion could not finish saving",
          detail: `${String(error)}\nYour windows will remain open.`,
          buttons: ["Keep working"],
        });
      }).finally(() => {
        preparingQuit = false;
      });
      return;
    }
    if (!state.rendererReady) return;
    event.preventDefault();
    if (state.pending || state.detaching || state.navigation || preparingQuit) return;
    void prepareWindow(window).then(
      () => window.close(),
      (error) => {
        void dialog.showMessageBox(window, {
          type: "error",
          message: "Hyperion could not finish saving",
          detail: `${String(error)}\nYour window will remain open. Retry saving before closing.`,
          buttons: ["Keep working"],
        });
      },
    );
  });
  window.on("closed", () => {
    stopTabDrag(window);
    state.navigation?.reject(new Error("The destination window closed before the page opened."));
    state.ready?.reject(
      new Error("The new window was closed before its workspace opened."),
    );
    state.pending?.resolve();
    windows.delete(window);
    if (mainWindow === window) mainWindow = null;
  });

  if (state.session.kind === "primary") mainWindow = window;
  try {
    // Observe an early workspace failure while the page is still loading.
    await Promise.all([
      useBuiltRenderer
        ? window.loadFile(join(currentDirectory, "../dist/index.html"))
        : window.loadURL(developmentUrl),
      workspaceReady,
    ]);
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  } finally {
    clearTimeout(readyTimeout);
  }
}

const ownsInstance = app.requestSingleInstanceLock();
const developmentProcessFile = ownsInstance && development
  ? join(development.profileDirectory, ".development-process.json")
  : null;
if (developmentProcessFile) {
  // The reset command must preserve a profile while its desktop instance is open.
  writeFileSync(developmentProcessFile, JSON.stringify({ pid: process.pid }));
}
if (!ownsInstance) {
  console.log(`${applicationName} is already running; focusing the existing instance.`);
  app.quit();
}
app.on("second-instance", () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  app.dock?.setIcon(applicationIcon);
  app.setAboutPanelOptions({ applicationName, iconPath: applicationIcon });
  const dataDirectoryOverride = process.env.HYPERION_DATA_DIRECTORY?.trim();
  if (development && dataDirectoryOverride && !isAbsolute(dataDirectoryOverride)) {
    throw new Error("HYPERION_DATA_DIRECTORY must be an absolute directory.");
  }
  database = new VaultLibrary({
    defaultDirectory: dataDirectoryOverride || (app.isPackaged
      ? undefined
      : development
        ? development.desktopDirectory
        : join(homedir(), ".config", "hyperion-development")),
  });
  if (development) console.log(`Development branch: ${development.branch}\nWorktree: ${development.root}\nProfile: ${app.getPath("userData")}\nData: ${database.defaultDirectory}`);
  if (database.setupInfo().activeVaultId && !database.setupInfo().error) {
    database.repositoryExecute({ operation: "captureAutomaticRevisions" });
    database.createBackup(true);
  }
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

app.on("before-quit", (event) => {
  if (quitApproved || windows.size === 0) return;
  event.preventDefault();
  if (preparingQuit) return;
  preparingQuit = true;
  void prepareAllWindows().then(
    () => {
      quitApproved = true;
      preparingQuit = false;
      app.quit();
    },
    (error) => {
      preparingQuit = false;
      void showAppMessageBox({
        type: "error",
        message: "Hyperion could not finish saving",
        detail: `${String(error)}\nYour windows will remain open.`,
        buttons: ["Keep working"],
      });
    },
  );
});
app.on("will-quit", () => {
  database?.close();
  database = null;
  if (developmentProcessFile) rmSync(developmentProcessFile, { force: true });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
