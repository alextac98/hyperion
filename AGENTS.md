# Contributor instructions

## Commits and releases

Only create commits when the user explicitly asks for one. Before committing,
review the complete diff, preserve unrelated user changes, and run the checks
appropriate to the files changed.

Use Conventional Commits to keep change history clear:

- `fix: ...` for a bug fix.
- `feat: ...` for a new feature.
- `feat!: ...`, `fix!: ...`, or a `BREAKING CHANGE:` footer for a major release.
- `docs: ...`, `test: ...`, `refactor: ...`, and `chore: ...` for changes that
  do not change user-facing behavior.

Keep the subject imperative and concise. Commit messages do not trigger releases
or determine versions. Use the manual Version workflow to prepare a tested
version commit on main, and the separate manual Release workflow to publish
main's captured commit. Do not create release tags or publish releases by hand.
See docs/developer/release.md for the process.
