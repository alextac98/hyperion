import { useMemo, useState } from "react";
import type { PageChange } from "../lib/page-diff";
import { compareText, type DiffSegment } from "../lib/text-diff";

function DiffText({ segments, side }: { segments: DiffSegment[]; side: "before" | "after" }) {
  if (!segments.some(segment => segment.text)) return <span className="diff-empty">No text</span>;
  return <>{segments.map((segment, index) => segment.changed
    ? side === "before" ? <del key={index}>{segment.text}</del> : <ins key={index}>{segment.text}</ins>
    : <span key={index}>{segment.text}</span>)}</>;
}

export function PageDiffViewer({ changes }: { changes: PageChange[] }) {
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const rows = useMemo(() => {
    const budgetPerChange = Math.min(25, Math.floor(200 / Math.max(1, changes.length)));
    return changes.map(change => ({ ...change, text: compareText(change.before, change.after, budgetPerChange) }));
  }, [changes]);
  return <div className={`page-diff-viewer diff-${layout}`}>
    <div className="diff-toolbar"><span>{changes.length} {changes.length === 1 ? "change" : "changes"}</span><div className="diff-layout" role="group" aria-label="Diff layout"><button aria-pressed={layout === "split"} onClick={() => setLayout("split")}>Side by side</button><button aria-pressed={layout === "unified"} onClick={() => setLayout("unified")}>Unified</button></div></div>
    <p className="comparison-caption">Comparing this saved version with the current page when you opened the preview. Highlighted words show what changed.</p>
    <div className="diff-column-headings"><span>− Saved version</span><span>+ Current page</span></div>
    {rows.length === 0 ? <p className="history-empty">This version matches the current page.</p> : rows.map(change => <section className="page-change" key={change.key} aria-label={change.label}>
      <h3>{change.label}</h3>
      {change.detail && <p>{change.detail}</p>}
      {(change.before || change.after) && <div className="diff-pair">
        <div className={`diff-cell diff-before${change.text.before.some(segment => segment.changed) ? " has-changes" : ""}`} aria-label={`Saved version: ${change.label}`}><span className="diff-cell-label">− Saved version</span><div className="diff-text"><DiffText segments={change.text.before} side="before" /></div></div>
        <div className={`diff-cell diff-after${change.text.after.some(segment => segment.changed) ? " has-changes" : ""}`} aria-label={`Current page: ${change.label}`}><span className="diff-cell-label">+ Current page</span><div className="diff-text"><DiffText segments={change.text.after} side="after" /></div></div>
      </div>}
    </section>)}
  </div>;
}
