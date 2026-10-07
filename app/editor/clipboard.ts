import { LifeCycleWatcher, type BlockStdScope } from "@blocksuite/affine/std";

// BlockSuite listens for clipboard events on document and dispatches them to
// whichever editor was last activated. Tabs, previews, and native fields can
// leave that flag out of sync with the actual destination of the command.
function installClipboardRouting(scope: BlockStdScope) {
  const host = scope.host;
  const document = host.ownerDocument;
  const route = (event: ClipboardEvent) => {
    const path = event.composedPath();
    const nativeControl = path.some(
      (target) =>
        target instanceof Element &&
        target.matches(
          'input, textarea, select, [data-range-sync-exclude="true"]',
        ),
    );
    let belongsToEditor = path.includes(host);
    // Copying a read-only selection can target the document rather than the
    // editor, since the selected text does not have an editable focus target.
    if (
      !belongsToEditor &&
      (event.target === document ||
        event.target === document.body ||
        event.target === document.documentElement)
    ) {
      const selection = document.getSelection();
      belongsToEditor =
        !!selection &&
        host.contains(selection.anchorNode) &&
        host.contains(selection.focusNode);
    }
    scope.event.active =
      belongsToEditor &&
      !nativeControl &&
      host.isConnected &&
      !host.closest("[hidden], [inert]");
  };

  const names = ["copy", "cut", "paste"] as const;
  names.forEach((name) => document.addEventListener(name, route, true));
  return () =>
    names.forEach((name) => document.removeEventListener(name, route, true));
}

export class ClipboardRouting extends LifeCycleWatcher {
  static override readonly key = "hyperion-clipboard-routing";
  private cleanup: (() => void) | null = null;

  override mounted() {
    this.cleanup?.();
    this.cleanup = installClipboardRouting(this.std);
  }

  override unmounted() {
    this.cleanup?.();
    this.cleanup = null;
  }
}
