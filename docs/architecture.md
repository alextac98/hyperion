# Architecture

Hyperion is browser-first and local-first. It keeps knowledge data on the
user's device and does not depend on an application server or remote database.

## Data model

All knowledge data is accessed through the `KnowledgeRepository` interface in
`app/lib/local-database.ts`. The browser implementation stores vault metadata
in IndexedDB. BlockSuite stores each vault's Yjs editor documents and local
assets in separate IndexedDB databases.

Pages form the Organize hierarchy through `NoteRecord.parentId`, while
`NoteRecord.sortOrder` preserves user-defined sibling order. A page is both
editable content and a potential parent, so the tree does not need a separate
folder entity. Tree rows accept drops before, inside, or after another page.
Legacy collections remain in backups for compatibility and are converted to
editable parent pages during the IndexedDB v4 migration. IndexedDB v6 adds
persisted page order for existing vaults.

`NoteRecord.icon` is optional display metadata attached to the page itself. It
can hold either a Unicode emoji or a named, colored interface icon, and travels
with the page when the hierarchy or title changes. It is rendered in the
Organize tree, page links, search, and library views. IndexedDB v8 upgrades the
original string-only icon field to structured data, and vault backup format v5
preserves both icon variants across export and import. The emoji picker reads
the localized Unicode Emoji 17 catalog from `emojibase-data`, including the
full macOS category set, searchable CLDR names and keywords, flags, joined
sequences, and skin-tone variants.

Page identity is independent from both hierarchy and display name. The
permanent `NoteRecord.id` is the target for stored page links, `parentId` can
change whenever a page is dragged, and `title` can change without rewriting
links. Previous stable titles are retained in `aliases` so old names remain
searchable and newly encountered wiki references can still be resolved. Inline
`[[Page name]]` references are reconciled to `PageLinkRecord.targetId` values;
manual quick links use the same target IDs. IndexedDB v5 adds these identity
fields, and vault backup format v3 remaps both parent and link IDs on import.

The repository boundary can support other storage implementations in the
future. For example, a desktop shell could provide SQLite and filesystem
adapters without changing the editor and navigation surfaces.
