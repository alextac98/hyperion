# Architecture

Hyperion is a desktop product. React and BlockSuite run in Electron's sandboxed
renderer; SQLite is the only supported persistence backend and is owned by the
main process. A standalone browser shows a desktop launch screen. Browser
prototype data is neither migrated nor deleted. There is no IndexedDB adapter.

## Boundaries and authority

- `app/lib/local-database.ts`: domain types, defaults, seed records and repository contract.
- `app/platform/`: typed Electron bridge and document/blob storage adapters.
- `app/lib/save-coordinator.ts`: pending writes, error reporting and retry.
- `app/lib/data-operations.ts`: editor write barrier for backups, history and restore.
- `electron/data-format.ts`: runtime validation, document transformations and hashing.
- `electron/database.ts`: transactions, migrations, records, documents, assets and revisions.
- `electron/main.ts`: trusted IPC, dialogs, storage locations and save-aware shutdown.

Yjs is authoritative for rich page content and the editor title. Note `body` and
`title` are projections used for search and navigation; initial prototype pages
without a document are seeded from those fields. Tags, hierarchy, collection
membership and lifecycle flags are domain records. IDs survive renames and moves.
UI-only preferences such as the open page and sidebar width remain localStorage
values and are not knowledge data. Vault preferences remain in SQLite.

All metadata writes are validated in the main process. Foreign keys enforce vault
ownership and same-vault parents; application checks reject hierarchy cycles,
invalid collection membership and invalid default templates. Page links may
retain the identity of deleted pages. Metadata operations involving several rows
run in one transaction. Editor compaction reads, merges and replaces updates
inside a single transaction; renderers cannot submit a stale replacement.

## SQLite migrations and durability

The database uses WAL and `synchronous=FULL`. `PRAGMA user_version` and the
`migrations` ledger version the physical schema; `storage_metadata` guards the live
document version. These are independent of document revision and
portable backup formats. Version 1 upgrades the unversioned prototype schema.
Before upgrading an existing database, Hyperion writes a verified SQLite snapshot
under `backups/migration-0-…sqlite3`. Table replacement, legacy record normalization,
relationship checks and the version update commit together. A failed upgrade
rolls back and reports the problem; it does not silently repair or discard
unrecognized data. Newer database versions are rejected before writes.

Future migrations must be ordered, transactional where practical, and tested
against prior released database fixtures, skipped-version upgrades and failures.
Do not update historical migration definitions once released. Preserve source
backups and original historical payloads when introducing document converters.

## Save and recovery lifecycle

Editor changes enqueue metadata projections; writes wait for the document source
to finish syncing to SQLite. The save coordinator tracks document and asset writes,
retains failed jobs for retry, and exposes saving/saved/error UI states. Backups,
imports, historical capture, restore and storage switching lock loaded editor
stores, drain pending work and then invoke the native operation. Window close and
app quit wait for this barrier; a save error leaves the window open.

SQLite snapshots use `VACUUM INTO` and verification before publishing a completed
file. Snapshots include all vaults, documents, assets and history. Automatic backups
run at startup and daily while the app is open; retain the latest 10. Manual and
pre-migration backups are retained. Settings → Data opens the folder or creates a
manual snapshot. Restoring a database backup writes to a separate folder, validates
it, and leaves the current database active. The storage folder chooser can open
the restored database. Copy backups off-device for protection against disk loss.

Portable vault format 9 includes metadata, independently encoded page and template
documents, immutable blobs, asset mappings and revisions. A SHA-256 checksum covers
the serialized payload; each blob has its own content hash. Import validates and
writes everything in one transaction into a separate vault, remaps page/template/
collection IDs and rich document references, and publishes nothing on failure.
Legacy formats 1–8 are accepted with an explicit missing-attachments warning.
Checksums detect accidental corruption; they are not cryptographic authentication.

## Page history

Revisions store an independent encoded document, metadata, format version, label,
capture time and immutable asset references. Yjs snapshot markers and undo stacks
are not used as durable history. Automatic capture runs every minute for changed
pages, at startup and before closing. Automatic versions expire after 30 days,
except the newest version of a page; named and pre-destructive-operation versions
are retained. Unchanged automatic captures are deduplicated.

Assets are content-addressed and cannot change under an existing key. The initial
implementation conservatively retains every vault asset in a checkpoint, including
keys marked deleted by the editor. Asset garbage collection is intentionally
conservative: blobs are retained rather than risk deleting data used by an unknown
block type. Retention therefore bounds automatic revisions, not total attachment
storage. Optimize references and reclaim unreachable blobs only with coverage for
all rich block types and historical formats.

The page History dialog previews a revision in an isolated read-only workspace.
Restore-as-copy creates a new page; in-place restore first captures the current
page and writes the old block content as fresh CRDT operations. It never merges
an old update expecting it to rewind the live document. Successful restoration
reloads the renderer to discard stale editor instances. Deleting a page preserves
a revision accessible through Settings → Data → Browse page history. Deleting a
vault removes its revision records too. Database backups may still contain it.

## Future collaboration

The storage boundary remains replaceable, but no sync outbox, server protocol,
remote backend or browser database is introduced. A future sync design must define
metadata conflicts, deletion tombstones, permissions, attribution and historical
restore behavior with concurrent editors. It must not equate a local checkpoint
with a globally synchronized revision or trust a device ID as authorship.
