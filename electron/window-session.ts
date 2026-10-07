import { z } from "zod";

export const windowLocation = z.union([
  z.object({
    view: z.enum(["note", "template"]),
    id: z.string().min(1).max(512),
  }),
  z.object({ view: z.literal("tags"), tag: z.string().max(512).nullable() }),
  z.object({
    view: z.enum(["home", "journal", "templates", "archive", "trash"]),
  }),
]);

export const detachedTabRequest = z.object({
  vaultId: z.string().min(1).max(512),
  location: windowLocation,
  position: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .optional(),
});

export const tabDragRequest = z.object({
  token: z.string().uuid(),
  location: windowLocation,
  rect: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1).max(600),
    height: z.number().int().min(1).max(100),
  }),
});

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
export const tabDragPosition = z.object({
  token: z.string().uuid(),
  position: point,
});
export const tabDropTargets = z.object({
  disabled: z.boolean(),
  targets: z
    .array(
      z.object({
        groupId: z.string().min(1).max(512),
        rect: point.extend({
          width: z.number().finite().positive(),
          height: z.number().finite().positive(),
        }),
        tabs: z.array(z.object({ midpoint: z.number().finite() })).max(4096),
      }),
    )
    .max(128),
});

export type WindowLocation = z.infer<typeof windowLocation>;
export type DetachedTabRequest = z.infer<typeof detachedTabRequest>;
export type WindowSession = {
  id: string;
  kind: "primary" | "page";
  vaultId: string | null;
  location: WindowLocation | null;
};

export type TabDragRequest = z.infer<typeof tabDragRequest>;
export type TabDropTargets = z.infer<typeof tabDropTargets>;
export type TabDropTarget = { groupId: string; index: number };
export type OpenWindowTab = DetachedTabRequest & {
  token: string;
  target?: TabDropTarget;
};

export type EditorUpdate = {
  vaultId: string;
  documentId: string;
  data: string;
};
