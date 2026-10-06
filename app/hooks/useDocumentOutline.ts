import { useEffect, useState } from "react";
import type { EditorStore } from "../editor/editor-client";
import {
  readDocumentOutline,
  type OutlineEntry,
} from "../editor/document-outline";

export function useDocumentOutline(store: EditorStore | null) {
  const [headings, setHeadings] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    const refresh = () => {
      const next = readDocumentOutline(store?.root ?? null);
      setHeadings((previous) =>
        previous.length === next.length &&
        previous.every(
          (heading, index) =>
            heading.id === next[index].id &&
            heading.title === next[index].title &&
            heading.level === next[index].level,
        )
          ? previous
          : next,
      );
    };
    refresh();
    const subscription = store?.slots.blockUpdated.subscribe(refresh);
    return () => subscription?.unsubscribe();
  }, [store]);
  return headings;
}
