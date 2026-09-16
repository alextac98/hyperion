import * as Y from "yjs";
import { isCalendarDate } from "./definition.js";

export const DATE_ATTRIBUTE = "hyperionDate";
// Inline embeds use one text position; the date lives in its formatting attributes.
export const DATE_CHARACTER = " ";

export function dateText(value: {
  toDelta(): Array<{ insert: unknown; attributes?: Record<string, unknown> }>;
}): string {
  return value
    .toDelta()
    .map((delta) =>
      isCalendarDate(delta.attributes?.[DATE_ATTRIBUTE])
        ? String(delta.attributes![DATE_ATTRIBUTE]).repeat(
            typeof delta.insert === "string" ? delta.insert.length : 1,
          )
        : typeof delta.insert === "string"
          ? delta.insert
          : "",
    )
    .join("");
}

/** Preserve identity and sibling order while replacing legacy date cards with editable text. */
export function migrateInlineDates<T extends Y.Map<unknown>>(
  blocks: Y.Map<T>,
): boolean {
  let changed = false;
  const apply = () => {
    for (const block of blocks.values()) {
      if (
        block.get("sys:flavour") !== "hyperion:date" ||
        Number(block.get("sys:version") ?? 1) !== 1
      )
        continue;
      const date = block.get("prop:date");
      if (date !== "" && !isCalendarDate(date)) continue;
      const text = new Y.Text();
      if (date) text.insert(0, DATE_CHARACTER, { [DATE_ATTRIBUTE]: date });
      block.set("sys:flavour", "affine:paragraph");
      block.set("sys:version", 1);
      block.set("prop:type", "text");
      block.set("prop:text", text);
      block.delete("prop:date");
      changed = true;
    }
  };
  if (blocks.doc) blocks.doc.transact(apply, "hyperion:inline-dates");
  else apply();
  return changed;
}
