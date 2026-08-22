# Project notes

- Generated art is stored under the local `artifacts` key (newest first, maximum 100). `clearArtifacts()` intentionally preserves conversations, generation/token statistics, and the daily budget log.
- Synced generation preferences use `topicCount` (validated to 1–20, default 3) and `artPrompt`. The literal `{{topics}}` placeholder is replaced with the randomly selected chat titles; a custom prompt without that placeholder is sent unchanged.
- Artifact export is a dependency-free, uncompressed ZIP assembled by `shared/artifact-archive.js`, with one timestamped `.html` entry per artifact.
- Per-tab blank mode never writes a preference. It navigates the active art iframe to `about:blank` so the current animation stops, and restores by reloading the sandbox in that page instance.
