import { saves } from "../lib/save-coordinator";
import { StoreExtensionManager } from "@blocksuite/affine/ext-loader";
import { getInternalStoreExtensions } from "@blocksuite/affine/extensions/store";
import type { Store } from "@blocksuite/affine/store";
import { Text } from "@blocksuite/affine/store";
import { TestWorkspace } from "@blocksuite/affine/store/test";
import * as Y from "yjs";
import type { NoteRecord } from "../lib/local-database";
import { platformRuntime } from "../platform/runtime";

const storeManager = new StoreExtensionManager(getInternalStoreExtensions());
const workspacePromises = new Map<string, Promise<TestWorkspace>>();
const storePromises = new Map<string, Promise<Store>>();

function repairDuplicateRoots(store: Store) {
  const roots = store.getModelsByFlavour("affine:page");
  const activeRoot = store.root;
  if (roots.length < 2 || !activeRoot) return;

  // A short-lived development build could initialize the same new document
  // twice under React Strict Mode. BlockSuite expects exactly one page root,
  // so remove only the disconnected roots and their descendants while keeping
  // the root BlockSuite already selected as active.
  const blocks = store.doc.yBlocks;
  const removeTree = (id: string) => {
    const block = blocks.get(id);
    const children = block?.get("sys:children");
    if (children instanceof Y.Array) {
      children.toArray().forEach((childId) => removeTree(String(childId)));
    }
    blocks.delete(id);
  };

  store.spaceDoc.transact(() => {
    roots.forEach((root) => {
      if (root.id !== activeRoot.id) removeTree(root.id);
    });
  }, "hyperion:repair-duplicate-roots");
  store.resetHistory();
}

async function createWorkspace(vaultId: string) {
  const storage = platformRuntime.createEditorStorage(vaultId);
  const workspace = new TestWorkspace({
    id: `hyperion:${vaultId}`,
    docSources: { main: storage.doc },
    blobSources: { main: storage.blobs },
  });
  workspace.storeExtensions = storeManager.get("store");
  const setBlob = workspace.blobSync.set.bind(workspace.blobSync);
  workspace.blobSync.set = ((valueOrKey: string | Blob, value?: Blob) =>
    saves.track(() =>
      typeof valueOrKey === "string"
        ? setBlob(valueOrKey, value!)
        : setBlob(valueOrKey),
    )) as typeof workspace.blobSync.set;
  workspace.start();
  await workspace.waitForSynced();
  workspace.meta.initialize();
  return workspace;
}

export function getVaultWorkspace(vaultId: string) {
  let workspace = workspacePromises.get(vaultId);
  if (!workspace) {
    workspace = createWorkspace(vaultId).catch((error: unknown) => {
      workspacePromises.delete(vaultId);
      throw error;
    });
    workspacePromises.set(vaultId, workspace);
  }
  return workspace;
}

function addInitialBlocks(store: Store, title: string, body: string) {
  const rootId = store.addBlock("affine:page", { title: new Text(title) });
  store.addBlock("affine:surface", {}, rootId);
  const noteId = store.addBlock(
    "affine:note",
    { xywh: "[0, 0, 800, 640]" },
    rootId,
  );
  const lines = body ? body.split("\n") : [""];
  let previousBlank = true;
  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const nextBlank = !lines[index + 1]?.trim();
    if (!line.trim()) {
      previousBlank = true;
      return;
    }
    if (/^[•*-]\s+/.test(line)) {
      store.addBlock(
        "affine:list",
        { type: "bulleted", text: new Text(line.replace(/^[•*-]\s+/, "")) },
        noteId,
      );
    } else if (/^□\s+/.test(line)) {
      store.addBlock(
        "affine:list",
        {
          type: "todo",
          checked: false,
          text: new Text(line.replace(/^□\s+/, "")),
        },
        noteId,
      );
    } else {
      const looksLikeHeading =
        previousBlank && nextBlank && line.length < 64 && !/[.!?]$/.test(line);
      store.addBlock(
        "affine:paragraph",
        { type: looksLikeHeading ? "h2" : "text", text: new Text(line) },
        noteId,
      );
    }
    previousBlank = false;
  });
  if (!store.getModelsByFlavour(["affine:paragraph", "affine:list"]).length) {
    store.addBlock("affine:paragraph", {}, noteId);
  }
  store.resetHistory();
}

async function initializeEditorStore(
  vaultId: string,
  noteId: string,
  title: string,
  legacyBody: string,
) {
  const workspace = await getVaultWorkspace(vaultId);
  const doc = workspace.getDoc(noteId) ?? workspace.createDoc(noteId);
  doc.spaceDoc.load();
  await workspace.docSync.waitForSynced(AbortSignal.timeout(15000));
  const store = doc.getStore();
  store.load(() => {
    if (!store.root) addInitialBlocks(store, title, legacyBody);
    repairDuplicateRoots(store);
  });
  return store;
}

export function getOrCreateEditorStore(
  vaultId: string,
  noteId: string,
  title: string,
  legacyBody: string,
) {
  const key = `${vaultId}:${noteId}`;
  let store = storePromises.get(key);
  if (!store) {
    store = initializeEditorStore(vaultId, noteId, title, legacyBody).catch(
      (error: unknown) => {
        storePromises.delete(key);
        throw error;
      },
    );
    storePromises.set(key, store);
  }
  return store;
}

