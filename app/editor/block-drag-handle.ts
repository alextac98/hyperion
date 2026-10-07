import {
  AFFINE_DRAG_HANDLE_WIDGET,
  type AffineDragHandleWidget,
} from "@blocksuite/affine/widgets/drag-handle";
import { LifeCycleWatcher, TextSelection } from "@blocksuite/affine/std";
import styles from "./block-drag-handle.css?inline";

const headingToggleSelector =
  ".affine-paragraph-rich-text-wrapper > blocksuite-toggle-button > .toggle-icon";
type HeadingToggle = HTMLElement & {
  collapsed: boolean;
  updateComplete: Promise<unknown>;
};

/** Keep BlockSuite's drag engine and customize its shadow-root grip. */
export class BlockDragHandleExtension extends LifeCycleWatcher {
  static override key = "hyperion:block-drag-handle";

  private unsubscribe?: () => void;
  private selectionFrame = 0;
  private dropCaptureTimer?: ReturnType<typeof setTimeout>;
  private headingCleanup?: () => void;

  override created() {
    const stopMonitoring = this.std.dnd.monitor({
      onDrop: ({ source }) => {
        if (
          source.data.from?.docId !== this.std.store.id ||
          source.data.bsEntity?.type !== "blocks"
        )
          return;
        // The native drop imports its snapshot asynchronously. End that undo
        // group after its microtasks finish, before the next typing action.
        clearTimeout(this.dropCaptureTimer);
        this.dropCaptureTimer = setTimeout(
          () => this.std.store.captureSync(),
          0,
        );
      },
    });
    const subscription = this.std.view.viewUpdated.subscribe((update) => {
      if (
        update.type !== "widget" ||
        update.method !== "add" ||
        update.view.widgetId !== AFFINE_DRAG_HANDLE_WIDGET
      )
        return;
      const widget = update.view as AffineDragHandleWidget;
      void widget.updateComplete.then(() => {
        if (!widget.isConnected || !widget.shadowRoot) return;
        const style = document.createElement("style");
        style.textContent = styles;
        widget.shadowRoot.append(style);

        const grip = widget.dragHandleGrabber;
        grip.setAttribute("role", "button");
        grip.tabIndex = 0;
        grip.setAttribute("aria-label", "Move block");
        grip.setAttribute(
          "aria-description",
          "Drag to move. Press Alt and the up or down arrow to reorder.",
        );
        grip.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
        grip.title = "Drag to move · Alt+↑/↓ to reorder";
        widget.disposables.addFromEvent(grip, "keydown", (event) => {
          const block = widget.anchorBlockComponent.peek();
          if (!block || widget.store.readonly || widget.dragging) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            widget.selectionHelper.setSelectedBlocks([block]);
          } else if (
            event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const parent = widget.store.getParent(block.model);
            if (!parent) return;
            const index = parent.children.indexOf(block.model);
            const before = event.key === "ArrowUp";
            const sibling = parent.children[index + (before ? -1 : 1)];
            if (!sibling) return;
            widget.store.captureSync();
            widget.store.moveBlocks([block.model], parent, sibling, before);
            widget.store.captureSync();
            widget.selectionHelper.setSelectedBlocks([block]);
            void this.std.host.updateComplete.then(() => {
              if (!widget.isConnected || widget.store.readonly) return;
              this.std.view
                .getBlock(block.model.id)
                ?.scrollIntoView({ block: "nearest" });
              // Scrolling hides the upstream grip. Restore it after layout settles.
              requestAnimationFrame(() => {
                if (!widget.isConnected || widget.store.readonly) return;
                widget.anchorBlockId.value = block.model.id;
                widget.pointerEventWatcher.showDragHandleOnHoverBlock();
                grip.focus({ preventScroll: true });
              });
            });
          }
        });
      });
    });
    // BlockSuite focuses the page root, so use the caret's block when navigating
    // with the keyboard. Each editor owns its subscription, including split panes.
    const selectionSubscription = this.std.selection.slots.changed.subscribe(
      () => {
        cancelAnimationFrame(this.selectionFrame);
        this.selectionFrame = requestAnimationFrame(() => {
          const selection = this.std.selection.find(TextSelection);
          if (
            this.std.store.readonly ||
            !selection ||
            selection.to ||
            selection.from.length ||
            !this.std.host.contains(document.activeElement)
          )
            return;
          const rootId = this.std.store.root?.id;
          if (!rootId) return;
          const widget = this.std.view.getWidget(
            AFFINE_DRAG_HANDLE_WIDGET,
            rootId,
          ) as AffineDragHandleWidget | null;
          if (!widget?.dragHandleContainer || widget.dragging) return;
          widget.anchorBlockId.value = selection.from.blockId;
          widget.pointerEventWatcher.showDragHandleOnHoverBlock();
        });
      },
    );
    this.unsubscribe = () => {
      stopMonitoring();
      subscription.unsubscribe();
      selectionSubscription.unsubscribe();
    };
  }

  override mounted() {
    const prepare = (element: HTMLElement) => {
      if (!element.isConnected) return;
      const toggle = element.parentElement as HeadingToggle;
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.setAttribute("aria-expanded", String(!toggle.collapsed));
      element.setAttribute(
        "aria-label",
        toggle.collapsed ? "Expand section" : "Collapse section",
      );
    };
    const scan = (element: Element) => {
      if (element.matches(headingToggleSelector))
        prepare(element as HTMLElement);
      element
        .querySelectorAll<HTMLElement>(headingToggleSelector)
        .forEach(prepare);
    };
    // The native disclosure replaces its element when it changes direction.
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element) scan(node);
    });
    observer.observe(this.std.host, { childList: true, subtree: true });
    scan(this.std.host);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key !== "Enter" && event.key !== " ") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof Element)
      )
        return;
      const control = event.target.closest<HTMLElement>(headingToggleSelector);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      const toggle = control.parentElement as HeadingToggle;
      const paragraph = control.closest("affine-paragraph") as
        | (HTMLElement & { updateComplete: Promise<unknown> })
        | null;
      control.click();
      void paragraph?.updateComplete
        .then(() => toggle.updateComplete)
        .then(() => {
          const replacement = toggle.querySelector<HTMLElement>(".toggle-icon");
          if (!replacement?.isConnected) return;
          prepare(replacement);
          replacement.focus({ preventScroll: true });
        });
    };
    this.std.host.addEventListener("keydown", onKeyDown, { capture: true });
    this.headingCleanup = () => {
      observer.disconnect();
      this.std.host.removeEventListener("keydown", onKeyDown, {
        capture: true,
      });
    };
  }

  override unmounted() {
    this.unsubscribe?.();
    this.headingCleanup?.();
    cancelAnimationFrame(this.selectionFrame);
    clearTimeout(this.dropCaptureTimer);
  }
}
