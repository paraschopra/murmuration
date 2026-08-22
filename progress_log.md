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

## 2026-08-22T10:40:00+05:30

- Committed the verified per-tab blank mode as `d1aac02` (`Add per-tab blank mode`).
- Added synced settings for 1–20 chat titles per generation and an editable prompt template using `{{topics}}`; retained three titles and the existing prompt as defaults.
- Added a Reset Prompt control and generation tests for validation, placeholder substitution, and request payload behavior.
- Verified with `node tests/test-art-generator.js` (61 passed), `node tests/test-options.js` (79 passed), `node tests/test-background.js` (15 passed), and `git diff --check`.
- Next: checkpoint generation preferences, then add artifact download and purge actions.
