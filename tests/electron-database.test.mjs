import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopDatabase } from "../dist-electron/database.js";

function seedRequest() {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    operation: "initialize",
    vault: {
      id: "vault",
      name: "Test vault",
      description: "",
      color: "#6f63d9",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    notes: [{
      id: "note",
      vaultId: "vault",
      title: "Persisted note",
      updatedAt: timestamp,
      collectionIds: ["collection"],
    }],
    collections: [{
      id: "collection",
      vaultId: "vault",
      name: "Test collection",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    preferences: {
      vaultId: "vault",
      theme: "system",
    },
  };
}

test("SQLite persists knowledge records, editor updates, and assets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hyperion-electron-database-"));
  const defaultDirectory = join(root, "default");
  let database = new DesktopDatabase({ defaultDirectory });
  context.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  database.repositoryExecute(seedRequest());
  database.editorPush("vault", "note", Buffer.from([1, 2, 3]).toString("base64"));
  database.assetSet("vault", "image", "image/png", Buffer.from([4, 5, 6]).toString("base64"));
  database.close();

  database = new DesktopDatabase({ defaultDirectory });
  const notes = database.repositoryExecute({ operation: "listNotes", vaultId: "vault" });
  assert.equal(notes[0].title, "Persisted note");
  assert.deepEqual(
    database.editorPull("vault", "note").map((value) => [...Buffer.from(value, "base64")]),
    [[1, 2, 3]],
  );
  assert.deepEqual(database.assetGet("vault", "image"), {
    mimeType: "image/png",
    data: Buffer.from([4, 5, 6]).toString("base64"),
  });
});

test("changing storage folders migrates and remembers the database", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hyperion-electron-storage-"));
  const defaultDirectory = join(root, "default");
  const customDirectory = join(root, "custom");
  let database = new DesktopDatabase({ defaultDirectory });
  context.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  database.repositoryExecute(seedRequest());
  const selected = await database.setStorageDirectory(customDirectory);
  assert.equal(selected.directory, customDirectory);
  assert.equal(selected.isDefault, false);
  assert.ok(existsSync(join(customDirectory, "hyperion.sqlite3")));
  database.close();

  database = new DesktopDatabase({ defaultDirectory });
  assert.equal(database.storageInfo().directory, customDirectory);
  const vaults = database.repositoryExecute({ operation: "listVaults" });
  assert.equal(vaults[0].name, "Test vault");
});
