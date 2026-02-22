# Research: Repurposing quotes-on-newtabs for Beauty on New Tabs

**Date**: 2026-02-22
**Scope**: Deep-read of the `quotes-on-newtabs` Chrome extension codebase to understand its architecture, data flows, and conventions — with the goal of repurposing it to display something different on new tabs based on user chat history with Claude and ChatGPT.

## System Understanding

### What the extension does today

"Quote Surfacer" is a Manifest V3 Chrome extension that:
1. **Scrapes** conversation titles from ChatGPT and Claude sidebars via content scripts
2. **Sends** scraped titles to a background service worker
3. **Calls an LLM API** (OpenAI, Anthropic, or OpenRouter) to generate 25 real historical quotes related to the scraped topics
4. **Displays** a random quote on every new tab, with the attribution "Because you were talking about [topic]"

### Complete Data Flow (end-to-end)

```
User visits chatgpt.com or claude.ai
       │
       ▼
Content script (chatgpt.js / claude.js) runs at document_idle
       │
       ├── Waits 3 seconds for sidebar to render
       ├── Tries custom selectors (from chrome.storage.sync) first
       ├── Falls back to hardcoded default CSS selectors
       ├── Extracts up to 20 conversation titles (deduped, length 3-200 chars)
       │
       ▼
chrome.runtime.sendMessage({ type: 'CONVERSATION_SCRAPED', data: {...} })
       │
       ├── data.platform: 'chatgpt' | 'claude'
       ├── data.title: 'Recent ChatGPT/Claude Conversations'
       ├── data.titles: string[]  (the actual scraped titles)
       ├── data.messages: { role: 'user', content: title }[]  (titles repackaged as messages)
       ├── data.url: current page URL
       │
       ▼
background.js receives via chrome.runtime.onMessage
       │
       ├── Creates conversation object with id = `${platform}-${url}`
       ├── Calls saveConversation() → chrome.storage.local['conversations']
       │     (deduped by id, sorted newest-first, capped at 100)
       ├── Calls updateLastSynced() → chrome.storage.local['lastSynced'][platform]
       │
       ├── Calls shouldGenerateQuote() — checks:
       │     - Are there 0 quotes in storage? → YES
       │     - Was lastQuoteGenerated > 1 hour ago? → YES
       │     - Otherwise → NO (use cached quotes)
       │
       ▼ (if YES)
generateQuotes(conversation) in shared/quote-generator.js
       │
       ├── Reads settings from chrome.storage.sync: { provider, apiKey, model }
       ├── Gets API client via getApiClient(provider, apiKey, model)
       ├── Shuffles titles via Fisher-Yates
       ├── Builds prompt: "Find 25 REAL historical quotes related to these topics..."
       ├── Calls client.generateCompletion(prompt, { maxTokens: 4000, temperature: 1.0 })
       ├── Parses JSON response → array of { quote, author, topic }
       ├── Maps to full quote objects with id, text, author, topic, platform, timestamp
       │
       ▼
saveQuotes(quotes) → REPLACES all quotes in chrome.storage.local['quotes']
updateLastQuoteGenerated() → chrome.storage.local['lastQuoteGenerated']
       │
       ▼
User opens new tab
       │
       ▼
newtab.js loads
       │
       ├── Checks chrome.storage.sync['apiKey'] → if missing, show onboarding
       ├── Reads chrome.storage.local['quotes'] → if empty, show empty state
       ├── Picks random quote from array
       ├── Displays: "quote text" — Author Name, Because you were talking about [topic]
       └── Footer: "Last synced: ChatGPT X ago · Claude Y ago"
```

### Architecture Layers

The codebase has 4 clear layers, each in its own directory:

1. **Content Scripts** (`content-scripts/`) — DOM scraping on ChatGPT/Claude pages
2. **Background** (`background/`) — Service worker orchestrating scrape → generate → save
3. **Shared** (`shared/`) — Reusable modules: storage, API client, quote generator, selector tools
4. **UI** (`newtab/`, `options/`) — New tab display and settings page

Communication pattern: Content scripts → `chrome.runtime.sendMessage` → Background service worker → `chrome.storage` → New tab page reads storage.

## Relevant Code Map

