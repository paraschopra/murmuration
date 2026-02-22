# Sprint Review: Beauty on New Tabs v1

**Date**: 2026-02-22
**Features completed**: 27/27 (all PRD tasks)
**Total automated tests**: 321 (all passing)
**Commits**: 14 (from `f810291` to `422da20`)

## Project Structure

```
beauty-on-new-tabs/
├── manifest.json                # Chrome MV3 extension manifest
├── background/
│   └── background.js            # Service worker: scrape → budget → generate → store
├── shared/
│   ├── storage.js               # Chrome storage abstraction (conversations, artifacts, budget, stats)
│   ├── api-client.js            # OpenRouter API client
│   └── art-generator.js         # LLM prompt builder, HTML parser, CSP injection
├── content-scripts/
│   ├── chatgpt.js               # Scrapes ChatGPT sidebar conversation titles
│   └── claude.js                # Scrapes Claude sidebar conversation titles
├── newtab/
│   ├── newtab.html              # New tab override (4 states: loading, onboarding, art, empty)
│   ├── newtab.js                # Display artifacts, refresh, trigger generation
│   └── newtab.css               # Full-viewport styling
├── options/
│   ├── options.html             # Settings page (API config, stats, custom selectors)
│   ├── options.js               # Settings save/load, stats display
│   └── options.css              # Form styling
├── icons/
│   ├── icon16.png               # 127 bytes
│   ├── icon48.png               # 254 bytes
│   └── icon128.png              # 834 bytes
├── scripts/
│   └── generate-icons.js        # Pure Node.js PNG generator
├── tests/                       # 8 test files, 321 assertions
└── sprints/v1/                  # Planning artifacts
```

## End-to-End Generation Flow

This section documents the complete lifecycle of an art generation — from visiting ChatGPT/Claude to seeing art on a new tab.

### Step 1: Scraping Conversation Titles

```
User visits chatgpt.com or claude.ai
         │
         ▼
Content script loads (run_at: document_idle)
         │
         ├── 3-second initial delay (SCRAPE_DELAY_MS)
         │
         ▼
getSelectors()
  ├── Read custom selectors from chrome.storage.sync (chatgptSelectors / claudeSelectors)
  └── Prepend custom selectors to DEFAULT_SELECTORS chain
         │
         ▼
extractTitles(selectors)
  ├── Try each selector in order via document.querySelectorAll()
  ├── First selector returning elements wins
  ├── Filter: 3 <= text.length <= 200
  ├── Claude only: filter out NOISE_ITEMS (new chat, chats, projects, recents, starred)
  ├── Deduplicate via new Set()
  └── Cap at MAX_TITLES (20)
         │
         ▼
chrome.runtime.sendMessage({
  type: 'CONVERSATION_SCRAPED',
  data: { platform, title, titles[], url }
})
         │
         ▼
MutationObserver continues watching for SPA navigation
  └── Re-triggers scrapeAndSend() with 2s debounce on DOM changes
```

### Step 2: Background Service Worker Processing

```
Message received by chrome.runtime.onMessage listener
         │
         ▼
handleConversationScraped(data)
  ├── Debounce check: skip if same platform scraped within 60s
  ├── Build conversation object: { id: '<platform>-<url>', platform, titles, url, timestamp }
  ├── saveConversation() → upsert into chrome.storage.local (max 100 conversations)
  ├── updateLastSynced(platform) → per-platform timestamp
  └── tryGenerate()
```

### Step 3: Art Generation Pipeline

```
tryGenerate()
  │
  ├── shouldGenerate() → check daily budget
  │     ├── Read dailyBudget from chrome.storage.sync (default: 3)
  │     ├── Read today's count from generationLog
  │     └── Return todayCount < budget
  │
  ├── If budget exhausted → log and return (no generation)
  │
  ├── getConversations() → gather all stored conversations
  │     ├── Flatten all conv.titles arrays
  │     └── Deduplicate via new Set() → uniqueTitles[]
  │
  ├── If no titles → log and return
  │
  └── generateArt(uniqueTitles)
        │
        ├── Read apiKey + model from chrome.storage.sync
        │
        ├── pickRandomTopics(uniqueTitles, 3)
        │     └── Fisher-Yates shuffle on copy, return first 3
        │
        ├── buildArtPrompt(topics)
        │     └── Multi-paragraph prompt with RULES:
        │           - Self-contained HTML/CSS/JS
        │           - Black & white, animated
        │           - No external assets
        │           - Under 8000 tokens
        │
        ├── OpenRouterClient.generateCompletion(prompt, {maxTokens: 8000, temperature: 1.0})
        │     ├── POST https://openrouter.ai/api/v1/chat/completions
        │     ├── Headers: Authorization Bearer, Content-Type JSON
        │     └── Returns { content, usage: {promptTokens, completionTokens, totalTokens} }
        │
        ├── parseArtResponse(response.content)
        │     ├── Strip markdown code block wrappers (```html...```)
        │     ├── Validate: must contain <html|style|canvas|svg|body|div> tags
        │     ├── Validate: length >= 50 bytes, <= 500KB
        │     ├── Strip existing CSP meta tags
        │     └── Inject strict CSP: default-src 'none'; style-src 'unsafe-inline';
        │           script-src 'unsafe-inline'; img-src data:; connect-src 'none';
        │
        └── Return artifact: { id, html, topics, timestamp, usage }
```

