import {
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowRight,
  BookOpenText,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  Code,
  Database,
  DownloadSimple,
  DotsThree,
  FilePlus,
  FileText,
  FolderSimple,
  GearSix,
  Hash,
  House,
  ListBullets,
  ListChecks,
  MagnifyingGlass,
  Moon,
  Plus,
  Quotes,
  Rows,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Star,
  Sun,
  Table,
  Tag,
  TextHTwo,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AffineEditor } from "./editor/AffineEditor";
import {
  type EditorStore,
  duplicateEditorDocument,
  exportEditorDocuments,
  importEditorDocuments,
  insertBlock,
  insertTable,
  removeEditorDocument,
} from "./editor/blocksuite-runtime";
import {
  CollectionRecord,
  createBlankNote,
  createCollection,
  DEFAULT_VAULT_ID,
  knowledgeRepository,
  NoteRecord,
  ThemePreference,
  VaultBundle,
  VaultPreferences,
  VaultRecord,
} from "./lib/local-database";

type View = "note" | "home" | "all" | "journal" | "tags" | "trash" | "collection";
type Composer = { type: "vault" | "collection"; value: string } | null;

const FALLBACK_PREFERENCES: VaultPreferences = {
  vaultId: DEFAULT_VAULT_ID,
  theme: "system",
  editorFontSize: 17,
  editorWidth: "comfortable",
  spellcheck: true,
  showDetails: true,
  notesView: "table",
};

function relativeTime(isoDate: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(isoDate));
}

function dateLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(isoDate));
}

function notePreview(note: NoteRecord) {
  return note.body.replace(/\s+/g, " ").trim() || "Empty note";
}

