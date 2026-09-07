import { createEditorLoader } from "./editor-loader";
import type { NoteRecord } from "../lib/local-database";

export type { EditorStore } from "./blocksuite-runtime";
export { templateDocumentId } from "./document-id";

// Keep the editor dependency graph out of the application shell.
const loader = createEditorLoader(
  () => import("./blocksuite-runtime"),
  () => import("./editor-view"),
);
const runtime = loader.runtime;

export function preloadEditor() {
  // Speculative loading must not prevent the shell from opening. The editor
  // handles errors and can retry when the user actually opens a document.
  void loader.preload().catch(() => {});
}

export function prepareVaultEditor(vaultId: string) {
  void runtime()
    .then((loaded) => loaded.getVaultWorkspace(vaultId))
    .catch(() => {});
}

export function openEditor(
  document: Pick<NoteRecord, "vaultId" | "id" | "title" | "body">,
) {
  return loader.open((loaded) =>
    loaded.getOrCreateEditorStore(
      document.vaultId,
      document.id,
      document.title,
      document.body,
    ),
  );
}

export async function getOrCreateEditorStore(
  ...args: Parameters<
    typeof import("./blocksuite-runtime").getOrCreateEditorStore
  >
) {
  return (await runtime()).getOrCreateEditorStore(...args);
}

export async function duplicateEditorDocument(
  ...args: Parameters<
    typeof import("./blocksuite-runtime").duplicateEditorDocument
  >
) {
  return (await runtime()).duplicateEditorDocument(...args);
}

export async function exportEditorDocuments(
  ...args: Parameters<
    typeof import("./blocksuite-runtime").exportEditorDocuments
  >
) {
  return (await runtime()).exportEditorDocuments(...args);
}

export async function importEditorDocuments(
  ...args: Parameters<
    typeof import("./blocksuite-runtime").importEditorDocuments
  >
) {
  return (await runtime()).importEditorDocuments(...args);
}

export async function removeEditorDocument(
  ...args: Parameters<
    typeof import("./blocksuite-runtime").removeEditorDocument
  >
) {
  return (await runtime()).removeEditorDocument(...args);
}

export async function renameEditorDocument(note: NoteRecord, title: string) {
  return (await runtime()).renameEditorDocument(note, title);
}
