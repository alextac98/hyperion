import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

void (async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-setup-ui-"));
  app.setPath("userData", join(directory, "profile"));
  process.env.HYPERION_DATA_DIRECTORY = join(directory, "data");
  process.env.HYPERION_TEST_RENDERER = "1";
  let window;
  const choices = [];
  dialog.showOpenDialog = async () =>
    choices.shift() ?? { canceled: true, filePaths: [] };
  const errors = [];
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(predicate, message) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* Reload or async view transition. */
      }
      await wait(100);
    }
    throw new Error(message + "\n" + (await js("document.body.innerText")));
  }
  const click = (selector, text) =>
    js(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const input = (selector, value) =>
    js(
      `(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const rpc = (operation, args = {}) =>
    js(
      `window.hyperionDesktop.repositoryExecute(${JSON.stringify({ operation, ...args })})`,
    );
  const saved = () =>
    until(
      () =>
        js(
          'document.querySelector(".save-status")?.textContent.includes("Saved locally")',
        ),
      "Writes did not finish",
    );
  try {
    await import("../dist-electron/main.js");
    await until(() => {
      window = BrowserWindow.getAllWindows()[0];
      return window && !window.webContents.isLoading();
    }, "Window did not load");
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await until(
      () => js('Boolean(document.querySelector(".vault-setup form"))'),
      "Setup did not appear",
    );
    assert.equal(
      await js('document.querySelector("#vault-name").value'),
      "Hyperion",
    );
    assert.equal(
      await js('document.querySelector("#vault-starter-notes").checked'),
      true,
    );
    assert.deepEqual(await rpc("listVaults"), []);
    assert.equal(
      existsSync(join(directory, "data", "hyperion.sqlite3")),
      false,
    );
    for (const theme of ["light", "dark"]) {
      await js(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      window.setSize(1000, 940);
      await wait(350);
      await writeFile(
        `/tmp/hyperion-setup-${theme}.png`,
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    window.setMinimumSize(360, 600);
    window.setSize(440, 900);
    await wait(350);
    assert.ok(
      await js("document.documentElement.scrollWidth <= window.innerWidth"),
      "Setup overflows narrow viewport",
    );
    await writeFile(
      "/tmp/hyperion-setup-narrow.png",
      (await window.webContents.capturePage()).toPNG(),
    );
    window.setSize(1200, 940);
    await click(".vault-open-option button", "Open existing vault…");
    await until(
      () =>
        js(
          '!document.querySelector(".vault-setup").getAttribute("aria-busy").includes("true")',
        ),
      "Cancelled open did not settle",
    );
    assert.deepEqual(await rpc("listVaults"), []);

    const personal = join(directory, "Personal");
    await mkdir(personal);
    choices.push({ canceled: false, filePaths: [personal] });
    await click(".vault-location-control button", "Browse…");
    await until(
      () =>
        js(
          'document.querySelector("#vault-location").textContent.includes("Personal")',
        ),
      "Folder selection did not update",
    );
    await input("#vault-name", "Personal");
    await js('document.querySelector(".vault-setup form").requestSubmit()');
    await until(
      () => js('Boolean(document.querySelector("doc-title")?.doc?.root)'),
      "Starter editor did not load",
    );
    await saved();
    const first = (await rpc("listVaults"))[0];
    assert.equal(first.name, "Personal");
    assert.equal(
      (await js("window.hyperionDesktop.storageInfo()")).directory,
      realpathSync(personal),
    );
    const notes = await rpc("listNotes", { vaultId: first.id });
    assert.deepEqual(notes.map((note) => note.title).sort(), [
      "Connect your ideas",
      "Make it yours",
      "Welcome",
    ]);
    const welcome = notes.find((note) => note.title === "Welcome");
    const make = notes.find((note) => note.title === "Make it yours");
    assert.equal(make.parentId, welcome.id);
    assert.ok(welcome.links.some((link) => link.targetId === make.id));
    await js(
      `document.querySelector('[data-page-id="${make.id}"] .organizer-page-link').click()`,
    );
    await until(
      () => js('Boolean(document.querySelector("affine-table"))'),
      "Real table did not render",
    );
    assert.ok(
      await js(
        'document.querySelector("affine-callout").textContent.includes("Give a useful thought its own space")',
      ),
      "Callout text did not render",
    );
    assert.ok(
      await js(
        'document.querySelector(".blocksuite-mount").textContent.includes("Sketch a first version")',
      ),
      "Table content missing",
    );
    await saved();
    await wait(350);
    await writeFile(
      "/tmp/hyperion-starter-guide.png",
      (await window.webContents.capturePage()).toPNG(),
    );

    await js('document.querySelector(".workspace-button").click()');
    await click(".vault-menu button", "Create vault…");
    await until(
      () => js('Boolean(document.querySelector(".vault-setup form"))'),
      "New vault form missing",
    );
    assert.equal(
      await js('document.querySelector("#vault-starter-notes").checked'),
      false,
    );
    assert.ok(
      await js('Boolean(document.querySelector(".vault-open-option button"))'),
      "Open existing absent from creation",
    );
    await input("#vault-name", "Work");
    choices.push({ canceled: false, filePaths: [personal] });
    await click(".vault-location-control button", "Browse…");
    await until(
      () =>
        js(
          'document.querySelector("#vault-location").textContent.includes("Personal")',
        ),
      "Occupied folder selection did not settle",
    );
    await js('document.querySelector(".vault-setup form").requestSubmit()');
    await until(
      () =>
        js(
          'document.querySelector(".vault-setup-error")?.textContent.includes("empty folder")',
        ),
      "Occupied folder was not rejected",
    );
    assert.doesNotMatch(
      await js('document.querySelector(".vault-setup-error").textContent'),
      /remote method|hyperion:repository/,
    );
    const work = join(directory, "Work");
    await mkdir(work);
    choices.push({ canceled: false, filePaths: [work] });
    await click(".vault-location-control button", "Browse…");
    await until(
      () =>
        js(
          'document.querySelector("#vault-location").textContent.includes("/Work")',
        ),
      "Replacement folder did not settle",
    );
    await js('document.querySelector(".vault-setup form").requestSubmit()');
    await until(
      () =>
        js(
          'document.querySelector(".workspace-copy strong")?.textContent === "Work"',
        ),
      "Empty vault did not open",
    );
    const second = (await rpc("listVaults")).find(
      (vault) => vault.name === "Work",
    );
    assert.deepEqual(await rpc("listNotes", { vaultId: second.id }), []);
    const workPath = (await js("window.hyperionDesktop.storageInfo()"))
      .directory;
    assert.notEqual(workPath, personal);
    // Closing a vault removes only its registration. Reopening uses the same IDs.
    for (let i = 0; i < 2; i++) {
      await js('document.querySelector(".workspace-button").click()');
      await click(".vault-menu button", "Close vault");
      await until(
        () =>
          js(
            i === 0
              ? 'document.querySelector(".workspace-copy strong")?.textContent === "Personal"'
              : 'Boolean(document.querySelector(".vault-onboarding"))',
          ),
        "Closing vault did not settle",
      );
    }
    choices.push({ canceled: false, filePaths: [personal] });
    await click(".vault-open-option button", "Open existing vault…");
    await until(
      () => js('Boolean(document.querySelector("doc-title")?.doc?.root)'),
      "Existing vault did not reopen",
    );
    assert.equal((await rpc("listVaults"))[0].id, first.id);
    assert.equal((await rpc("listNotes", { vaultId: first.id })).length, 3);

    // A move drains a pending editor change and carries every backup with it.
    await js(
      `document.querySelector('[data-page-id="${welcome.id}"] .organizer-page-link').click()`,
    );
    await until(
      () =>
        js(
          `document.querySelector('doc-title')?.doc.id===${JSON.stringify(welcome.id)}`,
        ),
      "Welcome did not open",
    );
    await js(
      "document.querySelector('doc-title').doc.root.props.title.insert('My ',0)",
    );
    await click(".sidebar button", "Settings");
    await click(".settings-body nav button", "Data");
    const backups = await js("window.hyperionDesktop.listBackups()");
    const moved = join(directory, "Moved");
    await mkdir(moved);
    choices.push({ canceled: false, filePaths: [moved] });
    await click(".vault-storage-actions button", "Move vault…");
    await until(
      () =>
        js(
          'document.querySelector(".storage-location-setting").textContent.includes("Moved")',
        ),
      "Move did not update location",
    );
    assert.equal(existsSync(join(personal, "hyperion.sqlite3")), false);
    assert.ok(
      existsSync(join(workPath, "hyperion.sqlite3")),
      "Move affected a different vault",
    );
    for (const backup of backups)
      assert.ok(existsSync(join(moved, "backups", backup.name)));
    await js("location.reload()");
    await until(
      () =>
        js(
          'document.querySelector("doc-title")?.doc?.root?.props?.title?.toString() === "My Welcome"',
        ),
      "Move lost the final title or did not reopen",
    );
    assert.equal(
      (await js("window.hyperionDesktop.storageInfo()")).directory,
      realpathSync(moved),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: first launch, cancellation, custom location, rich starter blocks, empty vault, close/open identity, verified move, reload and responsive themes",
    );
  } catch (error) {
    console.error(error);
    if (window)
      await writeFile(
        "/tmp/hyperion-setup-failure.png",
        (await window.webContents.capturePage()).toPNG(),
      );
    process.exitCode = 1;
  } finally {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    app.emit("will-quit");
    await rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
})();
