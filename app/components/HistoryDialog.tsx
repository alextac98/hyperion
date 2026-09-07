import { useEffect, useRef, useState } from "react";
import type { PageRevision } from "../platform/desktop-api";
import { requireDesktop } from "../platform/runtime";
import { previewRevision, stopEditorWorkspaces } from "../editor/blocksuite-runtime";
import { dataOperation } from "../lib/data-operations";

export function HistoryDialog({ vaultId, noteId, onClose }: { vaultId: string; noteId?: string; onClose: () => void }) {
  const [versions, setVersions] = useState<PageRevision[]>([]);
  const [selected, setSelected] = useState<PageRevision | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !element) return;
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element?.focus(); element?.addEventListener("keydown", trapFocus);
    return () => { element?.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, []);
  const reload = async () => {
    const result = await requireDesktop().repositoryExecute<PageRevision[]>({ operation: "listRevisions", vaultId, noteId });
    setVersions(result);
    if (result[0]) setSelected(await requireDesktop().repositoryExecute<PageRevision>({ operation: "getRevision", vaultId, revisionId: result[0].id }));
  };
  useEffect(() => { void Promise.resolve().then(reload).catch(e => setError(String(e))); }, [vaultId, noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) return;
    let cancelled = false; let dispose: (() => void) | undefined;
    const element = mount.current;
    queueMicrotask(() => { if (!cancelled) setPreviewLoading(true); });
    void previewRevision(vaultId, selected.document, selected.note).then(result => {
      if (cancelled) { result.dispose(); return; }
      dispose = result.dispose; element?.replaceChildren(result.viewport); setPreviewLoading(false);
    }).catch(e => { if (!cancelled) { setError(String(e)); setPreviewLoading(false); } });
    return () => { cancelled = true; dispose?.(); element?.replaceChildren(); };
  }, [selected, vaultId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !working) { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [onClose, working]);
  const run = async (action: () => Promise<void>) => {
    setWorking(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  };
  const restore = (asCopy: boolean) => run(async () => {
    if (!selected) return;
    if (!asCopy && !window.confirm("Restore this version? The current page will be saved in history first.")) return;
    await dataOperation(async () => {
      const note = await requireDesktop().repositoryExecute<{ id: string }>({ operation: "restoreRevision", vaultId, revisionId: selected.id, asCopy });
      await stopEditorWorkspaces();
      localStorage.setItem(`hyperion:last-note:${vaultId}`, note.id);
      window.location.reload();
    });
  });
  return <div className="dialog-layer history-layer"><section className="history-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Page history">
    <header><div><h2>{noteId ? "Page history" : "Vault page history"}</h2><p>Automatic versions stay for 30 days. Named versions stay until you delete the vault.</p></div><button aria-label="Close history" onClick={onClose} disabled={working}>×</button></header>
    {noteId && <form onSubmit={event => { event.preventDefault(); void run(async () => { await dataOperation(() => requireDesktop().repositoryExecute({ operation: "captureRevision", vaultId, noteId, label: label.trim() })); setLabel(""); await reload(); }); }}><input aria-label="Version name" placeholder="Name this version…" value={label} onChange={e => setLabel(e.target.value)} /><button disabled={working || !label.trim()}>Save named version</button></form>}
    {error && <p role="alert" className="data-error">{error}</p>}
    <div className="history-body"><nav aria-label="Saved versions">{versions.length === 0 && <p>No versions yet. Automatic history is captured every minute when pages change.</p>}{versions.map(version => <button key={version.id} className={selected?.id === version.id ? "selected" : ""} disabled={working} onClick={() => void run(async () => { setSelected(await requireDesktop().repositoryExecute<PageRevision>({ operation: "getRevision", vaultId, revisionId: version.id })); })}><strong>{version.label || "Automatic version"}</strong>{!noteId && <span>{version.note.title}</span>}<time>{new Date(version.createdAt).toLocaleString()}</time></button>)}</nav><div className="history-preview">{selected && <div className="history-metadata"><strong>{selected.note.title}</strong><span>{selected.note.tags.join(" · ")}</span></div>}{previewLoading && <p>Opening version…</p>}<div ref={mount} /></div></div>
    <footer><span>Restoring preserves your existing history.</span><button disabled={!selected || working || previewLoading} onClick={() => void restore(true)}>Restore as a copy</button><button disabled={!selected || working || previewLoading} onClick={() => void restore(false)}>Restore this version</button></footer>
  </section></div>;
}
