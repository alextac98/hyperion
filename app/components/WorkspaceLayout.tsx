import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
  type IContextMenuItemComponentProps,
  type DockviewWillDropEvent,
  type DockviewWillShowOverlayLocationEvent,
} from "dockview-react";
import { Plus, X } from "@phosphor-icons/react";
import type { TabDragRequest, TabDropTarget, TabDropTargets } from "../../electron/window-session";
import { locationKey } from "../application/workspace-tabs";
import { readPageDrag, type PageDrag } from "../application/page-drag";
import type {
  TabAction,
  WorkspaceTab,
  WorkspaceTabs,
} from "../application/workspace-tabs";
import {
  canSplitPane,
  layoutMinimum,
  MIN_PANE_WIDTH,
  MIN_PANE_HEIGHT,
  PANE_TAB_HEIGHT,
  WORKSPACE_COMPONENT,
  type SplitDirection,
} from "../application/workspace-layout";

type Props = {
  ref?: Ref<WorkspaceLayoutHandle>;
  state: WorkspaceTabs;
  dispatch: (action: TabAction) => void;
  disabled: boolean;
  canOpenPage: (page: PageDrag) => boolean;
  label: (tab: WorkspaceTab) => string;
  icon: (tab: WorkspaceTab) => ReactNode;
  render: (tab: WorkspaceTab, visible: boolean) => ReactNode;
  onDetach?: (tab: WorkspaceTab, position?: { x: number; y: number }) => void;
  canDetach?: (tab: WorkspaceTab) => boolean;
  pageWindow?: boolean;
  onReturn?: (tab: WorkspaceTab) => void;
  onBeginTabDrag?: (request: TabDragRequest) => Promise<boolean>;
  onEndTabDrag?: (token: string) => Promise<void>;
  onUpdateTabDrag?: (token: string, position: { x: number; y: number }) => Promise<void>;
  onUpdateTabDropTargets?: (targets: TabDropTargets) => Promise<void>;
  onTabDropHint?: (callback: (target: TabDropTarget | null) => void) => () => void;
};
export type WorkspaceLayoutHandle = { placeTab: (id: string, target: TabDropTarget) => void };

function tabPreview(element: HTMLElement, title: string): TabDragRequest["preview"] {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const content = element.querySelector(".workspace-tab-content");
  const emoji = content?.querySelector(".page-icon-glyph");
  const svg = content?.querySelector<SVGElement>(":scope > svg");
  let icon: TabDragRequest["preview"]["icon"] = null;
  if (emoji) icon = { type: "emoji", value: (emoji.textContent ?? "").slice(0, 128) };
  else if (svg) {
    const copy = svg.cloneNode(true) as SVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.style.color = getComputedStyle(svg).color;
    icon = { type: "svg", value: copy.outerHTML };
  }
  return {
    width: Math.max(1, Math.min(600, Math.round(box.width))),
    height: Math.max(1, Math.min(100, Math.round(box.height))),
    title: title.slice(0, 4096),
    icon,
    background: style.getPropertyValue("--bg").trim(),
    foreground: style.getPropertyValue("--text").trim(),
    accent: style.getPropertyValue("--accent").trim(),
  };
}

function tabStrip(group: HTMLElement, viewport: HTMLElement) {
  const header = group.querySelector<HTMLElement>(".dv-tabs-and-actions-container");
  if (!header) return null;
  const box = header.getBoundingClientRect();
  const clip = viewport.getBoundingClientRect();
  const actions = header.querySelector(".dv-right-actions-container")?.getBoundingClientRect();
  const x = Math.max(0, box.left, clip.left);
  const y = Math.max(0, box.top, clip.top);
  const right = Math.min(window.innerWidth, box.right, clip.right, actions?.width ? actions.left : box.right);
  const bottom = Math.min(window.innerHeight, box.bottom, clip.bottom);
  if (right <= x || bottom <= y) return null;
  return {
    rect: { x, y, width: right - x, height: bottom - y },
    tabs: Array.from(header.querySelectorAll<HTMLElement>(".dv-tab")),
  };
}
const WorkspaceContext = createContext<Props | null>(null);
function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace panel has no workspace");
  return context;
}

function WorkspacePanel({ api }: IDockviewPanelProps) {
  const { state, render } = useWorkspace();
  const visible = useSyncExternalStore(
    useCallback(
      (notify) => {
        const subscription = api.onDidVisibilityChange(notify);
        return () => subscription.dispose();
      },
      [api],
    ),
    () => api.isVisible,
  );
  const tab = state.tabs.find((item) => item.id === api.id);
  return tab && (tab.visited || visible) ? render(tab, visible) : null;
}

