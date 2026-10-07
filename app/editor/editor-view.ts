import {
  configureInlineDates,
  inlineDateMenu,
  inlineDateSpec,
  installInlineDates,
} from "./inline-date";
import { MindmapViewExtension } from "@blocksuite/affine/gfx/mindmap/view";
import { supportedExtensions } from "./blocks/extensions";
import { retiredBlockFlavours } from "../../blocks/retired";
import {
  ViewExtensionManager,
  type ViewScope,
} from "@blocksuite/affine/ext-loader";
import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import {
  BlockStdScope,
  LifeCycleWatcher,
  TextSelection,
} from "@blocksuite/affine/std";
import type { Store } from "@blocksuite/affine/store";
import { PageDraggingAreaViewExtension } from "@blocksuite/affine/widgets/page-dragging-area/view";
import { ClipboardRouting } from "./clipboard";
import {
  DocModeProvider,
  EditorSettingExtension,
  FeatureFlagService,
} from "@blocksuite/affine/shared/services";
import { signal } from "@preact/signals-core";
import { BlockDragHandleExtension } from "./block-drag-handle";

import {
  customBlockViews,
  customBlockInsertion,
  applyInsertionPolicy,
} from "./blocks/views";
import { literal } from "lit/static-html.js";

const viewProviders = getInternalViewExtensions().filter(
  (extension) =>
    extension !== PageDraggingAreaViewExtension &&
    extension !== MindmapViewExtension,
);

class DragPreviewInlineDates extends LifeCycleWatcher {
  static override key = "hyperion:drag-preview-inline-dates";

  override created() {
    configureInlineDates(this.std);
  }
}

class EditorViewManager extends ViewExtensionManager {
  constructor(private readonly store: Store) {
    super(viewProviders);
  }

  override get(viewScope: ViewScope) {
    // The native drag preview asks this manager for a separate editor scope.
    // Give it the same custom views and inline dates as the source document.
    return [
      ...supportedExtensions(super.get(viewScope)),
      ...customBlockViews(this.store),
      ...(viewScope === "preview-page"
        ? [inlineDateSpec, DragPreviewInlineDates]
        : []),
    ];
  }
}

export function renderPageEditor(store: Store) {
  const viewManager = new EditorViewManager(store);
  const scope = new BlockStdScope({
    store,
    extensions: [
      ...viewManager.get("page"),
      ...customBlockInsertion(),
      inlineDateSpec,
      inlineDateMenu,
      ClipboardRouting,
      BlockDragHandleExtension,
      EditorSettingExtension({ setting$: signal({}) }),
    ],
  });
  // The upstream default returns null, which disables page drag-handle hit testing.
  scope.get(DocModeProvider).getEditorMode = () => "page";
  // Callouts are supported, but the upstream slash command is gated by default.
  scope.get(FeatureFlagService).setFlag("enable_callout", true);
  configureInlineDates(scope);
  // RangeBinding can finish an earlier selection update after notes are hidden.
  // Keep that delayed page update from clearing or replacing a native field's caret.
  const meetingControlFocused = () => {
    const active = document.activeElement;
    return (
      active instanceof Element &&
      scope.host.contains(active) &&
      active.matches(
        '.meeting-title, .meeting-date, textarea[aria-label="Meeting transcript"]',
      )
    );
  };
  const range = scope.range;
  const clearRange = range.clear.bind(range);
  range.clear = () => {
    if (!meetingControlFocused()) clearRange();
  };
  const syncTextSelection = range.syncTextSelectionToRange.bind(range);
  range.syncTextSelectionToRange = (selection) => {
    if (!meetingControlFocused()) syncTextSelection(selection);
  };
  const getView = scope.getView.bind(scope);
  scope.getView = (flavour) =>
    retiredBlockFlavours.has(flavour)
      ? null
      : (getView(flavour) ?? literal`hyperion-unavailable-block`);
  applyInsertionPolicy(scope);
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
  installInlineDates(editorContainer, scope);

  // BlockSuite progressively changes repeated Select All presses from text
  // selection into paragraph-block selection. Hyperion keeps Select All
  // text-only so an extra Cmd/Ctrl+A keeps the same selection behavior.
  viewport.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key.toLowerCase() !== "a" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [data-range-sync-exclude="true"]',
          )) ||
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

      const selectionContainer =
        event.target instanceof Element
          ? (event.target.closest(".meeting-notes-editor") ?? editorContainer)
          : editorContainer;

      const textBlocks = Array.from(
        selectionContainer.querySelectorAll<HTMLElement>(".inline-editor"),
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
