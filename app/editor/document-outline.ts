export type OutlineEntry = { id: string; title: string; level: number };

export type OutlineBlock = {
  id: string;
  flavour: string;
  props?: { type?: string; text?: { toString(): string } };
  text?: { toString(): string };
  children?: OutlineBlock[];
};

export function readDocumentOutline(root: OutlineBlock | null): OutlineEntry[] {
  const headings: OutlineEntry[] = [];
  const visit = (block: OutlineBlock) => {
    const heading = /^h([1-6])$/.exec(block.props?.type ?? "");
    const title = (block.props?.text ?? block.text)?.toString().trim();
    if (block.flavour === "affine:paragraph" && heading && title) {
      headings.push({ id: block.id, title, level: Number(heading[1]) });
    }
    block.children?.forEach(visit);
  };
  if (root) visit(root);
  return headings;
}

export function revealHeading(root: HTMLElement, blockId: string) {
  const block = Array.from(
    root.querySelectorAll<HTMLElement>("[data-block-id]"),
  ).find((element) => element.dataset.blockId === blockId);
  if (!block) return;
  block.scrollIntoView({ block: "start", behavior: "smooth" });
  const editable = block.querySelector<HTMLElement>('[contenteditable="true"]');
  editable?.focus({ preventScroll: true });
}
