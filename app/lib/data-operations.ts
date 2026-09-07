import { flushEditorDocuments, lockEditorStores } from "../editor/blocksuite-runtime";
import { saves } from "./save-coordinator";
let busy = false;
const listeners = new Set<() => void>();
export const dataBusy = { getSnapshot: () => busy, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
export async function flushAll() {
  await saves.flush();
  await flushEditorDocuments();
  await saves.flush();
}
export async function dataOperation<T>(action: () => Promise<T>): Promise<T> {
  if (busy) throw new Error("Another data operation is still running");
  busy = true; listeners.forEach(fn => fn());
  let unlock: (() => void) | undefined;
  try { unlock = await lockEditorStores(); await flushAll(); return await action(); }
  finally { unlock?.(); busy = false; listeners.forEach(fn => fn()); }
}
