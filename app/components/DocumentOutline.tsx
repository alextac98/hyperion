import { revealHeading } from "../editor/document-outline";
import type { EditorStore } from "../editor/editor-client";
import { useDocumentOutline } from "../hooks/useDocumentOutline";

export function DocumentOutline({ store }: { store: EditorStore | null }) {
  const headings = useDocumentOutline(store);

  return (
    <section>
      <div className="details-title">
        <span>On this page</span>
        <em>{headings.length}</em>
      </div>
      <div className="outline-list">
        {headings.length ? (
          headings.map((heading) => (
            <button
              key={heading.id}
              style={{ paddingLeft: `${(heading.level - 1) * 10}px` }}
              onClick={() => {
                const editor = document.querySelector<HTMLElement>(
                  '.workspace-panel[data-workspace-active="true"] .note-workspace .blocksuite-mount',
                );
                if (editor) revealHeading(editor, heading.id);
              }}
            >
              <span className="outline-marker" />
              <span>{heading.title}</span>
            </button>
          ))
        ) : (
          <p>No headings yet</p>
        )}
      </div>
    </section>
  );
}
