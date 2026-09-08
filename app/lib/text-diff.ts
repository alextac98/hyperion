import { diffWordsWithSpace } from "diff";

export type DiffSegment = { text: string; changed: boolean };
export type TextComparison = { before: DiffSegment[]; after: DiffSegment[] };

/** Preserve exact whitespace and bound work for unusually large or unrelated text. */
export function compareText(before: string, after: string, timeout = 25): TextComparison {
  if (before === after) return { before: [{ text: before, changed: false }], after: [{ text: after, changed: false }] };
  const parts = before.length + after.length > 100_000 || timeout <= 0 ? undefined : diffWordsWithSpace(before, after, { timeout, maxEditLength: 2_000 });
  if (!parts) return { before: before ? [{ text: before, changed: true }] : [], after: after ? [{ text: after, changed: true }] : [] };
  return {
    before: parts.filter(part => !part.added).map(part => ({ text: part.value, changed: part.removed })),
    after: parts.filter(part => !part.removed).map(part => ({ text: part.value, changed: part.added })),
  };
}
