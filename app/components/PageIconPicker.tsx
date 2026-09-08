import { MagnifyingGlass, Smiley } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NoteRecord, PageIconRecord } from "../lib/local-database";
import { PageIcon } from "./PageIcon";
import type { EmojiEntry, EmojiGroup } from "./emoji-catalog";
import { AFFINE_ICONS, iconDefinition } from "./icon-catalog";

const ICON_COLORS = [
  "#ef5c5c",
  "#e9853d",
  "#d6a521",
  "#55a861",
  "#3aa39a",
  "#4d7cfe",
  "#805ad5",
  "#c45ac0",
  "#737781",
];

const SKIN_TONES = [
  { label: "Default", value: "" },
  { label: "Light", value: "🏻" },
  { label: "Medium-light", value: "🏼" },
  { label: "Medium", value: "🏽" },
  { label: "Medium-dark", value: "🏾" },
  { label: "Dark", value: "🏿" },
] as const;
const SKIN_TONE_MODIFIERS = new Set<string>(
  SKIN_TONES.slice(1).map(({ value }) => value),
);
const RECENT_EMOJI_KEY = "hyperion:recent-page-emojis";
const RECENT_ICON_KEY = "hyperion:recent-page-icons";

function readRecent(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function rememberRecent(key: string, value: string, current: string[]) {
  const next = [value, ...current.filter((item) => item !== value)].slice(
    0,
    10,
  );
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}

function emojiForSkinTone(emoji: EmojiEntry, tone: string) {
  if (!tone || !emoji.skins.length) return emoji.unicode;
  return (
    emoji.skins.find((variant) => {
      const modifiers = Array.from(variant.unicode).filter((character) =>
        SKIN_TONE_MODIFIERS.has(character),
      );
      return (
        modifiers.length > 0 && modifiers.every((modifier) => modifier === tone)
      );
    })?.unicode ?? emoji.unicode
  );
}

export function PageIconPicker({
  note,
  onChange,
}: {
  note: NoteRecord;
  onChange: (icon: PageIconRecord | null) => void;
}) {
  const [emojiGroups, setEmojiGroups] = useState<readonly EmojiGroup[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"emoji" | "icons">("emoji");
  const [query, setQuery] = useState("");
  const [skinTone, setSkinTone] = useState("");
  const [color, setColor] = useState(
    note.icon?.type === "affine-icon" ? note.icon.color : ICON_COLORS[5],
  );
  const [skinMenuOpen, setSkinMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() =>
    readRecent(RECENT_EMOJI_KEY),
  );
  const [recentIcons, setRecentIcons] = useState<string[]>(() =>
    readRecent(RECENT_ICON_KEY),
  );
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, panel]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void import("./emoji-catalog")
      .then(({ EMOJI_GROUPS }) => {
        if (!cancelled) {
          setCatalogError(false);
          setEmojiGroups(EMOJI_GROUPS);
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEmojiGroups = useMemo(
    () =>
      emojiGroups
        .map((group) => ({
          ...group,
          emojis: group.emojis.filter(
            (emoji) =>
              !normalizedQuery ||
              emoji.searchText.includes(normalizedQuery) ||
              group.name.toLocaleLowerCase().includes(normalizedQuery),
          ),
        }))
        .filter((group) => group.emojis.length),
    [emojiGroups, normalizedQuery],
  );
  const filteredIcons = useMemo(
    () =>
      AFFINE_ICONS.filter(
        (icon) =>
          !normalizedQuery ||
          `${icon.label} ${icon.keywords}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      ),
    [normalizedQuery],
  );

  const chooseEmoji = (unicode: string) => {
    setRecentEmojis((current) =>
      rememberRecent(RECENT_EMOJI_KEY, unicode, current),
    );
    onChange({ type: "emoji", unicode });
    setOpen(false);
  };
  const chooseAffineIcon = (name: string) => {
    setRecentIcons((current) => rememberRecent(RECENT_ICON_KEY, name, current));
    onChange({ type: "affine-icon", name, color });
    setOpen(false);
  };

  return (
    <div className="page-icon-picker-wrap" ref={pickerRef}>
      <button
        type="button"
        className={`page-icon-button${note.icon ? " has-icon" : " is-placeholder"}`}
        aria-label={`${note.icon ? "Change" : "Add"} icon for ${note.title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={note.icon ? "Change page icon" : "Add page icon"}
        onClick={() => setOpen((current) => !current)}
      >
        {note.icon ? (
          <PageIcon note={note} size={38} />
        ) : (
          <>
            <Smiley size={16} weight="fill" />
            <span>Add icon</span>
          </>
        )}
      </button>
      {open && (
        <div
          className="popover page-icon-picker"
          role="dialog"
          aria-label="Choose a page icon"
        >
          <header className="page-icon-picker-header">
            <div
              className="page-icon-tabs"
              role="tablist"
              aria-label="Page icon type"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panel === "emoji"}
                className={panel === "emoji" ? "active" : ""}
                onClick={() => {
                  setPanel("emoji");
                  setQuery("");
                }}
              >
                Emoji
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panel === "icons"}
                className={panel === "icons" ? "active" : ""}
                onClick={() => {
                  setPanel("icons");
                  setQuery("");
                }}
              >
                Icons
              </button>
            </div>
            <button
              type="button"
              className="page-icon-remove"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              disabled={!note.icon}
            >
              Remove
            </button>
          </header>
          <div className="page-icon-filter-row">
            <label>
              <MagnifyingGlass size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Filter..."
                aria-label={`Filter ${panel}`}
              />
            </label>
            {panel === "emoji" ? (
              <div className="page-icon-option-menu">
                <button
                  type="button"
                  className="page-icon-option-trigger"
                  aria-label="Choose skin tone"
                  aria-expanded={skinMenuOpen}
                  onClick={() => {
                    setSkinMenuOpen((current) => !current);
                    setColorMenuOpen(false);
                  }}
                >{`👋${skinTone}`}</button>
                {skinMenuOpen && (
                  <div className="page-icon-inline-menu skin-tones" role="menu">
                    {SKIN_TONES.map((tone) => (
                      <button
                        type="button"
                        key={tone.label}
                        aria-label={`Use ${tone.label.toLocaleLowerCase()} skin tone`}
                        onClick={() => {
                          setSkinTone(tone.value);
                          setSkinMenuOpen(false);
                        }}
                      >{`👋${tone.value}`}</button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="page-icon-option-menu">
                <button
                  type="button"
                  className="page-icon-option-trigger"
                  aria-label="Choose icon color"
                  aria-expanded={colorMenuOpen}
                  onClick={() => {
                    setColorMenuOpen((current) => !current);
                    setSkinMenuOpen(false);
                  }}
                >
                  <i style={{ background: color }} />
                </button>
                {colorMenuOpen && (
                  <div
                    className="page-icon-inline-menu icon-colors"
                    role="menu"
                  >
                    {ICON_COLORS.map((item) => (
                      <button
                        type="button"
                        key={item}
                        aria-label={`Use ${item} icon color`}
                        className={color === item ? "selected" : ""}
                        onClick={() => {
                          setColor(item);
                          setColorMenuOpen(false);
                        }}
                      >
                        <i style={{ background: item }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {panel === "emoji" ? (
            <>
              <div className="page-icon-scroll" data-panel="emoji">
                {!normalizedQuery && recentEmojis.length > 0 && (
                  <div
                    className="page-icon-group"
                    ref={(element) => {
                      groupRefs.current.Recent = element;
                    }}
                  >
                    <strong>Recent</strong>
                    <div className="page-icon-grid">
                      {recentEmojis.map((unicode) => (
                        <button
                          type="button"
                          key={unicode}
                          aria-label={`Use ${unicode} as page icon`}
                          onClick={() => chooseEmoji(unicode)}
                        >
                          <span>{unicode}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!emojiGroups.length && (
                  <p role="status">
                    {catalogError
                      ? "Emoji could not load. Close and reopen the picker to retry."
                      : "Loading emoji…"}
                  </p>
                )}
                {filteredEmojiGroups.map((group) => (
                  <div
                    className="page-icon-group"
                    key={group.name}
                    ref={(element) => {
                      groupRefs.current[group.name] = element;
                    }}
                  >
                    <strong>{group.name}</strong>
                    <div className="page-icon-grid">
                      {group.emojis.map((emoji) => {
                        const rendered = emojiForSkinTone(emoji, skinTone);
                        return (
                          <button
                            type="button"
                            key={emoji.unicode}
                            title={emoji.label}
                            aria-label={`Use ${rendered} as page icon · ${emoji.label}`}
                            className={
                              note.icon?.type === "emoji" &&
                              note.icon.unicode === rendered
                                ? "selected"
                                : ""
                            }
                            onClick={() => chooseEmoji(rendered)}
                          >
                            <span>{rendered}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!filteredEmojiGroups.length && (
                  <div className="page-icon-empty">No emoji found</div>
                )}
              </div>
              <footer className="page-icon-category-bar">
                {[
                  { name: "Recent", symbol: "◴" },
                  ...emojiGroups.map(({ name, symbol }) => ({ name, symbol })),
                ].map((group) => (
                  <button
                    type="button"
                    key={group.name}
                    title={group.name}
                    aria-label={`Show ${group.name}`}
                    disabled={group.name === "Recent" && !recentEmojis.length}
                    onClick={() =>
                      groupRefs.current[group.name]?.scrollIntoView({
                        block: "start",
                      })
                    }
                  >
                    {group.symbol}
                  </button>
                ))}
              </footer>
            </>
          ) : (
            <div className="page-icon-scroll" data-panel="icons">
              {!normalizedQuery && recentIcons.length > 0 && (
                <div className="page-icon-group">
                  <strong>Recent</strong>
                  <div className="page-icon-grid affine-icons">
                    {recentIcons.flatMap((name) => {
                      const item = iconDefinition(name);
                      if (!item) return [];
                      return [
                        <button
                          type="button"
                          key={name}
                          aria-label={`Use ${item.label} icon`}
                          onClick={() => chooseAffineIcon(name)}
                        >
                          <item.Icon size={24} color={color} />
                        </button>,
                      ];
                    })}
                  </div>
                </div>
              )}
              <div className="page-icon-group">
                <strong>Icons</strong>
                <div className="page-icon-grid affine-icons">
                  {filteredIcons.map((item) => (
                    <button
                      type="button"
                      key={item.name}
                      title={item.label}
                      aria-label={`Use ${item.label} icon`}
                      className={
                        note.icon?.type === "affine-icon" &&
                        note.icon.name === item.name
                          ? "selected"
                          : ""
                      }
                      onClick={() => chooseAffineIcon(item.name)}
                    >
                      <item.Icon size={24} color={color} />
                    </button>
                  ))}
                </div>
              </div>
              {!filteredIcons.length && (
                <div className="page-icon-empty">No icons found</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
