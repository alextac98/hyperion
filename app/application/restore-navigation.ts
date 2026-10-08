import { uiStorage } from "../lib/ui-storage";
import { restoreTabs, tabsReducer } from "./workspace-tabs";
import { layoutPanes } from "./workspace-layout";
import type { WindowSession } from "../../electron/window-session";

export function windowTabsKey(vaultId: string, session?: WindowSession) {
  return session && session.id !== "main"
    ? `hyperion:tabs:${session.id}:${vaultId}`
    : `hyperion:tabs:${vaultId}`;
}

/** A restore reload must select its result, even when a tab session is saved. */
export function rememberRestoredPage(
  vaultId: string,
  noteId: string,
  session?: WindowSession,
) {
  const location = { view: "note", id: noteId } as const;
  const key = windowTabsKey(vaultId, session);
  const state = tabsReducer(
    restoreTabs(uiStorage.getItem(key), () => true, location),
    { type: "open", location },
  );
  const layout = state.layout;
  if (layout) {
    const panes = layoutPanes(layout);
    const pane =
      panes.find((item) => item.views.includes(state.active)) ??
      panes.find((item) => item.id === layout.activeGroup) ??
      panes[0];
    if (!pane.views.includes(state.active))
      pane.views.splice(
        pane.views.indexOf(pane.activeView ?? "") + 1,
        0,
        state.active,
      );
    pane.activeView = state.active;
    layout.activeGroup = pane.id;
  }
  uiStorage.setItem(`hyperion:last-note:${vaultId}`, noteId);
  uiStorage.setItem(
    key,
    JSON.stringify({
      version: 2,
      locations: state.tabs.map((tab) => tab.location),
      active: state.active,
      layout: state.layout,
    }),
  );
}
