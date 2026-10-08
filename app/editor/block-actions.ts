import { BlockSelection, type BlockStdScope } from "@blocksuite/affine/std";
import { Text } from "@blocksuite/affine/store";
import { openEditorActionMenu, type EditorAction } from "./action-menu";
import { unwrapColumns } from "./blocks/columns";

export function focusBlock(std: BlockStdScope, id?: string) {
  void std.host.updateComplete.then(async () => {
    if (!std.host.isConnected || std.store.readonly) return;
    const block = id ? std.view.getBlock(id) : null;
    const editor = block?.querySelector("rich-text")?.inlineEditor;
    if (editor) {
      await editor.waitForUpdate();
      if (!editor.rootElement?.isConnected) return;
      std.host.focus({ preventScroll: true });
      editor.focusIndex(0);
    } else {
      std.host.focus({ preventScroll: true });
      if (block)
        std.selection.setGroup("note", [
          std.selection.create(BlockSelection, { blockId: block.model.id }),
        ]);
    }
  });
}

/** Page content is actionable; structural page/note containers are not. */
export function openBlockActions(
  std: BlockStdScope,
  id: string,
  anchor: HTMLElement,
  returnFocus?: () => void,
) {
  const { store } = std;
  const model = store.getModelById(id);
  const parent = model && store.getParent(model);
  if (store.readonly || !model || !parent || model.role !== "content") return;
  const index = parent.children.indexOf(model);
  const run = (action: () => string | undefined) => {
    if (store.readonly || !store.getModelById(id)) return;
    std.selection.clear();
    store.captureSync();
    const focus = action();
    store.captureSync();
    focusBlock(std, focus);
  };
  const move = (before: boolean) =>
    run(() => {
      const current = store.getModelById(id)!;
      const currentParent = store.getParent(current);
      if (!currentParent) return;
      const sibling =
        currentParent.children[
          currentParent.children.indexOf(current) + (before ? -1 : 1)
        ];
      if (sibling) store.moveBlocks([current], currentParent, sibling, before);
      return id;
    });
  const actions: EditorAction[] = [
    { label: "Move up", disabled: index === 0, run: () => move(true) },
    {
      label: "Move down",
      disabled: index === parent.children.length - 1,
      run: () => move(false),
    },
  ];
  if (model.flavour === "hyperion:columns") {
    actions.push({
      label: "Unwrap columns",
      run: () =>
        run(() => {
          let focus = unwrapColumns(store, store.getModelById(id)!);
          if (!parent.children.length)
            focus = store.addBlock(
              "affine:paragraph",
              { text: new Text() },
              parent,
            );
          return focus;
        }),
    });
  }
  actions.push({
    label: "Delete block",
    danger: true,
    run: () =>
      run(() => {
        const current = store.getModelById(id)!;
        const currentParent = store.getParent(current);
        if (!currentParent) return;
        const currentIndex = currentParent.children.indexOf(current);
        let focus = (
          currentParent.children[currentIndex + 1] ??
          currentParent.children[currentIndex - 1]
        )?.id;
        const needsParagraph =
          currentParent.children.length === 1 &&
          currentParent.flavour === "affine:note";
        store.transact(() => {
          store.deleteBlock(current);
          if (needsParagraph)
            focus = store.addBlock(
              "affine:paragraph",
              { text: new Text() },
              currentParent,
            );
        });
        return focus;
      }),
  });
  return openEditorActionMenu(anchor, "Block actions", actions, returnFocus);
}
