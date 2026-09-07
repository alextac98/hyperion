import { CaretDown, CaretRight, Plus } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type {
  PageDropPlacement,
  PageDropTarget,
  View,
} from "../application/navigation";
import type { NoteRecord } from "../lib/local-database";
import { comparePageOrder, descendantIds } from "../lib/page-tree";
import { PageIcon } from "./PageIcon";

const PAGE_DRAG_TYPE = "application/x-hyperion-page";

export function SidebarSectionHeading({
  label,
  expanded,
  onToggle,
  action,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading-row">
      <button
        className="section-heading"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>{label}</span>
        {expanded ? <CaretDown size={13} /> : <CaretRight size={13} />}
      </button>
      {action}
    </div>
  );
}

export function SidebarOrganizer({
  notes,
  view,
  activeNoteId,
  onCreatePage,
  onMoveNote,
  onOpenNote,
  onContextMenu,
}: {
  notes: NoteRecord[];
  view: View;
  activeNoteId: string;
  onCreatePage: (parentId: string | null) => void;
  onMoveNote: (
    noteId: string,
    targetId: string | null,
    placement?: PageDropPlacement,
  ) => void;
  onOpenNote: (noteId: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, noteId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        notes
          .filter((note) => notes.some((child) => child.parentId === note.id))
          .map((note) => note.id),
      ),
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PageDropTarget | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const noteIds = new Set(notes.map((note) => note.id));
  const byParent = new Map<string | null, NoteRecord[]>();
  notes.forEach((note) => {
    const parentId =
      note.parentId && noteIds.has(note.parentId) && note.parentId !== note.id
        ? note.parentId
        : null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), note]);
  });
  byParent.forEach((pages) => pages.sort(comparePageOrder));

  const togglePage = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginDrag = (event: React.DragEvent<HTMLElement>, noteId: string) => {
    draggedIdRef.current = noteId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PAGE_DRAG_TYPE, noteId);
    event.dataTransfer.setData("text/plain", noteId);
    const row = event.currentTarget.closest(".organizer-page-row");
    if (row) event.dataTransfer.setDragImage(row, 16, 16);
    setDraggedId(noteId);
    setDropTarget(null);
  };

  const clearDrag = () => {
    draggedIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  };

  const draggedPageId = (event: React.DragEvent<HTMLElement>) =>
    event.dataTransfer.getData(PAGE_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain") ||
    draggedIdRef.current;

  const dropPlacement = (
    event: React.DragEvent<HTMLElement>,
  ): PageDropPlacement => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientY - bounds.top) / bounds.height;
    if (position < 0.28) return "before";
    if (position > 0.72) return "after";
    return "inside";
  };

  const canDrop = (
    noteId: string,
    target: NoteRecord,
    placement: PageDropPlacement,
  ) => {
    if (noteId === target.id) return false;
    const parentId = placement === "inside" ? target.id : target.parentId;
    return (
      parentId !== noteId &&
      (!parentId || !descendantIds(notes, noteId).has(parentId))
    );
  };

  const finishDrop = (
    noteId: string | null,
    targetId: string | null,
    placement: PageDropPlacement,
  ) => {
    const target = targetId
      ? notes.find((note) => note.id === targetId)
      : undefined;
    if (
      !noteId ||
      (targetId && (!target || !canDrop(noteId, target, placement)))
    ) {
      clearDrag();
      return;
    }
    onMoveNote(noteId, targetId, placement);
    const parentToExpand = placement === "inside" ? targetId : target?.parentId;
    if (parentToExpand)
      setExpanded((current) => new Set(current).add(parentToExpand));
    clearDrag();
  };

  const renderPage = (note: NoteRecord, depth: number): React.ReactNode => {
    const children = byParent.get(note.id) ?? [];
    const isExpanded = expanded.has(note.id);
    const placement =
      dropTarget?.noteId === note.id ? dropTarget.placement : null;
    return (
      <div className="organizer-page" key={note.id}>
        <div
          className={`organizer-page-row${view === "note" && activeNoteId === note.id ? " active" : ""}${placement ? ` drop-${placement}` : ""}${draggedId === note.id ? " dragging" : ""}`}
          data-page-id={note.id}
          data-drop-placement={placement ?? undefined}
          style={
            {
              paddingLeft: `${depth * 14 + 2}px`,
              "--organizer-drop-inset": `${depth * 14 + 10}px`,
            } as React.CSSProperties
          }
          onContextMenu={(event) => onContextMenu(event, note.id)}
          onDragOver={(event) => {
            event.stopPropagation();
            const sourceId = draggedIdRef.current ?? draggedId;
            const nextPlacement = dropPlacement(event);
            if (!sourceId || !canDrop(sourceId, note, nextPlacement)) {
              event.dataTransfer.dropEffect = "none";
              setDropTarget(null);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget((current) =>
              current?.noteId === note.id && current.placement === nextPlacement
                ? current
                : { noteId: note.id, placement: nextPlacement },
            );
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            finishDrop(draggedPageId(event), note.id, dropPlacement(event));
          }}
        >
          {children.length ? (
            <button
              className="organizer-disclosure"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${note.title}`}
              aria-expanded={isExpanded}
              onClick={() => togglePage(note.id)}
            >
              <CaretRight
                className={isExpanded ? "expanded" : ""}
                size={12}
                weight="bold"
              />
            </button>
          ) : (
            <span className="organizer-disclosure-spacer" />
          )}
          <button
            className="organizer-page-link"
            draggable
            aria-haspopup="menu"
            onDragStart={(event) => beginDrag(event, note.id)}
            onDragEnd={clearDrag}
            onClick={() => onOpenNote(note.id)}
            title={`${note.title} · Drag to move · Right-click for actions`}
          >
            <PageIcon
              note={note}
              size={16}
              weight={children.length ? "fill" : "regular"}
            />
            <span>{note.title}</span>
          </button>
          <button
            className="organizer-add-child"
            aria-label={`Add a page inside ${note.title}`}
            title="Add child page"
            onClick={() => {
              setExpanded((current) => new Set(current).add(note.id));
              onCreatePage(note.id);
            }}
          >
            <Plus size={12} weight="bold" />
          </button>
        </div>
        {isExpanded && children.length > 0 && (
          <div
            className="organizer-children"
            role="group"
            aria-label={`${note.title} child pages`}
          >
            {children.map((child) => renderPage(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="sidebar-section organizer-section">
      <SidebarSectionHeading
        label="Notes"
        expanded={open}
        onToggle={() => setOpen((current) => !current)}
        action={
          <button
            className="mini-button"
            aria-label="New top-level page"
            title="New top-level page"
            onClick={() => onCreatePage(null)}
          >
            <Plus size={13} />
          </button>
        }
      />
      {open && (
        <div className="organizer-tree">
          {(byParent.get(null) ?? []).map((note) => renderPage(note, 0))}
          {draggedId && (
            <div
              className={`organizer-root-drop${dropTarget?.noteId === null ? " active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({ noteId: null, placement: "inside" });
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                finishDrop(draggedPageId(event), null, "inside");
              }}
            >
              Drop here for top level
            </div>
          )}
          {!notes.length && (
            <p className="sidebar-empty">
              Create a page, then nest more pages inside it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
