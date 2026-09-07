import { preloadEditor, prepareVaultEditor } from "./editor/editor-client";
import {
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  DotsThree,
  FilePlus,
  GearSix,
  House,
  ListBullets,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SidebarSimple,
  Stack,
  Star,
  Tag,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Composer,
  PageContextMenuState,
  PageDropPlacement,
  View,
} from "./application/navigation";
import { movePage, patchPage } from "./application/page-operations";
import { ComposerDialog } from "./components/ComposerDialog";
import { HyperionMark } from "./components/HyperionMark";
import { JournalView } from "./components/JournalView";
import {
  ArchiveView,
  HomeView,
  TagsView,
  TemplatesView,
  TrashView,
} from "./components/LibraryViews";
import { NoteDetails } from "./components/NoteDetails";
import { PageContextMenu } from "./components/PageContextMenu";
import { PageIcon } from "./components/PageIcon";
import { PageIconPicker } from "./components/PageIconPicker";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import {
  SidebarOrganizer,
  SidebarSectionHeading,
} from "./components/SidebarOrganizer";
import { TemplatePickerDialog } from "./components/TemplatePickerDialog";
import { AffineEditor } from "./editor/AffineEditor";
import {
  duplicateEditorDocument,
  exportEditorDocuments,
  getOrCreateEditorStore,
  importEditorDocuments,
  removeEditorDocument,
  renameEditorDocument,
  templateDocumentId,
  type EditorStore,
} from "./editor/editor-client";
import { useRecords } from "./hooks/useRecords";
import {
  CollectionRecord,
  createBlankNote,
  createBlankTemplate,
  createTemplateFromNote,
  DEFAULT_VAULT_ID,
  journalDateKey,
  normalizeNoteRecord,
  normalizePageIcon,
  NoteRecord,
  TemplateRecord,
  VaultBundle,
  VaultPreferences,
  VaultRecord,
} from "./lib/local-database";
import {
  hydratePageIdentities,
  pageIdentityChanged,
  reconcilePageLinks,
} from "./lib/page-links";
import {
  findTextMatches,
  revealPageSearchMatch,
  updatePageSearchHighlights,
  type PageSearchMatch,
} from "./lib/page-search";
import { ancestorPath } from "./lib/page-tree";
import {
  journalDate,
  journalTitle,
  templatePageRecord,
} from "./lib/presentation";
import {
  knowledgeRepository,
  platformRuntime,
  type StorageInfo,
} from "./platform/runtime";

type TemplateSelection = "default" | "blank" | { templateId: string };
type TemplatePickerState = { parentId: string | null } | null;

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_WIDTH_STORAGE_KEY = "hyperion:sidebar-width";

function clampSidebarWidth(width: number) {
  return Math.round(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)),
  );
}

