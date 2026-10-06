import type { NoteRecord } from "../lib/local-database";
import { dateLabel, journalDate, relativeTime } from "../lib/presentation";

export function PageProperties({ note }: { note: NoteRecord }) {
  return (
    <section className="details-properties">
      <dl>
        {note.kind === "journal" && note.journalDate && (
          <div>
            <dt>Journal date</dt>
            <dd>{dateLabel(journalDate(note.journalDate).toISOString())}</dd>
          </div>
        )}
        <div>
          <dt>Created</dt>
          <dd>{dateLabel(note.createdAt)}</dd>
        </div>
        <div>
          <dt>Edited</dt>
          <dd>{relativeTime(note.updatedAt)}</dd>
        </div>
        <div>
          <dt>Words</dt>
          <dd>{note.body.trim().split(/\s+/).filter(Boolean).length}</dd>
        </div>
        {note.aliases.length > 0 && (
          <div>
            <dt>Former names</dt>
            <dd>{note.aliases.join(", ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
