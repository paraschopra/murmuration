# Progress log

## 2026-08-22T10:23:12+05:30

- Started implementation of per-tab blank mode, configurable title count and art prompt, artifact download, and artifact purge.
- Confirmed the repository is tracked by Git and the worktree was clean before changes.
- Next: map the existing generation, storage, new-tab, settings, and test flows.

## 2026-08-22T10:31:00+05:30

- Mapped the extension flow: the service worker selects titles and generates artifacts; the new-tab page displays a sandboxed artifact; Settings manages synced preferences and local statistics.
- Added a per-tab blank state. Entering it navigates the art iframe to `about:blank` to stop the animation; a deliberately hidden-until-hover control restores art in that same tab.
- Verified with `node tests/test-newtab.js` (84 passed) and `git diff --check`.
- Next: checkpoint the blank-page feature, then add generation preferences.
