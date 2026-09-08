import { useEffect, useState } from "react";
import {
  readDocumentOutline,
  revealHeading,
  type OutlineEntry,
} from "../editor/document-outline";
import type { EditorStore } from "../editor/editor-client";

export function DocumentOutline({ store }: { store: EditorStore | null }) {
  const [headings, setHeadings] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    const refresh = () => setHeadings(readDocumentOutline(store?.root ?? null));
    refresh();
    const subscription = store?.slots.blockUpdated.subscribe(refresh);
    return () => subscription?.unsubscribe();
  }, [store]);

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
                  ".note-workspace .blocksuite-mount",
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
