import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Y from "yjs";
import { VaultLibrary } from "../dist-electron/vault-library.js";
import { DesktopDatabase } from "../dist-electron/database.js";
import { record } from "../dist-electron/data-format.js";

const time = "2026-01-01T00:00:00.000Z";
const vault = (id, name = id) =>
  record({ id, name, createdAt: time }, "vault", true);
const note = (id) =>
  record(
    {
      id: `${id}-page`,
      vaultId: id,
      title: "A page",
      updatedAt: time,
      collectionIds: [],
    },
    "note",
    true,
  );
const request = (id, name = id) => ({
  operation: "createVault",
  vault: vault(id, name),
  notes: [note(id)],
  collections: [],
  preferences: record({ vaultId: id }, "preferences", true),
});
const execute = (library, operation, args = {}) =>
  library.repositoryExecute({ operation, ...args });
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "hyperion-vault-test-"));
  const directory = join(root, "profile");
  const library = new VaultLibrary({ defaultDirectory: directory });
  context.after(async () => {
    library.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, directory, library };
}
function addRichData(db, id) {
  db.assetSet(id, "image", "image/png", "AQID");
  const doc = new Y.Doc();
  const blocks = doc.getMap("blocks");
  blocks.set(
    "root",
    new Y.Map([
      ["sys:flavour", "affine:page"],
      ["prop:title", new Y.Text("Title")],
      ["sys:children", Y.Array.from(["p", "image"])],
    ]),
  );
  blocks.set(
    "p",
    new Y.Map([
      ["sys:flavour", "affine:paragraph"],
      ["prop:text", new Y.Text("Rich content")],
    ]),
  );
  blocks.set(
    "image",
    new Y.Map([
      ["sys:flavour", "affine:image"],
      ["prop:sourceId", "image"],
    ]),
  );
  db.editorPush(
    id,
    `${id}-page`,
    Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
  );
  execute(db, "captureRevision", {
    vaultId: id,
    noteId: `${id}-page`,
    label: "Keep me",
  });
  doc.destroy();
}
function assertRichData(db, id) {
  assert.equal(db.assetGet(id, "image").data, "AQID");
  assert.equal(
    execute(db, "listRevisions", { vaultId: id })[0].label,
    "Keep me",
  );
  const doc = new Y.Doc();
  for (const data of db.editorPull(id, `${id}-page`))
    Y.applyUpdate(doc, Buffer.from(data, "base64"));
  assert.equal(
    doc.getMap("blocks").get("p").get("prop:text").toString(),
    "Rich content",
  );
  doc.destroy();
}

test("first launch is empty; create stores independent folders and remembers the selected vault", async (context) => {
  const { library, root, directory } = await fixture(context);
  execute(library, "initialize");
  assert.deepEqual(execute(library, "listVaults"), []);
  assert.equal(existsSync(join(directory, "hyperion.sqlite3")), false);
  library.repositoryExecute(request("one", "Hyperion"));
  const first = library.storageInfo().directory;
  const custom = join(root, "custom");
  library.repositoryExecute({ ...request("two"), directory: custom });
  assert.notEqual(first, custom);
  assert.deepEqual(
    execute(library, "listNotes", { vaultId: "one" }).map((n) => n.id),
    ["one-page"],
  );
  execute(library, "selectVault", { vaultId: "one" });
  library.close();
  const reopened = new VaultLibrary({ defaultDirectory: directory });
  try {
    assert.equal(reopened.setupInfo().activeVaultId, "one");
    assert.equal(reopened.storageInfo().directory, first);
    const second = new DesktopDatabase({ initialDirectory: custom });
    try {
      assert.deepEqual(
        execute(second, "listVaults").map((v) => v.id),
        ["two"],
      );
    } finally {
      second.close();
    }
  } finally {
    reopened.close();
  }
});

