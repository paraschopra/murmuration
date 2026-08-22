# Progress log

## 2026-08-22T10:23:12+05:30

- Started implementation of per-tab blank mode, configurable title count and art prompt, artifact download, and artifact purge.
- Confirmed the repository is tracked by Git and the worktree was clean before changes.
- Next: map the existing generation, storage, new-tab, settings, and test flows.

## 2026-08-22T10:25:05+05:30

- Mapped the extension flow: the service worker selects titles and generates artifacts; the new-tab page displays a sandboxed artifact; Settings manages synced preferences and local statistics.
- Added a per-tab blank state. Entering it navigates the art iframe to `about:blank` to stop the animation; a deliberately hidden-until-hover control restores art in that same tab.
- Verified with `node tests/test-newtab.js` (84 passed) and `git diff --check`.
- Next: checkpoint the blank-page feature, then add generation preferences.

## 2026-08-22T10:27:00+05:30

- Committed the verified per-tab blank mode as `d1aac02` (`Add per-tab blank mode`).
- Added synced settings for 1–20 chat titles per generation and an editable prompt template using `{{topics}}`; retained three titles and the existing prompt as defaults.
- Added a Reset Prompt control and generation tests for validation, placeholder substitution, and request payload behavior.
- Verified with `node tests/test-art-generator.js` (61 passed), `node tests/test-options.js` (79 passed), `node tests/test-background.js` (15 passed), and `git diff --check`.
- Next: checkpoint generation preferences, then add artifact download and purge actions.

## 2026-08-22T10:28:45+05:30

- Committed configurable title count and prompt settings as `3f4dd3e` (`Make generation prompt and topic count configurable`).
- Added a dependency-free ZIP builder that packages each cached artifact as a separate HTML file for a single reliable download.
- Added a confirmed purge action that clears only cached artifacts and refreshes Settings status; conversations, statistics, and daily limits are preserved.
- Verified with `node tests/test-storage.js` (73 passed), `node tests/test-artifact-archive.js` (11 passed), `node tests/test-options.js` (88 passed), and `git diff --check`.
- Next: checkpoint archive management, update documentation, and run the full suite.

## 2026-08-22T10:30:00+05:30

- Committed HTML archive download and confirmed purge controls as `95bc07a` (`Add generated art download and purge controls`).
- Updated README structure, test commands, configuration reference, blank-mode usage, and purge/daily-limit behavior.
- Next: run the complete automated suite and review the final diff/worktree.

## 2026-08-22T10:30:56+05:30

- Full suite passed: 416 assertions across all nine test files, with zero failures.
- Final review found no hard-coded three-title generation path, no new manifest permission requirement, and no whitespace errors.
- Status: requested features are implemented and verified. Next user step is to reload the unpacked extension and perform a browser smoke test with real stored art.

## 2026-08-22T10:40:42+05:30

- Began follow-up after confirming purge currently retains today's generation count, which can prevent replacement art at the daily limit.
- Planned behavior: purge artifacts, reset today's successful-generation allowance, request one fresh generation when API credentials and conversation titles exist, and report the result in Settings.
- Also adding Settings and per-tab Blank Page actions to the `No art yet` state.

## 2026-08-22T10:41:49+05:30

- Purge now clears cached artifacts and today's generation count, then requests a fresh artifact when an API key and synced titles are available.
- Settings reports generating, success, missing-configuration, and 30-second timeout states after purge.
- Verified storage behavior with 77 passing assertions and Settings integration with 91 passing assertions; `git diff --check` passed.
- Next: checkpoint purge regeneration and add controls to the no-art state.

## 2026-08-22T10:42:52+05:30

- Committed purge-triggered regeneration as `eda3279` (`Regenerate fresh art after purge`).
- Added visible Settings and Blank Page buttons to the `No art yet` state.
- Centralized per-tab blank restoration so it returns to the correct prior state and still stops any iframe animation via `about:blank`.
- Verified the new-tab UI with 92 passing assertions and `git diff --check`.
- Next: checkpoint the no-art controls, update documentation, and run the full suite.

## 2026-08-22T10:43:32+05:30

- Committed no-art Settings/Blank Page controls as `5e00b32` (`Add controls to the no-art state`).
- Updated README to describe purge-triggered regeneration, visible status feedback, and no-art screen actions.
- Next: run all automated tests and review the final worktree.

## 2026-08-22T10:43:55+05:30

- Full regression suite passed: 431 assertions across all nine test files, with zero failures.
- Final diff review and `git diff --check` passed.
- Status: follow-up is complete. Reload the unpacked extension before browser-testing purge regeneration and the no-art controls.

## 2026-08-22T10:47:15+05:30

- Diagnosed the reported `3 / 3` plus `0 art pieces cached` state as a persisted-state edge case: artifacts were purged under the previously loaded code, while today's generation log remained exhausted.
- Confirmed extension reloads and model changes do not reset the local generation log or trigger an API request. The new-tab guard requires `todayCount < dailyBudget`, so `3 / 3` correctly blocks generation.
- Confirmed the newer purge/reset path only runs on a new purge with at least one artifact; with zero cached artifacts its button is disabled, so it cannot repair this already-existing state.
- No application code changed during this diagnostic. Immediate recovery: temporarily set the daily generation limit to 4, save, and open a new tab; with synced titles present this permits one fresh generation using the newly selected model.

## 2026-08-22T10:51:14+05:30

- Started a permanent recovery for users upgrading with the stale `0 artifacts` plus exhausted daily-count state.
- Chosen safeguard: only when a new tab has no artifacts and has synced titles, automatically reset an exhausted allowance once per calendar day and request fresh art. Existing art and normal daily-limit paths remain unchanged.

## 2026-08-22T10:52:23+05:30

- Implemented the once-per-day empty-cache recovery marker and automatic new-tab repair path.
- Recovery preserves older generation history, never runs when cached art exists, and requires usable synced titles before changing the allowance.
- Verified storage behavior with 86 passing assertions, new-tab integration with 94 passing assertions, and `git diff --check`.
- Next: checkpoint the recovery, update documentation, and run the full regression suite.