### Step 4: Saving Results

```
tryGenerate() continued:
  │
  ├── ON SUCCESS:
  │     ├── saveArtifact(artifact) → prepend to chrome.storage.local (max 20)
  │     │     └── On QUOTA_BYTES error: remove 5 oldest, retry once
  │     ├── recordGeneration() → increment today's count in generationLog
  │     ├── recordGenerationResult(true) → increment succeeded in generationStats
  │     └── recordTokenUsage(artifact.usage) → accumulate daily token counts
  │
  └── ON FAILURE:
        ├── recordGenerationResult(false) → increment failed in generationStats
        └── Budget NOT consumed (recordGeneration not called)
```

### Step 5: Displaying Art on New Tab

```
User opens new tab → newtab.html loads
         │
         ▼
init()
  ├── Check chrome.storage.sync for apiKey
  │     └── Missing → show onboarding state ("Open Settings" button)
  │
  ├── getArtifacts()
  │     ├── Empty → check if generation possible:
  │     │     ├── shouldGenerate() && getConversations().length > 0
  │     │     ├── If yes → send REQUEST_GENERATION to background
  │     │     └── Show empty state with sync status
  │     │
  │     └── Has artifacts → displayArtifact(artifacts)
  │
  └── displayArtifact(artifacts)
        ├── Pick random starting index
        ├── Load sandbox.html in iframe (manifest-sandboxed page)
        │     └── Allows unsafe-inline scripts (bypasses extension CSP)
        ├── On iframe load → postMessage(artifact.html) to sandbox
        │     └── sandbox.html sets nested iframe srcdoc = received HTML
        ├── Show topics (joined with · separator) in hover info popup
        ├── Show budget status (X/Y today)
        │
        ├── Refresh button → pick different random index (do-while loop)
        │     └── postMessage new artifact HTML to sandbox
        │
        └── Settings link → chrome.runtime.openOptionsPage()
```

### Trigger Points

Art generation can be triggered from two places:
1. **Content script scrape** → `CONVERSATION_SCRAPED` message → `handleConversationScraped()` → `tryGenerate()`
2. **New tab opened** (with no artifacts) → `REQUEST_GENERATION` message → `handleGenerationRequest()` → `tryGenerate()`

Both paths converge at `tryGenerate()` which handles budget checking and deduplication.

### Security Boundary

```
Extension page (newtab.html)         Sandboxed page (sandbox.html)        LLM content
  CSP: script-src 'self'       ──►     CSP: unsafe-inline allowed    ──►   CSP meta injected:
  (no inline scripts)                   (manifest sandbox)                  connect-src 'none'
                                                                            default-src 'none'
                               postMessage()                    srcdoc
                               ──────────────►          ──────────────►
                                                  iframe[sandbox=allow-scripts]
                                                  (no same-origin, no forms, no popups)
```

---

## Cost Estimate

Default model: `anthropic/claude-sonnet-4-20250514` via OpenRouter.

| | Rate |
|---|---|
| Input (prompt) | $3 / million tokens |
| Output (completion) | $15 / million tokens |

**Observed usage**: ~14,000 tokens/day at 3 generations/day (default budget).

Typical per-generation breakdown (based on observed data):
- Prompt: ~800 tokens (short — the art prompt + topics)
- Completion: ~3,800 tokens (the generated HTML/CSS/JS art piece)
- Total: ~4,600 tokens per generation

| Period | Tokens | Prompt cost | Completion cost | Total cost |
|--------|--------|------------|----------------|------------|
| Per generation | ~4,600 | $0.0024 | $0.057 | ~$0.06 |
| Per day (3 gens) | ~14,000 | $0.007 | $0.17 | ~$0.18 |
| Per month (30 days) | ~420,000 | $0.21 | $5.13 | ~$5.34 |
| Per year | ~5,110,000 | $2.56 | $62.3 | ~$64.9 |

**Summary**: At default settings (3 generations/day), the extension costs approximately **$0.18/day** or **$5.34/month**. The bulk of the cost (~96%) is output tokens since the LLM generates substantial HTML/CSS/JS code per art piece.

**Cost levers**:
- Reducing `dailyBudget` from 3 to 1 cuts cost to ~$1.78/month
- Switching to a cheaper model (e.g. `anthropic/claude-sonnet-4-5` at $1/$5 per M tokens) would reduce cost by ~3x to ~$1.78/month at 3/day
- `maxTokens: 8000` is the upper bound; actual completions average ~3,800 tokens

---

## Executive Summary

Beauty on New Tabs is a Chrome Manifest V3 extension built from scratch in vanilla JavaScript with zero external dependencies. It scrapes conversation titles from ChatGPT and Claude sidebars, sends 3 random topics to an LLM via OpenRouter, and displays the generated HTML/CSS/JS art piece in a sandboxed iframe on every new tab. The architecture follows a clean separation: content scripts scrape, a background service worker orchestrates, and the new tab page displays. Key design decisions include daily budget tracking instead of TTL caching, failed generations not consuming budget (with success rate stats), and strict CSP injection for iframe isolation.

---

## Feature Deep Dives

---

### 1. Manifest & Directory Structure

**What it does**: Defines the extension's identity, permissions, entry points, and file layout for Chrome's MV3 runtime.

**File: `manifest.json`** (35 lines)