function WorkspaceTabHeader({ api }: IDockviewPanelHeaderProps) {
  const { state, label, icon, dispatch, disabled } = useWorkspace();
  const tab = state.tabs.find((item) => item.id === api.id);
  if (!tab) return null;
  return (
    <div
      className="workspace-tab-content"
      title={label(tab)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          if (!disabled) dispatch({ type: "close", id: tab.id });
        }
      }}
    >
      {icon(tab)}
      <span>{label(tab)}</span>
      <button
        className="tab-close"
        disabled={disabled}
        aria-label={`Close ${label(tab)} tab`}
        title="Close tab"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: "close", id: tab.id });
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function WorkspacePaneActions({ api }: IDockviewHeaderActionsProps) {
  const { dispatch, disabled, pageWindow } = useWorkspace();
  if (pageWindow) return null;
  return (
    <button
      className="tab-home"
      disabled={disabled}
      aria-label="Open Home tab"
      title="Open Home tab"
      onClick={() => {
        api.setActive();
        dispatch({ type: "open", location: { view: "home" } });
      }}
    >
      <Plus size={16} />
    </button>
  );
}

function focusTabElement(id: string) {
  Array.from(document.querySelectorAll<HTMLElement>(".dv-tab"))
    .find((element) => element.dataset.tabPanelId === id)
    ?.focus();
}

function WorkspaceTabMenu({
  panel,
  api,
  close,
}: IContextMenuItemComponentProps) {
  const { dispatch, disabled, state, onDetach, canDetach, onReturn } = useWorkspace();
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, []);
  if (!panel) return null;
  const tab = state.tabs.find(tab => tab.id === panel.id);
  const run = (action: () => void) => {
    action();
    close();
    requestAnimationFrame(() => {
      if (api.activePanel) focusTabElement(api.activePanel.id);
    });
  };
  const split = (direction: SplitDirection, label: string) => (
    <button
      role="menuitem"
      key={direction}
      disabled={
        disabled ||
        panel.group.panels.length < 2 ||
        !canSplitPane(panel.group.width, panel.group.height, direction)
      }
      onClick={() =>
        run(() => panel.api.moveTo({ group: panel.group, position: direction }))
      }
    >
      {label}
    </button>
  );
  return (
    <div
      className="workspace-tab-menu"
      role="menu"
      aria-label="Tab actions"
      tabIndex={-1}
      ref={menu}
      onKeyDown={(event) => {
        event.stopPropagation();
        const items = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let next: number;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        else if (event.key === "ArrowUp")
          next = (index - 1 + items.length) % items.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          close();
          focusTabElement(panel.id);
          return;
        } else return;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      {onReturn && tab && (
        <button role="menuitem" disabled={disabled} onClick={() => run(() => onReturn(tab))}>
          Move to main window
        </button>
      )}
      {onDetach && tab && (canDetach?.(tab) ?? true) && (
        <button
          role="menuitem"
          disabled={disabled}
          onClick={() =>
            run(() => {
              const tab = state.tabs.find((tab) => tab.id === panel.id);
              if (tab) onDetach(tab);
            })
          }
        >
          Move to new window
        </button>
      )}
      {split("left", "Split left")}
      {split("right", "Split right")}
      {split("top", "Split above")}
      {split("bottom", "Split below")}
      {api.groups.map(
        (group, index) =>
          group !== panel.group && (
            <button
              role="menuitem"
              key={group.id}
              disabled={disabled}
              onClick={() =>
                run(() => panel.api.moveTo({ group, position: "center" }))
              }
            >
              Move to pane {index + 1}: {group.activePanel?.title ?? "Home"}
            </button>
          ),
      )}
      <button
        role="menuitem"
        disabled={disabled}
        onClick={() => run(() => dispatch({ type: "close", id: panel.id }))}
      >
        Close tab
      </button>
    </div>
  );
}

// Component identities must stay stable: changing them replaces the live editors.
const components = { [WORKSPACE_COMPONENT]: WorkspacePanel };
const theme = { name: "hyperion", className: "dockview-theme-hyperion" };

