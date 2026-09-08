import { useEffect, useRef, useState } from "react";
import type { NoteRecord, VaultPreferences } from "../lib/local-database";
import { openEditor, type EditorStore } from "./editor-client";
import { observeMetadata } from "./metadata-subscription";

type Props = {
  document: Pick<NoteRecord, "id" | "vaultId" | "title" | "body">;
  preferences: VaultPreferences;
  onChange: (patch: Pick<NoteRecord, "title" | "body">) => void;
  onReady?: () => void;
  onStoreReady?: (store: EditorStore) => void;
};

export function AffineEditor({
  document: editorDocument,
  preferences,
  onChange,
  onReady,
  onStoreReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const initialDocumentRef = useRef(editorDocument);
  const callbacksRef = useRef({ onChange, onReady, onStoreReady });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    callbacksRef.current = { onChange, onReady, onStoreReady };
  }, [onChange, onReady, onStoreReady]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const mount = mountRef.current;
    const initialDocument = initialDocumentRef.current;
    if (!mount) return;
    setLoading(true);
    setError(null);
    void openEditor(initialDocument)
      .then(({ runtime, view, store }) => {
        if (cancelled) return;
        const { viewport } = view.renderPageEditor(store);
        mount.replaceChildren(viewport);
        const syncTheme = () => {
          viewport.dataset.theme =
            document.documentElement.dataset.theme ?? "light";
        };
        syncTheme();
        const themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
        const stopMetadata = observeMetadata(
          (changed) => {
            const subscription = store.slots.blockUpdated.subscribe(changed);
            return () => subscription.unsubscribe();
          },
          () => runtime.readEditorMetadata(store),
          (metadata) => callbacksRef.current.onChange(metadata),
          0, // Queue projections synchronously so history/close barriers see the latest edit.
        );
        unsubscribe = () => {
          stopMetadata();
          themeObserver.disconnect();
        };
        const metadata = runtime.readEditorMetadata(store);
        if (
          metadata.title !== initialDocument.title ||
          metadata.body !== initialDocument.body
        ) {
          callbacksRef.current.onChange(metadata);
        }
        setLoading(false);
        callbacksRef.current.onStoreReady?.(store);
        callbacksRef.current.onReady?.();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.error("Could not open the block editor", cause);
        setError(
          "This page could not be opened. Your stored content has not been replaced.",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      mount.replaceChildren();
    };
  }, [attempt]);

  return (
    <div
      className={`blocksuite-mount width-${preferences.editorWidth}${loading ? " editor-loading" : ""}`}
      style={
        {
          "--hyperion-editor-font-size": `${preferences.editorFontSize}px`,
        } as React.CSSProperties
      }
      spellCheck={preferences.spellcheck}
    >
      {loading && (
        <div className="editor-opening">
          <span className="saving-spinner" />
          <span>Opening block editor…</span>
        </div>
      )}
      {error && (
        <div className="editor-opening" role="alert">
          <span>{error}</span>
          <button
            className="primary-button"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      )}
      <div ref={mountRef} className="blocksuite-mount-inner" />
    </div>
  );
}
