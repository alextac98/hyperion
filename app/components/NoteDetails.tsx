import { ArrowRight, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EditorStore } from "../editor/editor-client";
import type { NoteRecord } from "../lib/local-database";
import { pageIconText } from "../lib/local-database";
import { dateLabel, journalDate, relativeTime } from "../lib/presentation";
import { DocumentOutline } from "./DocumentOutline";
import { PageIcon } from "./PageIcon";

export function NoteDetails({
  note: activeNote,
  notes: activeNotes,
  store: editorStore,
  onSelect: selectNote,
  onChange,
}: {
  note: NoteRecord;
  notes: NoteRecord[];
  store: EditorStore | null;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<NoteRecord>) => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);
  const outgoingLinks = activeNote
    ? [...new Set(activeNote.links.map((link) => link.targetId))].flatMap(
        (targetId) => {
          const target = activeNotes.find((note) => note.id === targetId);
          return target ? [target] : [];
        },
      )
    : [];
  const outgoingLinkIds = new Set(outgoingLinks.map((note) => note.id));
  const manualLinkIds = new Set(
    activeNote?.links
      .filter((link) => link.kind === "manual")
      .map((link) => link.targetId) ?? [],
  );
  const backlinks = activeNote
    ? activeNotes.filter(
        (note) =>
          note.id !== activeNote.id &&
          note.links.some((link) => link.targetId === activeNote.id),
      )
    : [];
  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    if (!activeNote) return;
    const tag = tagDraft.trim().toLowerCase().replace(/^#/, "");
    if (tag && !activeNote.tags.includes(tag))
      onChange({ tags: [...activeNote.tags, tag] });
    setTagDraft("");
    setAddingTag(false);
  };

  const addPageLink = (source: NoteRecord, targetId: string) => {
    const target = activeNotes.find((note) => note.id === targetId);
    if (!target || source.links.some((link) => link.targetId === target.id))
      return;
    onChange({
      links: [
        ...source.links,
        { targetId: target.id, label: target.title, kind: "manual" },
      ],
    });
  };

  const removePageLink = (source: NoteRecord, targetId: string) => {
    onChange({
      links: source.links.filter(
        (link) => link.targetId !== targetId || link.kind !== "manual",
      ),
    });
  };

  return (
    <>
      <DocumentOutline store={editorStore} />
      <section className="details-tags">
        <div className="details-title">
          <span>Tags</span>
          <em>{activeNote.tags.length}</em>
        </div>
        <div className="details-tag-list">
          {activeNote.tags.map((tag) => (
            <span className="tag-pill" key={tag}>
              #{tag}
              <button
                aria-label={`Remove tag ${tag}`}
                onClick={() =>
                  onChange({
                    tags: activeNote.tags.filter((item) => item !== tag),
                  })
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {addingTag ? (
            <form onSubmit={submitTag}>
              <input
                ref={tagInputRef}
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onBlur={() => !tagDraft && setAddingTag(false)}
                placeholder="New tag"
                aria-label="New tag"
              />
            </form>
          ) : (
            <button
              className="details-add-button"
              onClick={() => setAddingTag(true)}
            >
              <Plus size={12} /> Add tag
            </button>
          )}
        </div>
      </section>
      <section className="details-page-links">
        <div className="details-title">
          <span>Page links</span>
          <em>{outgoingLinks.length}</em>
        </div>
        {outgoingLinks.length ? (
          <div className="details-link-list">
            {outgoingLinks.map((note) => {
              const inline = activeNote.links.some(
                (link) => link.targetId === note.id && link.kind === "inline",
              );
              return (
                <div
                  className="details-link-row"
                  key={note.id}
                  title={
                    inline
                      ? `Bound to [[${activeNote.links.find((link) => link.targetId === note.id && link.kind === "inline")?.label}]] by page ID`
                      : "Bound by page ID"
                  }
                >
                  <button
                    className="details-link-open"
                    onClick={() => selectNote(note.id)}
                  >
                    <PageIcon note={note} size={15} />
                    <span>{note.title}</span>
                    <ArrowRight size={13} />
                  </button>
                  {manualLinkIds.has(note.id) && (
                    <button
                      className="details-link-remove"
                      aria-label={`Remove link to ${note.title}`}
                      onClick={() => removePageLink(activeNote, note.id)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="details-inline-empty">
            No linked pages yet. Mention one with double brackets or choose a
            page below.
          </p>
        )}
        <select
          className="details-link-select"
          aria-label="Link another page"
          value=""
          onChange={(event) =>
            event.target.value && addPageLink(activeNote, event.target.value)
          }
        >
          <option value="">+ Link a page</option>
          {activeNotes
            .filter(
              (note) =>
                note.id !== activeNote.id && !outgoingLinkIds.has(note.id),
            )
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((note) => (
              <option value={note.id} key={note.id}>
                {pageIconText(note.icon) ? `${pageIconText(note.icon)} ` : ""}
                {note.title}
              </option>
            ))}
        </select>
      </section>
      <section>
        <div className="details-title">
          <span>Backlinks</span>
          <em>{backlinks.length}</em>
        </div>
        {backlinks.length ? (
          <div className="backlinks-list">
            {backlinks.map((note) => (
              <button key={note.id} onClick={() => selectNote(note.id)}>
                <PageIcon note={note} size={15} />
                <span>{note.title}</span>
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        ) : (
          <div className="details-empty">
            <span className="linked-rings">
              <i />
              <i />
            </span>
            <p>No pages link here yet.</p>
            <small>Mention with [[{activeNote.title}]]</small>
          </div>
        )}
      </section>
      <section className="details-properties">
        <div className="details-title">
          <span>Properties</span>
        </div>
        <dl>
          {activeNote.kind === "journal" && activeNote.journalDate && (
            <div>
              <dt>Journal date</dt>
              <dd>
                {dateLabel(journalDate(activeNote.journalDate).toISOString())}
              </dd>
            </div>
          )}
          <div>
            <dt>Created</dt>
            <dd>{dateLabel(activeNote.createdAt)}</dd>
          </div>
          <div>
            <dt>Edited</dt>
            <dd>{relativeTime(activeNote.updatedAt)}</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd>
              {activeNote.body.trim().split(/\s+/).filter(Boolean).length}
            </dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd title={activeNote.id}>Stable through moves</dd>
          </div>
          {activeNote.aliases.length > 0 && (
            <div>
              <dt>Former names</dt>
              <dd title={activeNote.aliases.join(", ")}>
                {activeNote.aliases.length}
              </dd>
            </div>
          )}
          <div>
            <dt>Storage</dt>
            <dd>Local vault</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