export function WorkspaceLayout({ ref, ...props }: Props) {
  const latest = useRef(props);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dropIndicator = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<DockviewApi>();
  const reconciling = useRef(false);
  const schedule = useRef(() => {});
  useLayoutEffect(() => {
    latest.current = props;
  });

  useImperativeHandle(ref, () => ({
    placeTab: (id, target) => {
      const panel = api?.getPanel(id);
      const group = api?.groups.find(group => group.id === target.groupId);
      if (!panel || !group) throw new Error("The destination tab strip changed. Try dragging the tab again.");
      panel.api.moveTo({ group, position: "center", index: target.index });
      panel.api.setActive();
      latest.current.dispatch({ type: "layout", layout: api!.toJSON() });
    },
  }), [api]);

  const { state: { tabs }, disabled, onUpdateTabDropTargets, onTabDropHint } = props;
  useEffect(() => {
    if (!api || !viewport.current || !onUpdateTabDropTargets) return;
    const surface = viewport.current;
    const indicator = dropIndicator.current;
    let frame = 0;
    let hint: TabDropTarget | null = null;
    let previous = "";
    const paintHint = () => {
      if (!indicator) return;
      const group = api.groups.find(group => group.id === hint?.groupId);
      const strip = group && tabStrip(group.element, surface);
      indicator.hidden = !strip || disabled;
      if (!strip || !hint) return;
      const { rect, tabs } = strip;
      const before = tabs[hint.index]?.getBoundingClientRect();
      const last = tabs.at(-1)?.getBoundingClientRect();
      const x = Math.max(rect.x + 1, Math.min(before?.left ?? last?.right ?? rect.x, rect.x + rect.width - 2));
      Object.assign(indicator.style, {
        left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      });
      indicator.style.setProperty("--tab-insertion-x", `${x - rect.x}px`);
      indicator.dataset.tabDropGroup = hint.groupId;
      indicator.dataset.tabDropIndex = String(hint.index);
    };
    const publish = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const targets = api.groups.flatMap(group => {
          const strip = tabStrip(group.element, surface);
          return strip ? [{ groupId: group.id, rect: strip.rect, tabs: strip.tabs.map(tab => {
            const box = tab.getBoundingClientRect();
            return { midpoint: box.left + box.width / 2 };
          }) }] : [];
        });
        const data = { disabled, targets };
        const serialized = JSON.stringify(data);
        if (serialized !== previous) {
          previous = serialized;
          void onUpdateTabDropTargets!(data).catch(() => {});
        }
        paintHint();
      });
    };
    const unsubscribe = onTabDropHint?.(target => { hint = target; paintHint(); });
    const layout = api.onDidLayoutChange(publish);
    const observer = new ResizeObserver(publish);
    observer.observe(surface);
    for (const group of api.groups) {
      observer.observe(group.element);
      for (const tab of group.element.querySelectorAll(".dv-tab")) observer.observe(tab);
    }
    surface.addEventListener("scroll", publish, true);
    window.addEventListener("resize", publish);
    publish();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      layout.dispose();
      unsubscribe?.();
      surface.removeEventListener("scroll", publish, true);
      window.removeEventListener("resize", publish);
      if (indicator) indicator.hidden = true;
      void onUpdateTabDropTargets!({ disabled: true, targets: [] }).catch(() => {});
    };
  }, [api, tabs, disabled, onUpdateTabDropTargets, onTabDropHint]);

  const onReady = useCallback(({ api }: DockviewReadyEvent) => {
    const { state } = latest.current;
    if (state.layout) {
      try {
        api.fromJSON(state.layout);
      } catch {
        api.clear();
      } // Invalid/stale layouts still recover their open pages below.
    }
    setApi(api);
  }, []);

  useLayoutEffect(() => {
    if (!api) return;
    const { state, label } = latest.current;
    reconciling.current = true;
    try {
      const initializing = api.totalPanels === 0;
      const ids = new Set(state.tabs.map((tab) => tab.id));
      for (const panel of api.panels)
        if (!ids.has(panel.id)) api.removePanel(panel);
      for (const tab of state.tabs) {
        const existing = api.getPanel(tab.id);
        if (existing) {
          if (existing.title !== label(tab)) existing.api.setTitle(label(tab));
          continue;
        }
        const active = api.activePanel ?? api.panels.at(-1);
        api.addPanel({
          id: tab.id,
          component: WORKSPACE_COMPONENT,
          title: label(tab),
          renderer: "always",
          inactive: true,
          minimumWidth: MIN_PANE_WIDTH,
          minimumHeight: MIN_PANE_HEIGHT - PANE_TAB_HEIGHT,
          ...(active
            ? {
                position: {
                  referencePanel: active.id,
                  direction: "within" as const,
                  index: initializing
                    ? active.group.panels.length
                    : active.group.panels.indexOf(active) + 1,
                },
              }
            : {}),
        });
      }
      if (api.activePanel?.id !== state.active)
        api.getPanel(state.active)?.api.setActive();
    } finally {
      reconciling.current = false;
    }
    schedule.current();
  }, [api, props.state.tabs, props.state.active, props.label]);

  useEffect(() => {
    if (!api) return;
    let frame = 0;
    let disposed = false;
    const dragSurface = viewport.current;
    let dragging: "native" | "pointer" | null = null;
    let draggedTab: {
      id: string;
      pointerId: number;
      element: HTMLElement;
      token: string;
    } | null = null;
    let draggedPage: PageDrag | null = null;
    let dragCleanup = 0;
    const endTabDrag = () => {
      if (draggedTab) void latest.current.onEndTabDrag?.(draggedTab.token).catch(() => {});
      document.body.removeAttribute("data-native-tab-drag-preview");
      if (draggedTab?.element.hasPointerCapture?.(draggedTab.pointerId))
        draggedTab.element.releasePointerCapture(draggedTab.pointerId);
      draggedTab = null;
      dragging = null;
      dragSurface?.removeAttribute("data-tab-dragging");
      // Native event listeners can run microtasks between capture and bubble.
      // Keep the payload available until all of Dockview's drop handlers finish.
      window.clearTimeout(dragCleanup);
      dragCleanup = window.setTimeout(() => {
        draggedPage = null;
        if (!disposed && latest.current.onDetach)
          api.updateOptions({ dndStrategy: "pointer" });
      }, 0);
    };
    const endPointerDrag = (event: PointerEvent) => {
      // HTML dragstart itself causes pointercancel; only end pointer-based drags here.
      if (dragging !== "pointer") return;
      if (draggedTab && event.pointerId !== draggedTab.pointerId) return;
      if (
        event.type === "pointerup" &&
        draggedTab &&
        !latest.current.disabled &&
        (event.clientX < 0 ||
          event.clientY < 0 ||
          event.clientX >= window.innerWidth ||
          event.clientY >= window.innerHeight)
      ) {
        const tab = latest.current.state.tabs.find(
          (tab) => tab.id === draggedTab!.id,
        );
        if (tab && (latest.current.canDetach?.(tab) ?? true))
          latest.current.onDetach?.(tab, {
            x: event.screenX,
            y: event.screenY,
          });
      }
      endTabDrag();
    };
    const movePointerDrag = (event: PointerEvent) => {
      if (!draggedTab || event.pointerId !== draggedTab.pointerId) return;
      void latest.current.onUpdateTabDrag?.(draggedTab.token, { x: event.screenX, y: event.screenY }).catch(() => {});
    };
    const cancelTabDrag = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !draggedTab) return;
      event.preventDefault();
      // End Dockview's pointer controller as well as our own capture.
      window.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: draggedTab.pointerId }),
      );
    };
    const beginPageDrag = (event: DragEvent) => {
      window.clearTimeout(dragCleanup);
      draggedPage = null;
      const page = readPageDrag(event.dataTransfer);
      if (
        event.defaultPrevented ||
        latest.current.disabled ||
        !page ||
        !latest.current.canOpenPage(page)
      )
        return;
      draggedPage = page;
      dragging = "native";
      // Sidebar pages still use the native drag payload. Enable native drop
      // targets for that gesture, then restore captured tab drags when it ends.
      if (latest.current.onDetach) api.updateOptions({ dndStrategy: "auto" });
      dragSurface?.setAttribute("data-tab-dragging", "true");
    };
    const fit = () => {
      if (!viewport.current || !canvas.current) return;
      const minimum = layoutMinimum(api.toJSON());
      // clientWidth/Height round fractional CSS pixels at non-default zoom.
      // Rounding up can create scrollbars that then repeatedly resize the grid.
      const bounds = viewport.current.getBoundingClientRect();
      const width = Math.max(Math.min(viewport.current.clientWidth, Math.floor(bounds.width)), minimum.width);
      const height = Math.max(Math.min(viewport.current.clientHeight, Math.floor(bounds.height)), minimum.height);
      canvas.current.style.width = `${width}px`;
      canvas.current.style.height = `${height}px`;
      if (api.width !== width || api.height !== height)
        api.layout(width, height);
    };
    const publish = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => {
        fit();
        frame = 0;
        if (api.totalPanels)
          latest.current.dispatch({ type: "layout", layout: api.toJSON() });
      });
    };
    schedule.current = publish;
    const constrain = () => {
      for (const group of api.groups)
        group.api.setConstraints({
          minimumWidth: MIN_PANE_WIDTH,
          minimumHeight: MIN_PANE_HEIGHT,
        });
    };
    const guardDrop = (
      event: DockviewWillShowOverlayLocationEvent | DockviewWillDropEvent,
    ) => {
      const data = event.getData();
      const page =
        draggedPage && latest.current.canOpenPage(draggedPage)
          ? draggedPage
          : null;
      if (
        latest.current.disabled ||
        (!page && (!data || data.viewId !== api.id || !data.panelId))
      ) {
        event.preventDefault();
        return;
      }
      // Left/right on a tab means insertion, not splitting the content pane.
      if (
        event.kind === "tab" ||
        event.kind === "header_space" ||
        event.position === "center"
      )
        return;
      const group = event.group;
      const sourceGroup = page
        ? api.getPanel(locationKey({ view: "note", id: page.id }))?.group.id
        : data?.groupId;
      if (
        !group ||
        !canSplitPane(group.width, group.height, event.position) ||
        (sourceGroup === group.id && group.panels.length < 2)
      )
        event.preventDefault();
    };
    const subscriptions = [
      api.onDidLayoutChange(publish),
      api.onDidActivePanelChange(({ panel }) => {
        if (!reconciling.current && panel)
          latest.current.dispatch({ type: "focus", id: panel.id });
      }),
      api.onDidRemovePanel((panel) => {
        if (!reconciling.current)
          latest.current.dispatch({ type: "close", id: panel.id });
      }),
      api.onDidAddGroup(() => {
        constrain();
        publish();
      }),
      api.onWillShowOverlay(guardDrop),
      api.onWillDrop(guardDrop),
      api.onUnhandledDragOver((event) => {
        if (
          !latest.current.disabled &&
          draggedPage &&
          latest.current.canOpenPage(draggedPage)
        )
          event.accept();
      }),
      api.onDidDrop((event) => {
        const { group } = event;
        const page =
          "dataTransfer" in event.nativeEvent
            ? readPageDrag(event.nativeEvent.dataTransfer)
            : null;
        if (
          !group ||
          latest.current.disabled ||
          !page ||
          !latest.current.canOpenPage(page)
        )
          return;
        const location = { view: "note" as const, id: page.id };
        const id = locationKey(location);
        const index = event.panel
          ? group.panels.indexOf(event.panel)
          : group.panels.length;
        latest.current.dispatch({ type: "open", location });
        const existing = api.getPanel(id);
        if (existing) {
          existing.api.moveTo({ group, position: event.position, index });
          existing.api.setActive();
        } else {
          api.addPanel({
            id,
            component: WORKSPACE_COMPONENT,
            title: latest.current.label({ id, location, visited: true }),
            renderer: "always",
            minimumWidth: MIN_PANE_WIDTH,
            minimumHeight: MIN_PANE_HEIGHT - PANE_TAB_HEIGHT,
            position: {
              referenceGroup: group,
              direction:
                event.position === "center" ? "within" : event.position,
              index,
            },
          });
        }
      }),
      api.onWillDragPanel(({ nativeEvent, panel }) => {
        if (latest.current.disabled || nativeEvent.defaultPrevented) return;
        window.clearTimeout(dragCleanup);
        draggedPage = null;
        dragging = nativeEvent.type.startsWith("pointer")
          ? "pointer"
          : "native";
        if (dragging === "pointer" && latest.current.onDetach) {
          const element = Array.from(
            dragSurface?.querySelectorAll<HTMLElement>(".dv-tab") ?? [],
          ).find((element) => element.dataset.tabPanelId === panel.id);
          if (element) {
            const pointerId = (nativeEvent as PointerEvent).pointerId;
            const token = crypto.randomUUID();
            draggedTab = { id: panel.id, pointerId, element, token };
            element.setPointerCapture?.(pointerId);
            const tab = latest.current.state.tabs.find(tab => tab.id === panel.id);
            if (tab && latest.current.onBeginTabDrag)
              void latest.current.onBeginTabDrag({ token, location: tab.location, preview: tabPreview(element, latest.current.label(tab)) }).then(visible => {
                if (visible && draggedTab?.token === token)
                  document.body.setAttribute("data-native-tab-drag-preview", "true");
              }).catch(() => { /* Dockview's in-window preview remains available. */ });
          }
        }
        dragSurface?.setAttribute("data-tab-dragging", "true");
      }),
      api.onWillDragGroup((event) => event.nativeEvent.preventDefault()),
    ];
    // Use the window so cancellation and drops outside this workspace also clean up.
    window.addEventListener("dragstart", beginPageDrag);
    window.addEventListener("drop", endTabDrag, true);
    window.addEventListener("dragend", endTabDrag, true);
    window.addEventListener("pointerup", endPointerDrag, true);
    window.addEventListener("pointermove", movePointerDrag, true);
    window.addEventListener("pointercancel", endPointerDrag, true);
    window.addEventListener("keydown", cancelTabDrag, true);
    const observer = new ResizeObserver(publish);
    if (viewport.current) observer.observe(viewport.current);
    constrain();
    publish();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      subscriptions.forEach((subscription) => subscription.dispose());
      window.removeEventListener("dragstart", beginPageDrag);
      window.removeEventListener("drop", endTabDrag, true);
      window.removeEventListener("dragend", endTabDrag, true);
      window.removeEventListener("pointerup", endPointerDrag, true);
      window.removeEventListener("pointermove", movePointerDrag, true);
      window.removeEventListener("pointercancel", endPointerDrag, true);
      window.removeEventListener("keydown", cancelTabDrag, true);
      endTabDrag();
      window.clearTimeout(dragCleanup);
      schedule.current = () => {};
    };
  }, [api]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!api || !(event.target instanceof HTMLElement)) return;
    if (props.disabled) {
      if (event.target.closest(".dv-tab")) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const focusTab = (id: string) => {
      api.getPanel(id)?.api.setActive();
      focusTabElement(id);
    };
    if (event.key === "F6") {
      event.preventDefault();
      event.stopPropagation();
      const groups = api.groups;
      const index = groups.findIndex((group) => group === api.activeGroup);
      const next =
        groups[
          (index + (event.shiftKey ? -1 : 1) + groups.length) % groups.length
        ];
      if (next?.activePanel) focusTab(next.activePanel.id);
      return;
    }
    const tabElement = event.target.closest<HTMLElement>(".dv-tab");
    // A close button keeps its normal Enter/Space behavior.
    if (!tabElement || event.target.closest("button")) return;
    const panel = api.getPanel(tabElement.dataset.tabPanelId ?? "");
    if (!panel) return;
    const tabs = panel.group.panels;
    const index = tabs.indexOf(panel);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      props.dispatch({ type: "close", id: panel.id });
      requestAnimationFrame(() => {
        if (api.activePanel) focusTab(api.activePanel.id);
      });
      return;
    } else if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = tabElement.getBoundingClientRect();
      tabElement.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left,
          clientY: bounds.bottom,
        }),
      );
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      // Dockview's insertion index is measured before removing the source tab.
      panel.api.moveTo({
        group: panel.group,
        position: "center",
        index: next > index ? next + 1 : next,
      });
      focusTab(panel.id);
    } else focusTab(tabs[next].id);
  };

  return (
    <WorkspaceContext.Provider value={props}>
      <div
        className="workspace-layout-viewport"
        ref={viewport}
        onKeyDownCapture={onKeyDown}
        onPointerDownCapture={(event) => {
          if (
            props.disabled &&
            event.target instanceof Element &&
            event.target.closest(".dv-tab")
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="workspace-layout-canvas" ref={canvas}>
          <DockviewReact
            dndStrategy={props.onDetach ? "pointer" : "auto"}
            components={components}
            onReady={onReady}
            theme={theme}
            defaultRenderer="always"
            disableFloatingGroups
            disableAutoResizing
            disableDnd={props.disabled}
            dndEdges={false}
            defaultTabComponent={WorkspaceTabHeader}
            rightHeaderActionsComponent={WorkspacePaneActions}
            getTabContextMenuItems={() => [{ component: WorkspaceTabMenu }]}
          />
        </div>
        <div className="window-tab-drop-indicator" ref={dropIndicator} hidden aria-hidden="true" />
      </div>
    </WorkspaceContext.Provider>
  );
}