| File | Role | Key Details |
|------|------|-------------|
| `manifest.json` | Extension manifest (MV3) | Defines permissions (storage, activeTab, tabs, scripting), host_permissions for chatgpt.com and claude.ai, content_scripts injection, service_worker registration, chrome_url_overrides for newtab |
| `background/background.js` | Service worker orchestrator | 76 lines. Receives `CONVERSATION_SCRAPED` messages, calls `saveConversation()`, `shouldGenerateQuote()`, `generateQuotes()`, `saveQuotes()`, `updateLastQuoteGenerated()`. Uses `importScripts()` to load shared modules. |
| `content-scripts/chatgpt.js` | ChatGPT scraper | 203 lines. Selector fallback chain: custom primary → custom fallbacks → 3 hardcoded defaults (`a[data-sidebar-item="true"] span.truncate`, `#history a`, `a[href*="/c/"]`). MutationObserver for SPA navigation. 3s delay for DOM. |
| `content-scripts/claude.js` | Claude scraper | 201 lines. Nearly identical to chatgpt.js. Hardcoded defaults: `a[data-dd-action-name="sidebar-chat-item"] span.truncate`, `a[href*="/chat/"]`, `nav[aria-label="Sidebar"] a`. Filters out "New chat", "Chats", "Projects". |
| `content-scripts/selector-mode.js` | Visual selector tool | 323 lines. IIFE. Mouseover highlighting, click capture, DOM context extraction, sends `ELEMENT_CAPTURED` message. ESC to exit. |
| `shared/storage.js` | Chrome storage abstraction | 269 lines. Functions: `saveConversation`, `getConversations`, `updateLastSynced`, `getLastSynced`, `saveQuote`, `saveQuotes` (replaces all), `getQuotes`, `saveCustomSelectors`, `getCustomSelectors`, `updateSelectorSuccess`, `isSelectorsStale`. Keys: `conversations`, `quotes`, `lastSynced`, `customSelectors`. Max 100 conversations. |
| `shared/api-client.js` | Unified AI API client | 291 lines. Three classes: `OpenAIClient`, `AnthropicClient`, `OpenRouterClient`. Factory: `getApiClient(provider, apiKey, model)`. OpenRouter has retry logic (3 retries, exponential backoff), usage tracking in `chrome.storage.local['openrouterUsageStats']`, detailed error handling. All return `{ content: string }`. |
| `shared/quote-generator.js` | Quote generation logic | 242 lines. `QUOTES_PER_BATCH = 25`. Prompt asks for real historical quotes as JSON array. `buildTopicsContext()` shuffles titles. `parseQuoteResponse()` handles JSON in markdown code blocks, regex fallback. `shouldGenerateQuote()` implements 1-hour cache. `generateQuotes()` is the main entry point. |
| `shared/selector-analyzer.js` | AI selector analysis | 200 lines. `analyzeSelectorWithAI(domContext, platform)` sends DOM context to LLM. `validateSelectors()` checks syntax and warns about fragile patterns (nth-child, deep child selectors). `isValidSelector()` uses `document.createDocumentFragment().querySelector()`. |
| `shared/selector-prompt.js` | Prompt generation for selectors | 254 lines. `generateSelectorPrompt(domContext, platform)` builds prompt with platform context, DOM structure, and examples. `parseSelectorResponse()` extracts JSON with primarySelector, fallbackSelectors, confidenceScore, reasoning. |
| `newtab/newtab.html` | New tab page HTML | 4 states: loading (spinner), onboarding (2-step setup), quote-display (blockquote + author + attribution), empty-state. Settings gear icon links to options. |
| `newtab/newtab.js` | New tab page logic | 127 lines. `init()`: check apiKey → check quotes → pick random → display. `formatRelativeTime()` for sync timestamps. |
| `newtab/newtab.css` | New tab styling | 213 lines. White background, dark text. Quote at 3rem (2rem mobile). Centered layout. Minimal, clean design. |
| `options/options.html` | Settings page | Provider select (OpenAI/Anthropic/OpenRouter), model select (shown only for OpenRouter), API key input, save button. Selector config section with tabs (ChatGPT/Claude), health monitoring, visual selector tool launcher. |
| `options/options.js` | Settings logic | 742 lines. Largest file. API key validation, selector tool launching (finds tab by URL, injects selector-mode.js, sends ACTIVATE_SELECTOR_MODE), element capture handling, AI analysis display, accept/retry/revert flows, health monitoring, usage stats. |
| `options/options.css` | Settings styling | 623 lines. Standard form styling, tab navigation, selector results display, confidence bars, health status indicators. |
| `package.json` | Dependencies | Only devDependency: `puppeteer` for visual testing. No build system. |

## Patterns and Conventions

### 1. Module loading pattern (no build system)

The codebase uses **no bundler** — it's plain JavaScript loaded via `<script>` tags and `importScripts()`. Modules export to both Node.js (`module.exports`) and browser (`self/window`) environments:

```javascript
// From shared/api-client.js:291
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getApiClient, OpenAIClient, AnthropicClient, OpenRouterClient };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  globalScope.getApiClient = getApiClient;
}
```

