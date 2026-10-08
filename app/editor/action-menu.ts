import styles from "./action-menu.css?inline";

export type EditorAction = {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
};

let dismiss: (() => void) | undefined;

/** A shared top-layer menu, with keyboard navigation and deterministic cleanup. */
export function openEditorActionMenu(
  anchor: HTMLElement,
  label: string,
  actions: EditorAction[],
  returnFocus = () => anchor.focus({ preventScroll: true }),
) {
  dismiss?.();
  const menu = document.createElement("div");
  menu.className = "editor-action-menu";
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.contentEditable = "false";
  menu.dataset.rangeSyncExclude = "true";
  const style = document.createElement("style");
  style.textContent = styles;
  menu.append(style);
  let focusFrame = 0;
  const close = (restoreFocus = false) => {
    cancelAnimationFrame(focusFrame);
    document.removeEventListener("scroll", position, true);
    document.removeEventListener("dragstart", closeOnDrag, true);
    window.removeEventListener("resize", position);
    observer.disconnect();
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (dismiss === close) dismiss = undefined;
    if (restoreFocus && anchor.isConnected) returnFocus();
  };
  // Native block drags originate on the widget, while column drags originate
  // on their header. Dismiss either menu before the drag engine handles them.
  const closeOnDrag = () => close();
  const position = () => {
    if (!anchor.isConnected) return close();
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, innerHeight - menu.offsetHeight - 8))}px`;
  };
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected) close();
  });
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = action.label;
    button.disabled = !!action.disabled;
    button.classList.toggle("danger", !!action.danger);
    button.addEventListener("click", () => {
      close(true);
      action.run();
    });
    menu.append(button);
  }
  menu.addEventListener("keydown", (event) => {
    // Keep editor shortcuts from consuming menu keys.
    event.stopPropagation();
    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  });
  menu.addEventListener("toggle", () => {
    if (menu.isConnected && !menu.matches(":popover-open")) close();
  });
  document.body.append(menu);
  menu.showPopover();
  dismiss = close;
  anchor.setAttribute("aria-expanded", "true");
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("scroll", position, true);
  document.addEventListener("dragstart", closeOnDrag, true);
  window.addEventListener("resize", position);
  position();
  const focus = () => {
    if (menu.isConnected)
      menu
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  };
  focus();
  focusFrame = requestAnimationFrame(focus);
  return close;
}
