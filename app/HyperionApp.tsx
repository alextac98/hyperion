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
  MagnifyingGlass,
  Moon,
  PencilSimple,
  Plus,
  Rows,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Star,
  Sun,
  Tag,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PageIcon, PageIconPicker } from "./components/PageIconPicker";
import { AffineEditor } from "./editor/AffineEditor";
import {
  type EditorStore,
  duplicateEditorDocument,
  exportEditorDocuments,
  importEditorDocuments,
  removeEditorDocument,
} from "./editor/blocksuite-runtime";
import {
  CollectionRecord,
  createBlankNote,
  DEFAULT_VAULT_ID,
  NoteRecord,
  normalizePageIcon,
  pageIconText,
  ThemePreference,
  VaultBundle,
  VaultPreferences,
  VaultRecord,
} from "./lib/local-database";
import { knowledgeRepository, platformRuntime, type StorageInfo } from "./platform/runtime";
import {
  hydratePageIdentities,
  pageIdentityChanged,
  reconcilePageLinks,
} from "./lib/page-links";

type View = "note" | "home" | "all" | "journal" | "tags" | "archive" | "trash";
type Composer =
  | { type: "vault"; value: string }
  | { type: "page"; value: string; parentId: string | null }
  | { type: "rename"; value: string; noteId: string }
  | null;
type PageDropPlacement = "before" | "inside" | "after";
type PageDropTarget = { noteId: string | null; placement: PageDropPlacement };
type PageContextMenuState = { noteId: string; x: number; y: number };
const PAGE_DRAG_TYPE = "application/x-hyperion-page";
const PAGE_ORDER_STEP = 1_000;

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_WIDTH_STORAGE_KEY = "hyperion:sidebar-width";

