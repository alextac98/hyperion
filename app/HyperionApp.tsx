import { MeetingRecordingStatus } from "./components/MeetingRecordingStatus";
import { flushMeetingTasks, hasMeetingTasks } from "./lib/meeting-tasks";
import { meetingRecorder } from "./lib/meeting-recording";
import { errorMessage } from "./lib/error-message";
import { flushSync } from "react-dom";
import { VaultSetup } from "./components/VaultSetup";
import { Dialog } from "./components/Dialog";
import { requireDesktop, desktop, desktopWindow } from "./platform/runtime";
import type { WorkspaceTab, TabAction } from "./application/workspace-tabs";
import type { NavigationLocation } from "./application/navigation-history";
import { useWorkspaceTabs } from "./hooks/useWorkspaceTabs";
import { usePageContext, type PageContextView } from "./hooks/usePageContext";
import { WorkspaceLayout, type WorkspaceLayoutHandle } from "./components/WorkspaceLayout";
import { locationKey } from "./application/workspace-tabs";
import { layoutPanes } from "./application/workspace-layout";
import { useMouseNavigation } from "./hooks/useMouseNavigation";
import { uiStorage } from "./lib/ui-storage";
import { UpdateControls } from "./components/UpdateControls";
import { FeedbackButton } from "./components/FeedbackButton";
import { saves } from "./lib/save-coordinator";
import { dataBusy, dataOperation, flushAll } from "./lib/data-operations";
import { PageHistory, PageHistoryPreview } from "./components/PageHistory";
import type { PageComparison } from "./platform/desktop-api";
import { HistoryDialog } from "./components/HistoryDialog";
import { preloadEditor, prepareVaultEditor } from "./editor/editor-client";
import {
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowBendUpLeft,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  ClockCounterClockwise,
  DotsThree,
  FilePlus,
  FolderOpen,
  GearSix,
  House,
  Info,
  Link,
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
  useSyncExternalStore,
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
import { DevelopmentBlueprint } from "./components/DevelopmentBlueprint";
import { JournalView } from "./components/JournalView";
import {
  ArchiveView,
  HomeView,
  TagsView,
  TemplatesView,
  TrashView,
} from "./components/LibraryViews";
import { DocumentOutline } from "./components/DocumentOutline";
import { PageConnections, pageConnections } from "./components/PageConnections";
import { PageContextDrawer } from "./components/PageContextDrawer";
import { PageProperties } from "./components/PageProperties";
import { PageTags } from "./components/PageTags";
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
import { BlockEditor } from "./editor/BlockEditor";
import {
  duplicateEditorDocument,
  flushEditorDocuments,
  forgetVaultWorkspace,
  getOrCreateEditorStore,
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
  NoteRecord,
  TemplateRecord,
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
  requireDataService,
  type StorageInfo,
} from "./platform/runtime";

type TemplateSelection = "default" | "blank" | { templateId: string };
type TemplatePickerState = { parentId: string | null } | null;

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_WIDTH_STORAGE_KEY = "hyperion:sidebar-width";
const IS_DEVELOPMENT_BUILD = import.meta.env?.DEV ?? false;

function clampSidebarWidth(width: number) {
  return Math.round(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)),
  );
}

