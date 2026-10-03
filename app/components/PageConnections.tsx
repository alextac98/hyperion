import { ArrowRight, X } from "@phosphor-icons/react";
import type { NoteRecord } from "../lib/local-database";
import { pageIconText } from "../lib/local-database";
import { PageIcon } from "./PageIcon";

export function pageConnections(note: NoteRecord, notes: NoteRecord[]) {
  const targets = new Set(note.links.map((link) => link.targetId));
  return {
    outgoing: notes.filter((target) => targets.has(target.id)),
    backlinks: notes.filter(
      (source) =>
        source.id !== note.id &&
        source.links.some((link) => link.targetId === note.id),
    ),
  };
}

export function backlinkExcerpt(source: NoteRecord, targetId: string) {
  const text = source.body.replace(/\s+/g, " ").trim();
  for (const link of source.links) {
    if (link.targetId !== targetId || link.kind !== "inline") continue;
    const index = text.indexOf(`[[${link.label}]]`);
    if (index < 0) continue;
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + link.label.length + 85);
    return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }
  return "";
}

export function PageConnections({
  note,
  notes,
  onSelect,
  onChange,
}: {
  note: NoteRecord;
  notes: NoteRecord[];
  onSelect: (id: string) => void;
  onChange: (patch: Partial<NoteRecord>) => void;
}) {
  const { outgoing, backlinks } = pageConnections(note, notes);
  const outgoingIds = new Set(outgoing.map((target) => target.id));
  const choices = notes
    .filter((target) => target.id !== note.id && !outgoingIds.has(target.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      {outgoing.length > 0 && (
        <section>
          <div className="details-title">
            <span>Links from this page</span>
            <em>{outgoing.length}</em>
          </div>
          <div className="details-link-list">
            {outgoing.map((target) => (
              <div className="details-link-row" key={target.id}>
                <button
                  type="button"
                  className="details-link-open"
                  onClick={() => onSelect(target.id)}
                >
                  <PageIcon note={target} size={16} />
                  <span>{target.title}</span>
                  <ArrowRight size={13} />
                </button>
                {note.links.some(
                  (link) =>
                    link.targetId === target.id && link.kind === "manual",
                ) && (
                  <button
                    type="button"
                    className="details-link-remove"
                    aria-label={`Remove link to ${target.title}`}
                    onClick={() =>
                      onChange({
                        links: note.links.filter(
                          (link) =>
                            link.targetId !== target.id ||
                            link.kind !== "manual",
                        ),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {backlinks.length > 0 && (
        <section>
          <div className="details-title">
            <span>Pages that link here</span>
            <em>{backlinks.length}</em>
          </div>
          <div className="backlinks-list">
            {backlinks.map((source) => {
              const excerpt = backlinkExcerpt(source, note.id);
              return (
                <button
                  type="button"
                  key={source.id}
                  onClick={() => onSelect(source.id)}
                >
                  <PageIcon note={source} size={16} />
                  <span className="connection-text">
                    <span>{source.title}</span>
                    {excerpt && <small>{excerpt}</small>}
                  </span>
                  <ArrowRight size={13} />
                </button>
              );
            })}
          </div>
        </section>
      )}
      {!outgoing.length && !backlinks.length && (
        <p className="context-empty">
          No connections yet. Mention a page with [[Page name]] or link one
          below.
        </p>
      )}
      {choices.length > 0 && (
        <select
          className="details-link-select"
          aria-label="Link another page"
          value=""
          onChange={(event) => {
            const target = choices.find(
              (choice) => choice.id === event.target.value,
            );
            if (target)
              onChange({
                links: [
                  ...note.links,
                  { targetId: target.id, label: target.title, kind: "manual" },
                ],
              });
          }}
        >
          <option value="">+ Link a page</option>
          {choices.map((target) => (
            <option value={target.id} key={target.id}>
              {pageIconText(target.icon) ? `${pageIconText(target.icon)} ` : ""}
              {target.title}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
