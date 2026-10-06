import { projectBlock } from "../../blocks/registry";
export type OutlineEntry = { id: string; title: string; level: number };

export type OutlineBlock = {
  id: string;
  flavour: string;
  props?: Record<string, unknown>;
  version?: number;
  text?: { toString(): string };
  children?: OutlineBlock[];
};

export function readDocumentOutline(root: OutlineBlock | null): OutlineEntry[] {
  const headings: OutlineEntry[] = [];
  const visit = (block: OutlineBlock) => {
    const { outline } = projectBlock({
      id: block.id,
      flavour: block.flavour ?? "",
      version: block.version ?? 1,
      props: { ...block.props, text: block.props?.text ?? block.text },
      children: [],
    });
    if (outline) headings.push({ id: block.id, ...outline });
    block.children?.forEach(visit);
  };
  if (root) visit(root);
  return headings;
}

export function revealHeading(
  root: HTMLElement,
  blockId: string,
  behavior: ScrollBehavior = "smooth",
) {
  const block = Array.from(
    root.querySelectorAll<HTMLElement>("[data-block-id]"),
  ).find((element) => element.dataset.blockId === blockId);
  if (!block) return;
  const scroll = () =>
    block.scrollIntoView({
      block: "start",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : behavior,
    });
  const editable = block.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editable) {
    scroll();
    return;
  }
  // BlockSuite's text fields are nested inside its editable page root.
  // Focus that root, then place the caret in the chosen heading.
  const focusTarget =
    editable.closest<HTMLElement>("affine-page-root") ?? editable;
  focusTarget.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    const walker = document.createTreeWalker(
      editable,
      window.NodeFilter.SHOW_TEXT,
    );
    let text = walker.nextNode();
    while (text && !text.textContent?.trim()) text = walker.nextNode();
    if (text) range.setStart(text, 0);
    else range.selectNodeContents(editable);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  scroll();
}
