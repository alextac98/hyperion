import type { NavigationLocation } from "./navigation-history";
import type { SerializedDockview } from "dockview-react";
import { layoutPanes, restoreLayout } from "./workspace-layout";

export const locationKey = (location: NavigationLocation) =>
  JSON.stringify(location);
export type WorkspaceTab = {
  id: string;
  location: NavigationLocation;
  visited: boolean;
};
export type WorkspaceTabs = {
  tabs: WorkspaceTab[];
  active: string;
  recent: string[];
  layout?: SerializedDockview;
};
export type TabAction =
  | { type: "open"; location: NavigationLocation }
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  | { type: "restore"; state: WorkspaceTabs }
  | { type: "layout"; layout: SerializedDockview }
  | { type: "prune"; ids: string[] };

export function initialTabs(
  location: NavigationLocation = { view: "home" },
): WorkspaceTabs {
  const id = locationKey(location);
  return { tabs: [{ id, location, visited: true }], active: id, recent: [id] };
}

export function tabsReducer(
  state: WorkspaceTabs,
  action: TabAction,
): WorkspaceTabs {
  if (action.type === "restore") return action.state;
  if (action.type === "layout") {
    const layout = restoreLayout(
      action.layout,
      state.tabs.map((tab) => tab.id),
    );
    if (!layout) return state;
    const panes = layoutPanes(layout);
    const active =
      panes.find((pane) => pane.id === layout.activeGroup)?.activeView ??
      state.active;
    const visible = new Set(panes.map((pane) => pane.activeView));
    const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
    const tabs = panes.flatMap((pane) =>
      pane.views.map((id) => {
        const tab = byId.get(id)!;
        return visible.has(id) && !tab.visited
          ? { ...tab, visited: true }
          : tab;
      }),
    );
    if (
      active === state.active &&
      tabs.every((tab, i) => tab === state.tabs[i]) &&
      JSON.stringify(layout) === JSON.stringify(state.layout)
    )
      return state;
    return {
      ...state,
      layout,
      tabs,
      active,
      recent:
        active === state.active
          ? state.recent
          : [...state.recent.filter((id) => id !== active), active],
    };
  }
  if (action.type === "open") {
    const id = locationKey(action.location);
    if (state.tabs.some((tab) => tab.id === id))
      return tabsReducer(state, { type: "focus", id });
    const tabs = [...state.tabs];
    tabs.splice(tabs.findIndex((tab) => tab.id === state.active) + 1, 0, {
      id,
      location: action.location,
      visited: true,
    });
    return {
      ...state,
      tabs,
      active: id,
      recent: [...state.recent.filter((key) => key !== id), id],
    };
  }
  if (action.type === "focus") {
    if (!state.tabs.some((tab) => tab.id === action.id)) return state;
    if (action.id === state.active) return state;
    return {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === action.id ? { ...tab, visited: true } : tab,
      ),
      active: action.id,
      recent: [...state.recent.filter((id) => id !== action.id), action.id],
    };
  }
  if (action.type === "close" || action.type === "prune") {
    const removed = action.type === "close" ? [action.id] : action.ids;
    const tabs = state.tabs.filter((tab) => !removed.includes(tab.id));
    if (tabs.length === state.tabs.length) return state;
    if (!tabs.length) return initialTabs();
    const recent = state.recent.filter((id) =>
      tabs.some((tab) => tab.id === id),
    );
    const pane = layoutPanes(state.layout).find((pane) =>
      pane.views.includes(state.active),
    );
    const paneRecent = recent.filter((id) => pane?.views.includes(id));
    const paneFallback = pane?.views.find((id) =>
      tabs.some((tab) => tab.id === id),
    );
    const active = tabs.some((tab) => tab.id === state.active)
      ? state.active
      : (paneRecent.at(-1) ?? paneFallback ?? recent.at(-1) ?? tabs[0].id);
    return {
      ...state,
      tabs: tabs.map((tab) =>
        tab.id === active ? { ...tab, visited: true } : tab,
      ),
      active,
      recent: [...recent.filter((id) => id !== active), active],
    };
  }
  return state;
}

function isLocation(value: unknown): value is NavigationLocation {
  if (!value || typeof value !== "object" || !("view" in value)) return false;
  if (value.view === "note" || value.view === "template")
    return "id" in value && typeof value.id === "string";
  if (value.view === "tags")
    return (
      "tag" in value && (value.tag === null || typeof value.tag === "string")
    );
  return ["home", "journal", "templates", "archive", "trash"].includes(
    String(value.view),
  );
}

export function restoreTabs(
  raw: string | null,
  available: (location: NavigationLocation) => boolean,
  fallback: NavigationLocation,
): WorkspaceTabs {
  try {
    const value = JSON.parse(raw ?? "null");
    if (![1, 2].includes(value?.version) || !Array.isArray(value.locations))
      return initialTabs(fallback);
    const locations: NavigationLocation[] = value.locations
      .filter(isLocation)
      .filter(available);
    const unique = [
      ...new Map(
        locations.map((location) => [locationKey(location), location]),
      ).values(),
    ];
    if (!unique.length) return initialTabs(fallback);
    const active = unique.some(
      (location) => locationKey(location) === value.active,
    )
      ? (value.active as string)
      : locationKey(unique[0]);
    const layout =
      value.version === 2
        ? restoreLayout(value.layout, unique.map(locationKey))
        : undefined;
    const visible = new Set(layoutPanes(layout).map((pane) => pane.activeView));
    return {
      ...(layout ? { layout } : {}),
      tabs: unique.map((location) => ({
        id: locationKey(location),
        location,
        visited:
          locationKey(location) === active ||
          visible.has(locationKey(location)),
      })),
      active,
      recent: [active],
    };
  } catch {
    return initialTabs(fallback);
  }
}
