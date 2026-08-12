import {
  Airplane,
  Alarm,
  Archive,
  BookOpenText,
  Briefcase,
  Bug,
  CalendarBlank,
  Camera,
  ChartBar,
  ChatCircle,
  CheckCircle,
  Cloud,
  Code,
  Compass,
  Crown,
  Database,
  Envelope,
  FileText,
  Flag,
  FolderSimple,
  GearSix,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image,
  Key,
  Lightbulb,
  LinkSimple,
  ListBullets,
  Lock,
  MagnifyingGlass,
  MapPin,
  Megaphone,
  MusicNote,
  NotePencil,
  Palette,
  Paperclip,
  Phone,
  Plant,
  Rocket,
  Shield,
  ShoppingCart,
  Smiley,
  Sparkle,
  Star,
  Sun,
  Tag,
  Target,
  TerminalWindow,
  Timer,
  Trash,
  Trophy,
  User,
  Users,
  Wrench,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import emojiData from "emojibase-data/en/compact.json";
import { useEffect, useMemo, useRef, useState } from "react";
import { NoteRecord, PageIconRecord } from "../lib/local-database";

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
type EmojiEntry = { label: string; searchText: string; skins: readonly EmojiVariant[]; unicode: string };
type EmojiGroup = { name: string; symbol: string; emojis: readonly EmojiEntry[] };

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
const EMOJI_GROUPS: readonly EmojiGroup[] = EMOJI_CATEGORY_DEFINITIONS.map((category) => ({
  name: category.name,
  symbol: category.symbol,
  emojis: EMOJI_CATALOG
    .filter((emoji) => emoji.group !== undefined && (category.groups as readonly number[]).includes(emoji.group))
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((emoji) => ({
      label: emoji.label,
      searchText: [emoji.label, ...(emoji.tags ?? []), ...(emoji.shortcodes ?? [])].join(" ").toLocaleLowerCase(),
      skins: (emoji.skins ?? []).map(({ label, unicode }) => ({ label, unicode })),
      unicode: emoji.unicode,
    })),
}));

const ICON_COLORS = ["#ef5c5c", "#e9853d", "#d6a521", "#55a861", "#3aa39a", "#4d7cfe", "#805ad5", "#c45ac0", "#737781"];

const AFFINE_ICONS: readonly { name: string; label: string; keywords: string; Icon: PhosphorIcon }[] = [
  { name: "lightbulb", label: "Lightbulb", keywords: "idea light bulb", Icon: Lightbulb },
  { name: "note-pencil", label: "Note", keywords: "note write edit", Icon: NotePencil },
  { name: "book", label: "Book", keywords: "book read knowledge", Icon: BookOpenText },
  { name: "folder", label: "Folder", keywords: "folder file collection", Icon: FolderSimple },
  { name: "archive", label: "Archive", keywords: "archive box storage", Icon: Archive },
  { name: "calendar", label: "Calendar", keywords: "calendar date journal", Icon: CalendarBlank },
  { name: "timer", label: "Timer", keywords: "timer clock time", Icon: Timer },
  { name: "alarm", label: "Alarm", keywords: "alarm clock reminder", Icon: Alarm },
  { name: "target", label: "Target", keywords: "target goal objective", Icon: Target },
  { name: "check", label: "Check circle", keywords: "check done task complete", Icon: CheckCircle },
  { name: "list", label: "List", keywords: "list notes tasks", Icon: ListBullets },
  { name: "tag", label: "Tag", keywords: "tag label topic", Icon: Tag },
  { name: "star", label: "Star", keywords: "star favorite important", Icon: Star },
  { name: "sparkle", label: "Sparkle", keywords: "sparkle magic ai", Icon: Sparkle },
  { name: "heart", label: "Heart", keywords: "heart love favorite", Icon: Heart },
  { name: "crown", label: "Crown", keywords: "crown premium leader", Icon: Crown },
  { name: "trophy", label: "Trophy", keywords: "trophy win award", Icon: Trophy },
  { name: "rocket", label: "Rocket", keywords: "rocket launch project", Icon: Rocket },
  { name: "plant", label: "Plant", keywords: "plant grow nature", Icon: Plant },
  { name: "sun", label: "Sun", keywords: "sun light weather", Icon: Sun },
  { name: "globe", label: "Globe", keywords: "globe earth world web", Icon: Globe },
  { name: "compass", label: "Compass", keywords: "compass direction navigate", Icon: Compass },
  { name: "map-pin", label: "Map pin", keywords: "map pin location place", Icon: MapPin },
  { name: "airplane", label: "Airplane", keywords: "airplane travel flight", Icon: Airplane },
  { name: "house", label: "House", keywords: "house home", Icon: House },
  { name: "briefcase", label: "Briefcase", keywords: "briefcase work business", Icon: Briefcase },
  { name: "graduation", label: "Graduation", keywords: "graduation school education", Icon: GraduationCap },
  { name: "users", label: "People", keywords: "people users team group", Icon: Users },
  { name: "user", label: "Person", keywords: "person user profile", Icon: User },
  { name: "chat", label: "Chat", keywords: "chat message conversation", Icon: ChatCircle },
  { name: "envelope", label: "Envelope", keywords: "envelope email mail", Icon: Envelope },
  { name: "megaphone", label: "Megaphone", keywords: "megaphone announce marketing", Icon: Megaphone },
  { name: "phone", label: "Phone", keywords: "phone call mobile", Icon: Phone },
  { name: "camera", label: "Camera", keywords: "camera photo image", Icon: Camera },
  { name: "image", label: "Image", keywords: "image photo picture", Icon: Image },
  { name: "music", label: "Music", keywords: "music audio note", Icon: MusicNote },
  { name: "palette", label: "Palette", keywords: "palette art design color", Icon: Palette },
  { name: "code", label: "Code", keywords: "code development programming", Icon: Code },
  { name: "terminal", label: "Terminal", keywords: "terminal command code", Icon: TerminalWindow },
  { name: "database", label: "Database", keywords: "database data storage", Icon: Database },
  { name: "chart", label: "Chart", keywords: "chart analytics graph", Icon: ChartBar },
  { name: "bug", label: "Bug", keywords: "bug issue debug", Icon: Bug },
  { name: "gear", label: "Gear", keywords: "gear settings configuration", Icon: GearSix },
  { name: "wrench", label: "Wrench", keywords: "wrench tool repair", Icon: Wrench },
  { name: "key", label: "Key", keywords: "key access password", Icon: Key },
  { name: "lock", label: "Lock", keywords: "lock secure private", Icon: Lock },
  { name: "shield", label: "Shield", keywords: "shield security protect", Icon: Shield },
  { name: "cloud", label: "Cloud", keywords: "cloud weather storage", Icon: Cloud },
  { name: "link", label: "Link", keywords: "link connection url", Icon: LinkSimple },
  { name: "paperclip", label: "Paperclip", keywords: "paperclip attachment", Icon: Paperclip },
  { name: "flag", label: "Flag", keywords: "flag milestone marker", Icon: Flag },
  { name: "cart", label: "Cart", keywords: "cart shopping store", Icon: ShoppingCart },
  { name: "trash", label: "Trash", keywords: "trash delete remove", Icon: Trash },
];

const SKIN_TONES = [
  { label: "Default", value: "" },
  { label: "Light", value: "🏻" },
  { label: "Medium-light", value: "🏼" },
  { label: "Medium", value: "🏽" },
  { label: "Medium-dark", value: "🏾" },
  { label: "Dark", value: "🏿" },
] as const;
const SKIN_TONE_MODIFIERS = new Set(SKIN_TONES.slice(1).map(({ value }) => value));
const RECENT_EMOJI_KEY = "hyperion:recent-page-emojis";
const RECENT_ICON_KEY = "hyperion:recent-page-icons";

function readRecent(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function rememberRecent(key: string, value: string, current: string[]) {
  const next = [value, ...current.filter((item) => item !== value)].slice(0, 10);
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}

function emojiForSkinTone(emoji: EmojiEntry, tone: string) {
  if (!tone || !emoji.skins.length) return emoji.unicode;
  return emoji.skins.find((variant) => {
    const modifiers = Array.from(variant.unicode).filter((character) => SKIN_TONE_MODIFIERS.has(character));
    return modifiers.length > 0 && modifiers.every((modifier) => modifier === tone);
  })?.unicode ?? emoji.unicode;
}

function iconDefinition(name: string) {
  return AFFINE_ICONS.find((icon) => icon.name === name);
}

export function PageIcon({ note, size = 16, weight = "regular" }: {
  note: Pick<NoteRecord, "icon">;
  size?: number;
  weight?: "regular" | "fill";
}) {
  if (note.icon?.type === "emoji") {
    return <span className="page-icon-glyph" style={{ width: size, height: size, fontSize: size }} aria-hidden="true">{note.icon.unicode}</span>;
  }
  if (note.icon?.type === "affine-icon") {
    const definition = iconDefinition(note.icon.name);
    if (definition) return <definition.Icon className="page-icon-affine" size={size} weight={weight} color={note.icon.color} aria-hidden="true" />;
  }
  return <FileText size={size} weight={weight} />;
}

export function PageIconPicker({ note, onChange }: { note: NoteRecord; onChange: (icon: PageIconRecord | null) => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"emoji" | "icons">("emoji");
  const [query, setQuery] = useState("");
  const [skinTone, setSkinTone] = useState("");
  const [color, setColor] = useState(note.icon?.type === "affine-icon" ? note.icon.color : ICON_COLORS[5]);
  const [skinMenuOpen, setSkinMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => readRecent(RECENT_EMOJI_KEY));
  const [recentIcons, setRecentIcons] = useState<string[]>(() => readRecent(RECENT_ICON_KEY));
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEmojiGroups = useMemo(() => EMOJI_GROUPS.map((group) => ({
    ...group,
    emojis: group.emojis.filter((emoji) => !normalizedQuery || emoji.searchText.includes(normalizedQuery) || group.name.toLocaleLowerCase().includes(normalizedQuery)),
  })).filter((group) => group.emojis.length), [normalizedQuery]);
  const filteredIcons = useMemo(() => AFFINE_ICONS.filter((icon) => !normalizedQuery || `${icon.label} ${icon.keywords}`.toLocaleLowerCase().includes(normalizedQuery)), [normalizedQuery]);

  const chooseEmoji = (unicode: string) => {
    setRecentEmojis((current) => rememberRecent(RECENT_EMOJI_KEY, unicode, current));
    onChange({ type: "emoji", unicode });
    setOpen(false);
  };
  const chooseAffineIcon = (name: string) => {
    setRecentIcons((current) => rememberRecent(RECENT_ICON_KEY, name, current));
    onChange({ type: "affine-icon", name, color });
    setOpen(false);
  };

  return <div className="page-icon-picker-wrap" ref={pickerRef}>
    <button
      type="button"
      className={`page-icon-button${note.icon ? " has-icon" : " is-placeholder"}`}
      aria-label={`${note.icon ? "Change" : "Add"} icon for ${note.title}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={note.icon ? "Change page icon" : "Add page icon"}
      onClick={() => setOpen((current) => !current)}
    >{note.icon ? <PageIcon note={note} size={60} /> : <><Smiley size={16} weight="fill" /><span>Add icon</span></>}</button>
    {open && <div className="popover page-icon-picker" role="dialog" aria-label="Choose a page icon">
      <header className="page-icon-picker-header">
        <div className="page-icon-tabs" role="tablist" aria-label="Page icon type">
          <button type="button" role="tab" aria-selected={panel === "emoji"} className={panel === "emoji" ? "active" : ""} onClick={() => { setPanel("emoji"); setQuery(""); }}>Emoji</button>
          <button type="button" role="tab" aria-selected={panel === "icons"} className={panel === "icons" ? "active" : ""} onClick={() => { setPanel("icons"); setQuery(""); }}>Icons</button>
        </div>
        <button type="button" className="page-icon-remove" onClick={() => { onChange(null); setOpen(false); }} disabled={!note.icon}>Remove</button>
      </header>
      <div className="page-icon-filter-row">
        <label><MagnifyingGlass size={16} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="Filter..." aria-label={`Filter ${panel}`} /></label>
        {panel === "emoji" ? <div className="page-icon-option-menu">
          <button type="button" className="page-icon-option-trigger" aria-label="Choose skin tone" aria-expanded={skinMenuOpen} onClick={() => { setSkinMenuOpen((current) => !current); setColorMenuOpen(false); }}>{`👋${skinTone}`}</button>
          {skinMenuOpen && <div className="page-icon-inline-menu skin-tones" role="menu">{SKIN_TONES.map((tone) => <button type="button" key={tone.label} aria-label={`Use ${tone.label.toLocaleLowerCase()} skin tone`} onClick={() => { setSkinTone(tone.value); setSkinMenuOpen(false); }}>{`👋${tone.value}`}</button>)}</div>}
        </div> : <div className="page-icon-option-menu">
          <button type="button" className="page-icon-option-trigger" aria-label="Choose icon color" aria-expanded={colorMenuOpen} onClick={() => { setColorMenuOpen((current) => !current); setSkinMenuOpen(false); }}><i style={{ background: color }} /></button>
          {colorMenuOpen && <div className="page-icon-inline-menu icon-colors" role="menu">{ICON_COLORS.map((item) => <button type="button" key={item} aria-label={`Use ${item} icon color`} className={color === item ? "selected" : ""} onClick={() => { setColor(item); setColorMenuOpen(false); }}><i style={{ background: item }} /></button>)}</div>}
        </div>}
      </div>
      {panel === "emoji" ? <>
        <div className="page-icon-scroll" data-panel="emoji">
          {!normalizedQuery && recentEmojis.length > 0 && <div className="page-icon-group" ref={(element) => { groupRefs.current.Recent = element; }}><strong>Recent</strong><div className="page-icon-grid">{recentEmojis.map((unicode) => <button type="button" key={unicode} aria-label={`Use ${unicode} as page icon`} onClick={() => chooseEmoji(unicode)}><span>{unicode}</span></button>)}</div></div>}
          {filteredEmojiGroups.map((group) => <div className="page-icon-group" key={group.name} ref={(element) => { groupRefs.current[group.name] = element; }}><strong>{group.name}</strong><div className="page-icon-grid">{group.emojis.map((emoji) => { const rendered = emojiForSkinTone(emoji, skinTone); return <button type="button" key={emoji.unicode} title={emoji.label} aria-label={`Use ${rendered} as page icon · ${emoji.label}`} className={note.icon?.type === "emoji" && note.icon.unicode === rendered ? "selected" : ""} onClick={() => chooseEmoji(rendered)}><span>{rendered}</span></button>; })}</div></div>)}
          {!filteredEmojiGroups.length && <div className="page-icon-empty">No emoji found</div>}
        </div>
        <footer className="page-icon-category-bar">{[{ name: "Recent", symbol: "◴" }, ...EMOJI_GROUPS.map(({ name, symbol }) => ({ name, symbol }))].map((group) => <button type="button" key={group.name} title={group.name} aria-label={`Show ${group.name}`} disabled={group.name === "Recent" && !recentEmojis.length} onClick={() => groupRefs.current[group.name]?.scrollIntoView({ block: "start" })}>{group.symbol}</button>)}</footer>
      </> : <div className="page-icon-scroll" data-panel="icons">
        {!normalizedQuery && recentIcons.length > 0 && <div className="page-icon-group"><strong>Recent</strong><div className="page-icon-grid affine-icons">{recentIcons.flatMap((name) => { const item = iconDefinition(name); if (!item) return []; return [<button type="button" key={name} aria-label={`Use ${item.label} icon`} onClick={() => chooseAffineIcon(name)}><item.Icon size={24} color={color} /></button>]; })}</div></div>}
        <div className="page-icon-group"><strong>Icons</strong><div className="page-icon-grid affine-icons">{filteredIcons.map((item) => <button type="button" key={item.name} title={item.label} aria-label={`Use ${item.label} icon`} className={note.icon?.type === "affine-icon" && note.icon.name === item.name ? "selected" : ""} onClick={() => chooseAffineIcon(item.name)}><item.Icon size={24} color={color} /></button>)}</div></div>
        {!filteredIcons.length && <div className="page-icon-empty">No icons found</div>}
      </div>}
    </div>}
  </div>;
}
