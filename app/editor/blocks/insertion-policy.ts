import { retiredBlockFlavours } from "../../../blocks/retired";

export { retiredBlockFlavours };
export const disabledSlashMenuItems: ReadonlySet<string> = new Set([
  "YouTube",
  "GitHub",
  "Figma",
  "Loom",
  "Mind Map",
  "Frame",
  "Today",
  "Tomorrow",
  "Yesterday",
  "Now",
  "Kanban View",
]);

export function canInsertSlashItem(name: string) {
  return !disabledSlashMenuItems.has(name) && !name.startsWith("Frame: ");
}
