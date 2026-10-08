import { BrowserWindow, screen } from "electron";
import type { TabDragRequest } from "./window-session.js";

export const TAB_DRAG_PREVIEW_TITLE = "Hyperion tab drag preview";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

// A DOM drag ghost is clipped at the edge of its renderer. This small,
// non-interactive native window keeps the tab visible over the desktop too.
export function createTabDragPreview(
  preview: TabDragRequest["preview"],
  zoom: number,
) {
  const width = Math.ceil(preview.width * zoom);
  const height = Math.ceil(preview.height * zoom);
  const window = new BrowserWindow({
    width: width + 24,
    height: height + 24,
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
    // Render tab content rather than capturing the live source. Dockview's
    // focus/drop outlines and moving DOM ghost can overlap a screenshot.
    const icon = !preview.icon ? "" : preview.icon.type === "emoji"
      ? `<span class="tab-icon emoji">${escapeHtml(preview.icon.value)}</span>`
      : `<img class="tab-icon" alt="" src="${escapeHtml(`data:image/svg+xml,${encodeURIComponent(preview.icon.value)}`)}">`;
    const html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
      <style>html,body{margin:0;background:transparent;overflow:hidden}
      .tab{display:flex;align-items:center;gap:${8 * zoom}px;margin:8px;padding:0 ${10 * zoom}px;
      width:${width}px;height:${height}px;box-sizing:border-box;overflow:hidden;
      font:${12 * zoom}px ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      border:2px solid;border-radius:7px;box-shadow:0 3px 9px #0004;opacity:.96}
      .tab-icon{width:${14 * zoom}px;height:${14 * zoom}px;flex:none}
      .emoji{font-size:${14 * zoom}px;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
      .tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tab-close{flex:none;margin-left:auto;font-size:${16 * zoom}px;opacity:.65}</style>
      </head><body><div class="tab" style="background:${escapeHtml(preview.background)};color:${escapeHtml(preview.foreground)};border-color:${escapeHtml(preview.accent)}">
      ${icon}<span class="tab-title">${escapeHtml(preview.title)}</span><span class="tab-close" aria-hidden="true">×</span>
      </div></body></html>`;
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