The background service worker uses `importScripts()`:
```javascript
// From background/background.js:7
importScripts('/shared/storage.js', '/shared/api-client.js', '/shared/quote-generator.js');
```

Options page loads scripts via `<script>` tags in order:
```html
<!-- From options/options.html:203-206 -->
<script src="../shared/selector-prompt.js"></script>
<script src="../shared/api-client.js"></script>
<script src="../shared/selector-analyzer.js"></script>
<script src="options.js"></script>
```

### 2. Chrome storage split

- **`chrome.storage.sync`**: Settings that should sync across devices — `provider`, `apiKey`, `model`, `chatgptSelectors`, `claudeSelectors`
- **`chrome.storage.local`**: Device-specific data — `conversations`, `quotes`, `lastSynced`, `lastQuoteGenerated`, `openrouterUsageStats`, `customSelectors`

### 3. Content script scraping pattern

Both chatgpt.js and claude.js follow an identical pattern:
1. Load custom selectors from `chrome.storage.sync`
2. Try custom primary selector → custom fallbacks → hardcoded defaults
3. Extract text from matching elements, filter by length (3-200 chars), deduplicate
4. Cap at 20 titles
5. Package as `{ platform, title, titles, messages, url }` and send via `chrome.runtime.sendMessage`
6. 3-second timeout after DOM ready
7. `MutationObserver` watching for URL changes (SPA navigation)

### 4. Message-passing protocol

Only two message types:
- `CONVERSATION_SCRAPED` — content script → background
- `ELEMENT_CAPTURED` — selector-mode.js → options page
- `ACTIVATE_SELECTOR_MODE` — options page → selector-mode.js content script
- `TEST_SELECTOR` — options page → selector-mode.js content script

### 5. Console logging convention

All logs prefixed with `"Quote Surfacer:"`:
```javascript
console.log('Quote Surfacer: ChatGPT content script loaded');
```

### 6. API client abstraction

All providers implement the same interface: `generateCompletion(prompt, options) → { content: string }`. The factory function `getApiClient(provider, apiKey, model)` returns the right client. This abstraction is clean and reusable.

### 7. CSS/UI conventions

