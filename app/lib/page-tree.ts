import type { NoteRecord } from "./local-database";

export function comparePageOrder(first: NoteRecord, second: NoteRecord) {
  const orderDifference = first.sortOrder - second.sortOrder;
  return (
    orderDifference ||
    first.title.localeCompare(second.title) ||
    first.id.localeCompare(second.id)
  );
}

export function descendantIds(notes: NoteRecord[], parentId: string) {
  const byParent = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.parentId) continue;
    const children = byParent.get(note.parentId) ?? [];
    children.push(note.id);
    byParent.set(note.parentId, children);
  }
  const visited = new Set([parentId]);
  const descendants = new Set<string>();
  const queue = [parentId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const childId of byParent.get(queue[index]) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      descendants.add(childId);
      queue.push(childId);
    }
  }
  return descendants;
}

export function ancestorPath(
  notes: NoteRecord[] | ReadonlyMap<string, NoteRecord>,
  note: NoteRecord,
) {
  const byId = Array.isArray(notes)
    ? new Map(notes.map((item) => [item.id, item]))
    : notes;
  const path: NoteRecord[] = [];
  const visited = new Set([note.id]);
  let parentId = note.parentId;
  while (parentId && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parentId;
  }
  return path;
}