The manifest declares:
- `manifest_version: 3` — required for modern Chrome extensions
- `permissions: ["storage", "activeTab", "tabs", "scripting"]` — storage for data persistence, activeTab/tabs/scripting for content script coordination
- `host_permissions` for `https://chatgpt.com/*` and `https://claude.ai/*` — required for content scripts to run on those domains
- `background.service_worker` → `background/background.js` — MV3 service worker (not persistent background page)
- Two `content_scripts` entries, each with `run_at: "document_idle"` — waits for page load before scraping
- `chrome_url_overrides.newtab` → `newtab/newtab.html` — replaces the new tab page
- `options_page` → `options/options.html`
- Three icon sizes: 16, 48, 128

**Tests**: `tests/test-manifest.js` — 23 assertions
- Validates JSON parsing, manifest_version, all 4 permissions, both host_permissions, service worker path, content script matches/paths/run_at, newtab override, options page, and existence of all 6 required directories.

**Design decisions**:
- `run_at: "document_idle"` chosen over `document_end` to avoid racing with SPA hydration
- `activeTab` + `tabs` + `scripting` provides flexibility for future features while staying within MV3 constraints

---

### 2. Storage Layer (`shared/storage.js`)

**What it does**: Provides async CRUD functions for all persistent data — conversations, artifacts, daily budget logs, and generation stats — using Chrome's storage API.

**File: `shared/storage.js`** (174 lines)

**Constants** (lines 1-11):
- `STORAGE_KEYS` — 5 named keys: `conversations`, `artifacts`, `lastSynced`, `generationLog`, `generationStats`
- `MAX_CONVERSATIONS = 100` — rolling buffer of scraped conversations
- `MAX_ARTIFACTS = 20` — maximum cached art pieces
- `DEFAULT_DAILY_BUDGET = 3` — daily generation limit

**Key functions**:

- `saveConversation(conversation)` (line 15) — Upsert by `id`: finds existing by `findIndex`, splices out if found, then `unshift` (prepend). Trims to 100 via `slice(0, MAX_CONVERSATIONS)`. Uses `chrome.storage.local`.

- `getConversations()` (line 26) — Returns array from `chrome.storage.local` or `[]`.

- `updateLastSynced(platform)` / `getLastSynced()` (lines 31-41) — Per-platform timestamp object `{chatgpt: <ts>, claude: <ts>}` in local storage.

- `saveArtifact(artifact)` (line 45) — Prepends, trims to 20. **Quota error recovery** (lines 52-64): catches errors containing `QUOTA_BYTES`, removes 5 oldest artifacts (`artifacts.slice(0, Math.max(1, artifacts.length - 5))`), retries once. On double failure, logs error but does not throw (graceful degradation).

- `getTodayKey()` (line 74) — Returns `YYYY-MM-DD` using local date. Used as dictionary key for budget and stats tracking.

- `shouldGenerate()` (line 79) — Reads `dailyBudget` from sync storage (default 3), reads today's count from `generationLog`, returns `todayCount < budget`.

- `recordGeneration()` (line 90) — Increments today's count in `generationLog`. **Prunes to 7 days** (lines 97-99): sorts keys, keeps last 7 via `slice(-7)`.

- `getGenerationStatus()` (line 104) — Returns `{used, budget}` for display.

- `recordGenerationResult(success)` (line 115) — Tracks `{succeeded, failed}` per day in `generationStats`. Prunes to 7 days.

- `getGenerationStats()` (line 138) — Returns today's `{total, succeeded, failed, successRate}` where `successRate = Math.round((succeeded / total) * 100)`.

**Module export pattern** (lines 156-173):
```
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };  // Node.js test context
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, { ... });  // Browser/service worker context
}
```
This dual-export pattern is used across all three shared modules to enable Node.js testing without a browser.

**Data flow**:
```
chrome.storage.local:
  conversations[]  ←── saveConversation() ←── background.js
  artifacts[]      ←── saveArtifact()     ←── background.js
  lastSynced{}     ←── updateLastSynced() ←── background.js
  generationLog{}  ←── recordGeneration() ←── background.js
  generationStats{}←── recordGenerationResult() ←── background.js

chrome.storage.sync:
  apiKey, model, dailyBudget  ←── options.js
  chatgptSelectors, claudeSelectors ←── options.js
```

**Tests**: `tests/test-storage.js` — 60 assertions
- Full mock of `chrome.storage.local` and `chrome.storage.sync` with JSON deep-clone semantics
- Tests: empty returns, upsert behavior, prepend ordering, trim to MAX, quota error recovery (single + double failure), date key format, budget math, stat tracking, 7-day pruning, all 12 function exports

**Design decisions**:
- `chrome.storage.local` for large data (artifacts up to 500KB each), `chrome.storage.sync` for small settings (synced across devices)
- 7-day pruning prevents unbounded log growth while keeping recent history for debugging
- Quota recovery removes 5 oldest artifacts (not just 1) to create headroom for future saves

---

### 3. API Client (`shared/api-client.js`)

**What it does**: Sends completion requests to OpenRouter's unified LLM API with error handling for rate limits, server errors, and network failures.

**File: `shared/api-client.js`** (75 lines)

**Constants**:
- `DEFAULT_MODEL = 'anthropic/claude-sonnet-4-20250514'` (line 1)
- `OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'` (line 2)

