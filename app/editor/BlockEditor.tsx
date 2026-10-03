import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NoteRecord, VaultPreferences } from "../lib/local-database";
import { openEditor, type EditorStore } from "./editor-client";
import { observeMetadata } from "./metadata-subscription";

type Props = {
  active?: boolean;
  document: Pick<
    NoteRecord,
    "id" | "vaultId" | "title" | "body" | "kind" | "journalDate"
  >;
  preferences: VaultPreferences;
  onChange: (patch: Pick<NoteRecord, "title" | "body">) => void;
  onReady?: () => void;
  onStoreReady?: (store: EditorStore) => void;
};

export function BlockEditor({
  active = true,
  document: editorDocument,
  preferences,
  onChange,
  onReady,
  onStoreReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const dispatcherRef = useRef<{ active: boolean } | null>(null);
  const selectionRef = useRef<Range | null>(null);
  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) {
      if (dispatcherRef.current) dispatcherRef.current.active = false;
      return;
    }
    if (dispatcherRef.current) dispatcherRef.current.active = true;
    const restoreSelection = () => {
      const range = selectionRef.current;
      if (
        !range ||
        !range.startContainer.isConnected ||
        document.activeElement?.closest('[role="tab"]') ||
        mountRef.current?.contains(document.activeElement) ||
        document.querySelector("dialog[open]")
      )
        return;
      const element =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      (
        (element?.closest("affine-page-root") ??
          element?.closest('[contenteditable="true"]')) as HTMLElement | null
      )?.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (dispatcherRef.current) dispatcherRef.current.active = true;
    };
    // Restore after the triggering key/click finishes, so opening a search
    // result with Enter cannot also insert a paragraph in the editor.
    const timer = setTimeout(restoreSelection, 0);
    return () => clearTimeout(timer);
  }, [active]);
  useEffect(() => {
    const remember = () => {
      const selection = window.getSelection();
      if (
        activeRef.current &&
        selection?.rangeCount &&
        mountRef.current?.contains(selection.anchorNode) &&
        mountRef.current?.contains(selection.focusNode)
      ) {
        selectionRef.current = selection.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);
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
    const opening = new AbortController();
    let unsubscribe: (() => void) | undefined;
    const mount = mountRef.current;
    const initialDocument = initialDocumentRef.current;
    if (!mount) return;
    setLoading(true);
    setError(null);
    void openEditor(initialDocument, opening.signal)
      .then(({ runtime, view, store }) => {
        if (cancelled) return;
        const { viewport, scope } = view.renderPageEditor(store);
        dispatcherRef.current = scope.event;
        mount.replaceChildren(viewport);
        scope.event.active = activeRef.current;
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
      opening.abort();
      unsubscribe?.();
      dispatcherRef.current = null;
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
      data-meeting-tab={preferences.meetingDefaultTab}
      data-journal-date={
        editorDocument.kind === "journal"
          ? editorDocument.journalDate ?? undefined
          : undefined
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
