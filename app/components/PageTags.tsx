import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { NoteRecord } from "../lib/local-database";

export function PageTags({
  note,
  onChange,
}: {
  note: NoteRecord;
  onChange: (patch: Partial<NoteRecord>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAdd = useRef(false);
  useEffect(() => {
    if (adding) input.current?.focus();
    else if (focusAdd.current) {
      focusAdd.current = false;
      addButton.current?.focus();
    }
  }, [adding]);
  const finish = () => {
    setDraft("");
    setAdding(false);
    focusAdd.current = true;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tag = draft.trim().toLowerCase().replace(/^#/, "");
    if (tag && !note.tags.includes(tag))
      onChange({ tags: [...note.tags, tag] });
    finish();
  };
  return (
    <section className="page-tags" aria-label="Page tags">
      {note.tags.map((tag) => (
        <span className="tag-pill" key={tag}>
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() =>
              onChange({ tags: note.tags.filter((item) => item !== tag) })
            }
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button
        ref={addButton}
        type="button"
        className="add-tag"
        aria-label="Add tag"
        hidden={adding}
        onClick={() => setAdding(true)}
      >
        <Plus size={12} /> Add tag
      </button>
      {adding && (
        <form className="page-tag-form" onSubmit={submit}>
          <input
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!draft) {
                setAdding(false);
              }
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                finish();
              }
            }}
            placeholder="New tag"
            aria-label="New tag"
          />
          <button type="submit" aria-label="Save tag" disabled={!draft.trim()}>
            <Plus size={14} />
          </button>
        </form>
      )}
    </section>
  );
}