- System font stack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- White background (#ffffff), dark text (#333)
- Max-width containers (800px for quotes, 600px for settings)
- Centered vertically and horizontally
- Minimal design — no heavy frameworks or component libraries

## Existing Utilities and Reusable Code

### Directly reusable (keep as-is or with minimal changes):

1. **`shared/api-client.js`** — The entire unified API client. Supports OpenAI, Anthropic, and OpenRouter with retry logic, error handling, and usage tracking. The `generateCompletion(prompt, options)` interface is generic enough for any prompt.

2. **`shared/storage.js`** — The conversation storage layer (`saveConversation`, `getConversations`, `updateLastSynced`, `getLastSynced`) and selector functions are fully reusable. The quote storage functions will need renaming/repurposing.

3. **Content scripts** (`chatgpt.js`, `claude.js`) — The entire scraping pipeline with selector fallback chains, SPA navigation detection, and custom selector support is reusable. The scraped data structure `{ platform, titles, messages, url }` is generic.

4. **`background/background.js`** — The message handling and orchestration pattern is reusable. Only the "what to do with scraped data" part needs to change.

5. **Selector system** (`selector-mode.js`, `selector-analyzer.js`, `selector-prompt.js`) — The entire AI-powered selector configuration system is reusable without changes.

6. **`options/`** — The settings page for API key configuration and selector management is reusable. Only needs cosmetic renaming.

### Needs modification:

1. **`shared/quote-generator.js`** — This is where the core logic change happens. The prompt, parsing, and generation logic need to be replaced with whatever the new content type is.

2. **`newtab/newtab.js`** — Display logic needs to change to show the new content type instead of quotes.

3. **`newtab/newtab.html`** and **`newtab/newtab.css`** — UI needs redesign for the new content type.

## Edge Cases and Gotchas

### 1. The quote generation is tightly coupled to the background worker

`background.js` calls `generateQuotes(conversation)` directly after saving. The "what to generate" logic is hardcoded in the flow:

```javascript
// background/background.js:56-64
const quotes = await generateQuotes(conversation);
if (quotes && quotes.length > 0) {
  await saveQuotes(quotes);
  await updateLastQuoteGenerated();
}
```

If you change what gets generated, you need to update this orchestration.

### 2. Content scripts send titles as messages too

Both content scripts package titles in TWO ways:
```javascript
// content-scripts/chatgpt.js:161-162
titles: titles,  // Send titles array
messages: titles.map(t => ({ role: 'user', content: t })), // Titles as messages for quote generation
```

The `quote-generator.js` prefers `conversation.titles` (line 46) but falls back to `conversation.messages` (line 51). If you change the data model, be aware of this duality.

### 3. `saveQuotes()` does a COMPLETE REPLACEMENT

Every generation cycle deletes all existing quotes and replaces them:
```javascript
// shared/storage.js:159
await chrome.storage.local.set({
  [STORAGE_KEYS.QUOTES]: quotesToSave
});
```

This means if the API call fails mid-generation, the user has no quotes until the next successful generation. There's no fallback to previous quotes.

### 4. The caching mechanism is timestamp-based, not content-based

`shouldGenerateQuote()` only checks time (1 hour), not whether the conversation topics have changed. If the user has new conversations but the cache is fresh, they'll see stale content until the hour expires.

### 5. `importScripts()` path is absolute from extension root

```javascript
importScripts('/shared/storage.js', '/shared/api-client.js', '/shared/quote-generator.js');
```

If you rename or move the shared modules, the background worker will fail silently on startup.

### 6. No error surfacing to the user

API errors in the background worker are only logged to `console.error`. The new tab page shows "No quotes yet" with no indication that generation failed. Users have no way to know if their API key is wrong except by checking the service worker console.

### 7. Selector staleness uses `chrome.storage.sync` but health tracking uses `chrome.storage.local`

`chatgptSelectors` and `claudeSelectors` are in `chrome.storage.sync` (options.js:384), but the `customSelectors` key in storage.js uses `chrome.storage.local`. There's a potential inconsistency — options page writes to sync, but `storage.js` functions read from local. However, the content scripts read directly from sync (line 11 of chatgpt.js: `chrome.storage.sync.get('chatgptSelectors')`), bypassing the storage.js abstraction entirely. This is a minor inconsistency but not a bug since each path reads from where it writes.

### 8. No rate limiting for scrape-triggered generation

Every `CONVERSATION_SCRAPED` message triggers the `shouldGenerateQuote()` check. If the user navigates rapidly on ChatGPT (SPA navigation triggers re-scrape every URL change), multiple generation attempts could fire. The 1-hour cache mostly prevents this, but there's no mutex/lock.

## Potential Bugs or Tech Debt Found

1. **Duplicate `tryExtractWithSelector` function**: chatgpt.js and claude.js have nearly identical implementations of the same scraping logic. This should be extracted to a shared module.

2. **`selector-mode.js` injected but not declared in manifest**: The file `content-scripts/selector-mode.js` is dynamically injected via `chrome.scripting.executeScript()` from options.js, not listed in the manifest's `content_scripts`. This is intentional (it's an on-demand tool), but it means it doesn't have access to the shared modules unless they're also injected.

3. **`saveQuote()` (singular) is never called**: Storage has both `saveQuote()` and `saveQuotes()`. The singular version appends; the plural replaces all. Only `saveQuotes()` is used in production. The singular function is dead code.

4. **Anthropic model hardcoded**: The `AnthropicClient` defaults to `claude-3-5-haiku-20241022` (line 52 of api-client.js), and the options page validation test also hardcodes this model (line 86 of options.js). These should reference a shared constant.

5. **`quote-generator.js.backup` exists**: There's a backup file in `shared/` — likely leftover from development.

## Open Questions

1. **What should the new content be?** You said "display something else on new tabs based on user chat history." What specifically?
   - Beautiful images/art related to conversation topics?
   - Visual/aesthetic content (typography, patterns, gradients)?
   - Poems, aphorisms, or other literary forms?
   - Visual summaries or mind maps of recent conversations?
   - Something else entirely?

2. **Should the scraping scope change?** Currently the extension only scrapes conversation *titles* from the sidebar (up to 20). Should it also scrape:
   - Actual message content?
   - More titles (>20)?
   - Other metadata (timestamps, conversation length)?

3. **What AI provider should be the default?** The current codebase supports OpenAI, Anthropic, and OpenRouter. Should the new extension:
   - Keep all three options?
   - Default to a specific one?
   - Add image generation APIs (DALL-E, Midjourney, etc.)?

4. **What's the caching strategy?** Currently it's a simple 1-hour TTL. Should the new content:
   - Refresh more/less frequently?
   - Cache more items per batch?
   - Be content-aware (regenerate when topics change)?

5. **Name and branding**: The project is called "beauty-on-new-tabs" — does this confirm it's visual/aesthetic content? What should the extension name be in the manifest?

6. **Should the extension be a fork or a rewrite?** The current codebase is functional but has some tech debt (duplicate code, no build system, hardcoded models). Should we:
   - Fork and modify (faster, carries forward tech debt)?
   - Rewrite from scratch using the same architecture (cleaner, more work)?
   - Something in between (copy specific modules)?
