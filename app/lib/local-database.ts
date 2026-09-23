export type ThemePreference = "light" | "dark" | "system";
export type NotesViewPreference = "list" | "table";
export type NoteKind = "note" | "journal";
export type TemplatePurpose = NoteKind;

export type VaultRecord = {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type CollectionRecord = {
  id: string;
  vaultId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type PageLinkRecord = {
  targetId: string;
  label: string;
  kind: "inline" | "manual";
};

export type PageIconRecord =
  | { type: "emoji"; unicode: string }
  // Legacy storage discriminator for Phosphor interface icons; keep existing data compatible.
  | { type: "affine-icon"; name: string; color: string };

export function normalizePageIcon(value: unknown): PageIconRecord | null {
  if (typeof value === "string" && value.trim()) {
    return { type: "emoji", unicode: value.trim() };
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PageIconRecord> & { unicode?: unknown; name?: unknown; color?: unknown };
  if (candidate.type === "emoji" && typeof candidate.unicode === "string" && candidate.unicode.trim()) {
    return { type: "emoji", unicode: candidate.unicode.trim() };
  }
  if (candidate.type === "affine-icon" && typeof candidate.name === "string" && candidate.name.trim()) {
    return {
      type: "affine-icon",
      name: candidate.name.trim(),
      color: typeof candidate.color === "string" && candidate.color.trim() ? candidate.color : "#4d7cfe",
    };
  }
  return null;
}

export function pageIconText(icon: PageIconRecord | null) {
  return icon?.type === "emoji" ? icon.unicode : icon ? "◆" : "";
}

export type NoteRecord = {
  id: string;
  vaultId: string;
  kind: NoteKind;
  journalDate: string | null;
  title: string;
  icon: PageIconRecord | null;
  aliases: string[];
  body: string;
  tags: string[];
  links: PageLinkRecord[];
  parentId: string | null;
  sortOrder: number;
  collectionIds: string[];
  favorite: boolean;
  archived: boolean;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplateRecord = {
  id: string;
  vaultId: string;
  target: "page";
  name: string;
  description: string;
  defaultTitle: string;
  icon: PageIconRecord | null;
  tags: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultPreferences = {
  vaultId: string;
  theme: ThemePreference;
  editorFontSize: number;
  editorWidth: "compact" | "comfortable" | "wide";
  spellcheck: boolean;
  showDetails: boolean;
  notesView: NotesViewPreference;
  defaultTemplateIds: Record<TemplatePurpose, string | null>;
};

export interface KnowledgeRepository {
  initialize(): Promise<void>;
  listVaults(): Promise<VaultRecord[]>;
  createVault(name: string, options?: { directory?: string; starterNotes?: boolean }): Promise<VaultRecord>;
  updateVault(vault: VaultRecord): Promise<void>;
  deleteVault(id: string): Promise<void>;
  listNotes(vaultId: string): Promise<NoteRecord[]>;
  saveNote(note: NoteRecord): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listTemplates(vaultId: string): Promise<TemplateRecord[]>;
  saveTemplate(template: TemplateRecord): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  listCollections(vaultId: string): Promise<CollectionRecord[]>;
  saveCollection(collection: CollectionRecord): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  getPreferences(vaultId: string): Promise<VaultPreferences>;
  savePreferences(preferences: VaultPreferences): Promise<void>;
}

export const DEFAULT_VAULT_ID = "hyperion";

export const DEFAULT_PREFERENCES: Omit<VaultPreferences, "vaultId"> = {
  theme: "system",
  editorFontSize: 17,
  editorWidth: "comfortable",
  spellcheck: true,
  showDetails: true,
  notesView: "table",
  defaultTemplateIds: { note: null, journal: null },
};

export function normalizeVaultPreferences(
  vaultId: string,
  preferences?: Partial<VaultPreferences> | null,
): VaultPreferences {
  const defaults = preferences?.defaultTemplateIds;
  return {
    vaultId,
    theme: preferences?.theme ?? DEFAULT_PREFERENCES.theme,
    editorFontSize: preferences?.editorFontSize ?? DEFAULT_PREFERENCES.editorFontSize,
    editorWidth: preferences?.editorWidth ?? DEFAULT_PREFERENCES.editorWidth,
    spellcheck: preferences?.spellcheck ?? DEFAULT_PREFERENCES.spellcheck,
    showDetails: preferences?.showDetails ?? DEFAULT_PREFERENCES.showDetails,
    notesView: preferences?.notesView ?? DEFAULT_PREFERENCES.notesView,
    defaultTemplateIds: {
      note: typeof defaults?.note === "string" ? defaults.note : null,
      journal: typeof defaults?.journal === "string" ? defaults.journal : null,
    },
  };
}

function timestamp() {
  return new Date().toISOString();
}

export function journalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferredJournalDate(note: Pick<NoteRecord, "title" | "createdAt">) {
  const titleDate = new Date(note.title);
  const fallbackDate = new Date(note.createdAt);
  return journalDateKey(Number.isNaN(titleDate.getTime()) ? fallbackDate : titleDate);
}

export function normalizeNoteRecord(note: NoteRecord): NoteRecord {
  const legacyJournal = !note.kind && (note.tags ?? []).includes("journal");
  const kind: NoteKind = note.kind === "journal" || legacyJournal ? "journal" : "note";
  const storedJournalDate = typeof note.journalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(note.journalDate)
    ? note.journalDate
    : null;
  return {
    ...note,
    kind,
    journalDate: kind === "journal" ? storedJournalDate ?? inferredJournalDate(note) : null,
    tags: legacyJournal ? (note.tags ?? []).filter((tag) => tag !== "journal") : note.tags ?? [],
    parentId: note.parentId ?? null,
  };
}

export function makeDefaultVault(): VaultRecord {
  const now = timestamp();
  return {
    id: DEFAULT_VAULT_ID,
    name: "Hyperion",
    description: "Personal knowledge base",
    color: "#6f63d9",
    createdAt: now,
    updatedAt: now,
  };
}

export function createBlankNote(vaultId: string, parentId: string | null = null): NoteRecord {
  const now = timestamp();
  return {
    id: crypto.randomUUID(),
    vaultId,
    kind: "note",
    journalDate: null,
    title: "Untitled",
    icon: null,
    aliases: [],
    body: "",
    tags: [],
    links: [],
    parentId,
    sortOrder: Date.now(),
    collectionIds: [],
    favorite: false,
    archived: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTemplateFromNote(note: NoteRecord, name = note.title): TemplateRecord {
  const now = timestamp();
  return {
    id: crypto.randomUUID(),
    vaultId: note.vaultId,
    target: "page",
    name: name.trim() || "Untitled template",
    description: "",
    defaultTitle: note.kind === "journal" ? "Untitled" : note.title,
    icon: note.icon,
    tags: [...note.tags],
    body: note.body,
    createdAt: now,
    updatedAt: now,
  };
}

export function createBlankTemplate(vaultId: string, name = "Untitled template"): TemplateRecord {
  const now = timestamp();
  return {
    id: crypto.randomUUID(),
    vaultId,
    target: "page",
    name: name.trim() || "Untitled template",
    description: "",
    defaultTitle: "Untitled",
    icon: null,
    tags: [],
    body: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createCollection(vaultId: string, name: string): CollectionRecord {
  const now = timestamp();
  return {
    id: crypto.randomUUID(),
    vaultId,
    name: name.trim() || "Untitled collection",
    color: ["#6f63d9", "#4b8f8c", "#b77a42", "#b45f73"][Math.floor(Math.random() * 4)],
    createdAt: now,
    updatedAt: now,
  };
}
