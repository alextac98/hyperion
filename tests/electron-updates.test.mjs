import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createUpdates } from "../dist-electron/updates.js";

function setup(disabled = null) {
  const updater = new EventEmitter();
  let checks = 0,
    downloads = 0,
    installs = 0;
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit("update-available", { version: "0.4.0" });
  };
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit("download-progress", { percent: 45.8 });
    updater.emit("update-downloaded", { version: "0.4.0" });
  };
  updater.quitAndInstall = () => {
    installs++;
  };
  const states = [];
  const service = createUpdates(updater, "0.1.0", disabled, (state) =>
    states.push(state),
  );
  return {
    updater,
    service,
    states,
    counts: () => ({ checks, downloads, installs }),
  };
}

test("skipped-version update reports progress and waits for explicit installation", async () => {
  const { updater, service, states, counts } = setup();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await service.check();
  assert.equal(service.getState().version, "0.4.0");
  assert.equal(counts().downloads, 0);
  await service.download();
  assert.ok(states.some((s) => s.status === "downloading" && s.percent === 45));
  assert.equal(service.getState().status, "ready");
  await service.check(true);
  assert.equal(counts().checks, 1);
  assert.equal(service.prepareInstall(), true);
  assert.equal(counts().installs, 0);
  service.install();
  assert.equal(counts().installs, 1);
});

test("download failure is retryable and periodic checks preserve the error", async () => {
  const { updater, service, counts } = setup();
  await service.check();
  const download = updater.downloadUpdate;
  updater.downloadUpdate = async () => {
    throw new Error("offline");
  };
  await service.download();
  assert.equal(service.getState().status, "error");
  assert.equal(service.getState().retry, "download");
  await service.check(true);
  assert.equal(counts().checks, 1);
  updater.downloadUpdate = download;
  await service.download();
  assert.equal(service.getState().status, "ready");
});

test("concurrent checks and download requests do not duplicate work", async () => {
  const { updater, service, counts } = setup();
  let finish;
  updater.checkForUpdates = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = service.check();
  await service.check();
  await service.download();
  assert.equal(counts().downloads, 0);
  updater.emit("update-available", { version: "0.4.0" });
  await service.download();
  assert.equal(counts().downloads, 0);
  finish();
  await first;
  await service.download();
  assert.equal(counts().downloads, 1);
});

test("saving failure prevents installation and allows another explicit attempt", async () => {
  const { service, counts } = setup();
  await service.check();
  await service.download();
  assert.equal(service.prepareInstall(), true);
  service.saveFailed();
  assert.equal(counts().installs, 0);
  assert.equal(service.getState().retry, "install");
  assert.equal(service.prepareInstall(), true);
});

test("unavailable updater cannot check or download", async () => {
  const { service, counts } = setup("Run the AppImage to update.");
  await service.check();
  await service.download();
  assert.equal(service.getState().status, "disabled");
  assert.deepEqual(counts(), { checks: 0, downloads: 0, installs: 0 });
});

test("preview download failure retries successfully and restart only runs explicitly", async () => {
  const { createUpdatePreview } = await import(
    "../dist-electron/update-preview.js"
  );
  let restarts = 0;
  const driver = createUpdatePreview(
    "download-error",
    "0.1.1",
    false,
    () => {
      restarts++;
    },
    async () => {},
  );
  const service = createUpdates(driver, "0.1.0", null, () => {});
  await service.check();
  await service.download();
  assert.equal(service.getState().status, "error");
  await service.download();
  assert.equal(service.getState().status, "ready");
  assert.equal(restarts, 0);
  service.prepareInstall();
  service.install();
  assert.equal(restarts, 1);
});

test("preview check failure recovers and simulated installed version stays up to date", async () => {
  const { createUpdatePreview } = await import(
    "../dist-electron/update-preview.js"
  );
  const service = createUpdates(
    createUpdatePreview(
      "check-error",
      "0.1.1",
      false,
      () => {},
      async () => {},
    ),
    "0.1.0",
    null,
    () => {},
  );
  await service.check();
  assert.equal(service.getState().status, "error");
  await service.check();
  assert.equal(service.getState().status, "available");
  const installed = createUpdates(
    createUpdatePreview(
      "success",
      "0.1.1",
      true,
      () => {},
      async () => {},
    ),
    "0.1.1",
    null,
    () => {},
  );
  await installed.check();
  assert.equal(installed.getState().status, "idle");
  assert.equal(installed.getState().currentVersion, "0.1.1");
});
