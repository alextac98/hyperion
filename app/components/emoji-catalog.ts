import emojiData from "emojibase-data/en/compact.json";
type EmojiCatalogRecord = {
  group?: number;
  label: string;
  order?: number;
  shortcodes?: string[];
  skins?: EmojiCatalogRecord[];
  tags?: string[];
  unicode: string;
};
type EmojiVariant = { label: string; unicode: string };
export type EmojiEntry = {
  label: string;
  searchText: string;
  skins: readonly EmojiVariant[];
  unicode: string;
};
export type EmojiGroup = {
  name: string;
  symbol: string;
  emojis: readonly EmojiEntry[];
};

const EMOJI_CATEGORY_DEFINITIONS = [
  { name: "Smileys & People", symbol: "☺", groups: [0, 1] },
  { name: "Animals & Nature", symbol: "♣", groups: [3] },
  { name: "Food & Drink", symbol: "●", groups: [4] },
  { name: "Activity", symbol: "◆", groups: [6] },
  { name: "Travel & Places", symbol: "▲", groups: [5] },
  { name: "Objects", symbol: "■", groups: [7] },
  { name: "Symbols", symbol: "♥", groups: [8] },
  { name: "Flags", symbol: "⚑", groups: [9] },
] as const;

const EMOJI_CATALOG = emojiData as EmojiCatalogRecord[];
export const EMOJI_GROUPS: readonly EmojiGroup[] =
  EMOJI_CATEGORY_DEFINITIONS.map((category) => ({
    name: category.name,
    symbol: category.symbol,
    emojis: EMOJI_CATALOG.filter(
      (emoji) =>
        emoji.group !== undefined &&
        (category.groups as readonly number[]).includes(emoji.group),
    )
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER),
      )
      .map((emoji) => ({
        label: emoji.label,
        searchText: [
          emoji.label,
          ...(emoji.tags ?? []),
          ...(emoji.shortcodes ?? []),
        ]
          .join(" ")
          .toLocaleLowerCase(),
        skins: (emoji.skins ?? []).map(({ label, unicode }) => ({
          label,
          unicode,
        })),
        unicode: emoji.unicode,
      })),
  }));
