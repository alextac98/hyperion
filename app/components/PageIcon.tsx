import { FileText } from "@phosphor-icons/react";
import type { NoteRecord } from "../lib/local-database";
import { iconDefinition } from "./icon-catalog";
export function PageIcon({
  note,
  size = 16,
  weight = "regular",
}: {
  note: Pick<NoteRecord, "icon">;
  size?: number;
  weight?: "regular" | "fill";
}) {
  if (note.icon?.type === "emoji") {
    return (
      <span
        className="page-icon-glyph"
        style={{ width: size, height: size, fontSize: size }}
        aria-hidden="true"
      >
        {note.icon.unicode}
      </span>
    );
  }
  if (note.icon?.type === "affine-icon") {
    const definition = iconDefinition(note.icon.name);
    if (definition)
      return (
        <definition.Icon
          className="page-icon-affine"
          size={size}
          weight={weight}
          color={note.icon.color}
          aria-hidden="true"
        />
      );
  }
  return <FileText size={size} weight={weight} />;
}
