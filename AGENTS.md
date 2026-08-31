# Contributor instructions

## Commits and releases

Only create commits when the user explicitly asks for one. Before committing,
review the complete diff, preserve unrelated user changes, and run the checks
appropriate to the files changed.

Use Conventional Commits because Release Please derives versions and release
notes from commit messages:

- `fix: ...` for a patch release.
- `feat: ...` for a minor release.
- `feat!: ...`, `fix!: ...`, or a `BREAKING CHANGE:` footer for a major release.
- `docs: ...`, `test: ...`, `refactor: ...`, and `chore: ...` for changes that
  should not trigger a release by themselves.

Keep the subject imperative and concise. Do not manually edit release versions,
create release tags, or publish GitHub Releases during normal development.
Release Please owns those steps through its generated release pull request.