test("opening validates folders without creating files or duplicating a vault; close leaves all data intact", async (context) => {
  const { library, root } = await fixture(context);
  const empty = join(root, "empty");
  mkdirSync(empty);
  assert.throws(() => library.openVault(empty), /not found/);
  assert.equal(existsSync(join(empty, "hyperion.sqlite3")), false);
  library.repositoryExecute(request("one"));
  const path = library.storageInfo().directory;
  addRichData(library, "one");
  library.openVault(path);
  assert.equal(execute(library, "listVaults").length, 1);
  library.closeVault("one");
  assert.equal(execute(library, "listVaults").length, 0);
  library.openVault(path);
  assertRichData(library, "one");
  const other = new VaultLibrary({
    defaultDirectory: join(root, "other-profile"),
  });
  try {
    assert.throws(() => other.openVault(path), /another Hyperion/);
  } finally {
    other.close();
  }
});

test("moves preserve attachments, history and all backups, remove source data, and survive restart", async (context) => {
  const { library, root, directory } = await fixture(context);
  library.repositoryExecute(request("one"));
  addRichData(library, "one");
  const original = library.storageInfo().directory;
  const backup = library.createBackup();
  const bytes = readFileSync(backup.path);
  const moved = join(root, "moved");
  library.moveVault(moved);
  assert.equal(existsSync(join(original, "hyperion.sqlite3")), false);
  assert.deepEqual(readFileSync(join(moved, "backups", backup.name)), bytes);
  assertRichData(library, "one");
  library.close();
  const reopened = new VaultLibrary({ defaultDirectory: directory });
  try {
    assert.equal(reopened.storageInfo().directory, realpathSync(moved));
    assertRichData(reopened, "one");
  } finally {
    reopened.close();
  }
});

test("invalid destinations and payloads leave the original selected vault usable", async (context) => {
  const { library, root } = await fixture(context);
  library.repositoryExecute(request("one"));
  const original = library.storageInfo().directory;
  const occupied = join(root, "occupied");
  mkdirSync(occupied);
  writeFileSync(join(occupied, "keep.txt"), "keep");
  assert.throws(() => library.moveVault(occupied), /empty/);
  assert.throws(() => library.moveVault(join(original, "nested")), /outside/);
  assert.throws(
    () => library.repositoryExecute({ ...request("two"), directory: occupied }),
    /empty/,
  );
  assert.throws(() =>
    library.repositoryExecute({
      ...request("bad"),
      documents: { "bad-page": "invalid" },
    }),
  );
  assert.equal(library.storageInfo().directory, original);
  assert.deepEqual(
    execute(library, "listVaults").map((v) => v.id),
    ["one"],
  );
  assert.equal(readFileSync(join(occupied, "keep.txt"), "utf8"), "keep");
});

test("legacy multi-vault migration preserves IDs, links, rich content and source backups without crossing vault boundaries", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hyperion-legacy-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const legacy = new DesktopDatabase({ defaultDirectory: root });
  for (const id of ["one", "two"]) {
    const input = request(id);
    legacy.repositoryExecute(input);
    execute(legacy, "saveNote", { note: note(id) });
    addRichData(legacy, id);
  }
  const backup = legacy.createBackup();
  legacy.close();
  const library = new VaultLibrary({ defaultDirectory: root });
  try {
    assert.deepEqual(
      execute(library, "listVaults").map((v) => v.id),
      ["one", "two"],
    );
    for (const id of ["one", "two"]) {
      library.selectVault(id);
      assertRichData(library, id);
      assert.notEqual(library.storageInfo().directory, root);
      const separate = new DesktopDatabase({
        initialDirectory: library.storageInfo().directory,
      });
      try {
        assert.deepEqual(
          execute(separate, "listVaults").map((v) => v.id),
          [id],
        );
      } finally {
        separate.close();
      }
    }
    assert.ok(existsSync(backup.path));
    const original = new DesktopDatabase({ initialDirectory: root });
    try {
      assert.equal(execute(original, "listVaults").length, 2);
    } finally {
      original.close();
    }
  } finally {
    library.close();
  }
});

