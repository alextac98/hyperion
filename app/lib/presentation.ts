import { templateDocumentId } from "../editor/document-id";
import type { NoteRecord,TemplateRecord } from "./local-database";

export function relativeTime(isoDate: string) {
  const seconds = Math.max(
    1,
    Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(isoDate));
}

export function dateLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoDate));
}

export function journalDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function journalTitle(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function notePreview(note: NoteRecord) {
  return note.body.replace(/\s+/g, " ").trim() || "Empty page";
}

export function templatePageRecord(template: TemplateRecord): NoteRecord {
  return {
    id: templateDocumentId(template.id),
    vaultId: template.vaultId,
    kind: "note",
    journalDate: null,
    title: template.defaultTitle,
    icon: template.icon,
    aliases: [],
    body: template.body,
    tags: template.tags,
    links: [],
    parentId: null,
    sortOrder: 0,
    collectionIds: [],
    favorite: false,
    archived: false,
    trashed: false,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}
