# Adding a block

Hyperion's bundled custom blocks have one data registry and separate browser views.
The first example is `hyperion:rating`: an editable label and a score from zero
(unrated) to five, available through `/rating`.

## Files and responsibilities

- `blocks/contract.ts` defines the persisted data, projection, references and migration contract.
- `blocks/registry.ts` registers bundled definitions and supplies shared text/outline projections.
- `blocks/document.ts` reads raw Yjs data and applies version migrations without needing the DOM.
- `blocks/<name>/definition.ts` describes a block's properties, validation, insertion and projection.
- `blocks/<name>/view.ts` exports `flavour`, `tagName` and a Lit `component`.
- `app/editor/blocks/` adapts definitions into BlockSuite schemas, slash commands and views.

Add a definition to `blockRegistry`; the editor discovers its `view.ts` by folder
convention. The registry must never import browser views. Both Electron and the
renderer consume its data definitions, so metadata and history descriptions agree.
Existing upstream blocks still use the editor preset and a compatibility projection.
They do not need to be rewritten to adopt this contract for new blocks.

## Block contract

Use a stable namespaced ID such as `hyperion:rating` or `my-extension:diagram`.
Duplicate IDs, invalid defaults and invalid versions fail registration. Do not
rename an ID once documents contain it. The upstream namespace is reserved.

A definition provides:

- `version`, `defaults()` and `validate(props)` for persisted properties.
- `project(block)` returning searchable text and optionally an outline title/level.
  Search, editor metadata, history descriptions and page diffs share this projection.
- Optional `insertion` metadata for the slash menu: description, aliases and icon.
- Optional parent/child constraints; the default is a content block with no children.
- Optional `migrations`, keyed by the old version, each advancing exactly one version.

Views use `store.updateBlock` so editing participates in Yjs persistence and undo.
Respect `store.readonly` for history previews. Group a discrete action with
`captureSync()` before and after it; group label typing at focus/blur boundaries.
Use accessible labels and keyboard-operable controls. See the rating view for an example.

## References and assets

Reserve `props.references` for explicit reference slots:

```ts
references: {
  pages: { related: 'page-id' },
  assets: { cover: 'asset-key' },
}
```

Portable imports remap `references.pages` for custom blocks, including unavailable
ones. They preserve ordinary strings even when a string happens to equal a page ID.
Asset slots feed asset validation; existing asset keys are preserved on import.
Store attachments through the editor's blob storage. References outside this envelope
need an explicit adapter; do not rely on searching arbitrary strings for IDs.
Upstream blocks retain their legacy remapping rules for compatibility.

## Versions and unavailable implementations

Migrations run before BlockSuite constructs models, including for isolated history
previews. They operate on detached JSON properties and validate all results before
writing. Missing steps, invalid results or unsupported rich values fail without
partially changing the document. Preserve additional properties in each step.
Rich Yjs properties need an explicit migration adapter; the generic converter
rejects them rather than flattening text or losing formatting.

Unknown blocks and newer versions keep their raw properties, references, formatting
and children. The editor supplies an opaque schema and an unavailable-block card;
children remain visible. Generic duplication, restore and export/import preserve
the payload. Removing an implementation is different from intentionally retiring
content: unavailable blocks are never silently deleted.

This is a bundled extension contract, not an installable plugin runtime. There is
no external code loader, package installer, permissions model or sandbox yet.

## Retired content

SQLite migration 2 removes YouTube, GitHub, Figma and Loom embeds, frames, mind maps
and Kanban views from all current page and template documents. A mixed database
keeps its table views and shared rows. A database with only Kanban views and its
owned row blocks are deleted. Mind-map node elements and connectors targeting
removed elements are deleted; unrelated shapes inside a frame remain. Parent lists,
surface references and group membership are repaired.

Before upgrading an existing database, Hyperion writes a verified migration backup.
The changes and version marker commit together. Existing local historical payloads
remain archival originals; previews, restores and portable imports apply the same
retirement policy, so those blocks cannot become active again. Assets and backups
are not garbage-collected by this migration.

The date commands (`Today`, `Tomorrow`, `Yesterday`, `Now`) only inserted text.
Their commands are removed; existing date prose is unchanged.

Retired schemas/views are excluded at the preset registration boundary, mind-map
providers are excluded, and the Vite compatibility adapter removes mind-map model
registration and Kanban database view registration. Shared upstream infrastructure
remains in the dependency. Check this adapter when upgrading BlockSuite.

## Validation

`pnpm test:blocks` checks registry validation, migration ordering/atomicity,
unknown data preservation, text/history projections, references and retirement.
`pnpm test:migrations` checks real SQLite upgrades, backups and rollback.
`pnpm test:integration` also runs the custom-block Electron test: slash insertion,
editing, undo/redo, indexing, reopen, read-only history, unknown children, portable
import and the supported database view list.
