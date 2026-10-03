import type { SerializedDockview } from "dockview-react";

export const MIN_PANE_WIDTH = 320;
export const MIN_PANE_HEIGHT = 240;
export const PANE_TAB_HEIGHT = 39;
export const PANE_DIVIDER_SIZE = 4;
export const WORKSPACE_COMPONENT = "workspace-page";

type GridNode = SerializedDockview["grid"]["root"];
export type Pane = Exclude<GridNode["data"], GridNode[]>;
export type SplitDirection = "left" | "right" | "top" | "bottom";

export function layoutPanes(layout?: SerializedDockview): Pane[] {
  const visit = (node: GridNode): Pane[] =>
    Array.isArray(node.data) ? node.data.flatMap(visit) : [node.data];
  return layout ? visit(layout.grid.root) : [];
}

/** Read only our docked layout format; never restore floating windows or arbitrary components. */
export function restoreLayout(
  raw: unknown,
  tabIds: string[],
): SerializedDockview | undefined {
  if (!raw || typeof raw !== "object" || !("grid" in raw)) return;
  const value = raw as SerializedDockview;
  if (
    !value.grid ||
    !["HORIZONTAL", "VERTICAL"].includes(value.grid.orientation)
  )
    return;
  const remaining = new Set(tabIds);
  const groupIds = new Set<string>();
  const positive = (n: unknown, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
  const visit = (input: unknown, depth: number): GridNode | undefined => {
    if (!input || typeof input !== "object" || depth > 100) return;
    const node = input as GridNode;
    const size = positive(node.size, 1);
    if (node.type === "branch" && Array.isArray(node.data)) {
      const data = node.data.flatMap((child) => {
        const next = visit(child, depth + 1);
        return next ? [next] : [];
      });
      // Keep single-child branches: removing one would change the axis of its descendants.
      return data.length ? { type: "branch", data, size } : undefined;
    }
    if (node.type !== "leaf" || !node.data || Array.isArray(node.data)) return;
    const pane = node.data;
    if (
      typeof pane.id !== "string" ||
      groupIds.has(pane.id) ||
      !Array.isArray(pane.views)
    )
      return;
    const views = pane.views.filter((id) => remaining.delete(id));
    if (!views.length) return;
    groupIds.add(pane.id);
    return {
      type: "leaf",
      size,
      data: {
        id: pane.id,
        views,
        activeView: views.includes(pane.activeView ?? "")
          ? pane.activeView
          : views[0],
      },
    };
  };
  const root = visit(value.grid.root, 0);
  if (!root) return;
  const result: SerializedDockview = {
    grid: {
      root: root.type === "branch" ? root : { type: "branch", data: [root] },
      width: positive(value.grid.width, 1000),
      height: positive(value.grid.height, 700),
      orientation: value.grid.orientation,
    },
    panels: Object.fromEntries(
      tabIds.map((id) => [
        id,
        {
          id,
          contentComponent: WORKSPACE_COMPONENT,
          renderer: "always" as const,
          minimumWidth: MIN_PANE_WIDTH,
          minimumHeight: MIN_PANE_HEIGHT - PANE_TAB_HEIGHT,
        },
      ]),
    ),
  };
  const panes = layoutPanes(result);
  panes[0].views.push(...remaining);
  result.activeGroup = groupIds.has(value.activeGroup ?? "")
    ? value.activeGroup
    : panes[0].id;
  return result;
}

/** Minimum footprint of the whole tree, including dividers between children. */
export function layoutMinimum(layout?: SerializedDockview) {
  const visit = (
    node: GridNode,
    horizontal: boolean,
  ): { width: number; height: number } => {
    if (!Array.isArray(node.data))
      return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
    const sizes = node.data.map((child) => visit(child, !horizontal));
    const gap = Math.max(0, sizes.length - 1) * PANE_DIVIDER_SIZE;
    return {
      width: horizontal
        ? sizes.reduce((sum, s) => sum + s.width, gap)
        : Math.max(MIN_PANE_WIDTH, ...sizes.map((s) => s.width)),
      height: horizontal
        ? Math.max(MIN_PANE_HEIGHT, ...sizes.map((s) => s.height))
        : sizes.reduce((sum, s) => sum + s.height, gap),
    };
  };
  return layout
    ? visit(layout.grid.root, layout.grid.orientation === "HORIZONTAL")
    : { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
}

export function canSplitPane(
  width: number,
  height: number,
  direction: SplitDirection,
) {
  return direction === "left" || direction === "right"
    ? width >= MIN_PANE_WIDTH * 2 + PANE_DIVIDER_SIZE &&
        height >= MIN_PANE_HEIGHT
    : height >= MIN_PANE_HEIGHT * 2 + PANE_DIVIDER_SIZE &&
        width >= MIN_PANE_WIDTH;
}
