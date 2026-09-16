import type { View } from "./navigation";

export type NavigationLocation =
  | { view: "note" | "template"; id: string }
  | { view: "tags"; tag: string | null }
  | { view: Exclude<View, "note" | "template" | "tags"> };
export type NavigationDirection = "back" | "forward";

function sameLocation(a: NavigationLocation, b: NavigationLocation) {
  return (
    a.view === b.view &&
    ("id" in a
      ? "id" in b && a.id === b.id
      : "tag" in a
        ? "tag" in b && a.tag === b.tag
        : true)
  );
}

/** In-memory, vault-local history; visiting after Back discards the forward branch. */
export class NavigationHistory {
  private entries: NavigationLocation[] = [];
  private index = -1;

  visit(location: NavigationLocation) {
    const current = this.entries[this.index];
    if (current && sameLocation(current, location)) return;
    this.entries = [...this.entries.slice(0, this.index + 1), location].slice(
      -100,
    );
    this.index = this.entries.length - 1;
  }

  move(
    direction: NavigationDirection,
    available: (location: NavigationLocation) => boolean,
  ) {
    const step = direction === "back" ? -1 : 1;
    for (
      let next = this.index + step;
      next >= 0 && next < this.entries.length;
      next += step
    ) {
      if (!available(this.entries[next])) continue;
      this.index = next;
      return this.entries[next];
    }
    return null;
  }
}
