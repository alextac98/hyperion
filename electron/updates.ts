export type UpdateState = {
  preview?: boolean;
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  version: string | null;
  percent: number | null;
  message: string | null;
  checkedAt: string | null;
  retry: "check" | "download" | "install";
};

export type UpdateDriver = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event: "update-available" | "update-downloaded",
    listener: (info: { version: string }) => void,
  ): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(
    event: "download-progress",
    listener: (info: { percent: number }) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
};

export function createUpdates(
  updater: UpdateDriver,
  currentVersion: string,
  disabledReason: string | null,
  publish: (state: UpdateState) => void,
) {
  let state: UpdateState = {
    status: disabledReason ? "disabled" : "idle",
    currentVersion,
    version: null,
    percent: null,
    message: disabledReason,
    checkedAt: null,
    retry: "check",
  };
  let busy = false;
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    publish(state);
  };
  const fail = (message: string) =>
    set({ status: "error", message, percent: null });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on("update-available", (info) =>
    set({
      status: "available",
      version: info.version,
      checkedAt: new Date().toISOString(),
      message: null,
    }),
  );
  updater.on("update-not-available", () =>
    set({
      status: "idle",
      version: null,
      checkedAt: new Date().toISOString(),
      message: null,
    }),
  );
  updater.on("download-progress", (info) =>
    set({ percent: Math.max(0, Math.min(100, Math.floor(info.percent))) }),
  );
  updater.on("update-downloaded", (info) =>
    set({
      status: "ready",
      version: info.version,
      percent: 100,
      message: null,
    }),
  );
  updater.on("error", (error) => {
    console.error("Automatic update failed", error);
    fail(
      "The update could not be completed. Try again or download the latest installer.",
    );
  });
  return {
    getState: () => state,
    async check(background = false) {
      if (
        disabledReason ||
        busy ||
        ["available", "downloading", "ready", "installing"].includes(
          state.status,
        ) ||
        (background && state.status === "error")
      )
        return state;
      busy = true;
      set({ status: "checking", message: null, retry: "check" });
      try {
        await updater.checkForUpdates();
      } catch {
        fail(
          "Could not check for updates. Check your connection and try again.",
        );
      } finally {
        busy = false;
      }
      return state;
    },
    async download() {
      if (
        disabledReason ||
        busy ||
        !(
          state.status === "available" ||
          (state.status === "error" && state.retry === "download")
        )
      )
        return state;
      busy = true;
      set({
        status: "downloading",
        percent: 0,
        message: null,
        retry: "download",
      });
      try {
        await updater.downloadUpdate();
      } catch {
        fail(
          "The download failed. Check your connection and retry, or download the installer manually.",
        );
      } finally {
        busy = false;
      }
      return state;
    },
    prepareInstall() {
      if (
        busy ||
        !(
          state.status === "ready" ||
          (state.status === "error" && state.retry === "install")
        )
      )
        return false;
      set({ status: "installing", message: null, retry: "install" });
      return true;
    },
    install() {
      try {
        updater.quitAndInstall(false, true);
      } catch {
        fail(
          "Could not restart to install. Retry or download the installer manually.",
        );
      }
    },
    saveFailed() {
      fail(
        "Could not finish saving. Your window remains open. Retry when your work is saved.",
      );
    },
  };
}