function getStoredSidebarWidth() {
  try {
    const storedWidth = Number(uiStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
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
  meetingDefaultTab: "notes",
  showDetails: false,
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
  const workspaceLayout = useRef<WorkspaceLayoutHandle>(null);
  const isPageWindow = desktopWindow?.kind === "page";
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [vaultId, setVaultId] = useState(DEFAULT_VAULT_ID);
  const [notes, setNotes, readNotes] = useRecords<NoteRecord>([]);
  const [templates, setTemplates, readTemplates] = useRecords<TemplateRecord>(
    [],
  );
  const [, setCollections] = useState<CollectionRecord[]>([]);
  const [preferences, setPreferences] = useState(FALLBACK_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [vaultReady, setVaultReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const workspace = useWorkspaceTabs(vaultId, vaultReady && !loading, desktopWindow);
  const {
    open: openWorkspaceTab,
    restore: restoreWorkspace,
    state: tabState,
    dispatch: reduceTab,
  } = workspace;
  const dispatchTab = useCallback((action: TabAction) => {
    const removed = action.type === "close" ? [action.id]
      : action.type === "prune" ? action.ids : [];
    if (isPageWindow && removed.length && tabState.tabs.every(tab => removed.includes(tab.id))) {
      void desktop?.closeWindow().catch(error => setDataError(errorMessage(error)));
      return;
    }
    reduceTab(action);
  }, [isPageWindow, reduceTab, tabState.tabs]);
  const openTab = useCallback((location: NavigationLocation) => {
    if (isPageWindow && location.view !== "note" && location.view !== "template") return;
    openWorkspaceTab(location);
  }, [isPageWindow, openWorkspaceTab]);
  const { location } = workspace;
  const currentVaultKey = desktopWindow && desktopWindow.id !== "main"
    ? `hyperion:current-vault:${desktopWindow.id}` : "hyperion:current-vault";
  const view = location.view;
  const activeId = location.view === "note" ? location.id : "";
  const activeTemplateId = location.view === "template" ? location.id : "";
  const activeTag = location.view === "tags" ? location.tag : null;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const pageContext = usePageContext(
    vaultId,
    view === "note" ? activeId : null,
    vaultReady && !loading,
  );
  const { close: closePageContext } = pageContext;
  const [comparison, setComparison] = useState<PageComparison | null>(null);
  const pageComparison =
    view === "note" &&
    comparison?.revision.noteId === activeId &&
    comparison?.revision.vaultId === vaultId
      ? comparison
      : null;
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearchQuery, setPageSearchQuery] = useState("");
  const [pageSearchIndex, setPageSearchIndex] = useState(0);
  const [pageSearchCount, setPageSearchCount] = useState(0);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "updates">(
    "general",
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageContextMenu, setPageContextMenu] =
    useState<PageContextMenuState | null>(null);
  const [composer, setComposer] = useState<Composer>(null);
  const [templatePicker, setTemplatePicker] =
    useState<TemplatePickerState>(null);
  const saveStatus = useSyncExternalStore(saves.subscribe, saves.getState);
  const operationBusy = useSyncExternalStore(
    dataBusy.subscribe,
    dataBusy.getSnapshot,
  );
  const [history, setHistory] = useState<{ noteId?: string } | null>(null);
  const [editorStore, setEditorStore] = useState<EditorStore | null>(null);
  const tabStores = useRef(new Map<string, EditorStore>());
  useEffect(() => {
    setEditorStore(tabStores.current.get(tabState.active) ?? null);
    setComparison(null);
    setPageSearchOpen(false);
    setPageSearchQuery("");
    setMoreOpen(false);
    setPageContextMenu(null);
  }, [tabState.active]);
  useEffect(() => {
    const ids = new Set(tabState.tabs.map((tab) => tab.id));
    for (const id of tabStores.current.keys())
      if (!ids.has(id)) tabStores.current.delete(id);
  }, [tabState.tabs]);
  useEffect(() => {
    tabStores.current.clear();
  }, [vaultId]);
  useEffect(() => {
    if (loading || !vaultReady) return;
    const ids = tabState.tabs
      .filter(({ location }) =>
        location.view === "note"
          ? !notes.some(
              (note) =>
                note.id === location.id && !note.trashed && !note.archived,
            )
          : location.view === "template"
            ? !templates.some((template) => template.id === location.id)
            : false,
      )
      .map((tab) => tab.id);
    if (ids.length) dispatchTab({ type: "prune", ids });
  }, [notes, templates, loading, vaultReady, tabState.tabs, dispatchTab]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        loading ||
        !vaultReady ||
        dataBusy.getSnapshot() ||
        document.querySelector("dialog[open]")
      )
        return;
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchTab({ type: "close", id: tabState.active });
      } else if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const pane = layoutPanes(tabState.layout).find((pane) =>
          pane.views.includes(tabState.active),
        );
        const ids = pane?.views ?? tabState.tabs.map((tab) => tab.id);
        const index = ids.indexOf(tabState.active);
        const next =
          (index + (event.shiftKey ? -1 : 1) + ids.length) % ids.length;
        dispatchTab({
          type: "focus",
          id: ids[next],
        });
      } else if (command && event.key.toLowerCase() === "t") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openTab({ view: "home" });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [loading, vaultReady, tabState, dispatchTab, openTab]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const pageSearchRef = useRef<HTMLInputElement>(null);
  const pageSearchMatchesRef = useRef<PageSearchMatch[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const stableTitles = useRef<Record<string, string>>({});
  const titleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const lastAutomaticBackup = useRef(0);

  useEffect(() => platformRuntime.onConnectionError(setDataError), []);

  useEffect(
    () =>
      platformRuntime.onPrepareClose(async () => {
        await dataOperation(async () => {
          await requireDataService().repositoryExecute({
            operation: "captureAutomaticRevisions",
          });
        });
      }),
    [],
  );
  useEffect(() => {
    if (loading || !vaultReady) return;
    if (!lastAutomaticBackup.current) lastAutomaticBackup.current = Date.now();
    let busy = false;
    const interval = setInterval(() => {
      // Defer background snapshots so their editor lock cannot interrupt capture.
      if (busy || dataBusy.getSnapshot() || meetingRecorder.getSnapshot() || hasMeetingTasks()) return;
      busy = true;
      void dataOperation(async () => {
        await requireDataService().repositoryExecute({
          operation: "captureAutomaticRevisions",
        });
        if (Date.now() - lastAutomaticBackup.current >= 86400000) {
          await requireDataService().createBackup(true);
          lastAutomaticBackup.current = Date.now();
        }
      })
        .catch((error) => setDataError(String(error)))
        .finally(() => {
          busy = false;
        });
    }, 60000);
    return () => clearInterval(interval);
  }, [loading, vaultReady]);

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
      await flushMeetingTasks();
      await meetingRecorder.stop();
      await flushAll();
      const info = await requireDataService().repositoryExecute<StorageInfo>({
        operation: "selectVault",
        vaultId: nextVaultId,
      });
      setStorageInfo(info);
      setComparison(null);
      setLoading(true);
      try {
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
            note: templateIds.has(
              storedPreferences.defaultTemplateIds.note ?? "",
            )
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
        if (nextVaults) setVaults(nextVaults);
        const remembered = uiStorage.getItem(
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
        restoreWorkspace(
          nextVaultId,
          (location) => {
            if (location.view === "note")
              return hydratedNotes.some(
                (note) =>
                  note.id === location.id && !note.trashed && !note.archived,
              );
            if (location.view === "template")
              return storedTemplates.some(
                (template) => template.id === location.id,
              );
            return true;
          },
          target ? { view: "note", id: target.id } : { view: "home" },
        );
        uiStorage.setItem(currentVaultKey, nextVaultId);
        setVaultMenuOpen(false);
        setEditorStore(null);
        setVaultSetupOpen(false);
        setVaultReady(true);
        setDataError("");
      } finally {
        setLoading(false);
      }
    },
    [setNotes, setTemplates, restoreWorkspace, currentVaultKey],
  );

  useEffect(() => {
    let cancelled = false;
    preloadEditor();
    void knowledgeRepository
      .initialize()
      .then(async () => {
        const [storedVaults, setupInfo] = await Promise.all([
          knowledgeRepository.listVaults(),
          requireDataService().repositoryExecute<{ error: string }>({
            operation: "vaultSetup",
          }),
        ]);
        if (cancelled) return;
        setVaults(storedVaults);
        if (!storedVaults.length) {
          setDataError(setupInfo.error);
          setVaultSetupOpen(true);
          setLoading(false);
          return;
        }
        const remembered = isPageWindow ? desktopWindow?.vaultId : uiStorage.getItem(currentVaultKey);
        const target = storedVaults.some((vault) => vault.id === remembered)
          ? remembered!
          : (storedVaults[0]?.id ?? DEFAULT_VAULT_ID);
        await loadVault(target, storedVaults);
      })
      .catch((error) => {
        if (cancelled) return;
        setDataError(String(error));
        setVaultSetupOpen(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadVault, currentVaultKey, isPageWindow]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onOpenTab(request => dataOperation(async () => {
      const switchingVault = request.vaultId !== vaultId;
      if (switchingVault) {
        if (isPageWindow) throw new Error("This page window belongs to a different vault.");
        await loadVault(request.vaultId);
      }
      flushSync(() => openTab(request.location));
      if (request.target && !switchingVault) {
        if (!workspaceLayout.current) throw new Error("The destination workspace is no longer open.");
        flushSync(() => workspaceLayout.current!.placeTab(locationKey(request.location), request.target!));
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }));
  }, [isPageWindow, vaultId, loadVault, openTab]);

  useEffect(() => {
    if (!loading && vaultReady) void desktop?.workspaceReady(vaultId).catch(error => setDataError(errorMessage(error)));
  }, [loading, vaultReady, vaultId]);

  useEffect(() => {
    if (!desktop || loading || !vaultReady) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (disposed) return;
      // Do not replace local records while their newer values are still queued.
      if (saves.getState() !== "saved") {
        timer = setTimeout(refresh, 100);
        return;
      }
      void Promise.all([
        knowledgeRepository.listNotes(vaultId),
        knowledgeRepository.listTemplates(vaultId),
        knowledgeRepository.listVaults(),
        knowledgeRepository.getPreferences(vaultId),
      ]).then(([notes, templates, vaults, preferences]) => {
        if (disposed || saves.getState() !== "saved") {
          if (!disposed) timer = setTimeout(refresh, 100);
          return;
        }
        setNotes(notes);
        setTemplates(templates);
        setVaults(vaults);
        setPreferences(preferences);
      }).catch(error => { if (!disposed) setDataError(errorMessage(error)); });
    };
    const unsubscribe = desktop.onRepositoryChanged(request => {
      if (request.vaultId !== vaultId && !["createVault", "updateVault", "importVault"].includes(request.operation)) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 50);
    });
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }, [vaultId, loading, vaultReady, setNotes, setTemplates]);

  const detachTab = desktop ? (tab: WorkspaceTab, position?: { x: number; y: number }) => {
    void dataOperation(async () => {
      await requireDesktop().detachTab({ vaultId, location: tab.location, position });
      await flushAll();
    }).then(() => dispatchTab({ type: "close", id: tab.id }))
      .catch(error => setDataError(errorMessage(error)));
  } : undefined;
  const returnTab = (tab: WorkspaceTab) => {
    void dataOperation(async () => {
      await requireDesktop().returnTab({ vaultId, location: tab.location });
      await flushAll();
    }).then(() => dispatchTab({ type: "close", id: tab.id }))
      .catch(error => setDataError(errorMessage(error)));
  };

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
    saves.enqueue(
      `note:${note.id}`,
      async () => {
        await flushEditorDocuments();
        await knowledgeRepository.saveNote(note);
      },
      immediate ? 0 : 300,
    );
  }, []);

  const updateNoteById = useCallback(
    (id: string, patch: Partial<NoteRecord>, immediate = false) => {
      const current = readNotes().find(note => note.id === id);
      if (current && Object.entries(patch).every(([key, value]) => current[key as keyof NoteRecord] === value)) return;
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
      if (Object.entries(patch).every(([key, value]) => template[key as keyof TemplateRecord] === value)) return;
      const updated = {
        ...template,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      setTemplates(current.map((item) => (item.id === id ? updated : item)));
      saves.enqueue(
        `template:${id}`,
        async () => {
          await flushEditorDocuments();
          await knowledgeRepository.saveTemplate(updated);
        },
        immediate ? 0 : 300,
      );
    },
    [readTemplates, setTemplates],
  );

  const selectNote = useCallback(
    (id: string) => {
      setComparison(null);
      openTab({ view: "note", id });
      setMoreOpen(false);
      setEditorStore(null);
      setPageContextMenu(null);
      setPageSearchOpen(false);
      setPageSearchQuery("");
      uiStorage.setItem(`hyperion:last-note:${vaultId}`, id);
      if (window.innerWidth <= 720) setSidebarOpen(false);
    },
    [vaultId, openTab],
  );

  const selectTemplate = useCallback(
    (id: string) => {
      openTab({ view: "template", id });
      setMoreOpen(false);
      setEditorStore(null);
      setPageContextMenu(null);
      setPageSearchOpen(false);
      if (window.innerWidth <= 720) setSidebarOpen(false);
    },
    [openTab],
  );

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
      if (!activeVault || loading || vaultSetupOpen) return;
      if (
        dataBusy.getSnapshot() ||
        document.querySelector(".history-dialog, .page-comparison")
      )
        return;
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
  }, [
    activeNote,
    activeVault,
    loading,
    vaultSetupOpen,
    closePageSearch,
    closeSearch,
    createNote,
    view,
  ]);

  useEffect(() => {
    if (pageSearchOpen) setTimeout(() => pageSearchRef.current?.focus(), 30);
  }, [pageSearchOpen]);

  useEffect(() => {
    if (!pageSearchOpen) return;
    const frame = requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>(
        '.workspace-panel[data-workspace-active="true"] .note-workspace .blocksuite-mount',
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
        uiStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
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

  const navigateView = (nextView: Exclude<View, "note" | "template">) => {
    if (isPageWindow) return;
    openTab(
      nextView === "tags" ? { view: "tags", tag: null } : { view: nextView },
    );
    setMoreOpen(false);
    setPageContextMenu(null);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  };

  useMouseNavigation({
    vaultId,
    loading,
    location:
      view === "note"
        ? { view, id: activeId }
        : view === "template"
          ? { view, id: activeTemplateId }
          : view === "tags"
            ? { view, tag: activeTag }
            : { view },
    isBlocked: () => dataBusy.getSnapshot() || !!pageComparison,
    isAvailable: (location) => {
      if (location.view === "note")
        return readNotes().some(
          (note) => note.id === location.id && !note.trashed && !note.archived,
        );
      if (location.view === "template")
        return readTemplates().some((template) => template.id === location.id);
      return true;
    },
    onNavigate: (location) => {
      if (location.view === "note") selectNote(location.id);
      else if (location.view === "template") selectTemplate(location.id);
      else {
        setComparison(null);
        setEditorStore(null);
        setPageSearchOpen(false);
        setPageSearchQuery("");
        openTab(location);
      }
    },
  });

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
      openTab({ view: "templates" });
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
    await dataOperation(async () => {
      await knowledgeRepository.deleteTemplate(template.id);
      await removeEditorDocument(vaultId, templateDocumentId(template.id));
    });
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
      openTab({ view: "templates" });
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
    const gutter = 8;
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX || bounds.left + Math.min(bounds.width, 44);
    const anchorY = event.clientY || bounds.top + bounds.height;
    setMoreOpen(false);
    setVaultMenuOpen(false);
    setPageContextMenu({
      noteId,
      x: Math.max(gutter, anchorX),
      y: Math.max(gutter, anchorY),
    });
  };

  const permanentlyDelete = async (note: NoteRecord) => {
    if (
      !window.confirm(
        `Delete “${note.title}”? Its saved versions remain in vault history.`,
      )
    )
      return;
    try {
      await dataOperation(async () => {
        await knowledgeRepository.deleteNote(note.id);
        await removeEditorDocument(vaultId, note.id);
      });
      await loadVault(vaultId);
    } catch (error) {
      setDataError(String(error));
    }
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
    if (composer.type === "page") {
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
    await knowledgeRepository.savePreferences(next);
  };

  const togglePageContext = (next: PageContextView) => {
    setMoreOpen(false);
    setPageSearchOpen(false);
    setComparison(null);
    pageContext.toggle(next);
  };

  const openPageContext = (next: PageContextView) => {
    // The menu item unmounts, so keep a connected trigger for drawer focus return.
    document.querySelector<HTMLButtonElement>(".topbar-more > button")?.focus({
      preventScroll: true,
    });
    if (pageContext.view !== next) togglePageContext(next);
    else setMoreOpen(false);
  };

  const exportVault = async () => {
    if (!activeVault) return;
    try {
      const bundle = await dataOperation(() =>
        requireDataService().repositoryExecute({
          operation: "exportVault",
          vaultId,
        }),
      );
      downloadJson(
        `${activeVault.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "hyperion"}.hyperion.json`,
        bundle,
      );
    } catch (error) {
      setDataError(String(error));
    }
  };

  const importVault = async (file: File) => {
    try {
      const bundle: unknown = JSON.parse(await file.text());
      const result = await dataOperation(() =>
        requireDataService().repositoryExecute<{
          vault: VaultRecord;
          warnings: string[];
        }>({ operation: "importVault", bundle }),
      );
      await loadVault(result.vault.id, [...vaults, result.vault]);
      setSettingsOpen(false);
      if (result.warnings.length) window.alert(result.warnings.join("\n"));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const suggestVaultDirectory = useCallback(
    (name: string) =>
      requireDataService().repositoryExecute<string>({
        operation: "suggestVaultDirectory",
        name,
      }),
    [],
  );
  const switchVault = async (id: string) => {
    try {
      await dataOperation(() => loadVault(id));
    } catch (error) {
      setLoading(false);
      setDataError(String(error));
    }
  };
  const openExistingVault = async () => {
    await dataOperation(async () => {
      const vault = await requireDesktop().openVault();
      if (vault)
        await loadVault(vault.id, await knowledgeRepository.listVaults());
    });
  };
  const closeCurrentVault = async () => {
    try {
      await dataOperation(async () => {
        flushSync(() => setLoading(true));
        await forgetVaultWorkspace(vaultId);
        await requireDataService().repositoryExecute({
          operation: "closeVault",
          vaultId,
        });
        const remaining = await knowledgeRepository.listVaults();
        setVaults(remaining);
        setVaultMenuOpen(false);
        setSettingsOpen(false);
        setEditorStore(null);
        if (remaining.length) await loadVault(remaining[0].id, remaining);
        else {
          setVaultReady(false);
          setVaultSetupOpen(true);
          setLoading(false);
        }
      });
    } finally {
      setLoading(false);
    }
  };
  const setup = (
    <VaultSetup
      firstRun={!vaultReady}
      error={dataError}
      vaults={!vaultReady ? vaults : []}
      onClose={vaultReady ? () => setVaultSetupOpen(false) : undefined}
      onSuggestDirectory={suggestVaultDirectory}
      onChooseDirectory={
        platformRuntime.capabilities.configurableStorage
          ? () => requireDesktop().chooseVaultDirectory()
          : undefined
      }
      onOpen={
        platformRuntime.capabilities.configurableStorage
          ? openExistingVault
          : undefined
      }
      onSelect={(id) => dataOperation(() => loadVault(id))}
      onCreate={async (name, options) => {
        await dataOperation(async () => {
          const vault = await knowledgeRepository.createVault(name, options);
          await loadVault(vault.id, await knowledgeRepository.listVaults());
        });
      }}
    />
  );

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
  const connections = activeNote ? pageConnections(activeNote, activeNotes) : null;
  const connectionCount = new Set(
    [...(connections?.outgoing ?? []), ...(connections?.backlinks ?? [])].map(
      note => note.id,
    ),
  ).size;
  useEffect(() => {
    if (isPageWindow) document.title = `${heading || "Untitled"} — Hyperion`;
  }, [isPageWindow, heading]);
  useEffect(() => {
    if (isPageWindow && !loading && vaultReady && view !== "note" && view !== "template")
      void desktop?.closeWindow().catch(error => setDataError(errorMessage(error)));
  }, [isPageWindow, loading, vaultReady, view]);

  if (loading) {
    return (
      <main className="app-loading">
        <HyperionMark />
        <span>Opening your local vault…</span>
      </main>
    );
  }

  if (!vaultReady) return <main className="vault-onboarding">{setup}</main>;

  return (
    <main
      className={`app-shell${isPageWindow ? " page-window" : ""}${sidebarResizing ? " sidebar-resizing" : ""}`}
      data-window-kind={isPageWindow ? "page" : "primary"}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {!isPageWindow && sidebarOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {!isPageWindow && (<aside
        className={`sidebar${sidebarOpen ? " sidebar-open" : ""}${IS_DEVELOPMENT_BUILD ? " sidebar-development" : ""}`}
        aria-label={IS_DEVELOPMENT_BUILD ? "Sidebar (development build)" : undefined}
      >
        <div className="workspace-header">
          {IS_DEVELOPMENT_BUILD && <DevelopmentBlueprint />}
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
                    onClick={() => void switchVault(vault.id)}
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
                    setVaultSetupOpen(true);
                    setVaultMenuOpen(false);
                  }}
                >
                  <Plus size={16} /> Create vault…
                </button>
                {platformRuntime.capabilities.configurableStorage && (
                  <button
                    onClick={() => {
                      setVaultMenuOpen(false);
                      void openExistingVault().catch((error) =>
                        setDataError(String(error)),
                      );
                    }}
                  >
                    <FolderOpen size={16} /> Open existing vault…
                  </button>
                )}
                <button
                  onClick={() =>
                    void closeCurrentVault().catch((error) =>
                      setDataError(String(error)),
                    )
                  }
                >
                  Close vault
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
          <div className="sidebar-settings-row">
            <button
              onClick={() => {
                setSettingsTab("general");
                setSettingsOpen(true);
              }}
            >
              <GearSix size={17} />
              <span>Settings</span>
            </button>
            <UpdateControls
              compact
              onOpenDetails={() => {
                setSettingsTab("updates");
                setSettingsOpen(true);
              }}
            />
          </div>
          <FeedbackButton />
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
      </aside>)}

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!isPageWindow && !sidebarOpen && (
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
                disabled={!!pageComparison}
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
            {isPageWindow && (
              <span className="page-window-vault" title={activeVault?.name}>
                {activeVault?.name}
              </span>
            )}
            <div className="breadcrumbs">
              {!isPageWindow && view === "note" && activeNote?.kind === "journal" && (
                <span className="breadcrumb-parent">
                  <button onClick={() => navigateView("journal")}>
                    <CalendarBlank size={12} />
                    Journal
                  </button>
                  <CaretRight size={12} />
                </span>
              )}
              {!isPageWindow && view === "template" && (
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
            {isPageWindow && (
              <button
                className="page-window-return"
                disabled={operationBusy}
                title="Move this page back to the main window"
                aria-label="Move to main window"
                onClick={() => {
                  const tab = tabState.tabs.find(tab => tab.id === tabState.active);
                  if (tab) returnTab(tab);
                }}
              >
                <ArrowBendUpLeft size={16} /> Main window
              </button>
            )}
            {((view === "note" && activeNote) ||
              (view === "template" && activeTemplate)) && (
              <div className="topbar-history" aria-label="Editing history">
                <button
                  className="icon-button"
                  aria-label="Undo"
                  title="Undo"
                  onClick={() => editorStore?.undo()}
                  disabled={!editorStore || !!pageComparison}
                >
                  <ArrowCounterClockwise size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo"
                  title="Redo"
                  onClick={() => editorStore?.redo()}
                  disabled={!editorStore || !!pageComparison}
                >
                  <ArrowClockwise size={16} />
                </button>
              </div>
            )}
            <span
              className={`save-status ${saveStatus}`}
              title={saves.getError()}
            >
              {saveStatus === "saved" ? (
                <Check size={13} weight="bold" />
              ) : saveStatus === "saving" ? (
                <span className="saving-spinner" />
              ) : null}
              {saveStatus === "saved"
                ? platformRuntime.kind === "browser-development"
                  ? "Saved to development server"
                  : "Saved locally"
                : saveStatus === "error"
                  ? "Save failed"
                  : "Saving"}
            </span>
            {saveStatus === "error" && (
              <button
                onClick={() =>
                  void flushAll().catch((error) => setDataError(String(error)))
                }
              >
                Retry save
              </button>
            )}
            {view === "note" && activeNote && (
              <div className="more-wrap topbar-more">
                <button
                  className="icon-button"
                  disabled={!!pageComparison}
                  aria-label="More page actions"
                  title="More actions"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <DotsThree size={21} weight="bold" />
                </button>
                {moreOpen && (
                  <div className="popover note-menu">
                    <button onClick={() => openPageContext("outline")}>
                      <ListBullets size={17} /> Outline
                    </button>
                    <button onClick={() => openPageContext("connections")}>
                      <Link size={17} /> Connections
                      {connectionCount > 0 && (
                        <span className="note-menu-count" aria-hidden="true">
                          {connectionCount}
                        </span>
                      )}
                    </button>
                    <button onClick={() => openPageContext("history")}>
                      <ClockCounterClockwise size={17} /> Version history
                    </button>
                    <button onClick={() => openPageContext("properties")}>
                      <Info size={17} /> Page properties
                    </button>
                    <div className="popover-divider" />
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
            <WorkspaceLayout
              ref={workspaceLayout}
              onDetach={detachTab}
              canDetach={tab => tab.location.view === "note" || tab.location.view === "template"}
              pageWindow={isPageWindow}
              onReturn={isPageWindow ? returnTab : undefined}
              onBeginTabDrag={desktop?.beginTabDrag}
              onEndTabDrag={desktop?.endTabDrag}
              onUpdateTabDrag={desktop?.updateTabDrag}
              onUpdateTabDropTargets={desktop?.updateTabDropTargets}
              onTabDropHint={desktop?.onTabDropHint}
              state={tabState}
              dispatch={dispatchTab}
              disabled={operationBusy}
              canOpenPage={(page) =>
                page.vaultId === vaultId &&
                notes.some(
                  (note) =>
                    note.id === page.id && !note.trashed && !note.archived,
                )
              }
              label={({ location }) =>
                location.view === "note"
                  ? notes.find((note) => note.id === location.id)?.title ||
                    "Untitled"
                  : location.view === "template"
                    ? templates.find((template) => template.id === location.id)
                        ?.name || "Template"
                    : location.view === "tags"
                      ? location.tag
                        ? `#${location.tag}`
                        : "Tags"
                      : {
                          home: "Home",
                          journal: "Journal",
                          templates: "Templates",
                          archive: "Archive",
                          trash: "Trash",
                        }[location.view]
              }
              icon={({ location }) => {
                const note =
                  location.view === "note"
                    ? notes.find((note) => note.id === location.id)
                    : undefined;
                return note ? (
                  <PageIcon note={note} size={14} />
                ) : location.view === "home" ? (
                  <House size={14} />
                ) : location.view === "journal" ? (
                  <CalendarBlank size={14} />
                ) : (
                  <Stack size={14} />
                );
              }}
              render={(tab, visible) => {
                const location = tab.location;
                const view = location.view;
                const activeNote =
                  location.view === "note"
                    ? notes.find((note) => note.id === location.id)
                    : undefined;
                const activeTemplate =
                  location.view === "template"
                    ? templates.find((template) => template.id === location.id)
                    : undefined;
                const activeTemplatePage = activeTemplate
                  ? templatePageRecord(activeTemplate)
                  : null;
                const activeTag =
                  location.view === "tags" ? location.tag : null;
                const selected = tab.id === tabState.active;
                const onStoreReady = (store: EditorStore) => {
                  tabStores.current.set(tab.id, store);
                  if (selected) setEditorStore(store);
                };
                return (
                  <div
                    key={`${vaultId}:${tab.id}`}
                    id={`panel-${tab.id}`}
                    className="workspace-panel"
                    hidden={!visible}
                    inert={!visible}
                    data-workspace-active={
                      selected && visible ? "true" : undefined
                    }
                    onPointerDownCapture={() => {
                      if (!selected && !operationBusy)
                        dispatchTab({ type: "focus", id: tab.id });
                    }}
                    onFocusCapture={() => {
                      if (!selected && !operationBusy)
                        dispatchTab({ type: "focus", id: tab.id });
                    }}
                  >
                    {view === "note" && activeNote ? (
                      <>
                        {selected && pageComparison && (
                          <PageHistoryPreview
                            key={pageComparison.revision.id}
                            comparison={pageComparison}
                            onClose={() => setComparison(null)}
                          />
                        )}
                        <article
                          hidden={selected && !!pageComparison}
                          className={`note-workspace${activeNote.icon ? " has-page-icon" : ""}`}
                        >
                          {activeNote.kind === "journal" &&
                            activeNote.journalDate && (
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
                                  }).format(
                                    journalDate(activeNote.journalDate),
                                  )}
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

                          <BlockEditor
                            active={selected && visible && !pageComparison}
                            key={`${vaultId}:${activeNote.id}`}
                            document={activeNote}
                            preferences={preferences}
                            onChange={(patch) =>
                              updateNoteById(activeNote.id, patch)
                            }
                            onStoreReady={onStoreReady}
                            belowTitle={
                              <PageTags
                                key={activeNote.id}
                                note={activeNote}
                                onChange={patch =>
                                  updateNoteById(activeNote.id, patch, true)
                                }
                              />
                            }
                          />
                        </article>
                      </>
                    ) : view === "template" &&
                      activeTemplate &&
                      activeTemplatePage ? (
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
                              onClick={() =>
                                void deleteTemplate(activeTemplate)
                              }
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
                              updateTemplateById(
                                activeTemplate.id,
                                { icon },
                                true,
                              )
                            }
                          />
                        </div>
                        <BlockEditor
                          active={selected && visible && !pageComparison}
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
                          onStoreReady={onStoreReady}
                        />
                      </article>
                    ) : view === "templates" ? (
                      <TemplatesView
                        templates={templates}
                        preferences={preferences}
                        onCreate={() =>
                          setComposer({
                            type: "template",
                            noteId: null,
                            value: "",
                          })
                        }
                        onUse={(template) =>
                          void createNote(null, undefined, {
                            templateId: template.id,
                          })
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
                        active={selected && visible}
                        entries={journalEntries}
                        onSelect={selectNote}
                        onOpenDate={(dateKey) => void openJournalDate(dateKey)}
                      />
                    ) : view === "tags" ? (
                      <TagsView
                        tags={allTags}
                        notes={activeNotes}
                        activeTag={activeTag}
                        onTag={(tag) => openTab({ view: "tags", tag })}
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
                  </div>
                );
              }}
            />
          </section>

          {pageContext.view && view === "note" && activeNote && (
            <PageContextDrawer
              view={pageContext.view}
              pinned={pageContext.pinned}
              busy={operationBusy}
              onPin={pageContext.togglePin}
              onClose={closePageContext}
            >
              {pageContext.view === "outline" ? (
                <DocumentOutline store={editorStore} />
              ) : pageContext.view === "history" ? (
                <PageHistory
                  key={`${vaultId}:${activeNote.id}`}
                  vaultId={vaultId}
                  noteId={activeNote.id}
                  selectedId={pageComparison?.revision.id}
                  onSelect={(value) => {
                    setMoreOpen(false);
                    setPageSearchOpen(false);
                    setComparison(value);
                  }}
                />
              ) : pageContext.view === "properties" ? (
                <PageProperties note={activeNote} />
              ) : (
                <PageConnections
                  key={activeNote.id}
                  note={activeNote}
                  notes={activeNotes}
                  onSelect={selectNote}
                  onChange={(patch) =>
                    updateNoteById(activeNote.id, patch, true)
                  }
                />
              )}
            </PageContextDrawer>
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

      {history && (
        <HistoryDialog
          vaultId={vaultId}
          noteId={history.noteId}
          onClose={() => setHistory(null)}
        />
      )}
      {operationBusy && (
        <div className="data-operation-overlay" role="status">
          Finishing data operation…
        </div>
      )}
      {dataError && (
        <div className="data-error-banner" role="alert">
          {dataError}
          <button onClick={() => setDataError("")}>Dismiss</button>
        </div>
      )}
      {vaultSetupOpen && (
        <Dialog
          label="Create or open a vault"
          busy={operationBusy}
          onClose={() => setVaultSetupOpen(false)}
          className="vault-setup-layer"
        >
          {setup}
        </Dialog>
      )}
      <MeetingRecordingStatus />
      {settingsOpen && activeVault && (
        <SettingsDialog
          initialTab={settingsTab}
          vault={activeVault}
          vaultCount={vaults.length}
          busy={operationBusy}
          templates={templates}
          preferences={preferences}
          storageInfo={storageInfo}
          onStorageLocation={async () => {
            try {
              const info = await dataOperation(() =>
                platformRuntime.chooseStorageLocation(),
              );
              if (info) {
                setStorageInfo(info);
                if (info.warning) setDataError(info.warning);
              }
            } catch (error) {
              alert(
                `Hyperion could not move the vault. ${errorMessage(error)}`,
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
          onHistory={() => {
            setSettingsOpen(false);
            setHistory({});
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
            try {
              await dataOperation(async () => {
                flushSync(() => setLoading(true));
                await forgetVaultWorkspace(activeVault.id);
                await knowledgeRepository.deleteVault(activeVault.id);
              });
              const nextVaults = vaults.filter(
                (vault) => vault.id !== activeVault.id,
              );
              setVaults(nextVaults);
              setSettingsOpen(false);
              await loadVault(nextVaults[0].id, nextVaults);
            } catch (error) {
              setDataError(errorMessage(error));
            } finally {
              setLoading(false);
            }
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
