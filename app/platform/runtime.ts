import type { KnowledgeRepository } from "../lib/local-database";
import { createElectronEditorStorage } from "./desktop/electron-editor-storage";
import { ElectronKnowledgeRepository } from "./desktop/electron-repository";
export type { LocalAiStatus, StorageInfo } from "./desktop-api";
export const desktop = window.hyperionDesktop;
export function requireDesktop() {
  if (!desktop) throw new Error("Open Hyperion in the desktop app to access your data.");
  return desktop;
}
// Construction does not access storage; the browser displays a desktop-only launch screen.
export const knowledgeRepository: KnowledgeRepository = new ElectronKnowledgeRepository(desktop!);
export const platformRuntime = {
  kind: "desktop" as const,
  capabilities: { configurableStorage: true, nativeLocalAi: true },
  createEditorStorage(vaultId: string) { return createElectronEditorStorage(requireDesktop(), vaultId); },
  deleteEditorDocument(vaultId: string, documentId: string) { return requireDesktop().editorDelete(vaultId, documentId); },
  getStorageInfo() { return requireDesktop().storageInfo(); },
  chooseStorageLocation() { return requireDesktop().chooseStorageLocation(); },
  getLocalAiStatus() { return requireDesktop().localAiStatus(); },
};
