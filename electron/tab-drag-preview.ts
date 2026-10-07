import { BrowserWindow, screen } from "electron";
import type { TabDragRequest } from "./window-session.js";

export const TAB_DRAG_PREVIEW_TITLE = "Hyperion tab drag preview";

// A DOM drag ghost is clipped at the edge of its renderer. This small,
// non-interactive native window keeps the tab visible over the desktop too.
export function createTabDragPreview(
  source: BrowserWindow,
  rect: TabDragRequest["rect"],
) {
  const window = new BrowserWindow({
    width: rect.width + 24,
    height: rect.height + 24,
    title: TAB_DRAG_PREVIEW_TITLE,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setIgnoreMouseEvents(true);
  const position = () => {
    if (window.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    window.setPosition(point.x + 12, point.y + 12, false);
  };
  position();
  const timer = setInterval(position, 16);
  window.once("closed", () => clearInterval(timer));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const ready = (async () => {
    const image = await source.webContents.capturePage(rect);
    if (window.isDestroyed()) return;
    const html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
      <style>html,body{margin:0;background:transparent;overflow:hidden}
      img{display:block;margin:8px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;
      border:2px solid #4664ed;border-radius:7px;box-shadow:0 3px 9px #0004;opacity:.96}</style>
      </head><body><img alt="Moving tab" src="${image.toDataURL()}"></body></html>`;
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    if (!window.isDestroyed()) {
      position();
      window.showInactive();
    }
  })();
  return {
    window,
    ready,
    dispose: () => {
      clearInterval(timer);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
