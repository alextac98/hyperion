import { useCallback, useEffect, useState } from "react";
import { uiStorage } from "../lib/ui-storage";

export type PageContextView =
  | "outline"
  | "connections"
  | "history"
  | "properties";

type ContextState = {
  vaultId: string;
  noteId: string | null;
  view: PageContextView | null;
  pinned: boolean;
};

function restoreContext(vaultId: string, noteId: string | null): ContextState {
  const state: ContextState = { vaultId, noteId, view: null, pinned: false };
  try {
    const saved = JSON.parse(
      uiStorage.getItem(`hyperion:page-context:${vaultId}`) ?? "null",
    );
    if (
      saved?.pinned === true &&
      ["outline", "connections", "history", "properties"].includes(saved.view)
    ) {
      state.view = saved.view;
      state.pinned = true;
    }
  } catch {
    /* Context stays usable without local storage. */
  }
  return state;
}

export function usePageContext(
  vaultId: string,
  noteId: string | null,
  ready: boolean,
) {
  const [state, setState] = useState<ContextState>({
    vaultId: "",
    noteId: null,
    view: null,
    pinned: false,
  });

  // Synchronize during rendering so a different page or vault never briefly
  // displays the previous page's unpinned context.
  if (ready && state.vaultId !== vaultId) {
    setState(restoreContext(vaultId, noteId));
  } else if (ready && state.noteId !== noteId) {
    setState({ ...state, noteId, view: state.pinned ? state.view : null });
  }

  useEffect(() => {
    if (!ready || state.vaultId !== vaultId) return;
    try {
      uiStorage.setItem(
        `hyperion:page-context:${vaultId}`,
        JSON.stringify({ view: state.view, pinned: state.pinned }),
      );
    } catch {
      /* Keep the current context usable in memory. */
    }
  }, [state, vaultId, ready]);

  const view =
    ready &&
    state.vaultId === vaultId &&
    (state.pinned || state.noteId === noteId)
      ? state.view
      : null;
  const toggle = useCallback(
    (next: PageContextView) => {
      setState((current) => ({
        vaultId,
        noteId,
        view:
          current.vaultId === vaultId &&
          current.view === next &&
          (current.pinned || current.noteId === noteId)
            ? null
            : next,
        pinned:
          current.vaultId === vaultId && current.view !== next
            ? current.pinned
            : false,
      }));
    },
    [vaultId, noteId],
  );
  const close = useCallback(
    () => setState((current) => ({ ...current, view: null, pinned: false })),
    [],
  );
  const togglePin = useCallback(
    () =>
      setState((current) =>
        current.view ? { ...current, pinned: !current.pinned } : current,
      ),
    [],
  );
  return {
    view,
    pinned: view !== null && state.pinned,
    toggle,
    close,
    togglePin,
  };
}
