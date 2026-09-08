export type PageSearchMatch = { range: Range; element: HTMLElement };

export function findTextMatches(
  root: HTMLElement,
  query: string,
): PageSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const matches: PageSearchMatch[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const pattern = new RegExp(
        needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "giu",
      );
      for (const match of text.matchAll(pattern)) {
        const index = match.index;
        const element = node.parentElement;
        if (element) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + match[0].length);
          matches.push({ range, element });
        }
      }
      return;
    }
    if (node instanceof Element && node.shadowRoot) visit(node.shadowRoot);
    node.childNodes.forEach(visit);
  };

  visit(root);
  return matches;
}

export function updatePageSearchHighlights(
  matches: PageSearchMatch[],
  activeIndex: number,
) {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  if (!document.getElementById("hyperion-page-search-highlights")) {
    const styles = document.createElement("style");
    styles.id = "hyperion-page-search-highlights";
    styles.textContent =
      "::highlight(hyperion-page-search){color:inherit;background:rgb(240 201 77 / 55%)}::highlight(hyperion-page-search-active){color:inherit;background:#f0b429}";
    document.head.append(styles);
  }
  CSS.highlights.delete("hyperion-page-search");
  CSS.highlights.delete("hyperion-page-search-active");
  if (!matches.length) return;
  CSS.highlights.set(
    "hyperion-page-search",
    new Highlight(...matches.map(({ range }) => range)),
  );
  const active = matches[activeIndex];
  if (active)
    CSS.highlights.set(
      "hyperion-page-search-active",
      new Highlight(active.range),
    );
}

export function revealPageSearchMatch(match: PageSearchMatch) {
  match.element.scrollIntoView({ block: "center", behavior: "smooth" });
}
