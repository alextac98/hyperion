# Database migration regression tests

Run the migration suite with:

```sh
pnpm test:migrations
```

This builds the native TypeScript code and runs `tests/electron-migrations.test.mjs`
using Node's SQLite implementation. It does not launch Electron or touch your
normal Hyperion database. Each test copies a frozen fixture into its own temporary
directory and removes that copy afterward.

The suite is also included in `pnpm test:desktop` and therefore `pnpm test`, which
already runs in the pull-request and release quality workflows. This change does
not change release workflow ordering or repository branch-protection settings.

## What it verifies

The fixture tests open old databases through the actual `DesktopDatabase` startup
path, rather than calling a separate test migration implementation.

- **Preservation:** pages and their stable IDs, hierarchy, links, tags, collections,
  journal normalization, preferences, default templates, and rich template/page
  documents match the checked-in expected results. Rich comparisons include block
  order/type, Unicode text, inline formatting and attachment references. Blob
  bytes and mappings are checked too.
- **Historical preservation:** the version-1 fixture contains named and automatic
  snapshots. Historical metadata, IDs, dates, hashes and encoded documents must
  remain intact. A separate restore-as-copy test recovers a named snapshot and an
  editor-deleted attachment without altering the live original page.
- **Pre-upgrade backup:** the prototype upgrade must produce a SQLite backup that
  passes `integrity_check` and contains the original schema and every original row.
- **Successful completion:** the schema version and migration ledger agree with
  the supported database version; SQLite integrity and foreign-key checks pass.
- **Safe reopening:** opening the upgraded database again changes neither its
  stored state nor its migration backups.
- **Rollback:** a missing parent is introduced into a temporary prototype copy.
  The existing migration discovers it after rebuilding and repopulating tables.
  Both an initial attempt and a retry must leave the entire original schema,
  records, document updates, assets and version markers intact. Recovery backups
  must contain that same pre-upgrade state.
- **Backup failure:** a regular file blocks creation of the backup directory.
  Startup must fail before migrating any data. This avoids platform-dependent
  permission tests.
- **Forward incompatibility:** a temporary copy marked with a newer schema version
  must be rejected without changing its database bytes or creating a backup.

For live Yjs documents, comparisons use decoded values, including text formatting,
so harmless update compaction does not cause a failure. Historical payloads are
also compared in their original encoded form. Rollback checks compare every table
and schema object rather than the physical SQLite file layout, which can change
when journal settings or page layouts change.

## Frozen fixtures

`tests/fixtures/migrations/manifest.json` records provenance, schema versions,
fixture checksums and the named revision used by the restore test. These are small,
synthetic databases with no user data:

| Fixture | Origin and purpose |
| --- | --- |
| `prototype-v0.sqlite3` | Hand-built unversioned prototype tables, partial legacy records, multiple Yjs update rows and an attachment. Exercises the real upgrade and legacy normalization. |
| `desktop-v1.sqlite3` | The same synthetic data upgraded once by the recorded source commit, then extended with snapshots, a later live edit and an editor-deleted attachment. Exercises compatibility and historical recovery. |

The paired `*.expected.json` files record the reviewed data contract after opening.
`tests/migration-fixture-state.mjs` reads public repository exports and decodes Yjs
values independently of the application's document conversion helpers. It omits
only the export envelope's changing timestamp, checksum and format identifiers;
those formats have their own existing tests. It does not omit page or revision
fields. Tests verify source fixture checksums before and after use.

These are pre-release baselines, not databases claimed to come from published
releases. Source provenance is recorded in the manifest. Fixtures are closed,
self-contained SQLite files; no external WAL, shared-memory file or attachment
folder is required.

## Maintaining the suite

1. Keep existing fixture databases and their expected contracts frozen. Never
   regenerate them using the latest application to make a failing test pass.
2. Before releasing a new schema, add a representative fixture produced by that
   version, its expected JSON, and an entry in the manifest. Add fixtures rather
   than replacing the previous version. Use only synthetic data.
3. Capture a consistent database using the version being represented; close or
   checkpoint it before copying so committed data is not left in a WAL file.
   Check its SQLite integrity, record the source commit and SHA-256 checksum, and
   review the human-readable expected content as well as the binary addition.
4. Run every older fixture against the new application. If a migration intentionally
   changes the data contract, document that specific transformation and add a
   target-version expectation/assertion. Keep the original fixture and contract
   available; do not broadly loosen comparisons or silently drop fields.
5. Add regression cases for each new migration's transformations and failure paths.
   When a migration runner and successive schema versions exist, add skipped-version
   upgrades and failures at each intermediate step.

## Current limits

Today the actual startup path supports the prototype-to-version-1 migration. The
suite exercises `0 → 1` and `1 → 1`; it does not add a migration runner or pretend
to test a chain of migrations that does not yet exist. It also does not simulate
power loss, a full disk, concurrent processes or a packaged-app upgrade. Those
require separate failure-injection and desktop integration coverage. The fixtures
cover representative rich content, not every BlockSuite block type.
