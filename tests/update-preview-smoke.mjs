import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-update-smoke-"));
  const profile = join(directory, "profile");
  await mkdir(profile);
  Object.assign(process.env, {
    HYPERION_TEST_RENDERER: "1",
    HYPERION_UPDATE_PREVIEW: "download-error",
    HYPERION_UPDATE_PREVIEW_PROFILE: profile,
    HYPERION_DATA_DIRECTORY: join(directory, "data"),
  });
  const wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  async function until(check, message) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await wait(100);
    }
    throw new Error(message);
  }
  try {
    await import("../dist-electron/main.js");
    await until(
      () => BrowserWindow.getAllWindows().length > 0,
      "No preview window",
    );
    const window = BrowserWindow.getAllWindows()[0];
    const js = (code) => window.webContents.executeJavaScript(code);
    await until(
      () =>
        js(
          'document.querySelector(".update-icon-button")?.getAttribute("aria-label").includes("Download Hyperion")',
        ),
      "Update icon missing",
    );
    assert.match(
      await js(
        'document.querySelector(".update-icon-button").getAttribute("aria-label")',
      ),
      /Update preview/,
    );
    assert.equal(
      await js('document.querySelectorAll(".update-icon-button").length'),
      1,
    );
    await js('document.querySelector(".update-icon-button").click()');
    await until(
      () =>
        js(
          'document.querySelector(".update-icon-button")?.getAttribute("aria-label").includes("Downloading")',
        ),
      "Progress tooltip missing",
    );
    await until(
      () =>
        js(
          'document.querySelector(".update-icon-button")?.getAttribute("aria-label").includes("An error occurred")',
        ),
      "Download error missing",
    );
    const bounds = await js(
      '(() => { const r = document.querySelector(".update-icon-button").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()',
    );
    window.webContents.sendInputEvent({ type: "mouseMove", ...bounds });
    await until(
      () =>
        js(
          'document.querySelector("[role=tooltip]")?.textContent.includes("An error occurred while downloading")',
        ),
      "Hover error tooltip missing",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      window.webContents.sendInputEvent({
        type: "mouseMove",
        x: bounds.x + 100,
        y: bounds.y - 100,
      });
      await until(
        () => js('!document.querySelector("[role=tooltip]")'),
        "Tooltip did not hide after leaving",
      );
      window.webContents.sendInputEvent({ type: "mouseMove", ...bounds });
      await until(
        () =>
          js(
            'document.querySelector("[role=tooltip]")?.textContent.includes("An error occurred while downloading")',
          ),
        "Tooltip did not reappear on repeated hover",
      );
    }
    await wait(100);
    await writeFile(
      "/tmp/hyperion-error-tooltip.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await js('document.querySelector(".update-icon-button").click()');
    await until(
      () => js('!document.querySelector(".update-icon-button")'),
      "Acknowledged error icon was not dismissed",
    );
    await until(
      () =>
        js(
          'document.querySelector(".settings-content .update-controls")?.textContent.includes("download failed")',
        ),
      "Error icon did not open update settings",
    );
    await js(
      'Array.from(document.querySelectorAll(".update-controls button")).find(button => button.textContent === "Retry").click()',
    );
    await until(
      () =>
        js(
          'document.querySelector(".update-icon-button")?.getAttribute("aria-label").includes("Restart to update")',
        ),
      "Retry did not complete",
    );
    assert.match(
      await js('document.querySelector(".settings-content").textContent'),
      /Installation happens only/,
    );
    await until(
      () =>
        js(
          'document.querySelector(".settings-content .update-controls")?.textContent.includes("is ready")',
        ),
      "Settings did not load the update state",
    );
    await wait(400);
    await writeFile(
      "/tmp/hyperion-update-preview.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(
      'document.querySelector(".settings-dialog > header > button").click()',
    );
    await wait(300);
    await writeFile(
      "/tmp/hyperion-update-icon.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(
      "Update preview UI passed: available → progress → error → retry → ready; Settings verified.",
    );
    window.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
})();
