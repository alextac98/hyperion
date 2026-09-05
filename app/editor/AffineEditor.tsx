import { useEffect, useRef, useState } from "react";
import type { NoteRecord, VaultPreferences } from "../lib/local-database";
import {
  type EditorStore,
  getOrCreateEditorStore,
  readEditorMetadata,
  renderPageEditor,
} from "./blocksuite-runtime";

type Props = {
  document: Pick<NoteRecord, "id" | "vaultId" | "title" | "body">;
  preferences: VaultPreferences;
  onChange: (patch: Pick<NoteRecord, "title" | "body">) => void;
  onReady?: () => void;
  onStoreReady?: (store: EditorStore) => void;
};

export function AffineEditor({ document: editorDocument, preferences, onChange, onReady, onStoreReady }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const initialDocumentRef = useRef(editorDocument);
  const callbacksRef = useRef({ onChange, onReady, onStoreReady });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callbacksRef.current = { onChange, onReady, onStoreReady };
  }, [onChange, onReady, onStoreReady]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const mount = mountRef.current;
    const initialDocument = initialDocumentRef.current;
    if (!mount) return;

    void getOrCreateEditorStore(
      initialDocument.vaultId,
      initialDocument.id,
      initialDocument.title,
      initialDocument.body,
    )
      .then((store) => {
        if (cancelled) return;
        const { viewport } = renderPageEditor(store);
        mount.replaceChildren(viewport);
        const subscription = store.slots.blockUpdated.subscribe(() => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => callbacksRef.current.onChange(readEditorMetadata(store)), 220);
        });
        unsubscribe = () => subscription.unsubscribe();
        const metadata = readEditorMetadata(store);
        if (metadata.title !== initialDocument.title || metadata.body !== initialDocument.body) {
          callbacksRef.current.onChange(metadata);
        }
        setLoading(false);
        callbacksRef.current.onStoreReady?.(store);
        callbacksRef.current.onReady?.();
      })
      .catch((error) => {
        console.error("Could not open the block editor", error);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      mount.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const viewport = mountRef.current?.querySelector<HTMLElement>(".affine-page-viewport");
    if (viewport) {
      viewport.dataset.theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    }
  }, [preferences.theme]);

  return (
    <div
      className={`blocksuite-mount width-${preferences.editorWidth}${loading ? " editor-loading" : ""}`}
      style={{ "--hyperion-editor-font-size": `${preferences.editorFontSize}px` } as React.CSSProperties}
      spellCheck={preferences.spellcheck}
    >
      {loading && (
        <div className="editor-opening">
          <span className="saving-spinner" />
          <span>Opening block editor…</span>
        </div>
      )}
      <div ref={mountRef} className="blocksuite-mount-inner" />
    </div>
  );
}
