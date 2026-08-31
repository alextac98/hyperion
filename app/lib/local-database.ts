export type ThemePreference = "light" | "dark" | "system";
export type NotesViewPreference = "list" | "table";
export type NoteKind = "note" | "journal";

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

export type VaultPreferences = {
  vaultId: string;
  theme: ThemePreference;
  editorFontSize: number;
  editorWidth: "compact" | "comfortable" | "wide";
  spellcheck: boolean;
  showDetails: boolean;
  notesView: NotesViewPreference;
};

export type VaultBundle = {
  format: "hyperion-vault";
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  exportedAt: string;
  vault: VaultRecord;
  notes: NoteRecord[];
  collections: CollectionRecord[];
  preferences: VaultPreferences;
  editorDocuments?: Record<string, string>;
};

export interface KnowledgeRepository {
  initialize(): Promise<void>;
  listVaults(): Promise<VaultRecord[]>;
  createVault(name: string): Promise<VaultRecord>;
  updateVault(vault: VaultRecord): Promise<void>;
  deleteVault(id: string): Promise<void>;
  listNotes(vaultId: string): Promise<NoteRecord[]>;
  saveNote(note: NoteRecord): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listCollections(vaultId: string): Promise<CollectionRecord[]>;
  saveCollection(collection: CollectionRecord): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  getPreferences(vaultId: string): Promise<VaultPreferences>;
  savePreferences(preferences: VaultPreferences): Promise<void>;
}

export const DEFAULT_VAULT_ID = "hyperion";

const DATABASE_NAME = "hyperion-local";
const DATABASE_VERSION = 10;
const NOTES_STORE = "notes";
const VAULTS_STORE = "vaults";
const COLLECTIONS_STORE = "collections";
const PREFERENCES_STORE = "preferences";

export const DEFAULT_PREFERENCES: Omit<VaultPreferences, "vaultId"> = {
  theme: "system",
  editorFontSize: 17,
  editorWidth: "comfortable",
  spellcheck: true,
  showDetails: true,
  notesView: "table",
};

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

export function makeSeedCollections(): CollectionRecord[] {
  const now = timestamp();
  return [
    { id: "knowledge-garden", vaultId: DEFAULT_VAULT_ID, name: "Knowledge garden", color: "#6f63d9", createdAt: now, updatedAt: now },
    { id: "projects", vaultId: DEFAULT_VAULT_ID, name: "Projects", color: "#4b8f8c", createdAt: now, updatedAt: now },
    { id: "reading", vaultId: DEFAULT_VAULT_ID, name: "Reading", color: "#b77a42", createdAt: now, updatedAt: now },
  ];
}

