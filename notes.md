# Project notes

- Generated art is stored under the local `artifacts` key (newest first, maximum 100). Purge clears artifacts and today's generation-log count so one replacement can be requested immediately; it preserves conversations, generation/token statistics, and older daily log entries.
- Synced generation preferences use `topicCount` (validated to 1–20, default 3) and `artPrompt`. The literal `{{topics}}` placeholder is replaced with the randomly selected chat titles; a custom prompt without that placeholder is sent unchanged.
- Artifact export is a dependency-free, uncompressed ZIP assembled by `shared/artifact-archive.js`, with one timestamped `.html` entry per artifact.
- Per-tab blank mode never writes a preference. It navigates the active art iframe to `about:blank` so the current animation stops; its restore callback returns to either the active artwork or the no-art state in that page instance.
- Migration edge case: a purge performed before commit `eda3279` can leave zero artifacts with today's generation count already at the limit. Reloading the extension or changing the model does not repair this persisted state, and the current Purge button is disabled when there are zero artifacts. Temporarily increasing `dailyBudget` permits a fresh generation; a future recovery control could reset/request generation independently of artifact count.
