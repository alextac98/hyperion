import type { NavigationLocation } from "./navigation-history";

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
};
export type TabAction =
  | { type: "open"; location: NavigationLocation }
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  | { type: "reorder"; id: string; before: string }
  | { type: "restore"; state: WorkspaceTabs }
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
      tabs,
      active: id,
      recent: [...state.recent.filter((key) => key !== id), id],
    };
  }
  if (action.type === "focus") {
    if (!state.tabs.some((tab) => tab.id === action.id)) return state;
    return {
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
    const active = tabs.some((tab) => tab.id === state.active)
      ? state.active
      : (recent.at(-1) ?? tabs[0].id);
    return tabsReducer({ tabs, active, recent }, { type: "focus", id: active });
  }
  if (action.id === action.before) return state;
  const tab = state.tabs.find((tab) => tab.id === action.id);
  if (!tab || !state.tabs.some((tab) => tab.id === action.before)) return state;
  const targetIndex = state.tabs.findIndex((tab) => tab.id === action.before);
  const tabs = state.tabs.filter((tab) => tab.id !== action.id);
  tabs.splice(targetIndex, 0, tab);
  return { ...state, tabs };
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
    if (value?.version !== 1 || !Array.isArray(value.locations))
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
    return {
      tabs: unique.map((location) => ({
        id: locationKey(location),
        location,
        visited: locationKey(location) === active,
      })),
      active,
      recent: [active],
    };
  } catch {
    return initialTabs(fallback);
  }
}
