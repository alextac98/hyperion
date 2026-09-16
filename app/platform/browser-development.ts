import type { HyperionDataApi } from "./desktop-api";
import { saves } from "../lib/save-coordinator";
import { dataBusy, flushAll } from "../lib/data-operations";

export async function connectBrowserDevelopment(config: {
  token: string;
  branch: string;
}) {
  const clientId = crypto.randomUUID();
  const listeners = new Set<(message: string) => void>();
  let lastError = "";
  let stopped = false;
  const report = (message: string) => {
    lastError = message;
    for (const listener of listeners) listener(message);
  };
  async function request<T>(
    path: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      const response = await fetch(`/__hyperion/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: config.token, clientId, ...payload }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Development request failed.");
      return body.result as T;
    } catch (error) {
      const message =
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === "TimeoutError")
          ? "The development server is unavailable. Keep this tab open and retry saving after reconnecting."
          : error instanceof Error
            ? error.message
            : String(error);
      report(message);
      throw new Error(message);
    }
  }
  // Allow a previous document's pagehide release to arrive during a reload.
  for (let attempt = 0; ; attempt++) {
    try {
      await request("acquire");
      lastError = "";
      break;
    } catch (error) {
      if (
        attempt >= 3 ||
        !(error instanceof Error) ||
        !error.message.includes("another tab")
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const rpc = <T>(method: string, ...args: unknown[]) =>
    request<T>("rpc", { method, args });
  const data: HyperionDataApi = {
    repositoryExecute: (request) => rpc("repositoryExecute", request),
    storageInfo: () => rpc("storageInfo"),
    createBackup: (automatic = false) => rpc("createBackup", automatic),
    listBackups: () => rpc("listBackups"),
    editorPull: (vaultId, documentId) => rpc("editorPull", vaultId, documentId),
    editorPush: (vaultId, documentId, data) =>
      rpc("editorPush", vaultId, documentId, data),
    editorDelete: (vaultId, documentId) =>
      rpc("editorDelete", vaultId, documentId),
    assetGet: (vaultId, key) => rpc("assetGet", vaultId, key),
    assetSet: (vaultId, key, mimeType, data) =>
      rpc("assetSet", vaultId, key, mimeType, data),
    assetDelete: (vaultId, key) => rpc("assetDelete", vaultId, key),
    assetList: (vaultId) => rpc("assetList", vaultId),
  };
  const heartbeat = setInterval(() => {
    if (!stopped) void request("heartbeat").catch(() => {});
  }, 15000);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (saves.getState() !== "saved" || dataBusy.getSnapshot()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const release = () => {
    stopped = true;
    clearInterval(heartbeat);
    navigator.sendBeacon(
      "/__hyperion/release",
      new Blob([JSON.stringify({ token: config.token, clientId })], {
        type: "application/json",
      }),
    );
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden")
      void flushAll().catch((error) => report(String(error)));
  };
  const onPageShow = (event: PageTransitionEvent) => {
    // A restored back/forward-cache document must obtain a fresh editor session.
    if (event.persisted) window.location.reload();
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("pagehide", release);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  document.title = `[Browser Dev] Hyperion — ${config.branch}`;
  return {
    data,
    onConnectionError(callback: (message: string) => void) {
      listeners.add(callback);
      if (lastError) callback(lastError);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
