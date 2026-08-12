import { NoteRecord, PageLinkRecord } from "./local-database";

const WIKI_LINK_PATTERN = /\[\[([^\]\n]+)\]\]/g;

function identityKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = identityKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pageLinkLabels(body: string) {
  return uniqueStrings([...body.matchAll(WIKI_LINK_PATTERN)].map((match) => match[1].trim()));
}

export function normalizePageIdentity(note: NoteRecord): NoteRecord {
  const titleKey = identityKey(note.title);
  const aliases = uniqueStrings(note.aliases ?? []).filter((alias) => identityKey(alias) !== titleKey);
  const seenLinks = new Set<string>();
  const links = (note.links ?? []).filter((link): link is PageLinkRecord => {
    if (!link?.targetId || link.targetId === note.id || !["inline", "manual"].includes(link.kind)) return false;
    const key = `${link.kind}:${link.targetId}:${link.kind === "inline" ? identityKey(link.label) : ""}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });
  return { ...note, aliases, links };
}

function findTarget(label: string, notes: NoteRecord[], sourceId: string) {
  const key = identityKey(label);
  const candidates = notes.filter((note) => note.id !== sourceId);
  const titleMatches = candidates.filter((note) => identityKey(note.title) === key);
  if (titleMatches.length === 1) return titleMatches[0];
  if (titleMatches.length > 1) return undefined;
  const aliasMatches = candidates.filter((note) => note.aliases.some((alias) => identityKey(alias) === key));
  return aliasMatches.length === 1 ? aliasMatches[0] : undefined;
}

export function reconcilePageLinks(note: NoteRecord, notes: NoteRecord[]): NoteRecord {
  const normalized = normalizePageIdentity(note);
  const manualLinks = normalized.links.filter((link) => link.kind === "manual");
  const previousInline = normalized.links.filter((link) => link.kind === "inline");
  const inlineLinks = pageLinkLabels(normalized.body).flatMap((label) => {
    const prior = previousInline.find((link) => identityKey(link.label) === identityKey(label));
    if (prior) return [{ ...prior, label }];
    const target = findTarget(label, notes, normalized.id);
    return target ? [{ targetId: target.id, label, kind: "inline" as const }] : [];
  });
  return normalizePageIdentity({ ...normalized, links: [...manualLinks, ...inlineLinks] });
}

export function hydratePageIdentities(notes: NoteRecord[]) {
  const normalized = notes.map(normalizePageIdentity);
  return normalized.map((note) => reconcilePageLinks(note, normalized));
}

export function pageIdentityChanged(before: NoteRecord, after: NoteRecord) {
  return JSON.stringify(before.aliases ?? []) !== JSON.stringify(after.aliases) ||
    JSON.stringify(before.links ?? []) !== JSON.stringify(after.links);
}
