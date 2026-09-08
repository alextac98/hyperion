import * as Y from 'yjs';

// Compare rich values, including inline formatting, independently of app converters.
export function documentState(encoded) {
  if (!encoded) return null;
  const doc = new Y.Doc();
  const value = item => {
    if (item instanceof Y.Text) return { text: item.toDelta().map(value) };
    if (item instanceof Y.Map) return Object.fromEntries([...item.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, value(entry)]));
    if (item instanceof Y.Array || Array.isArray(item)) return (item instanceof Y.Array ? item.toArray() : item).map(value);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, value(entry)]));
    return item;
  };
  try { Y.applyUpdate(doc, Buffer.from(encoded, 'base64')); return value(doc.getMap('blocks')); }
  finally { doc.destroy(); }
}

export function vaultState(db) {
  const bundle = db.repositoryExecute({ operation: 'exportVault', vaultId: 'fixture-vault' });
  const byId = items => [...items].sort((a, b) => a.id.localeCompare(b.id));
  const documents = entries => Object.fromEntries(Object.entries(entries).map(([key, encoded]) => [key, documentState(encoded)]));
  return {
    vault: bundle.vault, notes: byId(bundle.notes), collections: byId(bundle.collections),
    templates: byId(bundle.templates), preferences: bundle.preferences,
    documents: documents(bundle.editorDocuments), templateDocuments: documents(bundle.templateDocuments),
    assets: [...bundle.assets].sort((a, b) => a.key.localeCompare(b.key)), blobs: bundle.blobs,
    // Historical payloads must remain byte-for-byte intact as well as readable.
    revisions: byId(bundle.revisions).map(revision => ({ ...revision, decodedDocument: documentState(revision.document) })),
  };
}