function HyperionMark({ small = false }: { small?: boolean }) {
  return <span className={`hyperion-mark${small ? " hyperion-mark-small" : ""}`} aria-hidden="true"><span /></span>;
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function HyperionApp() {
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [vaultId, setVaultId] = useState(DEFAULT_VAULT_ID);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [preferences, setPreferences] = useState(FALLBACK_PREFERENCES);
  const [activeId, setActiveId] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [composer, setComposer] = useState<Composer>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const [editorStore, setEditorStore] = useState<EditorStore | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeVault = vaults.find((vault) => vault.id === vaultId);
  const activeNote = notes.find((note) => note.id === activeId);
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId);
  const activeNotes = useMemo(() => notes.filter((note) => !note.trashed), [notes]);
  const trashedNotes = useMemo(() => notes.filter((note) => note.trashed), [notes]);
  const favoriteNotes = useMemo(() => activeNotes.filter((note) => note.favorite).slice(0, 5), [activeNotes]);
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    activeNotes.forEach((note) => note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeNotes]);

  const loadVault = useCallback(async (nextVaultId: string, nextVaults?: VaultRecord[]) => {
    setLoading(true);
    const [storedNotes, storedCollections, storedPreferences] = await Promise.all([
      knowledgeRepository.listNotes(nextVaultId),
      knowledgeRepository.listCollections(nextVaultId),
      knowledgeRepository.getPreferences(nextVaultId),
    ]);
    setVaultId(nextVaultId);
    setNotes(storedNotes);
    setCollections(storedCollections);
    setPreferences(storedPreferences);
    setDetailsOpen(storedPreferences.showDetails);
    if (nextVaults) setVaults(nextVaults);
    const remembered = localStorage.getItem(`hyperion:last-note:${nextVaultId}`);
    const target = storedNotes.find((note) => note.id === remembered && !note.trashed) ?? storedNotes.find((note) => !note.trashed);
    setActiveId(target?.id ?? "");
    setActiveCollectionId(null);
    setActiveTag(null);
    setView(target ? "note" : "home");
    localStorage.setItem("hyperion:current-vault", nextVaultId);
    setVaultMenuOpen(false);
    setEditorStore(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void knowledgeRepository.initialize().then(async () => {
      const storedVaults = await knowledgeRepository.listVaults();
      if (cancelled) return;
      setVaults(storedVaults);
      const remembered = localStorage.getItem("hyperion:current-vault");
      const target = storedVaults.some((vault) => vault.id === remembered) ? remembered! : storedVaults[0]?.id ?? DEFAULT_VAULT_ID;
      await loadVault(target, storedVaults);
    });
    return () => { cancelled = true; };
  }, [loadVault]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  const scheduleSave = useCallback((note: NoteRecord, immediate = false) => {
    setSaveStatus("saving");
    if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id]);
    saveTimers.current[note.id] = setTimeout(() => {
      void knowledgeRepository.saveNote(note).then(() => setSaveStatus("saved"));
    }, immediate ? 0 : 300);
  }, []);

  const updateNoteById = useCallback((id: string, patch: Partial<NoteRecord>, immediate = false) => {
    setNotes((current) => current.map((note) => {
      if (note.id !== id) return note;
      const updated = { ...note, ...patch, updatedAt: new Date().toISOString() };
      scheduleSave(updated, immediate);
      return updated;
    }));
  }, [scheduleSave]);

  const selectNote = useCallback((id: string) => {
    setActiveId(id);
    setView("note");
    setMoreOpen(false);
    setInsertOpen(false);
    setEditorStore(null);
    localStorage.setItem(`hyperion:last-note:${vaultId}`, id);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }, [vaultId]);

  const createNote = useCallback(async (collectionId?: string) => {
    const note = createBlankNote(vaultId, collectionId);
    setNotes((current) => [note, ...current]);
    await knowledgeRepository.saveNote(note);
    selectNote(note.id);
  }, [selectNote, vaultId]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (command && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote(activeCollectionId ?? undefined);
      }
      if (event.key === "Escape") {
        closeSearch();
        setMoreOpen(false);
        setInsertOpen(false);
        setVaultMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeCollectionId, closeSearch, createNote]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 30);
  }, [searchOpen]);

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  useEffect(() => {
    if (composer) composerInputRef.current?.focus();
  }, [composer]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeNotes.slice(0, 8);
    return activeNotes.filter((note) =>
      note.title.toLowerCase().includes(query) ||
      note.body.toLowerCase().includes(query) ||
      note.tags.some((tag) => tag.includes(query)) ||
      note.collectionIds.some((id) => collections.find((collection) => collection.id === id)?.name.toLowerCase().includes(query)),
    ).slice(0, 12);
  }, [activeNotes, collections, searchQuery]);

  const navigateView = (nextView: Exclude<View, "note" | "collection">) => {
    setView(nextView);
    setActiveCollectionId(null);
    setMoreOpen(false);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  };

  const openCollection = (id: string) => {
    setActiveCollectionId(id);
    setView("collection");
    if (window.innerWidth <= 720) setSidebarOpen(false);
  };

  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    if (!activeNote) return;
    const tag = tagDraft.trim().toLowerCase().replace(/^#/, "");
    if (tag && !activeNote.tags.includes(tag)) updateNoteById(activeNote.id, { tags: [...activeNote.tags, tag] }, true);
    setTagDraft("");
    setAddingTag(false);
  };

  const duplicateNote = async (note: NoteRecord) => {
    const now = new Date().toISOString();
    const duplicate: NoteRecord = { ...note, id: crypto.randomUUID(), title: `${note.title} copy`, favorite: false, createdAt: now, updatedAt: now };
    await duplicateEditorDocument(vaultId, note.id, duplicate.id);
    await knowledgeRepository.saveNote(duplicate);
    setNotes((current) => [duplicate, ...current]);
    selectNote(duplicate.id);
  };

  const permanentlyDelete = async (note: NoteRecord) => {
    if (!window.confirm(`Permanently delete “${note.title}”? This cannot be undone.`)) return;
    setNotes((current) => current.filter((item) => item.id !== note.id));
    await Promise.all([knowledgeRepository.deleteNote(note.id), removeEditorDocument(vaultId, note.id)]);
  };

  const submitComposer = async (event: FormEvent) => {
    event.preventDefault();
    if (!composer) return;
    if (composer.type === "vault") {
      const vault = await knowledgeRepository.createVault(composer.value);
      const nextVaults = [...vaults, vault];
      setComposer(null);
      await loadVault(vault.id, nextVaults);
    } else {
      const collection = createCollection(vaultId, composer.value);
      await knowledgeRepository.saveCollection(collection);
      setCollections((current) => [...current, collection].sort((a, b) => a.name.localeCompare(b.name)));
      setComposer(null);
      openCollection(collection.id);
    }
  };

  const savePreferencePatch = async (patch: Partial<VaultPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if ("showDetails" in patch) setDetailsOpen(next.showDetails);
    await knowledgeRepository.savePreferences(next);
  };

  const exportVault = async () => {
    if (!activeVault) return;
    const editorDocuments = await exportEditorDocuments(vaultId, notes.map((note) => note.id));
    const bundle: VaultBundle = {
      format: "hyperion-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      vault: activeVault,
      notes,
      collections,
      preferences,
      editorDocuments,
    };
    downloadJson(`${activeVault.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "hyperion"}.hyperion.json`, bundle);
  };

  const importVault = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text()) as VaultBundle;
      if (bundle.format !== "hyperion-vault" || bundle.version !== 1) throw new Error("Unsupported vault file");
      const vault = await knowledgeRepository.createVault(`${bundle.vault.name} import`);
      const collectionMap = new Map(bundle.collections.map((collection) => [collection.id, crypto.randomUUID()]));
      const noteMap = new Map(bundle.notes.map((note) => [note.id, crypto.randomUUID()]));
      const importedCollections = bundle.collections.map((collection) => ({ ...collection, id: collectionMap.get(collection.id)!, vaultId: vault.id }));
      const importedNotes = bundle.notes.map((note) => ({
        ...note,
        id: noteMap.get(note.id)!,
        vaultId: vault.id,
        collectionIds: note.collectionIds.map((id) => collectionMap.get(id)).filter(Boolean) as string[],
      }));
      await Promise.all([
        ...importedCollections.map((collection) => knowledgeRepository.saveCollection(collection)),
        ...importedNotes.map((note) => knowledgeRepository.saveNote(note)),
        knowledgeRepository.savePreferences({ ...bundle.preferences, vaultId: vault.id }),
      ]);
      if (bundle.editorDocuments) {
        const documents = Object.fromEntries(Object.entries(bundle.editorDocuments).flatMap(([id, value]) => noteMap.has(id) ? [[noteMap.get(id)!, value]] : []));
        await importEditorDocuments(vault.id, documents);
      }
      await loadVault(vault.id, [...vaults, vault]);
      setPreferencesOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not import this vault");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const heading = view === "collection" ? activeCollection?.name : view === "note" ? activeNote?.title : ({ home: "Home", all: "All notes", journal: "Journal", tags: "Tags", trash: "Trash" } as const)[view as Exclude<View, "note" | "collection">];
  const backlinkToken = activeNote ? `[[${activeNote.title}]]`.toLowerCase() : "";
  const backlinks = activeNote ? activeNotes.filter((note) => note.id !== activeNote.id && note.body.toLowerCase().includes(backlinkToken)) : [];
  const outline = activeNote ? activeNote.body.split("\n").map((line) => line.trim()).filter((line) => line && line.length < 72 && !/^[•*-]/.test(line)).slice(0, 8) : [];

  if (loading) {
    return <main className="app-loading"><HyperionMark /><span>Opening your local vault…</span></main>;
  }

  return (
    <main className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <div className="workspace-header">
          <div className="vault-switcher-wrap">
            <button className="workspace-button" onClick={() => setVaultMenuOpen((open) => !open)} aria-expanded={vaultMenuOpen}>
              <HyperionMark small />
              <span className="workspace-copy"><strong>{activeVault?.name ?? "Hyperion"}</strong><span>{activeNotes.length} notes · Local only</span></span>
              <CaretDown size={14} weight="bold" />
            </button>
            {vaultMenuOpen && (
              <div className="popover vault-menu">
                <div className="popover-label">Your vaults</div>
                {vaults.map((vault) => (
                  <button key={vault.id} className={vault.id === vaultId ? "selected" : ""} onClick={() => void loadVault(vault.id)}>
                    <span className="vault-color" style={{ background: vault.color }} />
                    <span><strong>{vault.name}</strong><small>Stored on this device</small></span>
                    {vault.id === vaultId && <Check size={15} weight="bold" />}
                  </button>
                ))}
                <div className="popover-divider" />
                <button onClick={() => { setComposer({ type: "vault", value: "" }); setVaultMenuOpen(false); }}><Plus size={16} /> New vault</button>
                <button onClick={() => { setPreferencesOpen(true); setVaultMenuOpen(false); }}><GearSix size={16} /> Vault settings</button>
              </div>
            )}
          </div>
          <button className="icon-button subtle" aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)}><SidebarSimple size={18} /></button>
        </div>

        <button className="new-note-button" onClick={() => void createNote(activeCollectionId ?? undefined)}><Plus size={17} weight="bold" /><span>New note</span><kbd>⌘ N</kbd></button>

        <nav className="primary-nav" aria-label="Knowledge base">
          <button onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /><span>Search</span><kbd>⌘ K</kbd></button>
          <button className={view === "home" ? "active" : ""} onClick={() => navigateView("home")}><House size={18} /><span>Home</span></button>
          <button className={view === "all" ? "active" : ""} onClick={() => navigateView("all")}><FileText size={18} /><span>All notes</span><em>{activeNotes.length}</em></button>
          <button className={view === "journal" ? "active" : ""} onClick={() => navigateView("journal")}><CalendarBlank size={18} /><span>Journal</span></button>
          <button className={view === "tags" ? "active" : ""} onClick={() => navigateView("tags")}><Tag size={18} /><span>Tags</span></button>
        </nav>

        <div className="sidebar-scroll">
          <section className="sidebar-section">
            <button className="section-heading" onClick={() => setFavoritesOpen((open) => !open)}>{favoritesOpen ? <CaretDown size={13} /> : <CaretRight size={13} />}<span>Favorites</span></button>
            {favoritesOpen && <div className="section-items">{favoriteNotes.map((note) => <button key={note.id} className={view === "note" && activeId === note.id ? "active" : ""} onClick={() => selectNote(note.id)}><Star size={15} weight="fill" /><span>{note.title}</span></button>)}</div>}
          </section>
          <SidebarOrganizer
            key={`organizer:${vaultId}`}
            notes={activeNotes}
            collections={collections}
            view={view}
            activeNoteId={activeId}
            activeCollectionId={activeCollectionId}
            onCreateFolder={() => setComposer({ type: "collection", value: "" })}
            onOpenFolder={openCollection}
            onOpenNote={(noteId, collectionId) => {
              setActiveCollectionId(collectionId);
              selectNote(noteId);
            }}
          />
          <SidebarTags
            key={`tags:${vaultId}`}
            tags={allTags}
            onOpenTag={(tag) => {
              setActiveTag(tag);
              navigateView("tags");
            }}
          />
        </div>

        <div className="sidebar-footer">
          <button className={view === "trash" ? "active" : ""} onClick={() => navigateView("trash")}><Trash size={17} /><span>Trash</span>{trashedNotes.length > 0 && <em>{trashedNotes.length}</em>}</button>
          <button onClick={() => setPreferencesOpen(true)}><GearSix size={17} /><span>Preferences</span></button>
          <div className="local-status" title="Editor documents and metadata are stored only in this browser"><span className="status-dot" /><span>Local database</span><Archive size={15} /></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><SidebarSimple size={19} /></button>}
            <div className="breadcrumbs"><span>{activeVault?.name ?? "Hyperion"}</span><CaretRight size={12} /><strong>{heading ?? "Untitled"}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className={`save-status ${saveStatus}`}>{saveStatus === "saved" ? <Check size={13} weight="bold" /> : <span className="saving-spinner" />}{saveStatus === "saved" ? "Saved locally" : "Saving"}</span>
            <button className="icon-button" aria-label="Open preferences" onClick={() => setPreferencesOpen(true)}><GearSix size={18} /></button>
            {view === "note" && <button className={`icon-button${detailsOpen ? " active" : ""}`} aria-label="Toggle note details" onClick={() => setDetailsOpen((open) => !open)}><ListBullets size={19} /></button>}
          </div>
        </header>

        <div className="content-shell">
          <section className="main-content">
            {view === "note" && activeNote ? (
              <article className="note-workspace">
                <div className="editor-commandbar">
                  <div className="commandbar-group">
                    <button title="Undo" onClick={() => editorStore?.undo()} disabled={!editorStore}><ArrowCounterClockwise size={17} /></button>
                    <button title="Redo" onClick={() => editorStore?.redo()} disabled={!editorStore}><ArrowClockwise size={17} /></button>
                  </div>
                  <div className="commandbar-group insert-wrap">
                    <button className="insert-button" onClick={() => setInsertOpen((open) => !open)}><Plus size={15} weight="bold" /> Insert <CaretDown size={12} /></button>
                    {insertOpen && editorStore && <div className="popover insert-menu">
                      <button onClick={() => { insertBlock(editorStore, "heading"); setInsertOpen(false); }}><TextHTwo size={17} /><span><strong>Heading</strong><small>Section heading</small></span></button>
                      <button onClick={() => { insertBlock(editorStore, "todo"); setInsertOpen(false); }}><ListChecks size={17} /><span><strong>To-do</strong><small>Checkbox item</small></span></button>
                      <button onClick={() => { insertTable(editorStore); setInsertOpen(false); }}><Table size={17} /><span><strong>Table</strong><small>Editable 3 × 3 table</small></span></button>
                      <button onClick={() => { insertBlock(editorStore, "code"); setInsertOpen(false); }}><Code size={17} /><span><strong>Code</strong><small>Syntax-highlighted block</small></span></button>
                      <button onClick={() => { insertBlock(editorStore, "quote"); setInsertOpen(false); }}><Quotes size={17} /><span><strong>Quote</strong><small>Quotation block</small></span></button>
                    </div>}
                  </div>
                  <span className="commandbar-hint"><kbd>/</kbd> all blocks · select text to format</span>
                  <button className={`favorite-command${activeNote.favorite ? " active" : ""}`} title="Favorite" onClick={() => updateNoteById(activeNote.id, { favorite: !activeNote.favorite }, true)}><Star size={18} weight={activeNote.favorite ? "fill" : "regular"} /></button>
                  <div className="more-wrap">
                    <button title="More actions" onClick={() => setMoreOpen((open) => !open)}><DotsThree size={21} weight="bold" /></button>
                    {moreOpen && <div className="popover note-menu"><button onClick={() => void duplicateNote(activeNote)}><FilePlus size={17} /> Duplicate note</button><button className="danger" onClick={() => { updateNoteById(activeNote.id, { trashed: true, favorite: false }, true); navigateView("home"); }}><Trash size={17} /> Move to trash</button></div>}
                  </div>
                </div>

                <div className="note-properties-strip">
                  <div className="property-row"><span className="property-label"><Tag size={14} /> Tags</span><div className="property-values">
                    {activeNote.tags.map((tag) => <span className="tag-pill" key={tag}>#{tag}<button onClick={() => updateNoteById(activeNote.id, { tags: activeNote.tags.filter((item) => item !== tag) }, true)}><X size={10} /></button></span>)}
                    {addingTag ? <form onSubmit={submitTag}><input ref={tagInputRef} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onBlur={() => !tagDraft && setAddingTag(false)} placeholder="New tag" /></form> : <button className="add-property" onClick={() => setAddingTag(true)}><Plus size={12} /> Add</button>}
                  </div></div>
                  <div className="property-row"><span className="property-label"><FolderSimple size={14} /> Collections</span><div className="property-values">
                    {activeNote.collectionIds.map((id) => { const collection = collections.find((item) => item.id === id); return collection ? <span className="collection-pill" key={id}><i style={{ background: collection.color }} />{collection.name}<button onClick={() => updateNoteById(activeNote.id, { collectionIds: activeNote.collectionIds.filter((item) => item !== id) }, true)}><X size={10} /></button></span> : null; })}
                    <select aria-label="Add to collection" value="" onChange={(event) => { if (event.target.value) updateNoteById(activeNote.id, { collectionIds: [...activeNote.collectionIds, event.target.value] }, true); }}><option value="">+ Add</option>{collections.filter((collection) => !activeNote.collectionIds.includes(collection.id)).map((collection) => <option value={collection.id} key={collection.id}>{collection.name}</option>)}</select>
                  </div></div>
                </div>

                <AffineEditor
                  key={`${vaultId}:${activeNote.id}`}
                  note={activeNote}
                  preferences={preferences}
                  onChange={(patch) => updateNoteById(activeNote.id, patch)}
                  onStoreReady={setEditorStore}
                />
              </article>
            ) : view === "home" ? (
              <HomeView notes={activeNotes} collections={collections} onSelect={selectNote} onCreate={() => void createNote()} onCollection={openCollection} />
            ) : view === "all" ? (
              <NotesView title="All notes" subtitle="Every active note in this vault" notes={activeNotes} collections={collections} mode={preferences.notesView} onMode={(mode) => void savePreferencePatch({ notesView: mode })} onSelect={selectNote} onCreate={() => void createNote()} />
            ) : view === "journal" ? (
              <NotesView title="Journal" subtitle="Daily notes and observations" notes={activeNotes.filter((note) => note.tags.includes("journal"))} collections={collections} mode={preferences.notesView} onMode={(mode) => void savePreferencePatch({ notesView: mode })} onSelect={selectNote} onCreate={async () => { const note = createBlankNote(vaultId); note.title = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date()); note.tags = ["journal"]; await knowledgeRepository.saveNote(note); setNotes((current) => [note, ...current]); selectNote(note.id); }} />
            ) : view === "collection" && activeCollection ? (
              <NotesView title={activeCollection.name} subtitle="Collection" accent={activeCollection.color} notes={activeNotes.filter((note) => note.collectionIds.includes(activeCollection.id))} collections={collections} mode={preferences.notesView} onMode={(mode) => void savePreferencePatch({ notesView: mode })} onSelect={selectNote} onCreate={() => void createNote(activeCollection.id)} onDelete={async () => { if (!confirm(`Delete the “${activeCollection.name}” collection? Notes will be kept.`)) return; await knowledgeRepository.deleteCollection(activeCollection.id); setCollections((current) => current.filter((item) => item.id !== activeCollection.id)); setNotes((current) => current.map((note) => ({ ...note, collectionIds: note.collectionIds.filter((id) => id !== activeCollection.id) }))); navigateView("all"); }} />
            ) : view === "tags" ? (
              <TagsView tags={allTags} notes={activeNotes} activeTag={activeTag} onTag={setActiveTag} onSelect={selectNote} />
            ) : (
              <TrashView notes={trashedNotes} onRestore={(note) => updateNoteById(note.id, { trashed: false }, true)} onDelete={permanentlyDelete} />
            )}
          </section>

          {detailsOpen && view === "note" && activeNote && <aside className="details-panel">
            <section><div className="details-title"><span>On this page</span><em>{outline.length}</em></div><div className="outline-list">{outline.length ? outline.map((line, index) => <button key={`${line}-${index}`}><span className={index === 0 ? "outline-marker active" : "outline-marker"} /><span>{line}</span></button>) : <p>No headings yet</p>}</div></section>
            <section><div className="details-title"><span>Backlinks</span><em>{backlinks.length}</em></div>{backlinks.length ? <div className="backlinks-list">{backlinks.map((note) => <button key={note.id} onClick={() => selectNote(note.id)}><FileText size={15} /><span>{note.title}</span><ArrowRight size={13} /></button>)}</div> : <div className="details-empty"><span className="linked-rings"><i /><i /></span><p>No notes link here yet.</p><small>Mention with [[{activeNote.title}]]</small></div>}</section>
            <section className="details-properties"><div className="details-title"><span>Properties</span></div><dl><div><dt>Created</dt><dd>{dateLabel(activeNote.createdAt)}</dd></div><div><dt>Edited</dt><dd>{relativeTime(activeNote.updatedAt)}</dd></div><div><dt>Words</dt><dd>{activeNote.body.trim().split(/\s+/).filter(Boolean).length}</dd></div><div><dt>Storage</dt><dd>Local vault</dd></div></dl></section>
            <section className="editor-capabilities"><div className="details-title"><span>Editor blocks</span></div><p>Text, headings, lists, to-dos, callouts, code, LaTeX, dividers, tables, database tables, kanban, images, attachments, bookmarks, and embeds.</p><small>Type <kbd>/</kbd> on an empty line.</small></section>
          </aside>}
        </div>
      </section>

      {searchOpen && <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeSearch()}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search Hyperion"><div className="search-field"><MagnifyingGlass size={21} /><input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) { selectNote(searchResults[0].id); closeSearch(); } }} placeholder="Search titles, text, tags, and collections…" /><kbd>ESC</kbd></div><div className="search-caption"><span>{searchQuery ? `${searchResults.length} results` : "Recently edited"}</span><small>{activeVault?.name} · local</small></div><div className="search-results">{searchResults.map((note, index) => <button key={note.id} className={index === 0 ? "selected" : ""} onClick={() => { selectNote(note.id); closeSearch(); }}><span className="result-icon"><FileText size={18} /></span><span className="result-copy"><strong>{note.title}</strong><span>{notePreview(note)}</span></span><span className="result-meta">{relativeTime(note.updatedAt)}</span></button>)}{!searchResults.length && <div className="no-results"><MagnifyingGlass size={24} /><span>No matching notes</span></div>}</div><footer className="dialog-footer"><span><kbd>↵</kbd> Open</span><span className="dialog-brand"><HyperionMark small /> Hyperion</span></footer></section></div>}

      {preferencesOpen && activeVault && <PreferencesDialog vault={activeVault} vaultCount={vaults.length} preferences={preferences} onClose={() => setPreferencesOpen(false)} onPreferences={savePreferencePatch} onVault={async (patch) => { const updated = { ...activeVault, ...patch }; await knowledgeRepository.updateVault(updated); setVaults((current) => current.map((vault) => vault.id === updated.id ? updated : vault)); }} onExport={() => void exportVault()} onImport={() => importRef.current?.click()} onDelete={async () => { if (vaults.length <= 1 || !confirm(`Delete the “${activeVault.name}” vault and all of its local notes?`)) return; await knowledgeRepository.deleteVault(activeVault.id); const nextVaults = vaults.filter((vault) => vault.id !== activeVault.id); setVaults(nextVaults); setPreferencesOpen(false); await loadVault(nextVaults[0].id, nextVaults); }} />}
      <input ref={importRef} className="hidden-input" type="file" accept=".json,.hyperion.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importVault(file); }} />

      {composer && <div className="dialog-layer"><form className="composer-dialog" onSubmit={submitComposer}><div className="dialog-icon">{composer.type === "vault" ? <Database size={22} /> : <FolderSimple size={22} />}</div><h2>New {composer.type === "vault" ? "vault" : "folder"}</h2><p>{composer.type === "vault" ? "A separate local knowledge space with its own notes and settings." : "Group related notes inside an Organize folder."}</p><input ref={composerInputRef} value={composer.value} onChange={(event) => setComposer({ ...composer, value: event.target.value })} placeholder={composer.type === "vault" ? "Vault name" : "Folder name"} /><div className="dialog-actions"><button type="button" onClick={() => setComposer(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!composer.value.trim()}>Create</button></div></form></div>}
    </main>
  );
}

