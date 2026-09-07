import {
  Archive,
  ArrowRight,
  FilePlus,
  PencilSimple,
  Plus,
  Stack,
  Star,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { PageContextMenuState } from "../application/navigation";
import type { NoteRecord } from "../lib/local-database";

export function PageContextMenu({
  state,
  note,
  onClose,
  onOpen,
  onCreatePage,
  onRename,
  onDuplicate,
  onSaveTemplate,
  onFavorite,
  onArchive,
  onTrash,
}: {
  state: PageContextMenuState;
  note: NoteRecord;
  onClose: () => void;
  onOpen: () => void;
  onCreatePage: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(
      () =>
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      0,
    );
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeMenu = () => onClose();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown")
      next = current < items.length - 1 ? current + 1 : 0;
    if (event.key === "ArrowUp")
      next = current > 0 ? current - 1 : items.length - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      className="page-context-menu"
      role="menu"
      tabIndex={-1}
      aria-label={`Actions for ${note.title}`}
      style={{ left: state.x, top: state.y }}
      onKeyDown={navigateMenu}
    >
      <button role="menuitem" onClick={run(onOpen)}>
        <ArrowRight size={16} />
        <span>Open</span>
      </button>
      <button role="menuitem" onClick={run(onRename)}>
        <PencilSimple size={16} />
        <span>Rename</span>
      </button>
      <button role="menuitem" onClick={run(onFavorite)}>
        <Star size={16} weight={note.favorite ? "fill" : "regular"} />
        <span>
          {note.favorite ? "Remove from favorites" : "Add to favorites"}
        </span>
      </button>
      <div className="context-menu-divider" role="separator" />
      {note.kind === "note" && (
        <button role="menuitem" onClick={run(onCreatePage)}>
          <Plus size={16} />
          <span>New page inside</span>
        </button>
      )}
      <button role="menuitem" onClick={run(onDuplicate)}>
        <FilePlus size={16} />
        <span>Duplicate</span>
      </button>
      <button role="menuitem" onClick={run(onSaveTemplate)}>
        <Stack size={16} />
        <span>Save as template</span>
      </button>
      <div className="context-menu-divider" role="separator" />
      <button className="archive" role="menuitem" onClick={run(onArchive)}>
        <Archive size={16} />
        <span>Archive</span>
      </button>
      <button className="danger" role="menuitem" onClick={run(onTrash)}>
        <Trash size={16} />
        <span>Trash</span>
      </button>
    </div>
  );
}
