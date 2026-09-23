---
name: release
description: Prepare a Hyperion release by testing the candidate and database upgrades, reviewing changes since the last published release, selecting a version bump, and preparing or opening a release MR/PR with evidence. Use for release readiness and preparation; publication is a separate action.
---

# Release preparation

Follow the user's process: validate the candidate, explain the changes, choose a
version, then prepare a reviewable MR (called a PR on GitHub). Finish with its link
or a concrete local draft and any remaining blockers. Do not claim that tests
prove there are no possible failures.

Resolve repository paths below from the repository root. Read `AGENTS.md`,
`docs/developer/release.md`, `docs/migration-tests.md`, `package.json`, and the
current `.github/workflows/{pull-request,version,release}.yml` before acting.
These files are authoritative for commands and release mechanics; do not freeze
current version numbers, schema versions, or platform lists into this skill.

## 1. Establish the candidate and test it

- Inspect the worktree, branch, remotes, and existing release-preparation PRs.
  Preserve unrelated work. Use an isolated worktree if necessary.
- Identify the latest published release in the intended release channel through
  the repository host, resolve its tag to a commit, and record that baseline and
  the candidate SHA. Do not assume the latest local tag or `package.json` version
  is the latest published release. If host access is unavailable, label the
  baseline provisional; if no release exists, review the initial release scope.
- Inspect the full baseline-to-candidate diff to identify risk before testing.
  Include pending candidate changes explicitly; record them separately from the
  SHA until committed. Review data storage, content conversion, save/restart,
  import/export, vault handling, dependencies, packaging, and update behavior
  where affected, even when no schema version changed.
- Use the package manager pinned in `package.json` and a Node version compatible
  with the checked-in workflows. Install with `pnpm install --frozen-lockfile`.
  Run the current release quality gate; at the time of writing it is:

  ```sh
  pnpm lint
  pnpm test
  pnpm check:desktop
  ```

  `pnpm test` already includes the migration suite through `test:desktop`.
  Use `pnpm test:migrations` for targeted diagnosis or reruns after migration
  changes, rather than counting it as independent extra coverage.
- Inspect migration assertions as well as their exit status. Verify older
  supported schemas and skipped-version upgrades, preservation of documents,
  attachments and history, pre-upgrade backups, integrity/foreign-key checks,
  safe reopening, transactional rollback/retry, backup failure, and rejection
  of newer schemas. For changed transformations, add focused regression cases
  for the expected content and failure paths. Follow `docs/migration-tests.md`
  when adding schema fixtures; keep existing fixtures and contracts frozen.
- Run migration experiments only against synthetic fixtures or disposable,
  consistent database copies. Never point test builds at the user's live vault
  or profile. Do not regenerate old fixtures or weaken assertions to pass tests.
  Explain intentional content removal or conversion and the recovery path.
- Exercise affected desktop flows in an isolated profile: startup, edit/save,
  reopen, and the changed features. Use `pnpm test:integration` and
  `pnpm test:updates` where relevant; use `pnpm test:development` for changes to
  development startup. Inspect the test launchers before additional manual runs
  to establish how their data directories are isolated.
- For packaging/update changes or substantial migration risk, test an appropriate
  packaged candidate and an upgrade from the previous release using disposable
  data when the environment supports it. Check current platform targets and
  record which were actually exercised. The simulated update preview does not
  validate real downloads, signatures, differential updates, or binary replacement.
- Record commands, outcomes, environment, candidate identity, and untested cases.
  Distinguish failures from checks unavailable on this machine. Investigate
  failures, make in-scope fixes with regression coverage, and rerun affected
  checks plus required gates on the final candidate. Unresolved failures and
  data-loss risks block a ready recommendation; a draft PR can document them.
  Never silently waive failures or label skipped checks as passing.

## 2. Describe what will ship

Review the full diff and relevant merged PRs since the published baseline, not
just commit titles. Produce user-facing release notes grouped into features,
fixes, breaking changes, and upgrade/data changes as applicable. Separate
internal maintenance from user-visible behavior. Cite relevant PRs or files,
explain removed behavior and required user actions, and identify known issues.

Summarize release risk with concrete evidence: affected paths, tests that cover
them, and remaining gaps (for example, power loss or unavailable platform tests).
Describe backup recovery and downgrade limits based on the code and observed
behavior. Do not promise that an older binary can open a migrated database or
suggest deleting user data as a rollback procedure.

## 3. Choose a version

Compare the published version, candidate `package.json`, existing tags/releases,
and changes that will actually ship. Recommend an exact next version and explain
why: patch for compatible fixes, minor for compatible features, major for breaking
changes. For a `0.x` release, state the chosen compatibility convention explicitly
and call out breaking changes regardless of the numeric bump. Respect an explicit
user version choice after checking it is valid and newer than published versions.
Conventional Commit messages are evidence, not an automatic versioning rule.

The repository's Version workflow prepares and tests a version commit on `main`;
the Release workflow later publishes the captured `main` SHA. Preparing this PR
must not dispatch either workflow. Normally put the proposed version and bump
in the PR, then use Version after review/merge. If `package.json` is already at the
intended version, explain that no additional bump is needed. The release guide
also describes manual version editing, but `AGENTS.md` directs use of Version;
do not silently switch paths or bump twice. If the user explicitly requests a
manual bump, update only the required version files and validate the final diff.

## 4. Prepare and open the release MR/PR

Use the repository's PR template if present; otherwise include:

- **Candidate:** baseline release/tag and SHA, candidate SHA, target branch, and
  any pending changes not represented by that SHA.
- **Version:** current published and package versions, proposed next version,
  bump type, compatibility rationale, and whether a version update is pending.
- **Release notes:** features, fixes, breaking changes, upgrade instructions.
- **Validation:** commands and outcomes, environment/platform coverage, migration
  evidence, manual smoke checks, and checks still required.
- **Risks and recovery:** known issues, blockers, backup/restore evidence, and
  downgrade limitations.
- **Release handoff:** after review/merge, prepare the version once, check the
  final `main` candidate, run the manual Release workflow only when requested,
  then smoke-test published installers. New intervening changes require review
  and appropriate validation; earlier evidence applies only to its candidate.

Prefer an existing preparation branch/PR when it represents the same work. For
new preparation work, use a focused branch targeting the repository's release
branch (currently `main`). If there are no code or version changes to review,
add a useful release report at `docs/releases/<proposed-version>.md` so the PR has
an actual reviewable diff; keep it consistent with the PR description. Do not
create an empty PR or make unrelated changes just to open one.

Review the complete diff and preserve unrelated changes before any commit.
`AGENTS.md` permits commits only when explicitly requested: release preparation
or a request to open a PR alone does not override that restriction. Finish all
local preparation first; if a commit is still needed and not authorized, provide
the draft and ask specifically for commit authorization, citing that rule. With
commit authorization and a request to open the PR, commit the relevant files
using a concise Conventional Commit subject, push the preparation branch, and
open the PR. Use a draft if blockers remain. For multiline PR bodies, use a
structured tool argument or `gh pr create --body-file` with an actual text file.

If hosting access or authorization is unavailable, leave the completed report,
proposed title/body, and the precise remaining action. Do not pretend a PR was
opened. Stop after the review handoff: no merge, workflow dispatch, release tag,
or publication is implied by preparing a release. Never hand-publish releases
or create release tags outside the documented workflow.

## Improve the skill from use

When an actual release exposes missing coverage or a repeatable failure, propose
or make a narrow update to this skill when requested. Keep changing release
mechanics in the linked repository documentation, and avoid adding speculative
checklists or stale copies of workflow configuration.
