import * as Y from "yjs";
import { readBlock } from "../document.js";
import { isBlockAvailable } from "../registry.js";

/** Move the first meeting prototype's plain notes into ordinary page blocks.
 * Keep its Markdown text verbatim, and leave unknown/future blocks untouched. */
export function migrateMeetingNotes<T extends Y.Map<unknown>>(
  blocks: Y.Map<T>,
  meetingId?: string,
) {
  let changed = false;
  const apply = () => {
    for (const [id, block] of [...blocks]) {
      if (meetingId !== undefined && id !== meetingId) continue;
      if (block.get("sys:flavour") !== "hyperion:meeting") continue;
      const meeting = readBlock(id, block);
      if (!isBlockAvailable(meeting)) continue;
      const legacy = String(meeting.props.notes);
      let noteId = meeting.children.find(
        (child) =>
          blocks.get(child)?.get("sys:flavour") === "affine:note" &&
          Number(blocks.get(child)?.get("sys:version") ?? 1) === 1,
      );
      if (noteId && !legacy) continue;

      const unusedId = (base: string) => {
        let candidate = base;
        let suffix = 0;
        while (blocks.has(candidate)) candidate = `${base}:${++suffix}`;
        return candidate;
      };
      if (!noteId) {
        noteId = unusedId(`${id}:notes`);
        blocks.set(
          noteId,
          new Y.Map<unknown>([
            ["sys:id", noteId],
            ["sys:flavour", "affine:note"],
            ["sys:version", 1],
            ["sys:children", Y.Array.from<string>([])],
            ["prop:displayMode", "doc"],
          ]) as T,
        );
        let children = block.get("sys:children");
        if (!(children instanceof Y.Array)) {
          children = Y.Array.from<string>([]);
          block.set("sys:children", children);
        }
        (children as Y.Array<string>).insert(0, [noteId]);
      }
      const note = blocks.get(noteId)!;
      const paragraphIds = legacy.split(/\r\n|\r|\n/).map((line, index) => {
        const paragraphId = unusedId(`${noteId}:${index}`);
        blocks.set(
          paragraphId,
          new Y.Map<unknown>([
            ["sys:id", paragraphId],
            ["sys:flavour", "affine:paragraph"],
            ["sys:version", 1],
            ["sys:children", Y.Array.from<string>([])],
            ["prop:type", "text"],
            ["prop:text", new Y.Text(line)],
          ]) as T,
        );
        return paragraphId;
      });
      const children = note.get("sys:children");
      if (children instanceof Y.Array) children.insert(0, paragraphIds);
      else note.set("sys:children", Y.Array.from(paragraphIds));
      block.set("prop:notes", "");
      changed = true;
    }
  };
  if (blocks.doc) blocks.doc.transact(apply, "hyperion:meeting-notes");
  else apply();
  return changed;
}