function HomeView({ notes, collections, onSelect, onCreate, onCollection }: { notes: NoteRecord[]; collections: CollectionRecord[]; onSelect: (id: string) => void; onCreate: () => void; onCollection: (id: string) => void }) {
  const recent = notes.slice(0, 5);
  return <div className="library-view home-view"><div className="view-heading home-heading"><div><span className="eyebrow"><Sparkle size={14} weight="fill" /> Your local knowledge space</span><h1>Good to see your ideas again.</h1><p>Capture quickly, then shape notes with rich blocks and collections.</p></div><button className="primary-button" onClick={onCreate}><Plus size={17} weight="bold" /> New note</button></div><div className="stat-row"><div><FileText size={20} /><strong>{notes.length}</strong><span>notes</span></div><div><FolderSimple size={20} /><strong>{collections.length}</strong><span>collections</span></div><div><Hash size={20} /><strong>{new Set(notes.flatMap((note) => note.tags)).size}</strong><span>topics</span></div></div>{collections.length > 0 && <section className="library-section"><div className="library-section-title"><h2>Collections</h2><span>Organized spaces</span></div><div className="collection-card-grid">{collections.slice(0, 4).map((collection) => <button key={collection.id} onClick={() => onCollection(collection.id)}><span className="collection-card-icon" style={{ background: `${collection.color}18`, color: collection.color }}><FolderSimple size={21} weight="fill" /></span><span><strong>{collection.name}</strong><small>{notes.filter((note) => note.collectionIds.includes(collection.id)).length} notes</small></span><CaretRight size={14} /></button>)}</div></section>}<section className="library-section"><div className="library-section-title"><h2>Continue writing</h2><span>Recently edited</span></div><div className="note-card-grid">{recent.map((note) => <button className="note-card" key={note.id} onClick={() => onSelect(note.id)}><span className="note-card-top"><BookOpenText size={18} /><small>{relativeTime(note.updatedAt)}</small></span><strong>{note.title}</strong><p>{notePreview(note)}</p><span className="note-card-tags">{note.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</span></button>)}</div></section></div>;
}

function SidebarOrganizer({ notes, collections, view, activeNoteId, activeCollectionId, onCreateFolder, onOpenFolder, onOpenNote }: {
  notes: NoteRecord[];
  collections: CollectionRecord[];
  view: View;
  activeNoteId: string;
  activeCollectionId: string | null;
  onCreateFolder: () => void;
  onOpenFolder: (id: string) => void;
  onOpenNote: (noteId: string, collectionId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(
    collections
      .filter((collection) => notes.some((note) => note.collectionIds.includes(collection.id)))
      .map((collection) => collection.id),
  ));
  const knownCollections = new Set(collections.map((collection) => collection.id));
  const rootNotes = notes.filter((note) => !note.collectionIds.some((id) => knownCollections.has(id)));

  const toggleFolder = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return <section className="sidebar-section organizer-section">
    <div className="section-heading-row">
      <button className="section-heading" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? <CaretDown size={13} /> : <CaretRight size={13} />}<span>Organize</span></button>
      <button className="mini-button" aria-label="New folder" title="New folder" onClick={onCreateFolder}><Plus size={13} /></button>
    </div>
    {open && <div className="organizer-tree">
      {collections.map((collection) => {
        const folderNotes = notes.filter((note) => note.collectionIds.includes(collection.id));
        const isExpanded = expanded.has(collection.id);
        const isActive = view === "collection" && activeCollectionId === collection.id;
        return <div className="organizer-folder" key={collection.id}>
          <div className={`organizer-folder-row${isActive ? " active" : ""}`}>
            <button className="organizer-disclosure" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${collection.name}`} aria-expanded={isExpanded} onClick={() => toggleFolder(collection.id)}>
              <CaretRight className={isExpanded ? "expanded" : ""} size={12} weight="bold" />
            </button>
            <button className="organizer-folder-link" onClick={() => { if (!isExpanded) toggleFolder(collection.id); onOpenFolder(collection.id); }}>
              <FolderSimple size={17} weight={isExpanded ? "fill" : "regular"} style={{ color: collection.color }} />
              <span>{collection.name}</span>
            </button>
          </div>
          {isExpanded && folderNotes.length > 0 && <div className="organizer-folder-notes" role="group" aria-label={`${collection.name} notes`}>
            {folderNotes.map((note) => <button key={note.id} className={`organizer-note${view === "note" && activeNoteId === note.id ? " active" : ""}`} onClick={() => onOpenNote(note.id, collection.id)}><FileText size={15} /><span>{note.title}</span></button>)}
          </div>}
        </div>;
      })}
      {rootNotes.map((note) => <button key={note.id} className={`organizer-note root-note${view === "note" && activeNoteId === note.id ? " active" : ""}`} onClick={() => onOpenNote(note.id, null)}><FileText size={15} /><span>{note.title}</span></button>)}
      {!collections.length && !rootNotes.length && <p className="sidebar-empty">Create a folder or note to start organizing.</p>}
    </div>}
  </section>;
}

function SidebarTags({ tags, onOpenTag }: { tags: [string, number][]; onOpenTag: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="sidebar-section sidebar-tags-section">
    <button className="section-heading" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? <CaretDown size={13} /> : <CaretRight size={13} />}<span>Tags</span></button>
    {open && <div className="sidebar-tag-items">{tags.map(([tag, count]) => <button key={tag} onClick={() => onOpenTag(tag)}><Hash size={14} /><span>{tag}</span><em>{count}</em></button>)}{!tags.length && <p className="sidebar-empty">Tags added to notes appear here.</p>}</div>}
  </section>;
}

function NotesView({ title, subtitle, accent, notes, collections, mode, onMode, onSelect, onCreate, onDelete }: { title: string; subtitle: string; accent?: string; notes: NoteRecord[]; collections: CollectionRecord[]; mode: "list" | "table"; onMode: (mode: "list" | "table") => void; onSelect: (id: string) => void; onCreate: () => void; onDelete?: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const filtered = notes.filter((note) => `${note.title} ${note.body} ${note.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title));
  return <div className="library-view notes-view"><div className="view-heading"><div>{accent && <span className="heading-accent" style={{ background: accent }} />}<span className="eyebrow">{subtitle}</span><h1>{title}</h1><p>{notes.length} {notes.length === 1 ? "note" : "notes"}</p></div><div className="heading-actions">{onDelete && <button className="secondary-button danger-text" onClick={onDelete}><Trash size={16} /> Delete collection</button>}<button className="primary-button" onClick={onCreate}><Plus size={17} weight="bold" /> New note</button></div></div><div className="data-toolbar"><label><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter notes…" /></label><select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "title")}><option value="updated">Last edited</option><option value="title">Title A–Z</option></select><div className="view-toggle"><button className={mode === "table" ? "active" : ""} onClick={() => onMode("table")} title="Table view"><Rows size={17} /></button><button className={mode === "list" ? "active" : ""} onClick={() => onMode("list")} title="Card view"><SquaresFour size={17} /></button></div></div>{filtered.length ? mode === "table" ? <div className="notes-table"><div className="notes-table-head"><span>Name</span><span>Collections</span><span>Tags</span><span>Edited</span></div>{filtered.map((note) => <button className="notes-table-row" key={note.id} onClick={() => onSelect(note.id)}><span className="table-title"><FileText size={17} /><span><strong>{note.title}</strong><small>{notePreview(note)}</small></span>{note.favorite && <Star size={13} weight="fill" />}</span><span className="table-collections">{note.collectionIds.slice(0, 2).map((id) => { const collection = collections.find((item) => item.id === id); return collection ? <i key={id}><b style={{ background: collection.color }} />{collection.name}</i> : null; })}</span><span className="table-tags">{note.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</span><span className="table-date">{relativeTime(note.updatedAt)}</span></button>)}</div> : <div className="note-card-grid wide">{filtered.map((note) => <button className="note-card" key={note.id} onClick={() => onSelect(note.id)}><span className="note-card-top"><FileText size={18} />{note.favorite && <Star size={14} weight="fill" />}</span><strong>{note.title}</strong><p>{notePreview(note)}</p><small>Edited {relativeTime(note.updatedAt)}</small></button>)}</div> : <EmptyState icon={<FileText size={28} />} title="Nothing here yet" description={query ? "No notes match this filter." : "Create the first note in this view."} action={!query && <button className="primary-button" onClick={onCreate}><Plus size={16} /> New note</button>} />}</div>;
}

function TagsView({ tags, notes, activeTag, onTag, onSelect }: { tags: [string, number][]; notes: NoteRecord[]; activeTag: string | null; onTag: (tag: string) => void; onSelect: (id: string) => void }) {
  const selectedTag = activeTag && tags.some(([tag]) => tag === activeTag) ? activeTag : tags[0]?.[0] ?? null;
  const tagged = selectedTag ? notes.filter((note) => note.tags.includes(selectedTag)) : [];
  return <div className="library-view tags-view"><div className="view-heading"><div><span className="eyebrow">Themes across your vault</span><h1>Tags</h1><p>Lightweight labels can cross collection boundaries.</p></div></div><div className="tags-layout"><aside><h2>All tags</h2>{tags.map(([tag, count]) => <button key={tag} className={tag === selectedTag ? "active" : ""} onClick={() => onTag(tag)}><Hash size={15} /><span>{tag}</span><em>{count}</em></button>)}</aside><section><h2>{selectedTag ? `#${selectedTag}` : "Choose a tag"}</h2><div className="simple-note-list">{tagged.map((note) => <button key={note.id} onClick={() => onSelect(note.id)}><FileText size={17} /><span><strong>{note.title}</strong><small>{notePreview(note)}</small></span><span>{relativeTime(note.updatedAt)}</span></button>)}</div></section></div></div>;
}

function TrashView({ notes, onRestore, onDelete }: { notes: NoteRecord[]; onRestore: (note: NoteRecord) => void; onDelete: (note: NoteRecord) => void }) {
  return <div className="library-view"><div className="view-heading"><div><span className="eyebrow">Removed notes</span><h1>Trash</h1><p>Restore a note or delete it permanently.</p></div></div>{notes.length ? <div className="trash-list">{notes.map((note) => <div key={note.id}><FileText size={18} /><span><strong>{note.title}</strong><small>Deleted {relativeTime(note.updatedAt)}</small></span><button onClick={() => onRestore(note)}>Restore</button><button className="danger-text" onClick={() => void onDelete(note)}>Delete</button></div>)}</div> : <EmptyState icon={<Trash size={28} />} title="Trash is empty" description="Notes moved to trash will appear here." />}</div>;
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</div>;
}

function PreferencesDialog({ vault, vaultCount, preferences, onClose, onPreferences, onVault, onExport, onImport, onDelete }: { vault: VaultRecord; vaultCount: number; preferences: VaultPreferences; onClose: () => void; onPreferences: (patch: Partial<VaultPreferences>) => Promise<void>; onVault: (patch: Partial<VaultRecord>) => Promise<void>; onExport: () => void; onImport: () => void; onDelete: () => void }) {
  const [tab, setTab] = useState<"general" | "editor" | "appearance" | "data">("general");
  const [name, setName] = useState(vault.name);
  const [description, setDescription] = useState(vault.description);
  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [{ value: "system", label: "System", icon: <Sparkle size={18} /> }, { value: "light", label: "Light", icon: <Sun size={18} /> }, { value: "dark", label: "Dark", icon: <Moon size={18} /> }];
  return <div className="dialog-layer"><section className="preferences-dialog" role="dialog" aria-modal="true" aria-label="Preferences"><header><div><HyperionMark small /><span><strong>Preferences</strong><small>{vault.name}</small></span></div><button onClick={onClose}><X size={19} /></button></header><div className="preferences-body"><nav>{(["general", "editor", "appearance", "data"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "general" ? <GearSix size={17} /> : item === "editor" ? <BookOpenText size={17} /> : item === "appearance" ? <Sun size={17} /> : <Database size={17} />}<span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}</nav><div className="preferences-content">
    {tab === "general" && <><div className="settings-heading"><h2>General</h2><p>Name and describe this local vault.</p></div><label className="setting-field"><span>Vault name</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && void onVault({ name: name.trim() })} /></label><label className="setting-field"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => void onVault({ description })} /></label><SettingToggle title="Open note details" description="Show outline, backlinks, and properties when opening a note." checked={preferences.showDetails} onChange={(checked) => void onPreferences({ showDetails: checked })} /></>}
    {tab === "editor" && <><div className="settings-heading"><h2>Editor</h2><p>Configure the AFFiNE block editor for this vault.</p></div><SettingToggle title="Spell check" description="Use the browser’s local spell checker while writing." checked={preferences.spellcheck} onChange={(checked) => void onPreferences({ spellcheck: checked })} /><label className="setting-range"><span><strong>Editor text size</strong><small>Adjust text between 14 and 22 pixels.</small></span><input type="range" min="14" max="22" value={preferences.editorFontSize} onChange={(event) => void onPreferences({ editorFontSize: Number(event.target.value) })} /><output>{preferences.editorFontSize}px</output></label><div className="settings-note"><BookOpenText size={19} /><span><strong>Rich blocks are enabled</strong><small>Type / for tables, database views, code, LaTeX, callouts, media, embeds, and more. Select text for inline formatting.</small></span></div></>}
    {tab === "appearance" && <><div className="settings-heading"><h2>Appearance</h2><p>Choose a theme and comfortable writing width.</p></div><div className="setting-block"><span>Theme</span><div className="theme-options">{themes.map((theme) => <button key={theme.value} className={preferences.theme === theme.value ? "active" : ""} onClick={() => void onPreferences({ theme: theme.value })}>{theme.icon}<span>{theme.label}</span>{preferences.theme === theme.value && <Check size={14} />}</button>)}</div></div><div className="setting-block"><span>Editor width</span><div className="segmented-control">{(["compact", "comfortable", "wide"] as const).map((width) => <button key={width} className={preferences.editorWidth === width ? "active" : ""} onClick={() => void onPreferences({ editorWidth: width })}>{width[0].toUpperCase() + width.slice(1)}</button>)}</div></div></>}
    {tab === "data" && <><div className="settings-heading"><h2>Data</h2><p>Everything remains local unless you export it yourself.</p></div><div className="data-setting"><span className="data-setting-icon"><DownloadSimple size={20} /></span><span><strong>Export this vault</strong><small>Download notes, collections, preferences, and full block documents.</small></span><button onClick={onExport}>Export</button></div><div className="data-setting"><span className="data-setting-icon"><UploadSimple size={20} /></span><span><strong>Import a vault</strong><small>Import a Hyperion backup as a new, separate local vault.</small></span><button onClick={onImport}>Import</button></div><div className="local-data-note"><Archive size={18} /><span><strong>No account or cloud sync</strong><small>Hyperion uses IndexedDB and Yjs in this browser. Nothing is uploaded by the app.</small></span></div>{vaultCount > 1 && <div className="danger-zone"><span><strong>Delete vault</strong><small>Remove this vault and its metadata from this browser.</small></span><button onClick={onDelete}>Delete vault</button></div>}</>}
  </div></div><footer><span>Changes save automatically to this browser.</span><button className="primary-button" onClick={onClose}>Done</button></footer></section></div>;
}

function SettingToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const inputId = useId();
  return <label className="setting-toggle" htmlFor={inputId}><span><strong>{title}</strong><small>{description}</small></span><input id={inputId} aria-label={title} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}
