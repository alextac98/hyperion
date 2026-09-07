import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { BlockStdScope, TextSelection } from "@blocksuite/affine/std";
import type { Store } from "@blocksuite/affine/store";
import { PageDraggingAreaViewExtension } from "@blocksuite/affine/widgets/page-dragging-area/view";

const viewManager = new ViewExtensionManager(
  getInternalViewExtensions().filter(
    (extension) => extension !== PageDraggingAreaViewExtension,
  ),
);
const pageExtensions = viewManager.get("page");

export function renderPageEditor(store: Store) {
  const scope = new BlockStdScope({ store, extensions: pageExtensions });
  const viewport = document.createElement("div");
  viewport.className = "affine-page-viewport hyperion-blocksuite-viewport";
  viewport.dataset.theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  const title = document.createElement("doc-title") as HTMLElement & {
    doc: Store;
  };
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
      if (!first.dataset.blockId || !last.dataset.blockId) return;
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