export function makeSeedNotes(): NoteRecord[] {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return [
    {
      id: "welcome-to-hyperion",
      vaultId: DEFAULT_VAULT_ID,
      kind: "note",
      journalDate: null,
      title: "Welcome to Hyperion",
      icon: { type: "emoji", unicode: "👋" },
      aliases: [],
      body: `Hyperion is a quiet place for the things you want to remember.\n\nThis vault lives on this device. There are no accounts, no workspace members, and no remote sync.\n\nStart with a thought\nWrite naturally, use the slash menu for blocks, and connect an idea by mentioning another page in double brackets — like [[The garden and the stream]].\n\nLet knowledge grow\nNest pages inside other pages, use tags for themes, favorite ideas you revisit, and follow backlinks to notice relationships you did not plan.`,
      tags: ["hyperion", "guide"],
      links: [{ targetId: "garden-and-stream", label: "The garden and the stream", kind: "inline" }],
      parentId: null,
      sortOrder: 1_000,
      collectionIds: ["knowledge-garden"],
      favorite: true,
      archived: false,
      trashed: false,
      createdAt: ago(240),
      updatedAt: ago(2),
    },
    {
      id: "garden-and-stream",
      vaultId: DEFAULT_VAULT_ID,
      kind: "note",
      journalDate: null,
      title: "The garden and the stream",
      icon: { type: "emoji", unicode: "🌱" },
      aliases: [],
      body: `A personal knowledge base has two tempos.\n\nThe stream is what passes by: fleeting notes, daily observations, half-formed questions. The garden is what receives deliberate care: durable ideas, maps of a subject, and writing that becomes clearer over time.\n\nHyperion should make capture feel immediate without making every note feel temporary. The bridge between the two is review.\n\nRelated: [[Reading workflow]]`,
      tags: ["thinking", "knowledge"],
      links: [{ targetId: "reading-workflow", label: "Reading workflow", kind: "inline" }],
      parentId: "welcome-to-hyperion",
      sortOrder: 1_000,
      collectionIds: ["knowledge-garden"],
      favorite: true,
      archived: false,
      trashed: false,
      createdAt: ago(10_200),
      updatedAt: ago(46),
    },
    {
      id: "reading-workflow",
      vaultId: DEFAULT_VAULT_ID,
      kind: "note",
      journalDate: null,
      title: "Reading workflow",
      icon: { type: "emoji", unicode: "📚" },
      aliases: [],
      body: `Capture the source and the question that brought you to it.\n\nDuring reading\n• Mark only ideas that change your model.\n• Add a sentence in your own words.\n• Link the idea to something already in the vault.\n\nAfter reading\nReturn within a day and turn the useful fragments into permanent notes. A highlight without context is only a souvenir.`,
      tags: ["reading", "workflow"],
      links: [],
      parentId: "welcome-to-hyperion",
      sortOrder: 2_000,
      collectionIds: ["reading"],
      favorite: false,
      archived: false,
      trashed: false,
      createdAt: ago(9_600),
      updatedAt: ago(190),
    },
    {
      id: "project-atlas",
      vaultId: DEFAULT_VAULT_ID,
      kind: "note",
      journalDate: null,
      title: "Project Atlas",
      icon: { type: "emoji", unicode: "🗺️" },
      aliases: [],
      body: `A small experiment in mapping the concepts I return to most.\n\nQuestions\n• Which notes act as bridges between unrelated subjects?\n• Which ideas have not changed in a year?\n• Can an index emerge from use instead of being designed in advance?`,
      tags: ["projects", "knowledge"],
      links: [],
      parentId: null,
      sortOrder: 2_000,
      collectionIds: ["projects"],
      favorite: false,
      archived: false,
      trashed: false,
      createdAt: ago(8_200),
      updatedAt: ago(380),
    },
    {
      id: "commonplace-book",
      vaultId: DEFAULT_VAULT_ID,
      kind: "note",
      journalDate: null,
      title: "A commonplace book",
      icon: { type: "emoji", unicode: "📖" },
      aliases: [],
      body: `A commonplace book is not a diary and not quite an archive. It is a working collection of passages, observations, and ideas arranged for reuse.\n\nThe important distinction is intention: collecting should make future thinking easier, not simply make the collection larger.`,
      tags: ["history", "knowledge"],
      links: [],
      parentId: "reading-workflow",
      sortOrder: 1_000,
      collectionIds: ["knowledge-garden", "reading"],
      favorite: false,
      archived: false,
      trashed: false,
      createdAt: ago(7_000),
      updatedAt: ago(1_440),
    },
    {
      id: "today-inbox",
      vaultId: DEFAULT_VAULT_ID,
      kind: "journal",
      journalDate: journalDateKey(),
      title: new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date()),
      icon: { type: "emoji", unicode: "📅" },
      aliases: [],
      body: `Morning notes\n\n• Review the open questions in Project Atlas.\n• Capture the essay idea about tools that become places.\n• Revisit [[Reading workflow]].`,
      tags: [],
      links: [{ targetId: "reading-workflow", label: "Reading workflow", kind: "inline" }],
      parentId: null,
      sortOrder: 3_000,
      collectionIds: [],
      favorite: false,
      archived: false,
      trashed: false,
      createdAt: ago(60),
      updatedAt: ago(28),
    },
  ];
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const notes = database.createObjectStore(NOTES_STORE, { keyPath: "id" });
        notes.createIndex("vaultId", "vaultId");
        notes.createIndex("updatedAt", "updatedAt");
      } else if (transaction) {
        const notes = transaction.objectStore(NOTES_STORE);
        if (!notes.indexNames.contains("vaultId")) notes.createIndex("vaultId", "vaultId");
      }
      if (!database.objectStoreNames.contains(VAULTS_STORE)) {
        database.createObjectStore(VAULTS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(COLLECTIONS_STORE)) {
        const collections = database.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
        collections.createIndex("vaultId", "vaultId");
      }
      if (!database.objectStoreNames.contains(PREFERENCES_STORE)) {
        database.createObjectStore(PREFERENCES_STORE, { keyPath: "vaultId" });
      }
      if (transaction && (event as IDBVersionChangeEvent).oldVersion < 9) {
        const notes = transaction.objectStore(NOTES_STORE);
        const collections = transaction.objectStore(COLLECTIONS_STORE);
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        const noteCursor = notes.openCursor();
        noteCursor.onsuccess = () => {
          const cursor = noteCursor.result;
          if (!cursor) return;
          const legacy = cursor.value as Partial<NoteRecord>;
          const normalized = normalizeNoteRecord(legacy as NoteRecord);
          const firstCollectionId = legacy.collectionIds?.[0];
          cursor.update({
            ...normalized,
            vaultId: legacy.vaultId ?? DEFAULT_VAULT_ID,
            icon: normalizePageIcon(legacy.icon),
            aliases: legacy.aliases ?? [],
            links: legacy.links ?? [],
            parentId: legacy.parentId ?? (oldVersion < 4 && firstCollectionId ? `collection-page:${firstCollectionId}` : null),
            sortOrder: Number.isFinite(legacy.sortOrder) ? legacy.sortOrder : 0,
            collectionIds: legacy.collectionIds ?? [],
            archived: legacy.archived ?? false,
          });
          cursor.continue();
        };
        if (oldVersion < 4) {
          const collectionCursor = collections.openCursor();
          collectionCursor.onsuccess = () => {
            const cursor = collectionCursor.result;
            if (!cursor) return;
            const collection = cursor.value as CollectionRecord;
            notes.put({
              id: `collection-page:${collection.id}`,
              vaultId: collection.vaultId,
              kind: "note",
              journalDate: null,
              title: collection.name,
              icon: { type: "emoji", unicode: "📁" },
              aliases: [],
              body: "",
              tags: [],
              links: [],
              parentId: null,
              sortOrder: 0,
              collectionIds: [],
              favorite: false,
              archived: false,
              trashed: false,
              createdAt: collection.createdAt,
              updatedAt: collection.updatedAt,
            } satisfies NoteRecord);
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function getAll<T>(database: IDBDatabase, storeName: string): Promise<T[]> {
  const transaction = database.transaction(storeName, "readonly");
  return requestResult(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>);
}

export class IndexedDbKnowledgeRepository implements KnowledgeRepository {
  async initialize(): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(
      [VAULTS_STORE, NOTES_STORE, COLLECTIONS_STORE, PREFERENCES_STORE],
      "readwrite",
    );
    const vaults = transaction.objectStore(VAULTS_STORE);
    const notes = transaction.objectStore(NOTES_STORE);
    const collections = transaction.objectStore(COLLECTIONS_STORE);
    const preferences = transaction.objectStore(PREFERENCES_STORE);
    if ((await requestResult(vaults.count())) === 0) vaults.put(makeDefaultVault());
    if ((await requestResult(notes.count())) === 0) makeSeedNotes().forEach((note) => notes.put(note));
    if ((await requestResult(collections.count())) === 0) makeSeedCollections().forEach((collection) => collections.put(collection));
    if ((await requestResult(preferences.count())) === 0) {
      preferences.put({ vaultId: DEFAULT_VAULT_ID, ...DEFAULT_PREFERENCES });
    }
    await transactionComplete(transaction);
  }

  async listVaults() {
    const database = await openDatabase();
    return (await getAll<VaultRecord>(database, VAULTS_STORE)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createVault(name: string) {
    const now = timestamp();
    const vault: VaultRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled vault",
      description: "Personal knowledge base",
      color: ["#6f63d9", "#4b8f8c", "#b77a42", "#b45f73"][Math.floor(Math.random() * 4)],
      createdAt: now,
      updatedAt: now,
    };
    const database = await openDatabase();
    const transaction = database.transaction([VAULTS_STORE, PREFERENCES_STORE], "readwrite");
    transaction.objectStore(VAULTS_STORE).put(vault);
    transaction.objectStore(PREFERENCES_STORE).put({ vaultId: vault.id, ...DEFAULT_PREFERENCES });
    await transactionComplete(transaction);
    return vault;
  }

  async updateVault(vault: VaultRecord) {
    const database = await openDatabase();
    const transaction = database.transaction(VAULTS_STORE, "readwrite");
    transaction.objectStore(VAULTS_STORE).put({ ...vault, updatedAt: timestamp() });
    await transactionComplete(transaction);
  }

  async deleteVault(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction([VAULTS_STORE, NOTES_STORE, COLLECTIONS_STORE, PREFERENCES_STORE], "readwrite");
    transaction.objectStore(VAULTS_STORE).delete(id);
    transaction.objectStore(PREFERENCES_STORE).delete(id);
    const notes = transaction.objectStore(NOTES_STORE).openCursor();
    notes.onsuccess = () => {
      const cursor = notes.result;
      if (!cursor) return;
      if ((cursor.value as NoteRecord).vaultId === id) cursor.delete();
      cursor.continue();
    };
    const collections = transaction.objectStore(COLLECTIONS_STORE).openCursor();
    collections.onsuccess = () => {
      const cursor = collections.result;
      if (!cursor) return;
      if ((cursor.value as CollectionRecord).vaultId === id) cursor.delete();
      cursor.continue();
    };
    await transactionComplete(transaction);
  }

  async listNotes(vaultId: string) {
    const database = await openDatabase();
    const notes = await getAll<NoteRecord>(database, NOTES_STORE);
    const stored = notes
      .filter((note) => note.vaultId === vaultId)
      .map((note) => normalizeNoteRecord({
        ...note,
        icon: normalizePageIcon(note.icon),
        aliases: note.aliases ?? [],
        links: note.links ?? [],
        parentId: note.parentId ?? null,
        sortOrder: Number.isFinite(note.sortOrder) ? note.sortOrder : 0,
        archived: note.archived ?? false,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const originalById = new Map(notes.map((note) => [note.id, note]));
    const changed = stored.filter((note) => JSON.stringify(originalById.get(note.id)) !== JSON.stringify(note));
    if (changed.length) {
      const transaction = database.transaction(NOTES_STORE, "readwrite");
      changed.forEach((note) => transaction.objectStore(NOTES_STORE).put(note));
      await transactionComplete(transaction);
    }
    return stored;
  }

  async saveNote(note: NoteRecord) {
    const database = await openDatabase();
    const transaction = database.transaction(NOTES_STORE, "readwrite");
    transaction.objectStore(NOTES_STORE).put(note);
    await transactionComplete(transaction);
  }

  async deleteNote(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(NOTES_STORE, "readwrite");
    transaction.objectStore(NOTES_STORE).delete(id);
    await transactionComplete(transaction);
  }

  async listCollections(vaultId: string) {
    const database = await openDatabase();
    const collections = await getAll<CollectionRecord>(database, COLLECTIONS_STORE);
    return collections.filter((collection) => collection.vaultId === vaultId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveCollection(collection: CollectionRecord) {
    const database = await openDatabase();
    const transaction = database.transaction(COLLECTIONS_STORE, "readwrite");
    transaction.objectStore(COLLECTIONS_STORE).put(collection);
    await transactionComplete(transaction);
  }

  async deleteCollection(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction([COLLECTIONS_STORE, NOTES_STORE], "readwrite");
    transaction.objectStore(COLLECTIONS_STORE).delete(id);
    const notes = transaction.objectStore(NOTES_STORE).openCursor();
    notes.onsuccess = () => {
      const cursor = notes.result;
      if (!cursor) return;
      const note = cursor.value as NoteRecord;
      if (note.collectionIds.includes(id)) cursor.update({ ...note, collectionIds: note.collectionIds.filter((item) => item !== id) });
      cursor.continue();
    };
    await transactionComplete(transaction);
  }

  async getPreferences(vaultId: string) {
    const database = await openDatabase();
    const transaction = database.transaction(PREFERENCES_STORE, "readonly");
    const stored = await requestResult(transaction.objectStore(PREFERENCES_STORE).get(vaultId) as IDBRequest<VaultPreferences | undefined>);
    return stored ?? { vaultId, ...DEFAULT_PREFERENCES };
  }

  async savePreferences(preferences: VaultPreferences) {
    const database = await openDatabase();
    const transaction = database.transaction(PREFERENCES_STORE, "readwrite");
    transaction.objectStore(PREFERENCES_STORE).put(preferences);
    await transactionComplete(transaction);
  }
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