**Class: `OpenRouterClient`** (lines 4-62)

- `constructor(apiKey, model)` — stores key, falls back to `DEFAULT_MODEL`

- `generateCompletion(prompt, options = {})` (line 10):
  1. Builds request body: `{model, messages: [{role: 'user', content: prompt}], max_tokens, temperature}`
  2. `max_tokens` defaults to 4096, `temperature` defaults to 0.7 (overridable via options)
  3. Sends `POST` with `Content-Type: application/json` and `Bearer` auth
  4. **Error handling** (lines 28-53):
     - Network error → wraps in `Error('Network error calling OpenRouter: ...')`
     - Non-OK response → parses error body for message, appends status code
     - 429 specifically → checks `retry-after` header, includes in error message
  5. Extracts `choices[0].message.content` from response, returns `{content}`

- `getApiClient(apiKey, model)` (line 64) — factory function returning `new OpenRouterClient(apiKey, model)`

**Tests**: `tests/test-api-client.js` — 25 assertions
- Mock `globalThis.fetch` captures calls and returns configurable responses
- Tests: constructor, request body structure (model, messages, max_tokens, temperature), Authorization header, endpoint URL, POST method, default model, 429 with retry-after, 500, 401, network error (thrown Error), factory function

**Design decisions**:
- OpenRouter as single provider (v1 decision) — simplifies auth, users access any model through unified gateway
- No retry logic built in — kept simple for v1, errors bubble up to caller (background.js handles by recording failure)
- `temperature: 0.7` default, overridden to `1.0` by art generator for maximum creativity

---

### 4. Art Generator (`shared/art-generator.js`)

**What it does**: The core creative pipeline — picks random topics, builds the LLM prompt, parses/validates the HTML response, and injects CSP for iframe isolation.

**File: `shared/art-generator.js`** (103 lines)

**Functions**:

- `pickRandomTopics(titles, count)` (line 3) — Fisher-Yates shuffle on a copy (`[...titles]`) to avoid mutating input. Returns `shuffled.slice(0, Math.min(count, shuffled.length))`. Handles empty arrays and `count <= 0`.

- `buildArtPrompt(topics)` (line 13) — Returns a multi-paragraph prompt:
  ```
  Based on given topics that user has been chatting about, create a self-contained
  html/css/js page... Pick one topic or some common theme, don't mix everything.

  Create a minimal ASCII or related art... Fractal, aquarium, scenery. Glitchy,
  whimsical, awe-inspiring. Black and white only. Animated. Be creative.

  RULES:
  - Output ONLY the self-contained HTML. No explanation, no markdown.
  - Must be a single HTML page with inline <style> and optional <script>.
  - NO external assets (no image URLs, no CDN links, no external scripts/fonts).
  - Colors: black, white, and grayscale ONLY.
  - Keep it concise — under 8000 tokens of HTML.

  Topics: machine learning, philosophy, cooking
  ```

- `parseArtResponse(responseContent)` (line 28) — The security-critical function:
  1. **Strips markdown** (line 32): regex `/{3}(?:html)?\s*\n([\s\S]*?)\n`{3}/` extracts content from code blocks
  2. **Validates HTML** (line 38): checks for `<html|style|canvas|svg|body|div>` tags AND length >= 50 chars
  3. **Size guard** (line 44): rejects content > 500,000 bytes
  4. **Strips existing CSP** (line 49): `html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')`
  5. **Injects strict CSP** (lines 52-60): `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none';`
     - Insertion priority: after `<head>`, else wraps `<html>` with `<head>`, else prepends

- `generateArt(allTitles)` (line 65) — Full pipeline:
  1. Reads `apiKey` and `model` from `chrome.storage.sync`
  2. Creates `OpenRouterClient` via `getApiClient()`
  3. Picks 3 random topics via `pickRandomTopics()`
  4. Builds prompt, calls API with `maxTokens: 8000, temperature: 1.0`
  5. Parses response through `parseArtResponse()`
  6. Returns artifact: `{id: 'art-<timestamp>-<random>', html, topics, timestamp}`

**Data flow**:
```
allTitles[] → pickRandomTopics(3) → topics[]
                                      ↓
                              buildArtPrompt(topics)
                                      ↓
                              OpenRouterClient.generateCompletion()
                                      ↓
                              parseArtResponse(response.content)
                                      ↓
                              { id, html, topics, timestamp }
```

**Tests**: `tests/test-art-generator.js` — 48 assertions
- `pickRandomTopics`: count, edge cases (empty, 0, small), immutability, randomization verification (20 runs, expects >= 2 unique orderings)
- `buildArtPrompt`: checks for keywords (self-contained, black/white, animated, ASCII, RULES, 8000, topics, state of mind)
- `parseArtResponse`: passthrough, markdown stripping (```html and plain ```), validation (no HTML tags, < 50 chars, > 500KB), existing CSP stripping, new CSP injection (all 4 directives verified), CSP injection into head-less and html-less documents
- `generateArt`: no API key error, successful end-to-end with mock fetch

**Design decisions**:
- `temperature: 1.0` — maximum creativity for art generation
- `maxTokens: 8000` — bumped from initial 4096 after analyzing example-visual.html (which was ~300 lines of HTML/CSS/JS)
- `connect-src 'none'` in CSP — prevents LLM-generated code from making network requests (data exfiltration protection)
- `TOPICS_PER_GENERATION = 3` — balances diversity vs. focus; prompt instructs LLM to "pick one topic or common theme"

