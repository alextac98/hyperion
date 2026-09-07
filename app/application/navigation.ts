export type View =
  | "note"
  | "template"
  | "templates"
  | "home"
  | "journal"
  | "tags"
  | "archive"
  | "trash";
export type PageDropPlacement = "before" | "inside" | "after";
export type PageDropTarget = {
  noteId: string | null;
  placement: PageDropPlacement;
};
export type PageContextMenuState = { noteId: string; x: number; y: number };

export type Composer =
  | { type: "vault"; value: string }
  | { type: "page"; value: string; parentId: string | null }
  | { type: "template"; value: string; noteId: string | null }
  | { type: "rename"; value: string; noteId: string }
  | null;