export function readEditorMetadata(store: Store) {
  type TreeModel = {
    flavour: string;
    text?: { toString(): string };
    children?: TreeModel[];
    props?: { title?: { toString(): string } };
  };

  const root = store.root as TreeModel | null;
  const title = root?.props?.title?.toString() || "Untitled";
  const models: TreeModel[] = [];
  const visit = (model: TreeModel) => {
    models.push(model);
    model.children?.forEach(visit);
  };
  if (root) visit(root);
  const body = models
    .filter(
      (model) =>
        !["affine:page", "affine:surface", "affine:note"].includes(
          model.flavour,
        ),
    )
    .map((model) => model.text?.toString().trim() ?? "")
    .filter(Boolean)
    .join("\n");
  return { title, body };
}

export { templateDocumentId } from "./document-id";

export async function duplicateEditorDocument(
  vaultId: string,
  sourceId: string,
  targetId: string,
  options: { title?: string } = {},
) {
  const workspace = await getVaultWorkspace(vaultId);
  const source = workspace.getDoc(sourceId);
  if (!source) return false;
  source.spaceDoc.load();
  await workspace.docSync.waitForSynced(AbortSignal.timeout(15000));
  const target = workspace.createDoc(targetId);
  target.spaceDoc.load();
  Y.applyUpdate(target.spaceDoc, Y.encodeStateAsUpdate(source.spaceDoc));
  const store = target.getStore();
  store.load();
  if (options.title && store.root) {
    store.updateBlock(store.root, { title: new Text(options.title) });
  }
  store.resetHistory();
  return true;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function exportEditorDocuments(
  vaultId: string,
  noteIds: string[],
) {
  const workspace = await getVaultWorkspace(vaultId);
  const result: Record<string, string> = {};
  noteIds.forEach((noteId) => {
    const doc = workspace.getDoc(noteId);
    if (doc)
      result[noteId] = bytesToBase64(Y.encodeStateAsUpdate(doc.spaceDoc));
  });
  return result;
}

export async function importEditorDocuments(
  vaultId: string,
  documents: Record<string, string>,
) {
  const workspace = await getVaultWorkspace(vaultId);
  Object.entries(documents).forEach(([noteId, value]) => {
    const doc = workspace.getDoc(noteId) ?? workspace.createDoc(noteId);
    doc.spaceDoc.load();
    Y.applyUpdate(doc.spaceDoc, base64ToBytes(value));
    doc.getStore().load();
  });
}

export async function removeEditorDocument(vaultId: string, noteId: string) {
  const workspace = await getVaultWorkspace(vaultId);
  if (workspace.getDoc(noteId)) workspace.removeDoc(noteId);
  await platformRuntime.deleteEditorDocument(vaultId, noteId);
  storePromises.delete(`${vaultId}:${noteId}`);
}

export type EditorStore = Store;

// Wait for BlockSuite's root and loaded subdocuments to reach durable primary storage.
export async function flushEditorDocuments() {
  for (const promise of workspacePromises.values()) {
    const workspace = await promise;
    await workspace.docSync.waitForSynced(AbortSignal.timeout(15000));
  }
}
export async function stopEditorWorkspaces() {
  await flushEditorDocuments();
  for (const promise of workspacePromises.values()) (await promise).forceStop();
}
export async function previewRevision(
  vaultId: string,
  encoded: string | null | undefined,
  note: { title: string; body: string },
) {
  const storage = platformRuntime.createEditorStorage(vaultId);
  const workspace = new TestWorkspace({
    id: `preview:${crypto.randomUUID()}`,
    blobSources: {
      main: {
        ...storage.blobs,
        name: "history-assets",
        readonly: true,
        get: (key) => storage.blobs.get(key),
        list: () => storage.blobs.list(),
        set: async () => {
          throw new Error("History is read-only");
        },
        delete: async () => {
          throw new Error("History is read-only");
        },
      },
    },
  });
  workspace.storeExtensions = storeManager.get("store");
  workspace.meta.initialize();
  const doc = workspace.createDoc();
  doc.spaceDoc.load();
  if (encoded) Y.applyUpdate(doc.spaceDoc, base64ToBytes(encoded));
  const store = doc.getStore();
  store.load();
  if (!store.root) addInitialBlocks(store, note.title, note.body);
  store.readonly = true;
  const { renderPageEditor } = await import("./editor-view");
  const { viewport } = renderPageEditor(store);
  return {
    viewport,
    dispose: () => {
      workspace.forceStop();
      workspace.dispose();
      workspace.doc.destroy();
    },
  };
}
export async function lockEditorStores() {
  const stores = await Promise.all(storePromises.values());
  const previous = stores.map((store) => store.readonly);
  stores.forEach((store) => {
    store.readonly = true;
  });
  return () =>
    stores.forEach((store, index) => {
      store.readonly = previous[index];
    });
}

export async function renameEditorDocument(note: NoteRecord, title: string) {
  const store = await getOrCreateEditorStore(
    note.vaultId,
    note.id,
    note.title,
    note.body,
  );
  if (!store.root)
    throw new Error("This page could not be opened for renaming.");
  store.updateBlock(store.root, { title: new Text(title) });
}

export async function forgetVaultWorkspace(vaultId: string) {
  const promise = workspacePromises.get(vaultId);
  if (promise) {
    const workspace = await promise;
    workspace.forceStop();
    workspace.dispose();
    workspace.doc.destroy();
  }
  workspacePromises.delete(vaultId);
  for (const key of storePromises.keys())
    if (key.startsWith(`${vaultId}:`)) storePromises.delete(key);
}
