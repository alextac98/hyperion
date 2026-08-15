import { StoreExtensionManager, ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import { getInternalStoreExtensions } from "@blocksuite/affine/extensions/store";
import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { BlockStdScope, TextSelection } from "@blocksuite/affine/std";
import { TableDataManager } from "@blocksuite/affine/blocks/table";
import type { Store } from "@blocksuite/affine/store";
import { Text } from "@blocksuite/affine/store";
import { TestWorkspace } from "@blocksuite/affine/store/test";
import { PageDraggingAreaViewExtension } from "@blocksuite/affine/widgets/page-dragging-area/view";
import * as Y from "yjs";
import { platformRuntime } from "../platform/runtime";

const storeManager = new StoreExtensionManager(getInternalStoreExtensions());
const viewManager = new ViewExtensionManager(
  getInternalViewExtensions().filter(
    (extension) => extension !== PageDraggingAreaViewExtension,
  ),
);
const pageExtensions = viewManager.get("page");

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
  workspace.start();
  await workspace.waitForSynced();
  workspace.meta.initialize();
  return workspace;
}

export function getVaultWorkspace(vaultId: string) {
  let workspace = workspacePromises.get(vaultId);
  if (!workspace) {
    workspace = createWorkspace(vaultId);
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
        { type: "todo", checked: false, text: new Text(line.replace(/^□\s+/, "")) },
        noteId,
      );
    } else {
      const looksLikeHeading = previousBlank && nextBlank && line.length < 64 && !/[.!?]$/.test(line);
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
  let doc = workspace.getDoc(noteId);
  if (!doc) {
    doc = workspace.createDoc(noteId);
    const store = doc.getStore();
    store.load(() => {
      if (!store.root) addInitialBlocks(store, title, legacyBody);
      repairDuplicateRoots(store);
    });
    return store;
  }
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
    store = initializeEditorStore(vaultId, noteId, title, legacyBody);
    storePromises.set(key, store);
  }
  return store;
}

export function renderPageEditor(store: Store) {
  const scope = new BlockStdScope({ store, extensions: pageExtensions });
  const viewport = document.createElement("div");
  viewport.className = "affine-page-viewport hyperion-blocksuite-viewport";
  viewport.dataset.theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  const title = document.createElement("doc-title") as HTMLElement & { doc: Store };
  title.doc = store;
  const editorContainer = document.createElement("div");
  editorContainer.className = "page-editor hyperion-blocksuite-page";
  editorContainer.append(scope.render());

  // BlockSuite progressively changes repeated Select All presses from text
  // selection into paragraph-block selection. Hyperion keeps Select All
  // text-only so an extra Cmd/Ctrl+A can never turn the page into opaque
  // block overlays.
  viewport.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key.toLowerCase() !== "a" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        !event.composedPath().some((target) => target === editorContainer)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      type TextBlockElement = HTMLElement & {
        model?: { text?: { length: number } };
      };

      const textBlocks = Array.from(
        editorContainer.querySelectorAll<HTMLElement>(".inline-editor"),
      ).reduce<TextBlockElement[]>((blocks, inlineEditor) => {
        const block = inlineEditor.closest<HTMLElement>(
          "[data-block-id]",
        ) as TextBlockElement | null;
        if (block?.model?.text && !blocks.includes(block)) blocks.push(block);
        return blocks;
      }, []);
      if (!textBlocks.length) return;

      const first = textBlocks[0];
      const last = textBlocks[textBlocks.length - 1];
      const from = {
        blockId: first.dataset.blockId,
        index: 0,
        length: first.model?.text?.length ?? 0,
      };
      const to =
        first === last
          ? null
          : {
              blockId: last.dataset.blockId,
              index: 0,
              length: last.model?.text?.length ?? 0,
            };

      scope.selection.setGroup("note", [
        scope.selection.create(TextSelection, { from, to }),
      ]);
    },
    { capture: true },
  );

  viewport.append(title, editorContainer);
  return { viewport, scope };
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
    .filter((model) => !["affine:page", "affine:surface", "affine:note"].includes(model.flavour))
    .map((model) => model.text?.toString().trim() ?? "")
    .filter(Boolean)
    .join("\n");
  return { title, body };
}

export async function duplicateEditorDocument(vaultId: string, sourceId: string, targetId: string) {
  const workspace = await getVaultWorkspace(vaultId);
  const source = workspace.getDoc(sourceId);
  if (!source) return;
  const target = workspace.createDoc(targetId);
  target.spaceDoc.load();
  Y.applyUpdate(target.spaceDoc, Y.encodeStateAsUpdate(source.spaceDoc));
  target.getStore().load();
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
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function exportEditorDocuments(vaultId: string, noteIds: string[]) {
  const workspace = await getVaultWorkspace(vaultId);
  const result: Record<string, string> = {};
  noteIds.forEach((noteId) => {
    const doc = workspace.getDoc(noteId);
    if (doc) result[noteId] = bytesToBase64(Y.encodeStateAsUpdate(doc.spaceDoc));
  });
  return result;
}

export async function importEditorDocuments(vaultId: string, documents: Record<string, string>) {
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

export function insertTable(store: Store) {
  const parent = store.getModelsByFlavour("affine:note")[0];
  if (!parent) return;
  const blockId = store.addBlock("affine:table", {}, parent);
  const model = store.getModelById(blockId);
  if (!model) return;
  const manager = new TableDataManager(model as ConstructorParameters<typeof TableDataManager>[0]);
  manager.addNRow(3);
  manager.addNColumn(3);
  store.addBlock("affine:paragraph", {}, parent);
}

export function insertBlock(
  store: Store,
  kind: "paragraph" | "heading" | "todo" | "code" | "quote" | "callout",
) {
  const parent = store.getModelsByFlavour("affine:note")[0];
  if (!parent) return;
  if (kind === "paragraph") store.addBlock("affine:paragraph", {}, parent);
  if (kind === "heading") store.addBlock("affine:paragraph", { type: "h2" }, parent);
  if (kind === "todo") store.addBlock("affine:list", { type: "todo", checked: false }, parent);
  if (kind === "code") store.addBlock("affine:code", {}, parent);
  if (kind === "quote") store.addBlock("affine:paragraph", { type: "quote" }, parent);
  if (kind === "callout") store.addBlock("affine:callout", {}, parent);
}

export type EditorStore = Store;
