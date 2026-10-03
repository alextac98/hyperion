import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialTabs,
  restoreTabs,
  tabsReducer,
} from "../application/workspace-tabs";
import type { NavigationLocation } from "../application/navigation-history";
import { uiStorage } from "../lib/ui-storage";

export function useWorkspaceTabs(vaultId: string, ready: boolean) {
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
        raw = uiStorage.getItem(`hyperion:tabs:${id}`);
      } catch {
        /* Storage is optional. */
      }
      scope.current = id;
      dispatch({
        type: "restore",
        state: restoreTabs(raw, available, fallback),
      });
    },
    [],
  );
  useEffect(() => {
    if (!ready || scope.current !== vaultId) return;
    try {
      uiStorage.setItem(
        `hyperion:tabs:${vaultId}`,
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
  }, [state, vaultId, ready]);
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
