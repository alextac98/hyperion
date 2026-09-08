import { useEffect, useMemo, useRef, useState } from "react";
import type { PageComparison, PageRevision, PageSnapshot, RevisionCapture } from "../platform/desktop-api";
import { requireDesktop } from "../platform/runtime";
import { previewRevision, stopEditorWorkspaces } from "../editor/editor-client";
import { dataOperation } from "../lib/data-operations";
import { PageDiffViewer } from "./PageDiffViewer";
import { pageChanges } from "../lib/page-diff";

export function PageHistory({ vaultId, noteId, selectedId, onSelect }: { vaultId: string; noteId: string; selectedId?: string; onSelect: (comparison: PageComparison) => void }) {
  const [versions, setVersions] = useState<PageRevision[]>([]);
  const [label, setLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const reload = async () => {
      const request = ++generation.current;
      try {
        const result = await requireDesktop().repositoryExecute<PageRevision[]>({ operation: "listRevisions", vaultId, noteId });
        if (mounted.current && request === generation.current) { setVersions(result); setLoading(false); }
      } catch (e) { if (mounted.current) { setError(String(e)); setLoading(false); } }
    };
    void reload();
    const timer = setInterval(() => void reload(), 60_000);
    window.addEventListener("focus", reload);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("focus", reload); };
  }, [vaultId, noteId]);
  const run = async (action: () => Promise<void>) => {
    setWorking(true); setError(""); setNotice("");
    try { await action(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setWorking(false); }
  };
  const select = async (revisionId: string) => {
    const comparison = await dataOperation(() => requireDesktop().repositoryExecute<PageComparison>({ operation: "compareRevision", vaultId, noteId, revisionId }));
    if (mounted.current) onSelect(comparison);
  };
  return <div className="page-history">
    <p className="history-retention">Automatic versions stay for 30 days. Named versions are kept indefinitely.</p>
    <form onSubmit={event => { event.preventDefault(); if (working || !label.trim()) return; void run(async () => {
      const revision = await dataOperation(() => requireDesktop().repositoryExecute<RevisionCapture>({ operation: "captureRevision", vaultId, noteId, label: label.trim() }));
      generation.current++;
      const result = await requireDesktop().repositoryExecute<PageRevision[]>({ operation: "listRevisions", vaultId, noteId });
      if (!mounted.current) return;
      setVersions(result); setLabel("");
      setNotice(revision.captureStatus === "created" ? "Version saved." : revision.captureStatus === "named" ? "Named the existing version. No duplicate was created." : "No changes since the latest version. Using that version instead.");
      await select(revision.id);
    }); }}>
      <input aria-label="Version name" placeholder="Name this version…" value={label} disabled={working} onChange={event => setLabel(event.target.value)} />
      <button disabled={working || !label.trim()}>Save named version</button>
    </form>
    {notice && <p className="history-retention" role="status">{notice}</p>}
    {error && <p className="data-error" role="alert">{error}</p>}
    <nav aria-label="Saved versions" aria-busy={working || loading}>
      {loading ? <p>Loading versions…</p> : versions.length === 0 && <p>No versions yet. Save a named version now, or keep editing for automatic history.</p>}
      {versions.map(version => <button key={version.id} aria-pressed={selectedId === version.id} disabled={working} onClick={() => void run(() => select(version.id))}><strong>{version.label || "Automatic version"}</strong><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time><span>{selectedId === version.id ? "Viewing changes" : "Compare with current page"}</span></button>)}
    </nav>
  </div>;
}

function SnapshotPreview({ vaultId, snapshot }: { vaultId: string; snapshot: PageSnapshot }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false; let dispose: (() => void) | undefined;
    const element = mount.current;
    void previewRevision(vaultId, snapshot.document, snapshot.note).then(result => {
      if (cancelled) { result.dispose(); return; }
      dispose = result.dispose; element?.replaceChildren(result.viewport); setLoading(false);
    }).catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; dispose?.(); element?.replaceChildren(); };
  }, [vaultId, snapshot]);
  return <div className="history-preview">{loading && <p role="status">Opening version…</p>}{error && <p role="alert" className="data-error">{error}</p>}<div ref={mount} /></div>;
}

export function PageHistoryPreview({ comparison, onClose }: { comparison: PageComparison; onClose: () => void }) {
  const { revision, current } = comparison;
  const [tab, setTab] = useState<"changes" | "saved" | "current">("changes");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const changes = useMemo(() => {
    try { return { items: pageChanges(revision, current), error: "" }; }
    catch { return { items: [], error: "Could not compare this document. Use the saved and current page previews to inspect it." }; }
  }, [revision, current]);
  const restore = async (asCopy: boolean) => {
    if (working) return;
    if (!asCopy && !window.confirm("Restore this version? The current page will be saved in history first.")) return;
    setWorking(true); setError("");
    try {
      await dataOperation(async () => {
        const note = await requireDesktop().repositoryExecute<{ id: string }>({ operation: "restoreRevision", vaultId: revision.vaultId, revisionId: revision.id, asCopy });
        await stopEditorWorkspaces();
        localStorage.setItem(`hyperion:last-note:${revision.vaultId}`, note.id);
        window.location.reload();
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setWorking(false); }
  };
  return <article className="page-comparison" aria-label="Page version comparison">
    <header><div><span className="history-eyebrow">Page history</span><h1>{revision.label || "Automatic version"}</h1><p>{new Date(revision.createdAt).toLocaleString()}</p></div><button onClick={onClose} disabled={working}>Back to editing</button></header>
    <div className="comparison-tabs" aria-label="Version preview">{([['changes', 'Changes'], ['saved', 'Saved page'], ['current', 'Current page']] as const).map(([value, title]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{title}</button>)}</div>
    {tab === "changes" ? <div className="page-changes">
      {changes.error ? <p role="alert">{changes.error}</p> : <PageDiffViewer changes={changes.items} />}
    </div> : <SnapshotPreview key={`${revision.id}:${tab}`} vaultId={revision.vaultId} snapshot={tab === "saved" ? revision : current} />}
    {error && <p role="alert" className="data-error">{error}</p>}
    <footer><p>Restoring saves the current page in history first.</p><div><button disabled={working} onClick={() => void restore(true)}>Restore as a copy</button><button className="restore-version" disabled={working} onClick={() => void restore(false)}>Restore this version</button></div></footer>
  </article>;
}
