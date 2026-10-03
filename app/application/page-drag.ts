export const PAGE_DRAG_TYPE = "application/x-hyperion-page";

export type PageDrag = { id: string; vaultId: string };

export function writePageDrag(transfer: DataTransfer, page: PageDrag) {
  transfer.effectAllowed = "move";
  transfer.setData(
    PAGE_DRAG_TYPE,
    JSON.stringify({ id: page.id, vaultId: page.vaultId }),
  );
}

export function readPageDrag(transfer: DataTransfer | null): PageDrag | null {
  try {
    const page = JSON.parse(transfer?.getData(PAGE_DRAG_TYPE) ?? "null");
    return page &&
      typeof page.id === "string" &&
      typeof page.vaultId === "string"
      ? { id: page.id, vaultId: page.vaultId }
      : null;
  } catch {
    return null;
  }
}
