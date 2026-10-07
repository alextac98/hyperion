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
  if (store.readonly || columns.children.length <= MIN_COLUMNS) return;
  const last = columns.children.at(-1)!;
  const previous = columns.children.at(-2)!;
  // Move complete subtrees before deleting the empty container. IDs, rich text,
  // assets, references and nested blocks all stay intact, including unknown blocks.
  store.transact(() => {
    store.moveBlocks([...last.children], previous);
    store.deleteBlock(last);
  });
}
