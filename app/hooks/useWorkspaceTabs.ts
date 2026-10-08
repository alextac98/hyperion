import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialTabs,
  restoreTabs,
  tabsReducer,
} from "../application/workspace-tabs";
import type { NavigationLocation } from "../application/navigation-history";
import { uiStorage } from "../lib/ui-storage";
import type { WindowSession } from "../../electron/window-session";
import { windowTabsKey } from "../application/restore-navigation";
export {
  rememberRestoredPage,
  windowTabsKey,
} from "../application/restore-navigation";

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
