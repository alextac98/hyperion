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
      id: block.id, flavour: block.flavour ?? "", version: block.version ?? 1,
      props: { ...block.props, text: block.props?.text ?? block.text }, children: [],
    });
    if (outline) headings.push({ id: block.id, ...outline });
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
