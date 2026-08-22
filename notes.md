# Project notes

- Generated art is stored under the local `artifacts` key (newest first, maximum 100). Purge clears artifacts and today's generation-log count so one replacement can be requested immediately; it preserves conversations, generation/token statistics, and older daily log entries.
- Synced generation preferences use `topicCount` (validated to 1–20, default 3) and `artPrompt`. The literal `{{topics}}` placeholder is replaced with the randomly selected chat titles; a custom prompt without that placeholder is sent unchanged.
- Artifact export is a dependency-free, uncompressed ZIP assembled by `shared/artifact-archive.js`, with one timestamped `.html` entry per artifact.
- Per-tab blank mode never writes a preference. It navigates the active art iframe to `about:blank` so the current animation stops; its restore callback returns to either the active artwork or the no-art state in that page instance.
- Migration safeguard: if a new tab finds zero artifacts, usable synced titles, and an exhausted generation allowance, `recoverEmptyArtifactCache()` resets today's count once per calendar day. This repairs stale state left by purge behavior before commit `eda3279` without bypassing normal limits when cached art exists or creating an unbounded recovery loop.
