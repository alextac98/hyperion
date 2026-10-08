import { Text, type BlockModel, type Store } from "@blocksuite/affine/store";

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

/** Use ordinary notes so each column supports the page's native rich blocks. */
export function appendColumn(store: Store, columns: BlockModel | string) {
  let paragraph = "";
  store.transact(() => {
    const note = store.addBlock("affine:note", { displayMode: "doc" }, columns);
    paragraph = store.addBlock(
      "affine:paragraph",
      { type: "text", text: new Text() },
      note,
    );
  });
  return paragraph;
}

export function removeLastColumn(store: Store, columns: BlockModel) {
  return removeColumn(store, columns, columns.children.at(-1)?.id ?? "");
}

/** Reorder the existing note, retaining its IDs and complete content subtree. */
export function moveColumn(
  store: Store,
  columns: BlockModel,
  id: string,
  targetId: string,
  before: boolean,
) {
  if (store.readonly) return false;
  const source = columns.children.find((column) => column.id === id);
  const target = columns.children.find((column) => column.id === targetId);
  if (!source || !target || source === target) return false;
  const order = columns.children.map((column) => column.id);
  const next = order.filter((column) => column !== id);
  next.splice(next.indexOf(targetId) + (before ? 0 : 1), 0, id);
  if (next.every((column, index) => column === order[index])) return false;
  store.captureSync();
  store.moveBlocks([source], columns, target, before);
  store.captureSync();
  return true;
}

export function removeColumn(store: Store, columns: BlockModel, id: string) {
  if (store.readonly || columns.children.length <= MIN_COLUMNS) return;
  const index = columns.children.findIndex((column) => column.id === id);
  if (index < 0) return;
  const column = columns.children[index];
  const neighbor = columns.children[index - 1] ?? columns.children[index + 1];
  // Move complete subtrees before deleting the empty container. IDs, rich text,
  // assets, references and nested blocks all stay intact, including unknown blocks.
  store.transact(() => {
    store.moveBlocks(
      [...column.children],
      neighbor,
      index === 0 ? neighbor.children[0] : undefined,
      true,
    );
    store.deleteBlock(column);
  });
  return neighbor.id;
}

/** Flatten column content at the layout's position, in its current reading order. */
export function unwrapColumns(store: Store, columns: BlockModel) {
  const parent = store.getParent(columns);
  if (store.readonly || !parent) return;
  const children = columns.children.flatMap((column) => [...column.children]);
  store.transact(() => {
    // Move each contiguous group separately: the native cross-parent move
    // advances its insertion index once per group, not by the group's size.
    for (const column of columns.children) {
      if (column.children.length)
        store.moveBlocks([...column.children], parent, columns, true);
    }
    store.deleteBlock(columns);
  });
  return children[0]?.id;
}
