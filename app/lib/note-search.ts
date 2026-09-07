import type { NoteRecord } from "./local-database";
import { ancestorPath } from "./page-tree";

export function buildNoteSearchIndex(notes: NoteRecord[]) {
  const byId = new Map(notes.map((note) => [note.id, note]));
  return notes.map((note) => ({
    note,
    text: [
      note.title,
      ...note.aliases,
      note.body,
      ...note.tags,
      ...ancestorPath(byId, note).map((parent) => parent.title),
    ]
      .join("\n")
      .toLocaleLowerCase(),
  }));
}

export function searchNotes(
  index: ReturnType<typeof buildNoteSearchIndex>,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? index.filter((entry) => entry.text.includes(needle))
    : index;
  return {
    notes: matches.slice(0, needle ? 12 : 8).map((entry) => entry.note),
    total: matches.length,
  };
}
