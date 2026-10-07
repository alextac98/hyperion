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

export type WindowLocation = z.infer<typeof windowLocation>;
export type DetachedTabRequest = z.infer<typeof detachedTabRequest>;
export type WindowSession = {
  id: string;
  vaultId: string | null;
  location: WindowLocation | null;
};

export type EditorUpdate = {
  vaultId: string;
  documentId: string;
  data: string;
};