function clampSidebarWidth(width: number) {
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

function getStoredSidebarWidth() {
  try {
    const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0 ? clampSidebarWidth(storedWidth) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

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
  return note.body.replace(/\s+/g, " ").trim() || "Empty page";
}

function comparePageOrder(first: NoteRecord, second: NoteRecord) {
  const orderDifference = first.sortOrder - second.sortOrder;
  return orderDifference || first.title.localeCompare(second.title) || first.id.localeCompare(second.id);
}

function descendantIds(notes: NoteRecord[], parentId: string) {
  const descendants = new Set<string>();
  const queue = [parentId];
  while (queue.length) {
    const current = queue.shift()!;
    notes.forEach((note) => {
      if (note.parentId === current && !descendants.has(note.id)) {
        descendants.add(note.id);
        queue.push(note.id);
      }
    });
  }
  return descendants;
}

function ancestorPath(notes: NoteRecord[], note: NoteRecord) {
  const byId = new Map(notes.map((item) => [item.id, item]));
  const path: NoteRecord[] = [];
  const visited = new Set([note.id]);
  let parentId = note.parentId;
  while (parentId && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parentId;
  }
  return path;
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
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageContextMenu, setPageContextMenu] = useState<PageContextMenuState | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [composer, setComposer] = useState<Composer>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const [editorStore, setEditorStore] = useState<EditorStore | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const stableTitles = useRef<Record<string, string>>({});
  const titleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeVault = vaults.find((vault) => vault.id === vaultId);
  const activeNote = notes.find((note) => note.id === activeId);
  const composerFocusKey = composer?.type === "rename" ? `rename:${composer.noteId}` : composer?.type ?? null;
  const activeNotes = useMemo(() => notes.filter((note) => !note.trashed && !note.archived), [notes]);
  const archivedNotes = useMemo(() => notes.filter((note) => note.archived && !note.trashed), [notes]);
  const trashedNotes = useMemo(() => notes.filter((note) => note.trashed), [notes]);
  const pageContextNote = pageContextMenu ? activeNotes.find((note) => note.id === pageContextMenu.noteId) : undefined;
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
    const hydratedNotes = hydratePageIdentities(storedNotes);
    await Promise.all(hydratedNotes.flatMap((note, index) =>
      pageIdentityChanged(storedNotes[index], note) ? [knowledgeRepository.saveNote(note)] : [],
    ));
    setVaultId(nextVaultId);
    setNotes(hydratedNotes);
    stableTitles.current = Object.fromEntries(hydratedNotes.map((note) => [note.id, note.title]));
    setCollections(storedCollections);
    setPreferences(storedPreferences);
    setDetailsOpen(storedPreferences.showDetails);
    if (nextVaults) setVaults(nextVaults);
    const remembered = localStorage.getItem(`hyperion:last-note:${nextVaultId}`);
    const target = hydratedNotes.find((note) => note.id === remembered && !note.trashed && !note.archived)
      ?? hydratedNotes.find((note) => !note.trashed && !note.archived);
    setActiveId(target?.id ?? "");
    setActiveTag(null);
    setView(target ? "note" : "home");
    localStorage.setItem("hyperion:current-vault", nextVaultId);
    setVaultMenuOpen(false);
    setEditorStore(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void platformRuntime.getStorageInfo().then((info) => {
      if (!cancelled) setStorageInfo(info);
    });
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
    setNotes((current) => {
      const source = current.find((note) => note.id === id);
      if (!source) return current;
      const nextTitle = typeof patch.title === "string" ? patch.title : source.title;
      const titleEdited = nextTitle !== source.title;
      const titleChanged = nextTitle.trim().toLocaleLowerCase() !== source.title.trim().toLocaleLowerCase();
      const stableTitle = stableTitles.current[id] ?? source.title;
      const aliases = titleChanged && stableTitle.trim()
        ? [...source.aliases.filter((alias) => alias.toLocaleLowerCase() !== nextTitle.trim().toLocaleLowerCase()), stableTitle.trim()]
        : source.aliases;
      if (titleEdited) {
        if (titleTimers.current[id]) clearTimeout(titleTimers.current[id]);
        titleTimers.current[id] = setTimeout(() => {
          if (nextTitle.trim()) stableTitles.current[id] = nextTitle;
          delete titleTimers.current[id];
        }, 1_500);
      }
      const updated = { ...source, ...patch, aliases, updatedAt: new Date().toISOString() };
      const identityNotes = current.map((note) => note.id === id ? updated : note);
      const reconciled = reconcilePageLinks(updated, identityNotes);
      scheduleSave(reconciled, immediate);
      return identityNotes.map((note) => note.id === id ? reconciled : note);
    });
  }, [scheduleSave]);

  const selectNote = useCallback((id: string) => {
    setActiveId(id);
    setView("note");
    setMoreOpen(false);
    setAddingTag(false);
    setTagDraft("");
    setEditorStore(null);
    setPageContextMenu(null);
    localStorage.setItem(`hyperion:last-note:${vaultId}`, id);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }, [vaultId]);

  const createNote = useCallback(async (parentId: string | null = null, title = "Untitled") => {
    const note = createBlankNote(vaultId, parentId);
    note.title = title.trim() || "Untitled";
    stableTitles.current[note.id] = note.title;
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
        void createNote();
      }
      if (event.key === "Escape") {
        closeSearch();
        setMoreOpen(false);
        setVaultMenuOpen(false);
        setPageContextMenu(null);
        setComposer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, createNote]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 30);
  }, [searchOpen]);

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  useEffect(() => {
    if (!composerFocusKey) return;
    composerInputRef.current?.focus();
    if (composerFocusKey.startsWith("rename:")) composerInputRef.current?.select();
  }, [composerFocusKey]);

  const applySidebarWidth = useCallback((width: number, persist = false) => {
    const nextWidth = clampSidebarWidth(width);
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    if (persist) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
      } catch {
        // The resize should still work when browser storage is unavailable.
      }
    }
  }, []);

  const startSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || window.innerWidth <= 720) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidthRef.current };
    setSidebarResizing(true);
  };

  const moveSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize) return;
    applySidebarWidth(resize.startWidth + event.clientX - resize.startX);
  };

  const finishSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!sidebarResizeRef.current) return;
    sidebarResizeRef.current = null;
    setSidebarResizing(false);
    applySidebarWidth(sidebarWidthRef.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 24 : 8;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = sidebarWidthRef.current - step;
    if (event.key === "ArrowRight") nextWidth = sidebarWidthRef.current + step;
    if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH;
    if (event.key === "End") nextWidth = MAX_SIDEBAR_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    applySidebarWidth(nextWidth, true);
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeNotes.slice(0, 8);
    return activeNotes.filter((note) =>
      note.title.toLowerCase().includes(query) ||
      note.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
      note.body.toLowerCase().includes(query) ||
      note.tags.some((tag) => tag.includes(query)) ||
      ancestorPath(activeNotes, note).some((parent) => parent.title.toLowerCase().includes(query)),
    ).slice(0, 12);
  }, [activeNotes, searchQuery]);

  const navigateView = (nextView: Exclude<View, "note">) => {
    setView(nextView);
    setMoreOpen(false);
    setPageContextMenu(null);
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
    const duplicate: NoteRecord = { ...note, id: crypto.randomUUID(), title: `${note.title} copy`, aliases: [], sortOrder: note.sortOrder + 0.5, favorite: false, archived: false, trashed: false, createdAt: now, updatedAt: now };
    await duplicateEditorDocument(vaultId, note.id, duplicate.id);
    await knowledgeRepository.saveNote(duplicate);
    stableTitles.current[duplicate.id] = duplicate.title;
    setNotes((current) => [duplicate, ...current]);
    selectNote(duplicate.id);
  };

  const archiveNote = (note: NoteRecord) => {
    updateNoteById(note.id, { archived: true, favorite: false }, true);
    setPageContextMenu(null);
    if (activeId === note.id) navigateView("archive");
  };

  const trashNote = (note: NoteRecord) => {
    updateNoteById(note.id, { trashed: true, archived: false, favorite: false }, true);
    setPageContextMenu(null);
    if (activeId === note.id) navigateView("home");
  };

  const openPageContextMenu = (event: React.MouseEvent<HTMLElement>, noteId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 218;
    const menuHeight = 260;
    const gutter = 8;
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX || bounds.left + Math.min(bounds.width, 44);
    const anchorY = event.clientY || bounds.top + bounds.height;
    setMoreOpen(false);
    setVaultMenuOpen(false);
    setPageContextMenu({
      noteId,
      x: Math.max(gutter, Math.min(anchorX, window.innerWidth - menuWidth - gutter)),
      y: Math.max(gutter, Math.min(anchorY, window.innerHeight - menuHeight - gutter)),
    });
  };

  const permanentlyDelete = async (note: NoteRecord) => {
    if (!window.confirm(`Permanently delete “${note.title}”? This cannot be undone.`)) return;
    const children = notes
      .filter((item) => item.parentId === note.id)
      .map((item) => ({ ...item, parentId: note.parentId, updatedAt: new Date().toISOString() }));
    setNotes((current) => current
      .filter((item) => item.id !== note.id)
      .map((item) => children.find((child) => child.id === item.id) ?? item));
    await Promise.all([
      ...children.map((child) => knowledgeRepository.saveNote(child)),
      knowledgeRepository.deleteNote(note.id),
      removeEditorDocument(vaultId, note.id),
    ]);
  };

  const moveNote = useCallback((noteId: string, targetId: string | null, placement: PageDropPlacement = "inside") => {
    setNotes((current) => {
      const active = current.filter((note) => !note.trashed && !note.archived);
      const source = active.find((note) => note.id === noteId);
      const target = targetId ? active.find((note) => note.id === targetId) : undefined;
      if (!source || (targetId && !target) || targetId === noteId) return current;

      const parentId = placement === "inside" ? targetId : target?.parentId ?? null;
      if (parentId === noteId || (parentId && descendantIds(active, noteId).has(parentId))) return current;

      const siblings = active
        .filter((note) => note.id !== noteId && note.parentId === parentId)
        .sort(comparePageOrder);
      let insertAt = siblings.length;
      if (placement !== "inside" && target) {
        const targetIndex = siblings.findIndex((note) => note.id === target.id);
        if (targetIndex < 0) return current;
        insertAt = targetIndex + (placement === "after" ? 1 : 0);
      }

      const ordered = [...siblings.slice(0, insertAt), source, ...siblings.slice(insertAt)];
      const now = new Date().toISOString();
      const orderById = new Map(ordered.map((note, index) => [note.id, (index + 1) * PAGE_ORDER_STEP]));
      const changed = current.map((note) => {
        const sortOrder = orderById.get(note.id);
        if (sortOrder === undefined) return note;
        const nextParentId = note.id === noteId ? parentId : note.parentId;
        if (note.sortOrder === sortOrder && note.parentId === nextParentId) return note;
        return { ...note, parentId: nextParentId, sortOrder, updatedAt: note.id === noteId ? now : note.updatedAt };
      });
      changed.forEach((note, index) => {
        if (note !== current[index]) scheduleSave(note, true);
      });
      return changed;
    });
  }, [scheduleSave]);

  const addPageLink = (source: NoteRecord, targetId: string) => {
    const target = activeNotes.find((note) => note.id === targetId);
    if (!target || source.links.some((link) => link.targetId === target.id)) return;
    updateNoteById(source.id, {
      links: [...source.links, { targetId: target.id, label: target.title, kind: "manual" }],
    }, true);
  };

  const removePageLink = (source: NoteRecord, targetId: string) => {
    updateNoteById(source.id, {
      links: source.links.filter((link) => link.targetId !== targetId || link.kind !== "manual"),
    }, true);
  };

  const submitComposer = async (event: FormEvent) => {
    event.preventDefault();
    if (!composer) return;
    if (composer.type === "vault") {
      const vault = await knowledgeRepository.createVault(composer.value);
      const nextVaults = [...vaults, vault];
      setComposer(null);
      await loadVault(vault.id, nextVaults);
    } else if (composer.type === "page") {
      const { parentId, value } = composer;
      setComposer(null);
      await createNote(parentId, value);
    } else {
      const title = composer.value.trim() || "Untitled";
      updateNoteById(composer.noteId, { title }, true);
      setComposer(null);
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
      version: 6,
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
      if (bundle.format !== "hyperion-vault" || ![1, 2, 3, 4, 5, 6].includes(bundle.version)) throw new Error("Unsupported vault file");
      const vault = await knowledgeRepository.createVault(`${bundle.vault.name} import`);
      const collectionMap = new Map(bundle.collections.map((collection) => [collection.id, crypto.randomUUID()]));
      const noteMap = new Map(bundle.notes.map((note) => [note.id, crypto.randomUUID()]));
      const importedCollections = bundle.collections.map((collection) => ({ ...collection, id: collectionMap.get(collection.id)!, vaultId: vault.id }));
      const importedNotes = hydratePageIdentities(bundle.notes.map((note) => ({
        ...note,
        id: noteMap.get(note.id)!,
        vaultId: vault.id,
        icon: normalizePageIcon(note.icon),
        aliases: note.aliases ?? [],
        links: (note.links ?? []).flatMap((link) => {
          const targetId = noteMap.get(link.targetId);
          return targetId ? [{ ...link, targetId }] : [];
        }),
        parentId: note.parentId ? noteMap.get(note.parentId) ?? null : null,
        sortOrder: Number.isFinite(note.sortOrder) ? note.sortOrder : 0,
        archived: note.archived ?? false,
        collectionIds: (note.collectionIds ?? []).map((id) => collectionMap.get(id)).filter(Boolean) as string[],
      })));
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
      setSettingsOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not import this vault");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const heading = view === "note" ? activeNote?.title : ({ home: "Home", all: "All pages", journal: "Journal", tags: "Tags", archive: "Archive", trash: "Trash" } as const)[view as Exclude<View, "note">];
  const activeAncestors = activeNote ? ancestorPath(activeNotes, activeNote) : [];
  const outgoingLinks = activeNote ? [...new Set(activeNote.links.map((link) => link.targetId))]
    .flatMap((targetId) => {
      const target = activeNotes.find((note) => note.id === targetId);
      return target ? [target] : [];
    }) : [];
  const outgoingLinkIds = new Set(outgoingLinks.map((note) => note.id));
  const manualLinkIds = new Set(activeNote?.links.filter((link) => link.kind === "manual").map((link) => link.targetId) ?? []);
  const backlinks = activeNote ? activeNotes.filter((note) => note.id !== activeNote.id && note.links.some((link) => link.targetId === activeNote.id)) : [];
  const outline = activeNote ? activeNote.body.split("\n").map((line) => line.trim()).filter((line) => line && line.length < 72 && !/^[•*-]/.test(line)).slice(0, 8) : [];

  if (loading) {
    return <main className="app-loading"><HyperionMark /><span>Opening your local vault…</span></main>;
  }

  return (
    <main
      className={`app-shell${sidebarResizing ? " sidebar-resizing" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <div className="workspace-header">
          <div className="vault-switcher-wrap">
            <button className="workspace-button" onClick={() => setVaultMenuOpen((open) => !open)} aria-expanded={vaultMenuOpen}>
              <HyperionMark small />
              <span className="workspace-copy"><strong>{activeVault?.name ?? "Hyperion"}</strong><span>{activeNotes.length} pages · Local only</span></span>
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
              </div>
            )}
          </div>
          <button className="icon-button subtle" aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)}><SidebarSimple size={18} /></button>
        </div>

        <button className="new-note-button" onClick={() => void createNote()}><Plus size={17} weight="bold" /><span>New page</span><kbd>⌘ N</kbd></button>

        <nav className="primary-nav" aria-label="Knowledge base">
          <button onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /><span>Search</span><kbd>⌘ K</kbd></button>
          <button className={view === "home" ? "active" : ""} onClick={() => navigateView("home")}><House size={18} /><span>Home</span></button>
          <button className={view === "all" ? "active" : ""} onClick={() => navigateView("all")}><FileText size={18} /><span>All pages</span><em>{activeNotes.length}</em></button>
          <button className={view === "journal" ? "active" : ""} onClick={() => navigateView("journal")}><CalendarBlank size={18} /><span>Journal</span></button>
          <button className={view === "tags" ? "active" : ""} onClick={() => navigateView("tags")}><Tag size={18} /><span>Tags</span></button>
        </nav>

        <div className="sidebar-scroll">
          {favoriteNotes.length > 0 && <section className="sidebar-section">
            <SidebarSectionHeading label="Favorites" expanded={favoritesOpen} onToggle={() => setFavoritesOpen((open) => !open)} />
            {favoritesOpen && <div className="section-items">{favoriteNotes.map((note) => <button key={note.id} className={view === "note" && activeId === note.id ? "active" : ""} onClick={() => selectNote(note.id)} onContextMenu={(event) => openPageContextMenu(event, note.id)}><PageIcon note={note} size={15} /><span>{note.title}</span></button>)}</div>}
          </section>}
          <SidebarOrganizer
            key={`organizer:${vaultId}`}
            notes={activeNotes}
            view={view}
            activeNoteId={activeId}
            onCreatePage={(parentId) => setComposer({ type: "page", value: "", parentId })}
            onMoveNote={moveNote}
            onOpenNote={selectNote}
            onContextMenu={openPageContextMenu}
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
          <button className={view === "archive" ? "active" : ""} onClick={() => navigateView("archive")}><Archive size={17} /><span>Archive</span>{archivedNotes.length > 0 && <em>{archivedNotes.length}</em>}</button>
          <button className={view === "trash" ? "active" : ""} onClick={() => navigateView("trash")}><Trash size={17} /><span>Trash</span>{trashedNotes.length > 0 && <em>{trashedNotes.length}</em>}</button>
          <button onClick={() => setSettingsOpen(true)}><GearSix size={17} /><span>Settings</span></button>
        </div>
        {sidebarOpen && <button
          type="button"
          className="sidebar-resize-handle"
          aria-label={`Resize sidebar, ${sidebarWidth} pixels`}
          title="Drag to resize · Double-click to reset"
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
          onKeyDown={resizeSidebarWithKeyboard}
          onDoubleClick={() => applySidebarWidth(DEFAULT_SIDEBAR_WIDTH, true)}
        />}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><SidebarSimple size={19} /></button>}
            {view === "note" && activeNote && <button className={`icon-button topbar-favorite${activeNote.favorite ? " active" : ""}`} aria-label={activeNote.favorite ? "Remove from favorites" : "Add to favorites"} title={activeNote.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => updateNoteById(activeNote.id, { favorite: !activeNote.favorite }, true)}><Star size={17} weight={activeNote.favorite ? "fill" : "regular"} /></button>}
            <div className="breadcrumbs"><span>{activeVault?.name ?? "Hyperion"}</span>{activeAncestors.map((ancestor) => <span className="breadcrumb-parent" key={ancestor.id}><CaretRight size={12} /><button onClick={() => selectNote(ancestor.id)}><PageIcon note={ancestor} size={12} />{ancestor.title}</button></span>)}<CaretRight size={12} />{view === "note" && activeNote && <PageIcon note={activeNote} size={13} />}<strong>{heading ?? "Untitled"}</strong></div>
          </div>
          <div className="topbar-actions">
            {view === "note" && activeNote && <div className="topbar-history" aria-label="Editing history">
              <button className="icon-button" aria-label="Undo" title="Undo" onClick={() => editorStore?.undo()} disabled={!editorStore}><ArrowCounterClockwise size={16} /></button>
              <button className="icon-button" aria-label="Redo" title="Redo" onClick={() => editorStore?.redo()} disabled={!editorStore}><ArrowClockwise size={16} /></button>
            </div>}
            <span className={`save-status ${saveStatus}`}>{saveStatus === "saved" ? <Check size={13} weight="bold" /> : <span className="saving-spinner" />}{saveStatus === "saved" ? "Saved locally" : "Saving"}</span>
            {view === "note" && <button className={`icon-button${detailsOpen ? " active" : ""}`} aria-label="Toggle note details" onClick={() => setDetailsOpen((open) => !open)}><ListBullets size={19} /></button>}
            {view === "note" && activeNote && <div className="more-wrap topbar-more">
              <button className="icon-button" aria-label="More page actions" title="More actions" onClick={() => setMoreOpen((open) => !open)}><DotsThree size={21} weight="bold" /></button>
              {moreOpen && <div className="popover note-menu"><button onClick={() => { setMoreOpen(false); setComposer({ type: "rename", noteId: activeNote.id, value: activeNote.title }); }}><PencilSimple size={17} /> Rename page</button><button onClick={() => void duplicateNote(activeNote)}><FilePlus size={17} /> Duplicate page</button><button className="archive" onClick={() => archiveNote(activeNote)}><Archive size={17} /> Archive</button><button className="danger" onClick={() => trashNote(activeNote)}><Trash size={17} /> Trash</button></div>}
            </div>}
          </div>
        </header>

        <div className="content-shell">
          <section className="main-content">
            {view === "note" && activeNote ? (
              <article className={`note-workspace${activeNote.icon ? " has-page-icon" : ""}`}>
                <div className={`page-icon-row width-${preferences.editorWidth}`}>
                  <PageIconPicker key={activeNote.id} note={activeNote} onChange={(icon) => updateNoteById(activeNote.id, { icon }, true)} />
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
              <HomeView notes={activeNotes} onSelect={selectNote} onCreate={() => void createNote()} />
            ) : view === "all" ? (
              <NotesView title="All pages" subtitle="Every active page in this vault" notes={activeNotes} allNotes={activeNotes} mode={preferences.notesView} onMode={(mode) => void savePreferencePatch({ notesView: mode })} onSelect={selectNote} onCreate={() => void createNote()} />
            ) : view === "journal" ? (
              <NotesView title="Journal" subtitle="Daily pages and observations" notes={activeNotes.filter((note) => note.tags.includes("journal"))} allNotes={activeNotes} mode={preferences.notesView} onMode={(mode) => void savePreferencePatch({ notesView: mode })} onSelect={selectNote} onCreate={async () => { const note = createBlankNote(vaultId); note.title = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date()); note.tags = ["journal"]; await knowledgeRepository.saveNote(note); setNotes((current) => [note, ...current]); selectNote(note.id); }} />
            ) : view === "tags" ? (
              <TagsView tags={allTags} notes={activeNotes} activeTag={activeTag} onTag={setActiveTag} onSelect={selectNote} />
            ) : view === "archive" ? (
              <ArchiveView notes={archivedNotes} onRestore={(note) => updateNoteById(note.id, { archived: false }, true)} onTrash={trashNote} />
            ) : (
              <TrashView notes={trashedNotes} onRestore={(note) => updateNoteById(note.id, { trashed: false, archived: false }, true)} onDelete={permanentlyDelete} />
            )}
          </section>

          {detailsOpen && view === "note" && activeNote && <aside className="details-panel">
            <section><div className="details-title"><span>On this page</span><em>{outline.length}</em></div><div className="outline-list">{outline.length ? outline.map((line, index) => <button key={`${line}-${index}`}><span className={index === 0 ? "outline-marker active" : "outline-marker"} /><span>{line}</span></button>) : <p>No headings yet</p>}</div></section>
            <section className="details-tags"><div className="details-title"><span>Tags</span><em>{activeNote.tags.length}</em></div><div className="details-tag-list">
              {activeNote.tags.map((tag) => <span className="tag-pill" key={tag}>#{tag}<button aria-label={`Remove tag ${tag}`} onClick={() => updateNoteById(activeNote.id, { tags: activeNote.tags.filter((item) => item !== tag) }, true)}><X size={10} /></button></span>)}
              {addingTag ? <form onSubmit={submitTag}><input ref={tagInputRef} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onBlur={() => !tagDraft && setAddingTag(false)} placeholder="New tag" aria-label="New tag" /></form> : <button className="details-add-button" onClick={() => setAddingTag(true)}><Plus size={12} /> Add tag</button>}
            </div></section>
            <section className="details-page-links"><div className="details-title"><span>Page links</span><em>{outgoingLinks.length}</em></div>
              {outgoingLinks.length ? <div className="details-link-list">{outgoingLinks.map((note) => {
                const inline = activeNote.links.some((link) => link.targetId === note.id && link.kind === "inline");
                return <div className="details-link-row" key={note.id} title={inline ? `Bound to [[${activeNote.links.find((link) => link.targetId === note.id && link.kind === "inline")?.label}]] by page ID` : "Bound by page ID"}><button className="details-link-open" onClick={() => selectNote(note.id)}><PageIcon note={note} size={15} /><span>{note.title}</span><ArrowRight size={13} /></button>{manualLinkIds.has(note.id) && <button className="details-link-remove" aria-label={`Remove link to ${note.title}`} onClick={() => removePageLink(activeNote, note.id)}><X size={11} /></button>}</div>;
              })}</div> : <p className="details-inline-empty">No linked pages yet. Mention one with double brackets or choose a page below.</p>}
              <select className="details-link-select" aria-label="Link another page" value="" onChange={(event) => event.target.value && addPageLink(activeNote, event.target.value)}><option value="">+ Link a page</option>{activeNotes.filter((note) => note.id !== activeNote.id && !outgoingLinkIds.has(note.id)).sort((a, b) => a.title.localeCompare(b.title)).map((note) => <option value={note.id} key={note.id}>{pageIconText(note.icon) ? `${pageIconText(note.icon)} ` : ""}{note.title}</option>)}</select>
            </section>
            <section><div className="details-title"><span>Backlinks</span><em>{backlinks.length}</em></div>{backlinks.length ? <div className="backlinks-list">{backlinks.map((note) => <button key={note.id} onClick={() => selectNote(note.id)}><PageIcon note={note} size={15} /><span>{note.title}</span><ArrowRight size={13} /></button>)}</div> : <div className="details-empty"><span className="linked-rings"><i /><i /></span><p>No pages link here yet.</p><small>Mention with [[{activeNote.title}]]</small></div>}</section>
            <section className="details-properties"><div className="details-title"><span>Properties</span></div><dl><div><dt>Created</dt><dd>{dateLabel(activeNote.createdAt)}</dd></div><div><dt>Edited</dt><dd>{relativeTime(activeNote.updatedAt)}</dd></div><div><dt>Words</dt><dd>{activeNote.body.trim().split(/\s+/).filter(Boolean).length}</dd></div><div><dt>Identity</dt><dd title={activeNote.id}>Stable through moves</dd></div>{activeNote.aliases.length > 0 && <div><dt>Former names</dt><dd title={activeNote.aliases.join(", ")}>{activeNote.aliases.length}</dd></div>}<div><dt>Storage</dt><dd>Local vault</dd></div></dl></section>
          </aside>}
        </div>
      </section>

      {searchOpen && <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeSearch()}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search Hyperion"><div className="search-field"><MagnifyingGlass size={21} /><input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) { selectNote(searchResults[0].id); closeSearch(); } }} placeholder="Search titles, text, tags, and page paths…" /><kbd>ESC</kbd></div><div className="search-caption"><span>{searchQuery ? `${searchResults.length} results` : "Recently edited"}</span><small>{activeVault?.name} · local</small></div><div className="search-results">{searchResults.map((note, index) => <button key={note.id} className={index === 0 ? "selected" : ""} onClick={() => { selectNote(note.id); closeSearch(); }}><span className="result-icon"><PageIcon note={note} size={18} /></span><span className="result-copy"><strong>{note.title}</strong><span>{notePreview(note)}</span></span><span className="result-meta">{relativeTime(note.updatedAt)}</span></button>)}{!searchResults.length && <div className="no-results"><MagnifyingGlass size={24} /><span>No matching pages</span></div>}</div><footer className="dialog-footer"><span><kbd>↵</kbd> Open</span><span className="dialog-brand"><HyperionMark small /> Hyperion</span></footer></section></div>}

      {settingsOpen && activeVault && <SettingsDialog vault={activeVault} vaultCount={vaults.length} preferences={preferences} storageInfo={storageInfo} onStorageLocation={async () => { try { const info = await platformRuntime.chooseStorageLocation(); if (info) { setStorageInfo(info); window.location.reload(); } } catch (error) { alert(`Hyperion could not change the storage folder. ${error instanceof Error ? error.message : String(error)}`); } }} onClose={() => setSettingsOpen(false)} onPreferences={savePreferencePatch} onVault={async (patch) => { const updated = { ...activeVault, ...patch }; await knowledgeRepository.updateVault(updated); setVaults((current) => current.map((vault) => vault.id === updated.id ? updated : vault)); }} onExport={() => void exportVault()} onImport={() => importRef.current?.click()} onDelete={async () => { if (vaults.length <= 1 || !confirm(`Delete the “${activeVault.name}” vault and all of its local notes?`)) return; await knowledgeRepository.deleteVault(activeVault.id); const nextVaults = vaults.filter((vault) => vault.id !== activeVault.id); setVaults(nextVaults); setSettingsOpen(false); await loadVault(nextVaults[0].id, nextVaults); }} />}
      <input ref={importRef} className="hidden-input" type="file" accept=".json,.hyperion.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importVault(file); }} />

      {pageContextMenu && pageContextNote && <PageContextMenu
        state={pageContextMenu}
        note={pageContextNote}
        onClose={() => setPageContextMenu(null)}
        onOpen={() => selectNote(pageContextNote.id)}
        onCreatePage={() => setComposer({ type: "page", value: "", parentId: pageContextNote.id })}
        onRename={() => setComposer({ type: "rename", noteId: pageContextNote.id, value: pageContextNote.title })}
        onDuplicate={() => void duplicateNote(pageContextNote)}
        onFavorite={() => updateNoteById(pageContextNote.id, { favorite: !pageContextNote.favorite }, true)}
        onArchive={() => archiveNote(pageContextNote)}
        onTrash={() => trashNote(pageContextNote)}
      />}

      {composer && <div className="dialog-layer"><form className="composer-dialog" onSubmit={submitComposer}><div className="dialog-icon">{composer.type === "vault" ? <Database size={22} /> : composer.type === "rename" ? <PencilSimple size={22} /> : <FileText size={22} />}</div><h2>{composer.type === "rename" ? "Rename page" : `New ${composer.type === "vault" ? "vault" : "page"}`}</h2><p>{composer.type === "vault" ? "A separate local knowledge space with its own notes and settings." : composer.type === "rename" ? "Give this page a clear name. Existing page links will continue to work." : composer.parentId ? `Create a page inside “${activeNotes.find((note) => note.id === composer.parentId)?.title ?? "this page"}”.` : "Create a top-level page. It can hold content and child pages."}</p><input ref={composerInputRef} value={composer.value} onChange={(event) => setComposer({ ...composer, value: event.target.value })} placeholder={composer.type === "vault" ? "Vault name" : "Page title"} /><div className="dialog-actions"><button type="button" onClick={() => setComposer(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!composer.value.trim()}>{composer.type === "rename" ? "Rename" : "Create"}</button></div></form></div>}
    </main>
  );
}

function PageContextMenu({ state, note, onClose, onOpen, onCreatePage, onRename, onDuplicate, onFavorite, onArchive, onTrash }: {
  state: PageContextMenuState;
  note: NoteRecord;
  onClose: () => void;
  onOpen: () => void;
  onCreatePage: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeMenu = () => onClose();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < items.length - 1 ? current + 1 : 0;
    if (event.key === "ArrowUp") next = current > 0 ? current - 1 : items.length - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return <div
    ref={menuRef}
    className="page-context-menu"
    role="menu"
    tabIndex={-1}
    aria-label={`Actions for ${note.title}`}
    style={{ left: state.x, top: state.y }}
    onKeyDown={navigateMenu}
  >
    <button role="menuitem" onClick={run(onOpen)}><ArrowRight size={16} /><span>Open</span></button>
    <button role="menuitem" onClick={run(onRename)}><PencilSimple size={16} /><span>Rename</span></button>
    <button role="menuitem" onClick={run(onFavorite)}><Star size={16} weight={note.favorite ? "fill" : "regular"} /><span>{note.favorite ? "Remove from favorites" : "Add to favorites"}</span></button>
    <div className="context-menu-divider" role="separator" />
    <button role="menuitem" onClick={run(onCreatePage)}><Plus size={16} /><span>New page inside</span></button>
    <button role="menuitem" onClick={run(onDuplicate)}><FilePlus size={16} /><span>Duplicate</span></button>
    <div className="context-menu-divider" role="separator" />
    <button className="archive" role="menuitem" onClick={run(onArchive)}><Archive size={16} /><span>Archive</span></button>
    <button className="danger" role="menuitem" onClick={run(onTrash)}><Trash size={16} /><span>Trash</span></button>
  </div>;
}

function SidebarSectionHeading({ label, expanded, onToggle, action }: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return <div className="section-heading-row">
    <button className="section-heading" aria-expanded={expanded} onClick={onToggle}><span>{label}</span>{expanded ? <CaretDown size={13} /> : <CaretRight size={13} />}</button>
    {action}
  </div>;
}

function HomeView({ notes, onSelect, onCreate }: { notes: NoteRecord[]; onSelect: (id: string) => void; onCreate: () => void }) {
  const recent = notes.slice(0, 5);
  const noteIds = new Set(notes.map((note) => note.id));
  const topLevelPages = notes.filter((note) => !note.parentId || !noteIds.has(note.parentId));
  return <div className="library-view home-view"><div className="view-heading home-heading"><div><span className="eyebrow"><Sparkle size={14} weight="fill" /> Your local knowledge space</span><h1>Good to see your ideas again.</h1><p>Capture quickly, then shape pages into a hierarchy that grows with your thinking.</p></div><button className="primary-button" onClick={onCreate}><Plus size={17} weight="bold" /> New page</button></div><div className="stat-row"><div><FileText size={20} /><strong>{notes.length}</strong><span>pages</span></div><div><FolderSimple size={20} /><strong>{topLevelPages.length}</strong><span>top level</span></div><div><Hash size={20} /><strong>{new Set(notes.flatMap((note) => note.tags)).size}</strong><span>topics</span></div></div>{topLevelPages.length > 0 && <section className="library-section"><div className="library-section-title"><h2>Top-level pages</h2><span>Pages can contain pages</span></div><div className="collection-card-grid">{topLevelPages.slice(0, 4).map((page) => { const childCount = notes.filter((note) => note.parentId === page.id).length; return <button key={page.id} onClick={() => onSelect(page.id)}><span className="collection-card-icon"><PageIcon note={page} size={21} weight={childCount ? "fill" : "regular"} /></span><span><strong>{page.title}</strong><small>{childCount ? `${childCount} child ${childCount === 1 ? "page" : "pages"}` : notePreview(page)}</small></span><CaretRight size={14} /></button>; })}</div></section>}<section className="library-section"><div className="library-section-title"><h2>Continue writing</h2><span>Recently edited</span></div><div className="note-card-grid">{recent.map((note) => <button className="note-card" key={note.id} onClick={() => onSelect(note.id)}><span className="note-card-top"><PageIcon note={note} size={18} /><small>{relativeTime(note.updatedAt)}</small></span><strong>{note.title}</strong><p>{notePreview(note)}</p><span className="note-card-tags">{note.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</span></button>)}</div></section></div>;
}

function SidebarOrganizer({ notes, view, activeNoteId, onCreatePage, onMoveNote, onOpenNote, onContextMenu }: {
  notes: NoteRecord[];
  view: View;
  activeNoteId: string;
  onCreatePage: (parentId: string | null) => void;
  onMoveNote: (noteId: string, targetId: string | null, placement?: PageDropPlacement) => void;
  onOpenNote: (noteId: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, noteId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(notes.filter((note) => notes.some((child) => child.parentId === note.id)).map((note) => note.id)));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PageDropTarget | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const noteIds = new Set(notes.map((note) => note.id));
  const byParent = new Map<string | null, NoteRecord[]>();
  notes.forEach((note) => {
    const parentId = note.parentId && noteIds.has(note.parentId) && note.parentId !== note.id ? note.parentId : null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), note]);
  });
  byParent.forEach((pages) => pages.sort(comparePageOrder));

  const togglePage = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginDrag = (event: React.DragEvent<HTMLElement>, noteId: string) => {
    draggedIdRef.current = noteId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PAGE_DRAG_TYPE, noteId);
    event.dataTransfer.setData("text/plain", noteId);
    const row = event.currentTarget.closest(".organizer-page-row");
    if (row) event.dataTransfer.setDragImage(row, 16, 16);
    setDraggedId(noteId);
    setDropTarget(null);
  };

  const clearDrag = () => {
    draggedIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  };

  const draggedPageId = (event: React.DragEvent<HTMLElement>) =>
    event.dataTransfer.getData(PAGE_DRAG_TYPE) || event.dataTransfer.getData("text/plain") || draggedIdRef.current;

  const dropPlacement = (event: React.DragEvent<HTMLElement>): PageDropPlacement => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientY - bounds.top) / bounds.height;
    if (position < 0.28) return "before";
    if (position > 0.72) return "after";
    return "inside";
  };

  const canDrop = (noteId: string, target: NoteRecord, placement: PageDropPlacement) => {
    if (noteId === target.id) return false;
    const parentId = placement === "inside" ? target.id : target.parentId;
    return parentId !== noteId && (!parentId || !descendantIds(notes, noteId).has(parentId));
  };

  const finishDrop = (noteId: string | null, targetId: string | null, placement: PageDropPlacement) => {
    const target = targetId ? notes.find((note) => note.id === targetId) : undefined;
    if (!noteId || (targetId && (!target || !canDrop(noteId, target, placement)))) {
      clearDrag();
      return;
    }
    onMoveNote(noteId, targetId, placement);
    const parentToExpand = placement === "inside" ? targetId : target?.parentId;
    if (parentToExpand) setExpanded((current) => new Set(current).add(parentToExpand));
    clearDrag();
  };

  const renderPage = (note: NoteRecord, depth: number): React.ReactNode => {
    const children = byParent.get(note.id) ?? [];
    const isExpanded = expanded.has(note.id);
    const placement = dropTarget?.noteId === note.id ? dropTarget.placement : null;
    return <div className="organizer-page" key={note.id}>
      <div
        className={`organizer-page-row${view === "note" && activeNoteId === note.id ? " active" : ""}${placement ? ` drop-${placement}` : ""}${draggedId === note.id ? " dragging" : ""}`}
        data-page-id={note.id}
        data-drop-placement={placement ?? undefined}
        style={{
          paddingLeft: `${depth * 14 + 2}px`,
          "--organizer-drop-inset": `${depth * 14 + 10}px`,
        } as React.CSSProperties}
        onContextMenu={(event) => onContextMenu(event, note.id)}
        onDragOver={(event) => {
          event.stopPropagation();
          const sourceId = draggedIdRef.current ?? draggedId;
          const nextPlacement = dropPlacement(event);
          if (!sourceId || !canDrop(sourceId, note, nextPlacement)) {
            event.dataTransfer.dropEffect = "none";
            setDropTarget(null);
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget((current) => current?.noteId === note.id && current.placement === nextPlacement
            ? current
            : { noteId: note.id, placement: nextPlacement });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          finishDrop(draggedPageId(event), note.id, dropPlacement(event));
        }}
      >
        {children.length ? <button className="organizer-disclosure" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${note.title}`} aria-expanded={isExpanded} onClick={() => togglePage(note.id)}><CaretRight className={isExpanded ? "expanded" : ""} size={12} weight="bold" /></button> : <span className="organizer-disclosure-spacer" />}
        <button className="organizer-page-link" draggable aria-haspopup="menu" onDragStart={(event) => beginDrag(event, note.id)} onDragEnd={clearDrag} onClick={() => onOpenNote(note.id)} title={`${note.title} · Drag to move · Right-click for actions`}><PageIcon note={note} size={16} weight={children.length ? "fill" : "regular"} /><span>{note.title}</span></button>
        <button className="organizer-add-child" aria-label={`Add a page inside ${note.title}`} title="Add child page" onClick={() => { setExpanded((current) => new Set(current).add(note.id)); onCreatePage(note.id); }}><Plus size={12} weight="bold" /></button>
      </div>
      {isExpanded && children.length > 0 && <div className="organizer-children" role="group" aria-label={`${note.title} child pages`}>{children.map((child) => renderPage(child, depth + 1))}</div>}
    </div>;
  };

  return <section className="sidebar-section organizer-section">
    <SidebarSectionHeading
      label="Organize"
      expanded={open}
      onToggle={() => setOpen((current) => !current)}
      action={<button className="mini-button" aria-label="New top-level page" title="New top-level page" onClick={() => onCreatePage(null)}><Plus size={13} /></button>}
    />
    {open && <div className="organizer-tree">
      {(byParent.get(null) ?? []).map((note) => renderPage(note, 0))}
      {draggedId && <div
        className={`organizer-root-drop${dropTarget?.noteId === null ? " active" : ""}`}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget({ noteId: null, placement: "inside" }); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); finishDrop(draggedPageId(event), null, "inside"); }}
      >Drop here for top level</div>}
      {!notes.length && <p className="sidebar-empty">Create a page, then nest more pages inside it.</p>}
    </div>}
  </section>;
}

