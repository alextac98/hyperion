import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialTabs,
  restoreTabs,
  tabsReducer,
} from "../application/workspace-tabs";
import type { NavigationLocation } from "../application/navigation-history";
import { uiStorage } from "../lib/ui-storage";
import type { WindowSession } from "../../electron/window-session";

export function windowTabsKey(vaultId: string, session?: WindowSession) {
  return session && session.id !== "main"
    ? `hyperion:tabs:${session.id}:${vaultId}`
    : `hyperion:tabs:${vaultId}`;
}

export function rememberRestoredPage(
  vaultId: string,
  noteId: string,
  session?: WindowSession,
) {
  const location = { view: "note" as const, id: noteId };
  const key = windowTabsKey(vaultId, session);
  const state = tabsReducer(
    restoreTabs(uiStorage.getItem(key), () => true, location),
    { type: "open", location },
  );
  uiStorage.setItem(
    key,
    JSON.stringify({
      version: 2,
      locations: state.tabs.map((tab) => tab.location),
      active: state.active,
      layout: state.layout,
    }),
  );
  uiStorage.setItem(`hyperion:last-note:${vaultId}`, noteId);
}

export function useWorkspaceTabs(
  vaultId: string,
  ready: boolean,
  session?: WindowSession,
) {
  const [state, dispatch] = useReducer(tabsReducer, undefined, () =>
    initialTabs(),
  );
  const scope = useRef<string | null>(null);
  const restore = useCallback(
    (
      id: string,
      available: (location: NavigationLocation) => boolean,
      fallback: NavigationLocation,
    ) => {
      let raw: string | null = null;
      try {
        raw = uiStorage.getItem(windowTabsKey(id, session));
      } catch {
        /* Storage is optional. */
      }
      scope.current = id;
      dispatch({
        type: "restore",
        state: restoreTabs(
          raw,
          available,
          session?.vaultId === id &&
            session.location &&
            available(session.location)
            ? session.location
            : fallback,
        ),
      });
    },
    [session],
  );
  useEffect(() => {
    if (!ready || scope.current !== vaultId) return;
    try {
      uiStorage.setItem(
        windowTabsKey(vaultId, session),
        JSON.stringify({
          version: 2,
          locations: state.tabs.map((tab) => tab.location),
          active: state.active,
          layout: state.layout,
        }),
      );
    } catch {
      /* Keep in-memory tabs usable. */
    }
  }, [state, vaultId, ready, session]);
  const open = useCallback(
    (location: NavigationLocation) => dispatch({ type: "open", location }),
    [],
  );
  return {
    state,
    dispatch,
    open,
    restore,
    location: state.tabs.find((tab) => tab.id === state.active)!.location,
  };
}
