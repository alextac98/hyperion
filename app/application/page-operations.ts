import type { NoteRecord } from "../lib/local-database";
import { reconcilePageLinks } from "../lib/page-links";
import { comparePageOrder, descendantIds } from "../lib/page-tree";
import type { PageDropPlacement } from "./navigation";

const PAGE_ORDER_STEP = 1_000;

export function movePage(
  current: NoteRecord[],
  noteId: string,
  targetId: string | null,
  placement: PageDropPlacement,
  now: string,
) {
  const active = current.filter(
    (note) => note.kind === "note" && !note.trashed && !note.archived,
  );
  const source = active.find((note) => note.id === noteId);
  const target = targetId
    ? active.find((note) => note.id === targetId)
    : undefined;
  if (!source || (targetId && !target) || targetId === noteId) return current;

  const parentId =
    placement === "inside" ? targetId : (target?.parentId ?? null);
  if (
    parentId === noteId ||
    (parentId && descendantIds(active, noteId).has(parentId))
  )
    return current;

  const siblings = active
    .filter((note) => note.id !== noteId && note.parentId === parentId)
    .sort(comparePageOrder);
  let insertAt = siblings.length;
  if (placement !== "inside" && target) {
    const targetIndex = siblings.findIndex((note) => note.id === target.id);
    if (targetIndex < 0) return current;
    insertAt = targetIndex + (placement === "after" ? 1 : 0);
  }

  const ordered = [
    ...siblings.slice(0, insertAt),
    source,
    ...siblings.slice(insertAt),
  ];
  const orderById = new Map(
    ordered.map((note, index) => [note.id, (index + 1) * PAGE_ORDER_STEP]),
  );
  const changed = current.map((note) => {
    const sortOrder = orderById.get(note.id);
    if (sortOrder === undefined) return note;
    const nextParentId = note.id === noteId ? parentId : note.parentId;
    if (note.sortOrder === sortOrder && note.parentId === nextParentId)
      return note;
    return {
      ...note,
      parentId: nextParentId,
      sortOrder,
      updatedAt: note.id === noteId ? now : note.updatedAt,
    };
  });
  return changed;
}

export function patchPage(
  current: NoteRecord[],
  id: string,
  patch: Partial<NoteRecord>,
  stableTitle: string | undefined,
  now: string,
) {
  const source = current.find((note) => note.id === id);
  if (!source) return null;
  const title = typeof patch.title === "string" ? patch.title : source.title;
  const renamed =
    title.trim().toLocaleLowerCase() !==
    source.title.trim().toLocaleLowerCase();
  const previousTitle = stableTitle ?? source.title;
  const aliases =
    renamed && previousTitle.trim()
      ? [
          ...source.aliases.filter(
            (alias) =>
              alias.toLocaleLowerCase() !== title.trim().toLocaleLowerCase(),
          ),
          previousTitle.trim(),
        ]
      : source.aliases;
  const updated = { ...source, ...patch, aliases, updatedAt: now };
  const notes = current.map((note) => (note.id === id ? updated : note));
  const note = reconcilePageLinks(updated, notes);
  return {
    note,
    notes: notes.map((item) => (item.id === id ? note : item)),
    titleEdited: title !== source.title,
  };
}
