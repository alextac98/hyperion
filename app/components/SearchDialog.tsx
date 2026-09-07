import { MagnifyingGlass } from "@phosphor-icons/react";
import { useId, useMemo, useState } from "react";
import type { NoteRecord } from "../lib/local-database";
import { buildNoteSearchIndex, searchNotes } from "../lib/note-search";
import { notePreview, relativeTime } from "../lib/presentation";
import { Dialog } from "./Dialog";
import { HyperionMark } from "./HyperionMark";
import { PageIcon } from "./PageIcon";

export function SearchDialog({
  notes,
  vaultName,
  onSelect,
  onClose,
}: {
  notes: NoteRecord[];
  vaultName?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const index = useMemo(() => buildNoteSearchIndex(notes), [notes]);
  const results = useMemo(() => searchNotes(index, query), [index, query]);
  const activeIndex = Math.min(selected, Math.max(0, results.notes.length - 1));
  const open = (note: NoteRecord) => {
    onSelect(note.id);
    onClose();
  };

  return (
    <Dialog label="Search Hyperion" onClose={onClose}>
      <section className="search-dialog">
        <div className="search-field">
          <MagnifyingGlass size={21} />
          <input
            aria-label="Search pages"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              results.notes.length ? `${listId}-${activeIndex}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              const count = results.notes.length;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (count)
                  setSelected(
                    (activeIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      count) %
                      count,
                  );
              }
              if (event.key === "Enter" && results.notes[activeIndex]) {
                event.preventDefault();
                open(results.notes[activeIndex]);
              }
            }}
            placeholder="Search pages, journal entries, text, and tags…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-caption">
          <span>
            {query
              ? `${results.total} results${results.total > results.notes.length ? ` · showing ${results.notes.length}` : ""}`
              : "Recently edited"}
          </span>
          <small>{vaultName} · local</small>
        </div>
        <div
          className="search-results"
          id={listId}
          role="listbox"
          aria-label="Matching pages"
        >
          {results.notes.map((note, position) => (
            <button
              key={note.id}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={position === activeIndex}
              className={position === activeIndex ? "selected" : ""}
              onClick={() => open(note)}
            >
              <span className="result-icon">
                <PageIcon note={note} size={18} />
              </span>
              <span className="result-copy">
                <strong>{note.title}</strong>
                <span>{notePreview(note)}</span>
              </span>
              <span className="result-meta">
                {note.kind === "journal" && <i>Journal</i>}
                {relativeTime(note.updatedAt)}
              </span>
            </button>
          ))}
        </div>
        {!results.notes.length && (
          <div className="no-results" role="status">
            <MagnifyingGlass size={24} />
            <span>No matching pages or entries</span>
          </div>
        )}
        <footer className="dialog-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Select <kbd>↵</kbd> Open
          </span>
          <span className="dialog-brand">
            <HyperionMark small /> Hyperion
          </span>
        </footer>
      </section>
    </Dialog>
  );
}
