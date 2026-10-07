# Adding a block

Hyperion's bundled custom blocks have one data registry and separate browser views.
Dates are inline text extensions, with their own specification and slash command;
they do not require a standalone block or interrupt a paragraph.

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

Use a stable namespaced ID such as `hyperion:date` or `my-extension:diagram`.
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
Use accessible labels and keyboard-operable controls. Views can implement
`onInsert()` to focus or open their controls.

## Meeting interaction

`/meeting` inserts a `hyperion:meeting` block with a title/date and three tabs:
Notes, Transcript & recording, and Summary. Notes contain a regular
`affine:note` container and use the page's native blocks, rich text, slash menu,
formatting shortcuts and undo history. Paragraphs, headings, lists, tables,
code, links and attachments use the existing page implementations and persistence.
New meetings default to today's local date, or the journal entry's stored date
when inserted into a journal. The date is saved at insertion and remains editable.
The first prototype's plain Markdown notes are preserved as text in paragraphs
when opened; initialization is atomic and idempotent, including history previews.
Native meeting controls exclude BlockSuite's range synchronization so typing
keeps its caret. Select All respects form fields and stays within meeting notes
when invoked there. Transcripts are editable text and accept
TXT, Markdown, VTT and SRT imports. Recording/import controls and playback appear
only in Transcript & recording. The summary is reserved persisted data with an
unavailable status; no automatic transcription or summary generation runs.

Settings → Blocks → Meeting stores the default tab in vault preferences.
Microphone selection uses device-local UI storage. Access is requested when the
user starts recording or explicitly refreshes microphone labels in settings.
Packaged and development macOS apps include a microphone usage description;
packaged apps also include the audio-input entitlement.

Audio imports and microphone capture use the existing blob store, with explicit
ordered `references.assets` slots named `audio-00000000`, etc. Transfers are at
most 2 MiB; recording requests chunks every five seconds. Each recorded chunk
is saved before its reference is appended to the document. Playback/download
joins the referenced chunks into a Blob. Removing audio only removes the current
reference; history and duplicate blocks can still use the asset. Imports publish
all references together after the file has been saved, so a failed import cannot
replace existing content with a partial file.

A shared recorder permits one active session and survives page navigation. The
shell displays the active session and Stop/Retry save controls. Vault switches,
data operations and desktop close wait for imports and stop/save the recorder
before locking stores. Recording metadata and chunk updates bypass undo history
so they do not interrupt note-typing undo. A failed write stops capture and keeps
pending chunks in memory for ordered retry. After an unexpected app exit, a
persisted `capturing` recording is shown as interrupted and its saved chunks can
be played, downloaded or kept. Audio since the last saved chunk cannot survive
an unexpected exit. Browser development warns before unloading an active session.

## Date interaction

Typing `//` at the start of a paragraph/list item or after whitespace searches
for Date in the existing slash picker, just like `/date`. Select Date with Enter
or a click to open the calendar. Nothing is inserted until a date is chosen.
The shortcut ignores URLs, code blocks, selected ranges, composition input and
read-only previews. The chip occupies one text position within its paragraph;
Backspace after it or Delete before it removes it in one keystroke. Surrounding
text and formatting remain in the same paragraph.

`app/editor/inline-date.ts` registers the inline spec and slash item;
`app/editor/date-picker.ts` supplies the compact popover. The Y.Text attribute
`hyperionDate` stores an ISO date on a single space. `blocks/date/inline.ts`
provides its text projection and converts legacy date cards to paragraphs.
Migration 4 applies this conversion to current pages and templates, with a
verified backup before upgrade. Import, restore and history previews apply the
same conversion; historical source payloads remain unchanged. Text/HTML/Markdown
clipboard adapters emit ISO date text for other applications. The legacy data
definition remains for compatibility with unavailable or future versions.

Choose a day, navigate months, or type `YYYY-MM-DD` or `M/D/YYYY` and press Enter
(or Apply). With an empty field, Enter confirms the selected date: today for a
new chip, or the saved date when editing one. Invalid dates stay in the field
with an error. Arrow keys move between
calendar days; Escape and Cancel dismiss the picker without changing the saved
date. Click a saved date to edit it. Dates are stored as calendar dates without a
time zone; the displayed label follows the device locale and search uses ISO text.

## Moving blocks

Hover a block to reveal its six-dot grip in the left gutter. Drag it to the
insertion line to reorder it; selected blocks move together, and nested content
stays with its parent. Text formatting, table cells and custom block properties
remain intact. A canceled drag leaves the document unchanged. Moves save through
the regular document store and support undo/redo, separately from subsequent typing.

The grip is also available at the text caret for keyboard navigation. Tab to
**Move block** and use Alt+ArrowUp or Alt+ArrowDown to move it among its siblings;
Enter or Space selects the block. History previews hide the grip and reject edits.

`app/editor/block-drag-handle.ts` adapts the native BlockSuite widget's shadow-root
styles and accessibility, with subscriptions owned by each editor scope. The page
editor supplies an explicit page mode and editor settings for hit testing and drag
previews. Keep those services when changing the editor preset.

`pnpm test:block-drag` exercises the real drag events and previews, paragraph/heading
and multi-block moves, nested lists, tables, custom meetings, formatting, undo/redo,
keyboard focus, cancellation, persistence after reopening and read-only history.
It requires a graphical desktop session (or Xvfb on Linux) and also runs as part
of `pnpm test:integration`.

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

Migration 3 removes the former Rating block from current pages/templates. Its
definition and view have been removed. Existing historical snapshots and the
pre-migration backup remain intact.

Before upgrading an existing database, Hyperion writes a verified migration backup.
The changes and version marker commit together. Existing local historical payloads
remain archival originals; previews, restores and portable imports apply the same
retirement policy, so those blocks cannot become active again. Assets and backups
are not garbage-collected by this migration.

The date commands (`Today`, `Tomorrow`, `Yesterday`, `Now`) only inserted text.
Their commands are removed; existing date prose is unchanged.

Retired schemas/views are excluded at the preset registration boundary, mind-map
providers are excluded, and the Vite compatibility adapter removes mind-map model
registration and Kanban database view registration. The `//` alias also refreshes
the existing slash menu through its current search hook after updating Y.Text;
keep the native picker test when upgrading BlockSuite. Shared upstream infrastructure
remains in the dependency. Check this adapter when upgrading BlockSuite.

## Validation

`pnpm test:blocks` also checks bounded audio transfers, ordered recording retries,
microphone denial and import barriers. `tests/meeting-smoke.mjs` exercises meeting
insertion, editing, playback, reopening and real MediaRecorder capture using a
synthetic microphone.

`pnpm test:blocks` checks registry validation, migration ordering/atomicity,
unknown data preservation, text/history projections, references and retirement.
`pnpm test:migrations` checks real SQLite upgrades, backups and rollback.
`pnpm test:integration` also runs the custom-block Electron test: slash insertion,
editing, undo/redo, indexing, reopen, read-only history, unknown children, portable
import, `//` typing without interfering with URLs, manual date validation, calendar
selection, inline deletion and the supported database view list.