function getStoredSidebarWidth() {
  try {
    const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0
      ? clampSidebarWidth(storedWidth)
      : DEFAULT_SIDEBAR_WIDTH;
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
  defaultTemplateIds: { note: null, journal: null },
};

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
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
  const [notes, setNotes, readNotes] = useRecords<NoteRecord>([]);
  const [templates, setTemplates, readTemplates] = useRecords<TemplateRecord>(
    [],
  );
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [preferences, setPreferences] = useState(FALLBACK_PREFERENCES);
  const [activeId, setActiveId] = useState("");
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearchQuery, setPageSearchQuery] = useState("");
  const [pageSearchIndex, setPageSearchIndex] = useState(0);
  const [pageSearchCount, setPageSearchCount] = useState(0);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageContextMenu, setPageContextMenu] =
    useState<PageContextMenuState | null>(null);
  const [composer, setComposer] = useState<Composer>(null);
  const [templatePicker, setTemplatePicker] =
    useState<TemplatePickerState>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const [editorStore, setEditorStore] = useState<EditorStore | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const pageSearchRef = useRef<HTMLInputElement>(null);
  const pageSearchMatchesRef = useRef<PageSearchMatch[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const templateSaveTimers = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const stableTitles = useRef<Record<string, string>>({});
  const titleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeVault = vaults.find((vault) => vault.id === vaultId);
  const activeNote = notes.find((note) => note.id === activeId);
  const activeTemplate = templates.find(
    (template) => template.id === activeTemplateId,
  );
  const activeNotes = useMemo(
    () => notes.filter((note) => !note.trashed && !note.archived),
    [notes],
  );
  const organizedNotes = useMemo(
    () => activeNotes.filter((note) => note.kind === "note"),
    [activeNotes],
  );
  const journalEntries = useMemo(
    () => activeNotes.filter((note) => note.kind === "journal"),
    [activeNotes],
  );
  const archivedNotes = useMemo(
    () => notes.filter((note) => note.archived && !note.trashed),
    [notes],
  );
  const trashedNotes = useMemo(
    () => notes.filter((note) => note.trashed),
    [notes],
  );
  const pageContextNote = pageContextMenu
    ? activeNotes.find((note) => note.id === pageContextMenu.noteId)
    : undefined;
  const favoriteNotes = useMemo(
    () => activeNotes.filter((note) => note.favorite).slice(0, 5),
    [activeNotes],
  );
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    activeNotes.forEach((note) =>
      note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeNotes]);

  const loadVault = useCallback(
    async (nextVaultId: string, nextVaults?: VaultRecord[]) => {
      setLoading(true);
      prepareVaultEditor(nextVaultId);
      const [
        storedNotes,
        storedTemplates,
        storedCollections,
        storedPreferences,
      ] = await Promise.all([
        knowledgeRepository.listNotes(nextVaultId),
        knowledgeRepository.listTemplates(nextVaultId),
        knowledgeRepository.listCollections(nextVaultId),
        knowledgeRepository.getPreferences(nextVaultId),
      ]);
      const hydratedNotes = hydratePageIdentities(
        storedNotes.map(normalizeNoteRecord),
      );
      await Promise.all(
        hydratedNotes.flatMap((note, index) =>
          pageIdentityChanged(storedNotes[index], note)
            ? [knowledgeRepository.saveNote(note)]
            : [],
        ),
      );
      setVaultId(nextVaultId);
      setNotes(hydratedNotes);
      setTemplates(storedTemplates);
      stableTitles.current = Object.fromEntries(
        hydratedNotes.map((note) => [note.id, note.title]),
      );
      setCollections(storedCollections);
      const templateIds = new Set(
        storedTemplates.map((template) => template.id),
      );
      const validPreferences = {
        ...storedPreferences,
        defaultTemplateIds: {
          note: templateIds.has(storedPreferences.defaultTemplateIds.note ?? "")
            ? storedPreferences.defaultTemplateIds.note
            : null,
          journal: templateIds.has(
            storedPreferences.defaultTemplateIds.journal ?? "",
          )
            ? storedPreferences.defaultTemplateIds.journal
            : null,
        },
      };
      setPreferences(validPreferences);
      if (
        JSON.stringify(validPreferences) !== JSON.stringify(storedPreferences)
      ) {
        await knowledgeRepository.savePreferences(validPreferences);
      }
      setDetailsOpen(storedPreferences.showDetails);
      if (nextVaults) setVaults(nextVaults);
      const remembered = localStorage.getItem(
        `hyperion:last-note:${nextVaultId}`,
      );
      const target =
        hydratedNotes.find(
          (note) => note.id === remembered && !note.trashed && !note.archived,
        ) ??
        hydratedNotes.find(
          (note) => note.kind === "note" && !note.trashed && !note.archived,
        ) ??
        hydratedNotes.find((note) => !note.trashed && !note.archived);
      setActiveId(target?.id ?? "");
      setActiveTemplateId("");
      setActiveTag(null);
      setView(target ? "note" : "home");
      localStorage.setItem("hyperion:current-vault", nextVaultId);
      setVaultMenuOpen(false);
      setEditorStore(null);
      setLoading(false);
    },
    [setNotes, setTemplates],
  );

  useEffect(() => {
    let cancelled = false;
    void platformRuntime.getStorageInfo().then((info) => {
      if (!cancelled) setStorageInfo(info);
    });
    preloadEditor();
    void knowledgeRepository.initialize().then(async () => {
      const storedVaults = await knowledgeRepository.listVaults();
      if (cancelled) return;
      setVaults(storedVaults);
      const remembered = localStorage.getItem("hyperion:current-vault");
      const target = storedVaults.some((vault) => vault.id === remembered)
        ? remembered!
        : (storedVaults[0]?.id ?? DEFAULT_VAULT_ID);
      await loadVault(target, storedVaults);
    });
    return () => {
      cancelled = true;
    };
  }, [loadVault]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  const scheduleSave = useCallback((note: NoteRecord, immediate = false) => {
    setSaveStatus("saving");
    if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id]);
    saveTimers.current[note.id] = setTimeout(
      () => {
        void knowledgeRepository
          .saveNote(note)
          .then(() => setSaveStatus("saved"));
      },
      immediate ? 0 : 300,
    );
  }, []);

  const updateNoteById = useCallback(
    (id: string, patch: Partial<NoteRecord>, immediate = false) => {
      const result = patchPage(
        readNotes(),
        id,
        patch,
        stableTitles.current[id],
        new Date().toISOString(),
      );
      if (!result) return;
      if (result.titleEdited) {
        if (titleTimers.current[id]) clearTimeout(titleTimers.current[id]);
        titleTimers.current[id] = setTimeout(() => {
          if (result.note.title.trim())
            stableTitles.current[id] = result.note.title;
          delete titleTimers.current[id];
        }, 1_500);
      }
      setNotes(result.notes);
      scheduleSave(result.note, immediate);
    },
    [readNotes, scheduleSave, setNotes],
  );

  const updateTemplateById = useCallback(
    (id: string, patch: Partial<TemplateRecord>, immediate = false) => {
      const current = readTemplates();
      const template = current.find((item) => item.id === id);
      if (!template) return;
      const updated = {
        ...template,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      setTemplates(current.map((item) => (item.id === id ? updated : item)));
      setSaveStatus("saving");
      if (templateSaveTimers.current[id])
        clearTimeout(templateSaveTimers.current[id]);
      templateSaveTimers.current[id] = setTimeout(
        () => {
          void knowledgeRepository
            .saveTemplate(updated)
            .then(() => setSaveStatus("saved"));
        },
        immediate ? 0 : 300,
      );
    },
    [readTemplates, setTemplates],
  );

  const selectNote = useCallback(
    (id: string) => {
      setActiveId(id);
      setView("note");
      setMoreOpen(false);
      setEditorStore(null);
      setPageContextMenu(null);
      setPageSearchOpen(false);
      setPageSearchQuery("");
      localStorage.setItem(`hyperion:last-note:${vaultId}`, id);
      if (window.innerWidth <= 720) setSidebarOpen(false);
    },
    [vaultId],
  );

  const selectTemplate = useCallback((id: string) => {
    setActiveTemplateId(id);
    setView("template");
    setMoreOpen(false);
    setEditorStore(null);
    setPageContextMenu(null);
    setPageSearchOpen(false);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }, []);

  const instantiatePage = useCallback(
    async ({
      kind,
      parentId = null,
      title,
      dateKey,
      templateSelection = "default",
    }: {
      kind: NoteRecord["kind"];
      parentId?: string | null;
      title?: string;
      dateKey?: string;
      templateSelection?: TemplateSelection;
    }) => {
      const defaultId = preferences.defaultTemplateIds[kind];
      const templateId =
        templateSelection === "default"
          ? defaultId
          : typeof templateSelection === "object"
            ? templateSelection.templateId
            : null;
      const template = templateId
        ? templates.find((item) => item.id === templateId)
        : undefined;
      if (templateId && !template && typeof templateSelection === "object") {
        window.alert("That template is no longer available.");
        return;
      }

      const note = createBlankNote(vaultId, parentId);
      note.kind = kind;
      note.journalDate =
        kind === "journal" ? (dateKey ?? journalDateKey()) : null;
      note.title =
        kind === "journal" && note.journalDate
          ? journalTitle(journalDate(note.journalDate))
          : title?.trim() || template?.defaultTitle.trim() || "Untitled";
      note.icon =
        template?.icon ??
        (kind === "journal" ? { type: "emoji", unicode: "📅" } : null);
      note.tags = template ? [...template.tags] : [];
      note.body = template?.body ?? "";
      const reconciled = reconcilePageLinks(note, [...notes, note]);

      try {
        if (template) {
          const cloned = await duplicateEditorDocument(
            vaultId,
            templateDocumentId(template.id),
            reconciled.id,
            { title: reconciled.title },
          );
          if (!cloned && typeof templateSelection === "object") {
            throw new Error(
              `The “${template.name}” template content could not be opened.`,
            );
          }
          if (!cloned)
            console.warn(
              `Default template ${template.id} had no editor document; creating a blank page`,
            );
        }
        await knowledgeRepository.saveNote(reconciled);
        stableTitles.current[reconciled.id] = reconciled.title;
        setNotes((current) => [reconciled, ...current]);
        selectNote(reconciled.id);
      } catch (error) {
        await removeEditorDocument(vaultId, reconciled.id);
        window.alert(
          error instanceof Error ? error.message : "Could not create this page",
        );
      }
    },
    [
      notes,
      preferences.defaultTemplateIds,
      selectNote,
      templates,
      vaultId,
      setNotes,
    ],
  );

  const createNote = useCallback(
    (
      parentId: string | null = null,
      title?: string,
      templateSelection: TemplateSelection = "default",
    ) => instantiatePage({ kind: "note", parentId, title, templateSelection }),
    [instantiatePage],
  );

  const openJournalDate = useCallback(
    async (dateKey: string) => {
      const existing = notes.find(
        (note) =>
          note.kind === "journal" &&
          note.journalDate === dateKey &&
          !note.trashed &&
          !note.archived,
      );
      if (existing) {
        selectNote(existing.id);
        return;
      }
      await instantiatePage({ kind: "journal", dateKey });
    },
    [instantiatePage, notes, selectNote],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const closePageSearch = useCallback(() => {
    setPageSearchOpen(false);
    setPageSearchQuery("");
    setPageSearchCount(0);
    pageSearchMatchesRef.current = [];
    if ("highlights" in CSS) {
      CSS.highlights.delete("hyperion-page-search");
      CSS.highlights.delete("hyperion-page-search-active");
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest("dialog"))
      )
        return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        closePageSearch();
        setSearchOpen(true);
      }
      if (
        command &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        view === "note" &&
        activeNote
      ) {
        event.preventDefault();
        closeSearch();
        setPageSearchOpen(true);
      }
      if (command && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if (event.key === "Escape") {
        closeSearch();
        closePageSearch();
        setMoreOpen(false);
        setVaultMenuOpen(false);
        setPageContextMenu(null);
        setTemplatePicker(null);
        setComposer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeNote, closePageSearch, closeSearch, createNote, view]);

  useEffect(() => {
    if (pageSearchOpen) setTimeout(() => pageSearchRef.current?.focus(), 30);
  }, [pageSearchOpen]);

  useEffect(() => {
    if (!pageSearchOpen) return;
    const frame = requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>(
        ".note-workspace .blocksuite-mount",
      );
      const matches = editor ? findTextMatches(editor, pageSearchQuery) : [];
      pageSearchMatchesRef.current = matches;
      setPageSearchCount(matches.length);
      setPageSearchIndex(0);
      updatePageSearchHighlights(matches, 0);
      if (matches[0]) revealPageSearchMatch(matches[0]);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, pageSearchOpen, pageSearchQuery]);

  const movePageSearch = (direction: 1 | -1) => {
    const matches = pageSearchMatchesRef.current;
    if (!matches.length) return;
    const next =
      (pageSearchIndex + direction + matches.length) % matches.length;
    setPageSearchIndex(next);
    updatePageSearchHighlights(matches, next);
    revealPageSearchMatch(matches[next]);
  };

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
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    setSidebarResizing(true);
  };

  const moveSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize) return;
    applySidebarWidth(resize.startWidth + event.clientX - resize.startX);
  };

  const finishSidebarResize = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (!sidebarResizeRef.current) return;
    sidebarResizeRef.current = null;
    setSidebarResizing(false);
    applySidebarWidth(sidebarWidthRef.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeSidebarWithKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
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

  const navigateView = (nextView: Exclude<View, "note">) => {
    setView(nextView);
    setMoreOpen(false);
    setPageContextMenu(null);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  };

  const duplicateNote = async (note: NoteRecord) => {
    const now = new Date().toISOString();
    const duplicate: NoteRecord = {
      ...note,
      id: crypto.randomUUID(),
      title: `${note.title} copy`,
      aliases: [],
      sortOrder: note.sortOrder + 0.5,
      favorite: false,
      archived: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    await duplicateEditorDocument(vaultId, note.id, duplicate.id, {
      title: duplicate.title,
    });
    await knowledgeRepository.saveNote(duplicate);
    stableTitles.current[duplicate.id] = duplicate.title;
    setNotes((current) => [duplicate, ...current]);
    selectNote(duplicate.id);
  };

  const saveNoteAsTemplate = async (note: NoteRecord, name: string) => {
    const template = createTemplateFromNote(note, name);
    try {
      await getOrCreateEditorStore(
        note.vaultId,
        note.id,
        note.title,
        note.body,
      );
      const cloned = await duplicateEditorDocument(
        note.vaultId,
        note.id,
        templateDocumentId(template.id),
        { title: template.defaultTitle },
      );
      if (!cloned) throw new Error("The page content could not be copied.");
      await knowledgeRepository.saveTemplate(template);
      setTemplates((current) => [template, ...current]);
      setActiveTemplateId(template.id);
      setView("templates");
    } catch (error) {
      await removeEditorDocument(note.vaultId, templateDocumentId(template.id));
      window.alert(
        error instanceof Error
          ? error.message
          : "Could not create this template",
      );
    }
  };

  const deleteTemplate = async (template: TemplateRecord) => {
    const assignedPurposes = (["note", "journal"] as const).filter(
      (purpose) => preferences.defaultTemplateIds[purpose] === template.id,
    );
    const assignment = assignedPurposes.length
      ? ` It is currently the default for ${assignedPurposes.map((purpose) => (purpose === "note" ? "new pages" : "journal entries")).join(" and ")}; those will return to blank pages.`
      : "";
    if (!window.confirm(`Delete the “${template.name}” template?${assignment}`))
      return;
    await Promise.all([
      knowledgeRepository.deleteTemplate(template.id),
      removeEditorDocument(vaultId, templateDocumentId(template.id)),
    ]);
    const nextDefaults = {
      note:
        preferences.defaultTemplateIds.note === template.id
          ? null
          : preferences.defaultTemplateIds.note,
      journal:
        preferences.defaultTemplateIds.journal === template.id
          ? null
          : preferences.defaultTemplateIds.journal,
    };
    if (
      JSON.stringify(nextDefaults) !==
      JSON.stringify(preferences.defaultTemplateIds)
    ) {
      const nextPreferences = {
        ...preferences,
        defaultTemplateIds: nextDefaults,
      };
      setPreferences(nextPreferences);
      await knowledgeRepository.savePreferences(nextPreferences);
    }
    setTemplates((current) =>
      current.filter((item) => item.id !== template.id),
    );
    if (activeTemplateId === template.id) {
      setActiveTemplateId("");
      setView("templates");
      setEditorStore(null);
    }
  };

  const archiveNote = (note: NoteRecord) => {
    updateNoteById(note.id, { archived: true, favorite: false }, true);
    setPageContextMenu(null);
    if (activeId === note.id) navigateView("archive");
  };

  const trashNote = (note: NoteRecord) => {
    updateNoteById(
      note.id,
      { trashed: true, archived: false, favorite: false },
      true,
    );
    setPageContextMenu(null);
    if (activeId === note.id) navigateView("home");
  };

  const openPageContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    noteId: string,
  ) => {
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
      x: Math.max(
        gutter,
        Math.min(anchorX, window.innerWidth - menuWidth - gutter),
      ),
      y: Math.max(
        gutter,
        Math.min(anchorY, window.innerHeight - menuHeight - gutter),
      ),
    });
  };

  const permanentlyDelete = async (note: NoteRecord) => {
    if (
      !window.confirm(
        `Permanently delete “${note.title}”? This cannot be undone.`,
      )
    )
      return;
    const children = notes
      .filter((item) => item.parentId === note.id)
      .map((item) => ({
        ...item,
        parentId: note.parentId,
        updatedAt: new Date().toISOString(),
      }));
    setNotes((current) =>
      current
        .filter((item) => item.id !== note.id)
        .map((item) => children.find((child) => child.id === item.id) ?? item),
    );
    await Promise.all([
      ...children.map((child) => knowledgeRepository.saveNote(child)),
      knowledgeRepository.deleteNote(note.id),
      removeEditorDocument(vaultId, note.id),
    ]);
  };

  const moveNote = useCallback(
    (
      noteId: string,
      targetId: string | null,
      placement: PageDropPlacement = "inside",
    ) => {
      const current = readNotes();
      const next = movePage(
        current,
        noteId,
        targetId,
        placement,
        new Date().toISOString(),
      );
      setNotes(next);
      next.forEach((note, index) => {
        if (note !== current[index]) scheduleSave(note, true);
      });
    },
    [readNotes, scheduleSave, setNotes],
  );

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
    } else if (composer.type === "template") {
      const note = composer.noteId
        ? notes.find((item) => item.id === composer.noteId)
        : undefined;
      const name = composer.value;
      setComposer(null);
      if (note) {
        await saveNoteAsTemplate(note, name);
      } else {
        const template = createBlankTemplate(vaultId, name);
        await knowledgeRepository.saveTemplate(template);
        setTemplates((current) => [template, ...current]);
        selectTemplate(template.id);
      }
    } else {
      const title = composer.value.trim() || "Untitled";
      const note = notes.find((item) => item.id === composer.noteId);
      if (!note) return;
      try {
        await renameEditorDocument(note, title);
        updateNoteById(note.id, { title }, true);
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : "Could not rename this page",
        );
        return;
      }
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
    const [editorDocuments, storedTemplateDocuments] = await Promise.all([
      exportEditorDocuments(
        vaultId,
        notes.map((note) => note.id),
      ),
      exportEditorDocuments(
        vaultId,
        templates.map((template) => templateDocumentId(template.id)),
      ),
    ]);
    const templateDocuments = Object.fromEntries(
      templates.flatMap((template) => {
        const document =
          storedTemplateDocuments[templateDocumentId(template.id)];
        return document ? [[template.id, document]] : [];
      }),
    );
    const bundle: VaultBundle = {
      format: "hyperion-vault",
      version: 8,
      exportedAt: new Date().toISOString(),
      vault: activeVault,
      notes,
      templates,
      collections,
      preferences,
      editorDocuments,
      templateDocuments,
    };
    downloadJson(
      `${activeVault.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "hyperion"}.hyperion.json`,
      bundle,
    );
  };

  const importVault = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text()) as VaultBundle;
      if (
        bundle.format !== "hyperion-vault" ||
        ![1, 2, 3, 4, 5, 6, 7, 8].includes(bundle.version)
      )
        throw new Error("Unsupported vault file");
      const vault = await knowledgeRepository.createVault(
        `${bundle.vault.name} import`,
      );
      const collectionMap = new Map(
        bundle.collections.map((collection) => [
          collection.id,
          crypto.randomUUID(),
        ]),
      );
      const noteMap = new Map(
        bundle.notes.map((note) => [note.id, crypto.randomUUID()]),
      );
      const templateMap = new Map(
        (bundle.templates ?? []).map((template) => [
          template.id,
          crypto.randomUUID(),
        ]),
      );
      const importedCollections = bundle.collections.map((collection) => ({
        ...collection,
        id: collectionMap.get(collection.id)!,
        vaultId: vault.id,
      }));
      const importedNotes = hydratePageIdentities(
        bundle.notes.map((note) =>
          normalizeNoteRecord({
            ...note,
            id: noteMap.get(note.id)!,
            vaultId: vault.id,
            icon: normalizePageIcon(note.icon),
            aliases: note.aliases ?? [],
            links: (note.links ?? []).flatMap((link) => {
              const targetId = noteMap.get(link.targetId);
              return targetId ? [{ ...link, targetId }] : [];
            }),
            parentId: note.parentId
              ? (noteMap.get(note.parentId) ?? null)
              : null,
            sortOrder: Number.isFinite(note.sortOrder) ? note.sortOrder : 0,
            archived: note.archived ?? false,
            collectionIds: (note.collectionIds ?? [])
              .map((id) => collectionMap.get(id))
              .filter(Boolean) as string[],
          }),
        ),
      );
      const importedTemplates = (bundle.templates ?? []).map((template) => ({
        ...template,
        id: templateMap.get(template.id)!,
        vaultId: vault.id,
        icon: normalizePageIcon(template.icon),
        tags: template.tags ?? [],
        body: template.body ?? "",
      }));
      const importedPreferences = {
        ...bundle.preferences,
        vaultId: vault.id,
        defaultTemplateIds: {
          note: bundle.preferences.defaultTemplateIds?.note
            ? (templateMap.get(bundle.preferences.defaultTemplateIds.note) ??
              null)
            : null,
          journal: bundle.preferences.defaultTemplateIds?.journal
            ? (templateMap.get(bundle.preferences.defaultTemplateIds.journal) ??
              null)
            : null,
        },
      };
      await Promise.all([
        ...importedCollections.map((collection) =>
          knowledgeRepository.saveCollection(collection),
        ),
        ...importedNotes.map((note) => knowledgeRepository.saveNote(note)),
        ...importedTemplates.map((template) =>
          knowledgeRepository.saveTemplate(template),
        ),
        knowledgeRepository.savePreferences(importedPreferences),
      ]);
      if (bundle.editorDocuments) {
        const documents = Object.fromEntries(
          Object.entries(bundle.editorDocuments).flatMap(([id, value]) =>
            noteMap.has(id) ? [[noteMap.get(id)!, value]] : [],
          ),
        );
        await importEditorDocuments(vault.id, documents);
      }
      if (bundle.templateDocuments) {
        const documents = Object.fromEntries(
          Object.entries(bundle.templateDocuments).flatMap(([id, value]) => {
            const importedId = templateMap.get(id);
            return importedId ? [[templateDocumentId(importedId), value]] : [];
          }),
        );
        await importEditorDocuments(vault.id, documents);
      }
      await loadVault(vault.id, [...vaults, vault]);
      setSettingsOpen(false);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not import this vault",
      );
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const heading =
    view === "note"
      ? activeNote?.title
      : view === "template"
        ? activeTemplate?.name
        : (
            {
              home: "Home",
              journal: "Journal",
              tags: "Tags",
              templates: "Templates",
              archive: "Archive",
              trash: "Trash",
            } as const
          )[view as Exclude<View, "note" | "template">];
  const activeTemplatePage = activeTemplate
    ? templatePageRecord(activeTemplate)
    : undefined;
  const activeAncestors =
    view === "note" && activeNote?.kind === "note"
      ? ancestorPath(organizedNotes, activeNote)
      : [];

  if (loading) {
    return (
      <main className="app-loading">
        <HyperionMark />
        <span>Opening your local vault…</span>
      </main>
    );
  }

  return (
    <main
      className={`app-shell${sidebarResizing ? " sidebar-resizing" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {sidebarOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <div className="workspace-header">
          <div className="vault-switcher-wrap">
            <button
              className="workspace-button"
              onClick={() => setVaultMenuOpen((open) => !open)}
              aria-expanded={vaultMenuOpen}
            >
              <HyperionMark small />
              <span className="workspace-copy">
                <strong>{activeVault?.name ?? "Hyperion"}</strong>
                <span>{organizedNotes.length} pages · Local only</span>
              </span>
              <CaretDown size={14} weight="bold" />
            </button>
            {vaultMenuOpen && (
              <div className="popover vault-menu">
                <div className="popover-label">Your vaults</div>
                {vaults.map((vault) => (
                  <button
                    key={vault.id}
                    className={vault.id === vaultId ? "selected" : ""}
                    onClick={() => void loadVault(vault.id)}
                  >
                    <span
                      className="vault-color"
                      style={{ background: vault.color }}
                    />
                    <span>
                      <strong>{vault.name}</strong>
                      <small>Stored on this device</small>
                    </span>
                    {vault.id === vaultId && <Check size={15} weight="bold" />}
                  </button>
                ))}
                <div className="popover-divider" />
                <button
                  onClick={() => {
                    setComposer({ type: "vault", value: "" });
                    setVaultMenuOpen(false);
                  }}
                >
                  <Plus size={16} /> New vault
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-button subtle"
            aria-label="Collapse sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <SidebarSimple size={18} />
          </button>
        </div>

        <div className="new-note-actions">
          <button className="new-note-button" onClick={() => void createNote()}>
            <Plus size={17} weight="bold" />
            <span>New page</span>
            <kbd>⌘ N</kbd>
          </button>
          <button
            className="new-note-template-button"
            aria-label="Choose a page template"
            title="New from template"
            onClick={() => setTemplatePicker({ parentId: null })}
          >
            <CaretDown size={14} weight="bold" />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Knowledge base">
          <button
            onClick={() => {
              closePageSearch();
              setSearchOpen(true);
            }}
          >
            <MagnifyingGlass size={18} />
            <span>Search</span>
            <kbd>⌘ ⇧ F</kbd>
          </button>
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => navigateView("home")}
          >
            <House size={18} />
            <span>Home</span>
          </button>
          <button
            className={
              view === "journal" ||
              (view === "note" && activeNote?.kind === "journal")
                ? "active"
                : ""
            }
            onClick={() => navigateView("journal")}
          >
            <CalendarBlank size={18} />
            <span>Journal</span>
            {journalEntries.length > 0 && <em>{journalEntries.length}</em>}
          </button>
          <button
            className={view === "tags" ? "active" : ""}
            onClick={() => navigateView("tags")}
          >
            <Tag size={18} />
            <span>Tags</span>
          </button>
          <button
            className={
              view === "templates" || view === "template" ? "active" : ""
            }
            onClick={() => navigateView("templates")}
          >
            <Stack size={18} />
            <span>Templates</span>
            {templates.length > 0 && <em>{templates.length}</em>}
          </button>
        </nav>

        <div className="sidebar-scroll">
          {favoriteNotes.length > 0 && (
            <section className="sidebar-section">
              <SidebarSectionHeading
                label="Favorites"
                expanded={favoritesOpen}
                onToggle={() => setFavoritesOpen((open) => !open)}
              />
              {favoritesOpen && (
                <div className="section-items">
                  {favoriteNotes.map((note) => (
                    <button
                      key={note.id}
                      className={
                        view === "note" && activeId === note.id ? "active" : ""
                      }
                      onClick={() => selectNote(note.id)}
                      onContextMenu={(event) =>
                        openPageContextMenu(event, note.id)
                      }
                    >
                      <PageIcon note={note} size={15} />
                      <span>{note.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          <SidebarOrganizer
            key={`organizer:${vaultId}`}
            notes={organizedNotes}
            view={view}
            activeNoteId={activeId}
            onCreatePage={(parentId) =>
              setComposer({ type: "page", value: "", parentId })
            }
            onMoveNote={moveNote}
            onOpenNote={selectNote}
            onContextMenu={openPageContextMenu}
          />
        </div>

        <div className="sidebar-footer">
          <button
            className={view === "archive" ? "active" : ""}
            onClick={() => navigateView("archive")}
          >
            <Archive size={17} />
            <span>Archive</span>
            {archivedNotes.length > 0 && <em>{archivedNotes.length}</em>}
          </button>
          <button
            className={view === "trash" ? "active" : ""}
            onClick={() => navigateView("trash")}
          >
            <Trash size={17} />
            <span>Trash</span>
            {trashedNotes.length > 0 && <em>{trashedNotes.length}</em>}
          </button>
          <button onClick={() => setSettingsOpen(true)}>
            <GearSix size={17} />
            <span>Settings</span>
          </button>
        </div>
        {sidebarOpen && (
          <button
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
          />
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button
                className="icon-button"
                aria-label="Open sidebar"
                onClick={() => setSidebarOpen(true)}
              >
                <SidebarSimple size={19} />
              </button>
            )}
            {view === "note" && activeNote && (
              <button
                className={`icon-button topbar-favorite${activeNote.favorite ? " active" : ""}`}
                aria-label={
                  activeNote.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                title={
                  activeNote.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                onClick={() =>
                  updateNoteById(
                    activeNote.id,
                    { favorite: !activeNote.favorite },
                    true,
                  )
                }
              >
                <Star
                  size={17}
                  weight={activeNote.favorite ? "fill" : "regular"}
                />
              </button>
            )}
            <div className="breadcrumbs">
              {view === "note" && activeNote?.kind === "journal" && (
                <span className="breadcrumb-parent">
                  <button onClick={() => navigateView("journal")}>
                    <CalendarBlank size={12} />
                    Journal
                  </button>
                  <CaretRight size={12} />
                </span>
              )}
              {view === "template" && (
                <span className="breadcrumb-parent">
                  <button onClick={() => navigateView("templates")}>
                    <Stack size={12} />
                    Templates
                  </button>
                  <CaretRight size={12} />
                </span>
              )}
              {activeAncestors.map((ancestor) => (
                <span className="breadcrumb-parent" key={ancestor.id}>
                  <button onClick={() => selectNote(ancestor.id)}>
                    <PageIcon note={ancestor} size={12} />
                    {ancestor.title}
                  </button>
                  <CaretRight size={12} />
                </span>
              ))}
              {view === "note" && activeNote && (
                <PageIcon note={activeNote} size={13} />
              )}
              {view === "template" && activeTemplatePage && (
                <PageIcon note={activeTemplatePage} size={13} />
              )}
              <strong>{heading ?? "Untitled"}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            {((view === "note" && activeNote) ||
              (view === "template" && activeTemplate)) && (
              <div className="topbar-history" aria-label="Editing history">
                <button
                  className="icon-button"
                  aria-label="Undo"
                  title="Undo"
                  onClick={() => editorStore?.undo()}
                  disabled={!editorStore}
                >
                  <ArrowCounterClockwise size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo"
                  title="Redo"
                  onClick={() => editorStore?.redo()}
                  disabled={!editorStore}
                >
                  <ArrowClockwise size={16} />
                </button>
              </div>
            )}
            <span className={`save-status ${saveStatus}`}>
              {saveStatus === "saved" ? (
                <Check size={13} weight="bold" />
              ) : (
                <span className="saving-spinner" />
              )}
              {saveStatus === "saved" ? "Saved locally" : "Saving"}
            </span>
            {view === "note" && (
              <button
                className={`icon-button${detailsOpen ? " active" : ""}`}
                aria-label="Toggle note details"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                <ListBullets size={19} />
              </button>
            )}
            {view === "note" && activeNote && (
              <div className="more-wrap topbar-more">
                <button
                  className="icon-button"
                  aria-label="More page actions"
                  title="More actions"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <DotsThree size={21} weight="bold" />
                </button>
                {moreOpen && (
                  <div className="popover note-menu">
                    <button
                      onClick={() => {
                        setMoreOpen(false);
                        setComposer({
                          type: "rename",
                          noteId: activeNote.id,
                          value: activeNote.title,
                        });
                      }}
                    >
                      <PencilSimple size={17} /> Rename{" "}
                      {activeNote.kind === "journal" ? "entry" : "page"}
                    </button>
                    <button onClick={() => void duplicateNote(activeNote)}>
                      <FilePlus size={17} /> Duplicate{" "}
                      {activeNote.kind === "journal" ? "entry" : "page"}
                    </button>
                    <button
                      onClick={() => {
                        setMoreOpen(false);
                        setComposer({
                          type: "template",
                          noteId: activeNote.id,
                          value: activeNote.title,
                        });
                      }}
                    >
                      <Stack size={17} /> Save as template
                    </button>
                    <button
                      className="archive"
                      onClick={() => archiveNote(activeNote)}
                    >
                      <Archive size={17} /> Archive
                    </button>
                    <button
                      className="danger"
                      onClick={() => trashNote(activeNote)}
                    >
                      <Trash size={17} /> Trash
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="content-shell">
          <section className="main-content">
            {view === "note" && activeNote ? (
              <article
                className={`note-workspace${activeNote.icon ? " has-page-icon" : ""}`}
              >
                {activeNote.kind === "journal" && activeNote.journalDate && (
                  <div
                    className={`journal-entry-label width-${preferences.editorWidth}`}
                  >
                    <CalendarBlank size={14} />
                    <span>
                      {new Intl.DateTimeFormat("en", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      }).format(journalDate(activeNote.journalDate))}
                    </span>
                  </div>
                )}
                <div
                  className={`page-icon-row width-${preferences.editorWidth}`}
                >
                  <PageIconPicker
                    key={activeNote.id}
                    note={activeNote}
                    onChange={(icon) =>
                      updateNoteById(activeNote.id, { icon }, true)
                    }
                  />
                </div>

                <AffineEditor
                  key={`${vaultId}:${activeNote.id}`}
                  document={activeNote}
                  preferences={preferences}
                  onChange={(patch) => updateNoteById(activeNote.id, patch)}
                  onStoreReady={setEditorStore}
                />
              </article>
            ) : view === "template" && activeTemplate && activeTemplatePage ? (
              <article
                className={`note-workspace template-workspace${activeTemplate.icon ? " has-page-icon" : ""}`}
              >
                <div
                  className={`template-editor-banner width-${preferences.editorWidth}`}
                >
                  <span>
                    <Stack size={16} />
                    <strong>Editing template</strong>
                    <small>Changes affect new pages only.</small>
                  </span>
                  <div>
                    <button
                      onClick={() =>
                        void createNote(null, undefined, {
                          templateId: activeTemplate.id,
                        })
                      }
                    >
                      Use template
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => void deleteTemplate(activeTemplate)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <label
                  className={`template-name-field width-${preferences.editorWidth}`}
                >
                  <span>Template name</span>
                  <input
                    value={activeTemplate.name}
                    onChange={(event) =>
                      updateTemplateById(activeTemplate.id, {
                        name: event.target.value,
                      })
                    }
                    onBlur={() =>
                      !activeTemplate.name.trim() &&
                      updateTemplateById(
                        activeTemplate.id,
                        { name: "Untitled template" },
                        true,
                      )
                    }
                  />
                </label>
                <div
                  className={`page-icon-row width-${preferences.editorWidth}`}
                >
                  <PageIconPicker
                    key={activeTemplate.id}
                    note={activeTemplatePage}
                    onChange={(icon) =>
                      updateTemplateById(activeTemplate.id, { icon }, true)
                    }
                  />
                </div>
                <AffineEditor
                  key={`${vaultId}:${templateDocumentId(activeTemplate.id)}`}
                  document={{
                    ...activeTemplatePage,
                    id: templateDocumentId(activeTemplate.id),
                  }}
                  preferences={preferences}
                  onChange={(patch) =>
                    updateTemplateById(activeTemplate.id, {
                      defaultTitle: patch.title,
                      body: patch.body,
                    })
                  }
                  onStoreReady={setEditorStore}
                />
              </article>
            ) : view === "templates" ? (
              <TemplatesView
                templates={templates}
                preferences={preferences}
                onCreate={() =>
                  setComposer({ type: "template", noteId: null, value: "" })
                }
                onUse={(template) =>
                  void createNote(null, undefined, { templateId: template.id })
                }
                onEdit={(template) => selectTemplate(template.id)}
                onDelete={(template) => void deleteTemplate(template)}
                onDefaults={(defaultTemplateIds) =>
                  void savePreferencePatch({ defaultTemplateIds })
                }
              />
            ) : view === "home" ? (
              <HomeView
                notes={organizedNotes}
                onSelect={selectNote}
                onCreate={() => void createNote()}
              />
            ) : view === "journal" ? (
              <JournalView
                entries={journalEntries}
                onSelect={selectNote}
                onOpenDate={(dateKey) => void openJournalDate(dateKey)}
              />
            ) : view === "tags" ? (
              <TagsView
                tags={allTags}
                notes={activeNotes}
                activeTag={activeTag}
                onTag={setActiveTag}
                onSelect={selectNote}
              />
            ) : view === "archive" ? (
              <ArchiveView
                notes={archivedNotes}
                onRestore={(note) =>
                  updateNoteById(note.id, { archived: false }, true)
                }
                onTrash={trashNote}
              />
            ) : (
              <TrashView
                notes={trashedNotes}
                onRestore={(note) =>
                  updateNoteById(
                    note.id,
                    { trashed: false, archived: false },
                    true,
                  )
                }
                onDelete={permanentlyDelete}
              />
            )}
          </section>

          {detailsOpen && view === "note" && activeNote && (
            <NoteDetails
              key={activeNote.id}
              note={activeNote}
              notes={activeNotes}
              store={editorStore}
              onSelect={selectNote}
              onChange={(patch) => updateNoteById(activeNote.id, patch, true)}
            />
          )}
        </div>
      </section>

      {pageSearchOpen && (
        <div
          className="page-search-bar"
          role="search"
          aria-label="Search this page"
        >
          <MagnifyingGlass size={17} />
          <input
            ref={pageSearchRef}
            value={pageSearchQuery}
            onChange={(event) => setPageSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                movePageSearch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find on this page…"
            aria-label="Find on this page"
          />
          <span className="page-search-count" aria-live="polite">
            {pageSearchQuery
              ? pageSearchCount
                ? `${pageSearchIndex + 1} of ${pageSearchCount}`
                : "No results"
              : ""}
          </span>
          <button
            type="button"
            aria-label="Previous result"
            onClick={() => movePageSearch(-1)}
            disabled={!pageSearchCount}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Next result"
            onClick={() => movePageSearch(1)}
            disabled={!pageSearchCount}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Close page search"
            onClick={closePageSearch}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {searchOpen && (
        <SearchDialog
          notes={activeNotes}
          vaultName={activeVault?.name}
          onSelect={selectNote}
          onClose={closeSearch}
        />
      )}

      {settingsOpen && activeVault && (
        <SettingsDialog
          vault={activeVault}
          vaultCount={vaults.length}
          templates={templates}
          preferences={preferences}
          storageInfo={storageInfo}
          onStorageLocation={async () => {
            try {
              const info = await platformRuntime.chooseStorageLocation();
              if (info) {
                setStorageInfo(info);
                window.location.reload();
              }
            } catch (error) {
              alert(
                `Hyperion could not change the storage folder. ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }}
          onClose={() => setSettingsOpen(false)}
          onPreferences={savePreferencePatch}
          onVault={async (patch) => {
            const updated = { ...activeVault, ...patch };
            await knowledgeRepository.updateVault(updated);
            setVaults((current) =>
              current.map((vault) =>
                vault.id === updated.id ? updated : vault,
              ),
            );
          }}
          onExport={() => void exportVault()}
          onImport={() => importRef.current?.click()}
          onDelete={async () => {
            if (
              vaults.length <= 1 ||
              !confirm(
                `Delete the “${activeVault.name}” vault and all of its local notes?`,
              )
            )
              return;
            await knowledgeRepository.deleteVault(activeVault.id);
            const nextVaults = vaults.filter(
              (vault) => vault.id !== activeVault.id,
            );
            setVaults(nextVaults);
            setSettingsOpen(false);
            await loadVault(nextVaults[0].id, nextVaults);
          }}
        />
      )}
      <input
        ref={importRef}
        className="hidden-input"
        type="file"
        accept=".json,.hyperion.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importVault(file);
        }}
      />

      {templatePicker && (
        <TemplatePickerDialog
          templates={templates}
          defaultTemplateId={preferences.defaultTemplateIds.note}
          parentTitle={
            templatePicker.parentId
              ? activeNotes.find((note) => note.id === templatePicker.parentId)
                  ?.title
              : undefined
          }
          onClose={() => setTemplatePicker(null)}
          onBlank={() => {
            const parentId = templatePicker.parentId;
            setTemplatePicker(null);
            void createNote(parentId, undefined, "blank");
          }}
          onTemplate={(template) => {
            const parentId = templatePicker.parentId;
            setTemplatePicker(null);
            void createNote(parentId, undefined, { templateId: template.id });
          }}
        />
      )}

      {pageContextMenu && pageContextNote && (
        <PageContextMenu
          state={pageContextMenu}
          note={pageContextNote}
          onClose={() => setPageContextMenu(null)}
          onOpen={() => selectNote(pageContextNote.id)}
          onCreatePage={() =>
            setComposer({
              type: "page",
              value: "",
              parentId: pageContextNote.id,
            })
          }
          onRename={() =>
            setComposer({
              type: "rename",
              noteId: pageContextNote.id,
              value: pageContextNote.title,
            })
          }
          onDuplicate={() => void duplicateNote(pageContextNote)}
          onSaveTemplate={() =>
            setComposer({
              type: "template",
              noteId: pageContextNote.id,
              value: pageContextNote.title,
            })
          }
          onFavorite={() =>
            updateNoteById(
              pageContextNote.id,
              { favorite: !pageContextNote.favorite },
              true,
            )
          }
          onArchive={() => archiveNote(pageContextNote)}
          onTrash={() => trashNote(pageContextNote)}
        />
      )}

      {composer && (
        <ComposerDialog
          composer={composer}
          parentTitle={
            composer.type === "page"
              ? activeNotes.find((note) => note.id === composer.parentId)?.title
              : undefined
          }
          onClose={() => setComposer(null)}
          onValue={(value) => setComposer({ ...composer, value })}
          onSubmit={submitComposer}
        />
      )}
    </main>
  );
}
