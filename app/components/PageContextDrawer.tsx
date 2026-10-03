import { PushPin, X } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { PageContextView } from "../hooks/usePageContext";

const titles: Record<PageContextView, string> = {
  outline: "Outline",
  connections: "Connections",
  history: "Version history",
  properties: "Page properties",
};

export function PageContextDrawer({
  view,
  pinned,
  busy,
  onPin,
  onClose,
  children,
}: {
  view: PageContextView;
  pinned: boolean;
  busy: boolean;
  onPin: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = drawer.current;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    element?.addEventListener("keydown", dismiss);
    return () => element?.removeEventListener("keydown", dismiss);
  }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body ||
          document.activeElement?.closest("#page-context-drawer"))
      )
        previous.focus({ preventScroll: true });
    };
  }, [view]);
  return (
    <>
      <button
        type="button"
        className="page-context-scrim"
        aria-label="Dismiss page context"
        disabled={busy}
        onClick={onClose}
      />
      <aside
        ref={drawer}
        id="page-context-drawer"
        className={`page-context-drawer${view === "history" ? " history-open" : ""}`}
        aria-labelledby="page-context-title"
      >
        <header className="page-context-header">
          <h2 ref={heading} id="page-context-title" tabIndex={-1}>
            {titles[view]}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={pinned ? "Unpin page context" : "Pin page context"}
            title={
              pinned
                ? "Close when switching pages"
                : "Keep open across pages and launches"
            }
            aria-pressed={pinned}
            disabled={busy}
            onClick={onPin}
          >
            <PushPin size={17} weight={pinned ? "fill" : "regular"} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close page context"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="page-context-body">{children}</div>
      </aside>
    </>
  );
}