---

### 5. Background Service Worker (`background/background.js`)

**What it does**: Orchestrates the extension — receives scraped conversations from content scripts, debounces per platform, checks budget, triggers art generation, and saves results.

**File: `background/background.js`** (81 lines)

**Setup** (lines 1-5):
- `importScripts('/shared/storage.js', '/shared/api-client.js', '/shared/art-generator.js')` — loads shared modules into service worker scope
- `lastScrapeTime = {}` — in-memory debounce map (resets on service worker restart)
- `SCRAPE_DEBOUNCE_MS = 60000` — 60-second per-platform debounce

**Message listener** (lines 7-19):
- Handles two message types:
  - `CONVERSATION_SCRAPED` → `handleConversationScraped(data)`
  - `REQUEST_GENERATION` → `handleGenerationRequest()`
- Returns `true` for async sendResponse (MV3 requirement)
- Errors logged but not propagated (`.catch(err => console.error(...))`)

**`handleConversationScraped(data)`** (line 21):
1. **Debounce check** (lines 22-26): if same platform scraped within 60s, return immediately
2. Update `lastScrapeTime[data.platform]`
3. Build conversation object: `{id: '<platform>-<url>', platform, title, titles, url, timestamp}`
4. `saveConversation()` → `updateLastSynced()` → `tryGenerate()`

**`tryGenerate()`** (line 49):
1. `shouldGenerate()` — budget check (returns if false)
2. `getConversations()` → flatten all `conv.titles` arrays → deduplicate via `new Set()`
3. If no titles, return
4. **Try block** (lines 70-79):
   - Success: `generateArt()` → `saveArtifact()` → `recordGeneration()` → `recordGenerationResult(true)`
   - Failure: `recordGenerationResult(false)` only — **budget NOT consumed on failure**

**Data flow**:
```
content-scripts/chatgpt.js ──┐
                              ├─ CONVERSATION_SCRAPED ──→ handleConversationScraped()
content-scripts/claude.js ───┘                              │
                                                            ├─ saveConversation()
                                                            ├─ updateLastSynced()
                                                            └─ tryGenerate()
                                                                 │
newtab.js ── REQUEST_GENERATION ──→ handleGenerationRequest() ──┘
                                                                 │
                                                           shouldGenerate()
                                                                 │
                                                           generateArt(uniqueTitles)
                                                                 │
                                                    ┌────────────┴────────────┐
                                                  success                   failure
                                                    │                         │
                                              saveArtifact()          recordGenerationResult(false)
                                              recordGeneration()
                                              recordGenerationResult(true)
```

**Tests**: `tests/test-background.js` — 15 assertions
- Mocks: `chrome.runtime.onMessage.addListener`, `chrome.storage`, `fetch`, `importScripts`
- Captures `console.log/warn/error` to verify log messages
- Tests: listener registration, async return value, conversation save on scrape, lastSynced update, 60s debounce (verifies log message), REQUEST_GENERATION end-to-end, budget exhaustion (no artifact created), no titles (logs message), failure preserves budget (`status.used === 0` after failed generation, `stats.failed >= 1`), success consumes budget (`status.used === 1`)