function SidebarTags({ tags, onOpenTag }: { tags: [string, number][]; onOpenTag: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="sidebar-section sidebar-tags-section">
    <SidebarSectionHeading label="Tags" expanded={open} onToggle={() => setOpen((current) => !current)} />
    {open && <div className="sidebar-tag-items">{tags.map(([tag, count]) => <button key={tag} onClick={() => onOpenTag(tag)}><Hash size={14} /><span>{tag}</span><em>{count}</em></button>)}{!tags.length && <p className="sidebar-empty">Tags added to pages appear here.</p>}</div>}
  </section>;
}

function NotesView({ title, subtitle, notes, allNotes, mode, onMode, onSelect, onCreate }: { title: string; subtitle: string; notes: NoteRecord[]; allNotes: NoteRecord[]; mode: "list" | "table"; onMode: (mode: "list" | "table") => void; onSelect: (id: string) => void; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const filtered = notes.filter((note) => `${note.title} ${note.body} ${note.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title));
  return <div className="library-view notes-view"><div className="view-heading"><div><span className="eyebrow">{subtitle}</span><h1>{title}</h1><p>{notes.length} {notes.length === 1 ? "page" : "pages"}</p></div><div className="heading-actions"><button className="primary-button" onClick={onCreate}><Plus size={17} weight="bold" /> New page</button></div></div><div className="data-toolbar"><label><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter pages…" /></label><select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "title")}><option value="updated">Last edited</option><option value="title">Title A–Z</option></select><div className="view-toggle"><button className={mode === "table" ? "active" : ""} onClick={() => onMode("table")} title="Table view"><Rows size={17} /></button><button className={mode === "list" ? "active" : ""} onClick={() => onMode("list")} title="Card view"><SquaresFour size={17} /></button></div></div>{filtered.length ? mode === "table" ? <div className="notes-table"><div className="notes-table-head"><span>Name</span><span>Location</span><span>Tags</span><span>Edited</span></div>{filtered.map((note) => { const path = ancestorPath(allNotes, note); return <button className="notes-table-row" key={note.id} onClick={() => onSelect(note.id)}><span className="table-title"><PageIcon note={note} size={17} /><span><strong>{note.title}</strong><small>{notePreview(note)}</small></span>{note.favorite && <Star size={13} weight="fill" />}</span><span className="table-location">{path.length ? path.map((parent) => parent.title).join(" / ") : "Top level"}</span><span className="table-tags">{note.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</span><span className="table-date">{relativeTime(note.updatedAt)}</span></button>; })}</div> : <div className="note-card-grid wide">{filtered.map((note) => <button className="note-card" key={note.id} onClick={() => onSelect(note.id)}><span className="note-card-top"><PageIcon note={note} size={18} />{note.favorite && <Star size={14} weight="fill" />}</span><strong>{note.title}</strong><p>{notePreview(note)}</p><small>Edited {relativeTime(note.updatedAt)}</small></button>)}</div> : <EmptyState icon={<FileText size={28} />} title="Nothing here yet" description={query ? "No pages match this filter." : "Create the first page in this view."} action={!query && <button className="primary-button" onClick={onCreate}><Plus size={16} /> New page</button>} />}</div>;
}

function TagsView({ tags, notes, activeTag, onTag, onSelect }: { tags: [string, number][]; notes: NoteRecord[]; activeTag: string | null; onTag: (tag: string) => void; onSelect: (id: string) => void }) {
  const selectedTag = activeTag && tags.some(([tag]) => tag === activeTag) ? activeTag : tags[0]?.[0] ?? null;
  const tagged = selectedTag ? notes.filter((note) => note.tags.includes(selectedTag)) : [];
  return <div className="library-view tags-view"><div className="view-heading"><div><span className="eyebrow">Themes across your vault</span><h1>Tags</h1><p>Lightweight labels can connect pages across the hierarchy.</p></div></div><div className="tags-layout"><aside><h2>All tags</h2>{tags.map(([tag, count]) => <button key={tag} className={tag === selectedTag ? "active" : ""} onClick={() => onTag(tag)}><Hash size={15} /><span>{tag}</span><em>{count}</em></button>)}</aside><section><h2>{selectedTag ? `#${selectedTag}` : "Choose a tag"}</h2><div className="simple-note-list">{tagged.map((note) => <button key={note.id} onClick={() => onSelect(note.id)}><PageIcon note={note} size={17} /><span><strong>{note.title}</strong><small>{notePreview(note)}</small></span><span>{relativeTime(note.updatedAt)}</span></button>)}</div></section></div></div>;
}

function ArchiveView({ notes, onRestore, onTrash }: { notes: NoteRecord[]; onRestore: (note: NoteRecord) => void; onTrash: (note: NoteRecord) => void }) {
  return <div className="library-view"><div className="view-heading"><div><span className="eyebrow">Pages kept out of the way</span><h1>Archive</h1><p>Archived pages stay local and can be restored at any time.</p></div></div>{notes.length ? <div className="trash-list">{notes.map((note) => <div key={note.id}><PageIcon note={note} size={18} /><span><strong>{note.title}</strong><small>Archived {relativeTime(note.updatedAt)}</small></span><button onClick={() => onRestore(note)}>Restore</button><button className="danger-text" onClick={() => onTrash(note)}>Move to trash</button></div>)}</div> : <EmptyState icon={<Archive size={28} />} title="Archive is empty" description="Right-click a page in the sidebar to archive it." />}</div>;
}

function TrashView({ notes, onRestore, onDelete }: { notes: NoteRecord[]; onRestore: (note: NoteRecord) => void; onDelete: (note: NoteRecord) => void }) {
  return <div className="library-view"><div className="view-heading"><div><span className="eyebrow">Removed pages</span><h1>Trash</h1><p>Restore a page or delete it permanently.</p></div></div>{notes.length ? <div className="trash-list">{notes.map((note) => <div key={note.id}><PageIcon note={note} size={18} /><span><strong>{note.title}</strong><small>Deleted {relativeTime(note.updatedAt)}</small></span><button onClick={() => onRestore(note)}>Restore</button><button className="danger-text" onClick={() => void onDelete(note)}>Delete</button></div>)}</div> : <EmptyState icon={<Trash size={28} />} title="Trash is empty" description="Pages moved to trash will appear here." />}</div>;
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</div>;
}

function SettingsDialog({ vault, vaultCount, preferences, storageInfo, onStorageLocation, onClose, onPreferences, onVault, onExport, onImport, onDelete }: { vault: VaultRecord; vaultCount: number; preferences: VaultPreferences; storageInfo: StorageInfo | null; onStorageLocation: () => Promise<void>; onClose: () => void; onPreferences: (patch: Partial<VaultPreferences>) => Promise<void>; onVault: (patch: Partial<VaultRecord>) => Promise<void>; onExport: () => void; onImport: () => void; onDelete: () => void }) {
  const [tab, setTab] = useState<"general" | "editor" | "appearance" | "data">("general");
  const [name, setName] = useState(vault.name);
  const [description, setDescription] = useState(vault.description);
  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [{ value: "system", label: "System", icon: <Sparkle size={18} /> }, { value: "light", label: "Light", icon: <Sun size={18} /> }, { value: "dark", label: "Dark", icon: <Moon size={18} /> }];
  return <div className="dialog-layer"><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings"><header><div><HyperionMark small /><span><strong>Settings</strong><small>{vault.name}</small></span></div><button onClick={onClose}><X size={19} /></button></header><div className="settings-body"><nav>{(["general", "editor", "appearance", "data"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "general" ? <GearSix size={17} /> : item === "editor" ? <BookOpenText size={17} /> : item === "appearance" ? <Sun size={17} /> : <Database size={17} />}<span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}</nav><div className="settings-content">
    {tab === "general" && <><div className="settings-heading"><h2>General</h2><p>Name and describe this local vault.</p></div><label className="setting-field"><span>Vault name</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && void onVault({ name: name.trim() })} /></label><label className="setting-field"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => void onVault({ description })} /></label><SettingToggle title="Open page details" description="Show outline, backlinks, and properties when opening a page." checked={preferences.showDetails} onChange={(checked) => void onPreferences({ showDetails: checked })} /></>}
    {tab === "editor" && <><div className="settings-heading"><h2>Editor</h2><p>Configure the AFFiNE block editor for this vault.</p></div><SettingToggle title="Spell check" description="Use the browser’s local spell checker while writing." checked={preferences.spellcheck} onChange={(checked) => void onPreferences({ spellcheck: checked })} /><label className="setting-range"><span><strong>Editor text size</strong><small>Adjust text between 14 and 22 pixels.</small></span><input type="range" min="14" max="22" value={preferences.editorFontSize} onChange={(event) => void onPreferences({ editorFontSize: Number(event.target.value) })} /><output>{preferences.editorFontSize}px</output></label><div className="settings-note"><BookOpenText size={19} /><span><strong>Rich blocks are enabled</strong><small>Type / for tables, database views, code, LaTeX, callouts, media, embeds, and more. Select text for inline formatting.</small></span></div></>}
    {tab === "appearance" && <><div className="settings-heading"><h2>Appearance</h2><p>Choose a theme and comfortable writing width.</p></div><div className="setting-block"><span>Theme</span><div className="theme-options">{themes.map((theme) => <button key={theme.value} className={preferences.theme === theme.value ? "active" : ""} onClick={() => void onPreferences({ theme: theme.value })}>{theme.icon}<span>{theme.label}</span>{preferences.theme === theme.value && <Check size={14} />}</button>)}</div></div><div className="setting-block"><span>Editor width</span><div className="segmented-control">{(["compact", "comfortable", "wide"] as const).map((width) => <button key={width} className={preferences.editorWidth === width ? "active" : ""} onClick={() => void onPreferences({ editorWidth: width })}>{width[0].toUpperCase() + width.slice(1)}</button>)}</div></div></>}
    {tab === "data" && <><div className="settings-heading"><h2>Data</h2><p>Everything remains local unless you export it yourself.</p></div>{storageInfo && <div className="data-setting storage-location-setting"><span className="data-setting-icon"><Database size={20} /></span><span><strong>SQLite storage folder</strong><small title={storageInfo.databasePath}>{storageInfo.directory}{storageInfo.isDefault ? " · Default" : ""}</small></span><button onClick={() => void onStorageLocation()}>Choose…</button></div>}<div className="data-setting"><span className="data-setting-icon"><DownloadSimple size={20} /></span><span><strong>Export this vault</strong><small>Download pages, hierarchy, settings, and full block documents.</small></span><button onClick={onExport}>Export</button></div><div className="data-setting"><span className="data-setting-icon"><UploadSimple size={20} /></span><span><strong>Import a vault</strong><small>Import a Hyperion backup as a new, separate local vault.</small></span><button onClick={onImport}>Import</button></div><div className="local-data-note"><Archive size={18} /><span><strong>No account or cloud sync</strong><small>{storageInfo ? "Hyperion stores records, editor documents, and assets in a local SQLite file. Native local-AI services remain on this device." : "Hyperion uses IndexedDB and Yjs in this browser. Nothing is uploaded by the app."}</small></span></div>{vaultCount > 1 && <div className="danger-zone"><span><strong>Delete vault</strong><small>Remove this vault and its metadata from this {storageInfo ? "database" : "browser"}.</small></span><button onClick={onDelete}>Delete vault</button></div>}</>}
  </div></div><footer><span>Changes save automatically to this {storageInfo ? "device" : "browser"}.</span><button className="primary-button" onClick={onClose}>Done</button></footer></section></div>;
}

function SettingToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const inputId = useId();
  return <label className="setting-toggle" htmlFor={inputId}><span><strong>{title}</strong><small>{description}</small></span><input id={inputId} aria-label={title} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}