test("legacy single-vault storage pointers retain the original folder and skip setup", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hyperion-pointer-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, "profile");
  const custom = join(root, "custom");
  mkdirSync(profile);
  const legacy = new DesktopDatabase({ defaultDirectory: custom });
  legacy.repositoryExecute(request("one"));
  legacy.close();
  writeFileSync(join(profile, "storage-location"), custom);
  const library = new VaultLibrary({ defaultDirectory: profile });
  try {
    assert.equal(library.storageInfo().directory, custom);
    assert.equal(library.setupInfo().activeVaultId, "one");
  } finally {
    library.close();
  }
});

test("missing drives report recovery information without creating replacement databases", async (context) => {
  const { library, directory, root } = await fixture(context);
  const external = join(root, "external");
  library.repositoryExecute({ ...request("one"), directory: external });
  library.close();
  await rm(external, { recursive: true });
  const reopened = new VaultLibrary({ defaultDirectory: directory });
  try {
    assert.match(reopened.setupInfo().error, /not found/);
    assert.equal(existsSync(external), false);
    assert.equal(execute(reopened, "listVaults")[0].name, "one");
  } finally {
    reopened.close();
  }
});

test("failed registry publication rolls back a move and leaves the source usable", async (context) => {
  const { library, root, directory } = await fixture(context);
  library.repositoryExecute(request("one"));
  addRichData(library, "one");
  const source = library.storageInfo().directory;
  const registry = join(directory, "vault-library.json");
  const original = readFileSync(registry);
  await rm(registry);
  mkdirSync(registry);
  try {
    const destination = join(root, "failed-move");
    assert.throws(() => library.moveVault(destination));
    assert.equal(library.storageInfo().directory, source);
    assertRichData(library, "one");
    assert.ok(existsSync(join(source, "hyperion.sqlite3")));
    assert.equal(existsSync(join(destination, "hyperion.sqlite3")), false);
  } finally {
    await rm(registry, { recursive: true });
    writeFileSync(registry, original);
  }
});

test("a legacy shared folder can be opened alongside an existing vault without merging data", async (context) => {
  const { library, root } = await fixture(context);
  library.repositoryExecute(request("current"));
  const path = join(root, "legacy");
  const legacy = new DesktopDatabase({ defaultDirectory: path });
  for (const id of ["one", "two"]) {
    legacy.repositoryExecute(request(id));
    execute(legacy, "saveNote", { note: note(id) });
    addRichData(legacy, id);
  }
  legacy.close();
  assert.equal(library.openVault(path).id, "one");
  assert.deepEqual(
    execute(library, "listVaults").map((v) => v.id),
    ["current", "one", "two"],
  );
  assertRichData(library, "one");
  assertRichData(library, "two");
});

test("imports get their own folders and IDs, with intact history and attachments", async (context) => {
  const { library } = await fixture(context);
  library.repositoryExecute(request("one"));
  addRichData(library, "one");
  const original = library.storageInfo().directory;
  const bundle = execute(library, "exportVault", { vaultId: "one" });
  const result = execute(library, "importVault", { bundle });
  assert.notEqual(result.vault.id, "one");
  assert.notEqual(library.storageInfo().directory, original);
  assert.equal(library.assetGet(result.vault.id, "image").data, "AQID");
  assert.equal(
    execute(library, "listRevisions", { vaultId: result.vault.id })[0].label,
    "Keep me",
  );
  const vault = new DesktopDatabase({
    initialDirectory: library.storageInfo().directory,
  });
  try {
    assert.deepEqual(
      execute(vault, "listVaults").map((v) => v.id),
      [result.vault.id],
    );
  } finally {
    vault.close();
  }
});

test("first upgrade with an unavailable legacy drive preserves the pointer and reports recovery", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hyperion-legacy-missing-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const missing = join(root, "missing-drive");
  writeFileSync(join(root, "storage-location"), missing);
  for (let attempt = 0; attempt < 2; attempt++) {
    const library = new VaultLibrary({ defaultDirectory: root });
    try {
      assert.match(
        library.setupInfo().error,
        /previous vault folder was not found/,
      );
      assert.equal(existsSync(missing), false);
      assert.deepEqual(execute(library, "listVaults"), []);
    } finally {
      library.close();
    }
  }
  assert.equal(readFileSync(join(root, "storage-location"), "utf8"), missing);
});