**Design decisions**:
- In-memory debounce (`lastScrapeTime`) resets on service worker restart — acceptable for v1 since MutationObserver re-triggers scrapes anyway
- Budget preservation on failure (user's explicit requirement) — only `recordGeneration()` increments the budget counter, and it's called only on success
- `60s` debounce is generous — prevents spam from rapid SPA navigation on ChatGPT/Claude

---

### 6. Content Scripts (`content-scripts/chatgpt.js`, `content-scripts/claude.js`)

**What they do**: Run on ChatGPT and Claude pages respectively, scrape conversation titles from the sidebar, and send them to the background service worker.

#### `content-scripts/chatgpt.js` (109 lines)

**Architecture**: IIFE-wrapped (`(function() { 'use strict'; ... })()`) to prevent global scope pollution.

**Constants** (lines 4-10):
- `PLATFORM = 'chatgpt'`
- `SCRAPE_DELAY_MS = 3000` — initial scrape delay after page load
- `OBSERVER_DEBOUNCE_MS = 2000` — MutationObserver debounce
- `MAX_TITLES = 20`, `MIN_TITLE_LENGTH = 3`, `MAX_TITLE_LENGTH = 200`

**Selector fallback chain** (lines 13-17):
```javascript
const DEFAULT_SELECTORS = [
  'a[data-sidebar-item="true"] span.truncate',  // Primary: data attribute selector
  '#history a',                                   // Fallback: history section links
  'a[href*="/c/"]'                                // Fallback: conversation URL pattern
];
```

**`getSelectors()`** (line 21) — Reads `chatgptSelectors` from `chrome.storage.sync`. If custom selectors exist, prepends them to the default chain (customs first, then defaults as fallback).

**`extractTitles(selectors)`** (line 37) — Tries each selector in order. First selector that returns elements wins. Filters by length (3-200 chars), deduplicates via `new Set()`, caps at 20. Returns `[]` if no selector matches. Each `querySelectorAll` call is wrapped in try/catch for invalid selector resilience.

**`scrapeAndSend()`** (line 64) — Gets selectors, extracts titles, sends message:
```javascript
{ type: 'CONVERSATION_SCRAPED', data: { platform: 'chatgpt', title, titles, url } }
```

**Lifecycle**:
- Initial scrape: `setTimeout(scrapeAndSend, 3000)` — 3s delay for SPA hydration
- SPA navigation: `MutationObserver` on `document.body` (`childList: true, subtree: true`) with 2s debounce

#### `content-scripts/claude.js` (116 lines)

**Identical architecture** to chatgpt.js with two differences:

1. **Different selectors** (lines 16-20):
   ```javascript
   const DEFAULT_SELECTORS = [
     'a[data-dd-action-name="sidebar-chat-item"] span.truncate',
     'a[href*="/chat/"]',
     'nav[aria-label="Sidebar"] a'
   ];
   ```

2. **Noise filtering** (lines 13, 40-42):
   ```javascript
   const NOISE_ITEMS = ['new chat', 'chats', 'projects', 'recents', 'starred'];
   function isNoise(text) {
     return NOISE_ITEMS.includes(text.toLowerCase());
   }
   ```
   Applied in `extractTitles()` before adding to results (line 52).

**Tests**: `tests/test-content-scripts.js` — 32 assertions (structural)
- File existence, expected CSS selectors present, platform string, message format (CONVERSATION_SCRAPED, sendMessage, platform, titles, window.location.href), MutationObserver, debounce mechanism, log prefix, IIFE wrapper, error handling (try/catch), Claude noise filtering

**Design decisions**:
- IIFE wrapping prevents variable conflicts with page scripts
- 3s initial delay + 2s MutationObserver debounce balances responsiveness with avoiding premature scraping
- Selector fallback chain: most specific first (data attributes), least specific last (URL patterns). If ChatGPT/Claude changes their DOM, later selectors provide resilience.
- Title length filter (3-200 chars) prevents scraping empty elements or huge text nodes
- Claude's noise filter is case-insensitive to handle UI capitalization variations

---

### 7. New Tab Page (`newtab/newtab.html`, `newtab.js`, `newtab.css`)

**What it does**: Replaces Chrome's new tab with 4 possible states — loading spinner, first-time onboarding, art display in a sandboxed iframe, or empty state with sync info.

#### `newtab/newtab.html` (45 lines)

Four `div.state` containers (only one visible at a time):
1. **`loading-state`** — CSS spinner
2. **`onboarding-state`** — Title, description, "Open Settings" button
3. **`art-display`** — The main UI:
   - `<iframe id="art-frame" sandbox="allow-scripts" title="Generated Art">` — sandboxed, only scripts allowed (no same-origin, no forms, no popups)
   - `#art-meta` — topics display + budget counter
   - `#refresh-btn` (↻) and `#settings-link` (⚙)
4. **`empty-state`** — "No art yet" with links to ChatGPT/Claude + sync status

#### `newtab/newtab.js` (96 lines)

**`init()`** (line 1) — Entry point, called on `DOMContentLoaded`:
1. Check `chrome.storage.sync` for `apiKey`:
   - Missing → show onboarding, wire "Open Settings" to `chrome.runtime.openOptionsPage()`
2. Get artifacts from storage:
   - Empty → check if generation is possible (`shouldGenerate()` + `getConversations().length > 0`), if yes send `REQUEST_GENERATION` to background. Show empty state + sync status.
3. Has artifacts → `displayArtifact(artifacts)`

**`displayArtifact(artifacts)`** (line 30):
- Picks random starting index: `Math.floor(Math.random() * artifacts.length)`
- Sets `frame.srcdoc = artifact.html`
- Shows topics joined with ` · ` (middle dot separator)
- Shows budget as `X/Y today` via `getGenerationStatus()`
- **Refresh button** (lines 52-60): do-while loop picks a different random index (`nextIndex !== currentIndex`). Short-circuits if only 1 artifact.
- Settings link → `chrome.runtime.openOptionsPage()`

**`showSyncStatus()`** (line 69) — Reads `getLastSynced()`, builds `"Last synced: ChatGPT: 5m ago · Claude: 2h ago"` or `"No conversations synced yet"`.

**`formatRelativeTime(timestamp)`** (line 80) — Simple relative time: `just now` / `Xm ago` / `Xh ago` / `Xd ago`.

**`showState(stateId)`** (line 91) — Hides all `.state` divs, shows the target.

#### `newtab/newtab.css` (146 lines)

- Global reset: `* { margin: 0; padding: 0; box-sizing: border-box }`
- `html, body`: 100% width/height, `overflow: hidden`, system font stack
- `.state`: flexbox centered, 100% dimensions
- `.spinner`: 32px, 3px border, `spin` keyframe at 0.8s
- `#art-frame`: 100% width/height, no border
- `#art-meta`: fixed bottom-left, 0.75rem, `#aaa` color
- `#refresh-btn`: fixed bottom-right (offset 56px), circular, 32px
- `#settings-link`: fixed bottom-right (offset 16px), 1.2rem gear icon
- Hover states change color from `#aaa` to `#333`

**Tests**: `tests/test-newtab.js` — 60 assertions (structural)
- HTML: all 4 state divs, spinner, setup button, iframe attributes (sandbox, title, id), meta elements, refresh/settings buttons with icons, external links, script loading
- CSS: dimensions, overflow, flexbox, keyframes, max-width, border, fixed positioning, cursor, border-radius
- JS: init function, apiKey check, onboarding flow, openOptionsPage, getArtifacts, REQUEST_GENERATION trigger, shouldGenerate, getConversations, displayArtifact, srcdoc, topic join, getGenerationStatus, refresh button non-repeat logic, showSyncStatus, formatRelativeTime (just now, m/h/d ago), showState, DOMContentLoaded

**Design decisions**:
- `sandbox="allow-scripts"` without `allow-same-origin` — LLM-generated code can run JavaScript but CANNOT access the parent page's DOM, cookies, or storage. Critical security boundary.
- `srcdoc` instead of `src` — no separate HTML file needed, content loaded from storage string
- Auto-trigger generation from new tab (`REQUEST_GENERATION`) — user doesn't need to manually trigger; if budget allows and conversations exist, generation happens in background
- Fixed-position controls overlay the iframe — minimal UI that doesn't interfere with art display

---

### 8. Options Page (`options/options.html`, `options.js`, `options.css`)

**What it does**: Settings UI for API configuration, generation stats display, and custom CSS selector override.

#### `options/options.html` (61 lines)

Three sections:
1. **API Configuration**: apiKey (password input), model (text, placeholder shows default), dailyBudget (number, min=1, max=20, default=3), Save button + status text
2. **Generation Status**: gen-status (used/budget), gen-stats (success rate), artifact-count
3. **Custom Selectors**: Tabbed ChatGPT/Claude, primary selector input, fallback selectors textarea, Save Selectors button

#### `options/options.js` (94 lines)

**On DOMContentLoaded** (line 1):
1. Load settings from `chrome.storage.sync` (apiKey, model, dailyBudget)
2. Wire save button
3. Load status
4. Setup selector tabs

**`saveSettings()`** (line 18):
- Reads form values, parses budget as `parseInt`, defaults to 3
- Removes undefined model (doesn't store if empty — uses DEFAULT_MODEL)
- `chrome.storage.sync.set(settings)`
- Shows "Saved" for 2 seconds via `setTimeout`

**`loadStatus()`** (line 35):
- `getGenerationStatus()` → `"Generated today: X / Y"`
- `getGenerationStats()` → `"No attempts today"` or `"Success rate: N% (X succeeded, Y failed)"`
- `getArtifacts()` → `"N art pieces cached"`

**`setupSelectorTabs()`** (line 56):
- Tab click: removes `active` from all, adds to clicked, loads selectors for that platform
- Save button: builds `{primary, fallbacks}` object, saves to `chatgptSelectors` or `claudeSelectors` in sync storage. If both empty, removes the key entirely.

**`loadSelectors(platform)`** (line 88):
- Reads from sync storage, populates form fields

#### `options/options.css` (114 lines)
- `max-width: 560px` container, centered
- Sections with `border-bottom: 1px solid #eee` separators
- Form inputs: 100% width, 0.5rem padding, 4px border-radius
- `.btn`: dark `#333` background, white text. `.btn-secondary`: white background, border
- `.tab`: side-by-side buttons, `.tab.active` gets `#333` background + white text
- `.hint`: 0.8rem, `#999` (muted), `.status`: 0.85rem, `#4a4` (green)

**Tests**: `tests/test-options.js` — 58 assertions (structural)
- HTML: title, all input ids/types/attributes, buttons, data-platform attributes, script/CSS loading
- CSS: max-width, border-bottom, width 100%, padding, button colors, hover states, secondary button, active tab, hint/status colors
- JS: DOMContentLoaded, storage get/set calls, saveSettings function, Saved status + setTimeout, parseInt, getGenerationStatus/getGenerationStats/getArtifacts calls, success rate display, "No attempts today", artifact count text, setupSelectorTabs, selector key names, classList add/remove active, loadSelectors

**Design decisions**:
- Password type for API key input — prevents shoulder surfing
- Selector clearing (remove key when empty) rather than storing empty objects — clean storage
- Tab UI for platform selection rather than separate pages — compact, single-page settings

---

### 9. Icons (`icons/`, `scripts/generate-icons.js`)

**What it does**: Generates valid PNG icon files programmatically using only Node.js built-in modules.

**File: `scripts/generate-icons.js`** (150 lines)

**PNG generation** (lines 13-48):
- `createPNG(width, height, pixels)` — Builds a valid PNG from scratch:
  - 8-byte PNG signature
  - IHDR chunk (width, height, bit depth 8, RGB color type)
  - IDAT chunk (deflate-compressed pixel data with filter byte 0 per row)
  - IEND chunk
- `makeChunk(type, data)` — Wraps data with length prefix, type string, CRC32 checksum
- `crc32(buf)` — Lookup-table CRC32 implementation

**Icon design** `drawIcon(size)` (lines 81-129):
- White background (255 fill)
- Black geometric crosshair/target pattern:
  - Outer ring: `r = size * 0.35`, width `size * 0.08`
  - Inner dot: radius `size * 0.12`
  - Cross-hair lines connecting inner dot to outer ring (horizontal + vertical)

**Output**: 16x16 (127B), 48x48 (254B), 128x128 (834B) — all valid PNGs.

**Design decisions**:
- Pure Node.js (no `canvas`, no ImageMagick) — zero-dependency constraint
- Geometric crosshair design matches black-and-white aesthetic
- Icons are placeholder quality — suitable for development/testing

---

## Cross-Feature Concerns

### Shared Utilities

All three shared modules (`storage.js`, `api-client.js`, `art-generator.js`) use the same dual-export pattern for Node.js/browser compatibility. They are loaded via:
- `<script>` tags in newtab.html and options.html (browser context)
- `importScripts()` in background.js (service worker context)
- `require()` in test files (Node.js context)

### Configuration & Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_CONVERSATIONS` | 100 | `shared/storage.js:9` |
| `MAX_ARTIFACTS` | 20 | `shared/storage.js:10` |
| `DEFAULT_DAILY_BUDGET` | 3 | `shared/storage.js:11` |
| `TOPICS_PER_GENERATION` | 3 | `shared/art-generator.js:1` |
| `DEFAULT_MODEL` | `anthropic/claude-sonnet-4-20250514` | `shared/api-client.js:1` |
| `OPENROUTER_ENDPOINT` | `https://openrouter.ai/api/v1/chat/completions` | `shared/api-client.js:2` |
| `SCRAPE_DEBOUNCE_MS` | 60000 (background) / 2000 (content) | `background.js:5` / content scripts |
| `SCRAPE_DELAY_MS` | 3000 | content scripts |
| Max HTML size | 500,000 bytes | `shared/art-generator.js:44` |
| Min HTML size | 50 bytes | `shared/art-generator.js:39` |

### Error Handling Patterns

1. **Storage**: Quota errors caught and handled with retry + graceful degradation (no throw)
2. **API calls**: Network/HTTP errors wrapped in descriptive `Error` objects, bubbled up
3. **Content scripts**: Invalid selector errors caught silently (try next selector)
4. **Background worker**: All async handlers wrapped in `.catch()` that logs but doesn't crash
5. **Art generation failures**: Recorded in stats but don't consume budget

### Security Model

```
LLM Output → parseArtResponse()
                  │
                  ├── Strip existing CSP tags
                  ├── Inject strict CSP:
                  │     default-src 'none'
                  │     style-src 'unsafe-inline'
                  │     script-src 'unsafe-inline'
                  │     img-src data:
                  │     connect-src 'none'
                  │
                  └── Displayed in <iframe sandbox="allow-scripts">
                        │
                        ├── Scripts can run (for animation)
                        ├── CANNOT access parent DOM (no allow-same-origin)
                        ├── CANNOT make network requests (connect-src 'none')
                        ├── CANNOT load external resources (default-src 'none')
                        └── CAN use inline styles and data: URIs
```

---

## Open Questions & Suggestions

### Potentially Fragile

1. **Content script selectors** (`content-scripts/chatgpt.js:13-17`, `claude.js:16-20`): CSS selectors like `a[data-sidebar-item="true"]` and `a[data-dd-action-name="sidebar-chat-item"]` are reverse-engineered from current DOM structure. These WILL break when ChatGPT/Claude update their UI. The fallback chain and custom selector override mitigate this, but ongoing maintenance will be needed.

2. **In-memory debounce resets** (`background/background.js:4`): `lastScrapeTime` is in memory and resets when the service worker goes idle (MV3 can kill it after ~30s of inactivity). This means rapid navigations after a worker restart won't be debounced. Not a bug per se, but worth knowing.

3. **CSP injection regex** (`shared/art-generator.js:49`): The regex `/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi` handles common cases but could miss edge cases like multi-line meta tags or unusual attribute ordering. Low risk since LLM output is relatively predictable.

### Suggested Improvements

1. **Artifact age display**: The new tab page shows topics and budget but not when the art was generated. Adding `formatRelativeTime(artifact.timestamp)` to the meta bar would help users understand freshness.

2. **Error feedback on new tab**: When generation fails (API error, no budget), the user sees either "No art yet" or stale art with no indication of failure. Consider showing a subtle error indicator.

3. **Selector health check**: The options page could show which selector currently works (green/red indicator per selector) to help users debug scraping issues.

4. **Test coverage for integration**: Current tests are either unit tests (storage, API, art generator with mocks) or structural tests (content scripts, newtab, options check file contents). There are no integration tests that verify the full flow across modules. A Playwright/Puppeteer test that loads the extension would significantly increase confidence.

5. **`newtab.js:55-57`**: The do-while loop for non-repeating refresh is correct but could theoretically be slow with `artifacts.length === 2` and unlucky random. Not a practical concern (2-element array converges quickly), but a simple modular arithmetic approach would be deterministic.

---

## Test Summary

| Test File | Assertions | What's Tested |
|-----------|-----------|---------------|
| `test-manifest.js` | 23 | JSON structure, permissions, paths, directories |
| `test-storage.js` | 60 | CRUD operations with mock chrome.storage, quota recovery, budget math, pruning |
| `test-api-client.js` | 25 | Request formatting, error handling (429/500/401/network), factory |
| `test-art-generator.js` | 48 | Topic picking, prompt content, HTML parsing, CSP injection, end-to-end |
| `test-background.js` | 15 | Message handling, debounce, budget preservation on failure, success recording |
| `test-content-scripts.js` | 32 | File structure, selectors, message format, observer, noise filtering |
| `test-newtab.js` | 60 | HTML elements, CSS properties, JS functions and flow |
| `test-options.js` | 58 | HTML elements, CSS properties, JS functions and flow |
| **Total** | **321** | **All passing** |
