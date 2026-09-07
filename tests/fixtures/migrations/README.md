# Frozen migration fixtures

These SQLite files contain synthetic test data, never personal vault data.
Do not open the originals with Hyperion; the test suite copies them to temporary
folders. Do not regenerate old fixtures when the application changes.

`manifest.json` records the source commit, schema versions and database SHA-256
checksums. Paired `*.expected.json` files preserve the expected data contract.
The prototype fixture has no history because that format predates snapshots; the
version-1 fixture adds named/automatic history and a recoverable deleted asset.

See [Database migration regression tests](../../../docs/migration-tests.md) for
commands, coverage, limitations and instructions for adding future fixtures.
