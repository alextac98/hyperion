import type { KnowledgeRepository } from "../lib/local-database";
import type { HyperionDataApi } from "./desktop-api";
import type { WindowSession } from "../../electron/window-session";
import { createSqliteEditorStorage } from "./sqlite-editor-storage";
import { SqliteKnowledgeRepository } from "./sqlite-repository";
export type { LocalAiStatus, StorageInfo } from "./desktop-api";
export const desktop = window.hyperionDesktop;
export let desktopWindow: WindowSession | undefined;
let data: HyperionDataApi | undefined = desktop;
let browser:
  | Awaited<
      ReturnType<
        typeof import("./browser-development").connectBrowserDevelopment
      >
    >
  | undefined;

export function requireDesktop() {
  if (!desktop) throw new Error("This operation requires the desktop app.");
  return desktop;
}
export function requireDataService() {
  if (!data)
    throw new Error(
      "Open Hyperion in the desktop app or start pnpm dev:web.",
    );
  return data;
}
export let knowledgeRepository: KnowledgeRepository =
  new SqliteKnowledgeRepository(data!);
export async function initializeRuntime() {
  if (desktop) {
    document.documentElement.dataset.desktopPlatform = desktop.platform;
    desktopWindow = await desktop.windowSession();
  }
  if (!desktop && import.meta.env.DEV && window.hyperionBrowserDevelopment) {
    const { connectBrowserDevelopment } = await import("./browser-development");
    browser = await connectBrowserDevelopment(
      window.hyperionBrowserDevelopment,
    );
    data = browser.data;
    knowledgeRepository = new SqliteKnowledgeRepository(data);
  }
}
export const platformRuntime = {
  get kind() {
    return browser ? ("browser-development" as const) : ("desktop" as const);
  },
  capabilities: {
    configurableStorage: Boolean(desktop),
    nativeLocalAi: Boolean(desktop),
  },
  createEditorStorage(vaultId: string) {
    return createSqliteEditorStorage(requireDataService(), vaultId);
  },
  deleteEditorDocument(vaultId: string, documentId: string) {
    return requireDataService().editorDelete(vaultId, documentId);
  },
  getStorageInfo() {
    return requireDataService().storageInfo();
  },
  chooseStorageLocation() {
    return requireDesktop().chooseStorageLocation();
  },
  getLocalAiStatus() {
    return desktop
      ? desktop.localAiStatus()
      : Promise.resolve({
          available: false,
          executionTarget: "browser" as const,
          reason: "Native local AI is unavailable in browser development.",
        });
  },
  onPrepareClose(callback: () => Promise<void>) {
    return desktop?.onPrepareClose(callback) ?? (() => {});
  },
  onConnectionError(callback: (message: string) => void) {
    return browser?.onConnectionError(callback) ?? (() => {});
  },
};
