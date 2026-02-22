# Plan: Beauty on New Tabs — Generative Art Chrome Extension

**Date**: 2026-02-22
**Based on**: sprints/v1/research.md + change-required.md
**Estimated scope**: L — ~15 new files, full extension from scratch (adapting architecture from quotes-on-newtabs)

## Overview

We're building a Manifest V3 Chrome extension that scrapes conversation titles from ChatGPT and Claude, then uses an LLM to generate self-contained HTML/CSS/JS art pieces reflecting the user's state of mind. These art pieces (black-and-white, animated, minimal ASCII/fractal/generative art) are displayed in an iframe on every new tab. The user configures a daily generation budget (default 3), and each generation uses 3 random topics from the scraped list to ensure variety across artifacts.

The architecture follows the same proven pattern from quotes-on-newtabs: content scripts scrape → background worker orchestrates → LLM generates → storage caches → new tab displays. The key difference: instead of generating 25 text quotes per batch, we generate 1 full HTML page per API call, up to N times per day.

## Key Decisions

1. **Store HTML as strings in chrome.storage.local** — Each artifact is a self-contained HTML string (typically 2-10KB). With a default budget of 3/day and keeping the last 20 artifacts, we stay well under chrome.storage.local's 10MB limit. No need for `unlimitedStorage` permission.

2. **iframe for display with injected CSP** — The generated HTML runs in a sandboxed iframe using `srcdoc`. This provides isolation (no access to extension APIs or parent page). Additionally, we inject a strict Content-Security-Policy `<meta>` tag into the generated HTML before loading it, preventing external network requests (no image loading, no fetch, no exfiltration). The CSP: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;`.

3. **Daily budget instead of hourly TTL, with dual trigger** — Instead of the original's 1-hour cache timer, we track generations per calendar day. Generation triggers both on scrape events AND on new tab load (if budget remains and topics exist but no artifacts yet). This ensures art is generated even if the user doesn't visit ChatGPT/Claude frequently.

4. **3 random topics per generation** — From the full scraped title list (up to 20), we randomly pick 3 for each generation call. This maximizes diversity across artifacts while keeping the prompt focused. This number 3 should be user configurable in settings.

4. **3 random topics per generation** — From the full scraped title list (up to 20), we randomly pick 3 for each generation call. This maximizes diversity across artifacts while keeping the prompt focused.

5. **Keep all 3 API providers** — OpenAI, Anthropic, OpenRouter all work. The HTML generation prompt is provider-agnostic. But default to openrouter with claude sonnet 4.6 model. Search on openrouter website to pick exact names. Give haiku and opus also. And for OpenAI give GPT5.2 and all its variants.

6. **No build system** — Match the original's convention: plain JS, `importScripts()`, `<script>` tags. No bundler.

## Changes

### New File: `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Beauty on New Tabs",
  "version": "1.0.0",
  "description": "Generative art on every new tab, inspired by your AI conversations",
  "permissions": ["storage", "activeTab", "tabs", "scripting"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://claude.ai/*"
  ],
  "background": {
    "service_worker": "background/background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*"],
      "js": ["content-scripts/chatgpt.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content-scripts/claude.js"],
      "run_at": "document_idle"
    }
  ],
  "chrome_url_overrides": {
    "newtab": "newtab/newtab.html"
  },
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### New File: `shared/storage.js`

Adapted from the original. Key changes: replaces quote storage with artifact storage, adds daily budget tracking.

**Storage key layout:**
- `chrome.storage.sync`: `provider`, `apiKey`, `model`, `dailyBudget`, `chatgptSelectors`, `claudeSelectors`
- `chrome.storage.local`: `conversations`, `artifacts`, `lastSynced`, `generationLog`, `customSelectors`

```javascript
const STORAGE_KEYS = {
  CONVERSATIONS: 'conversations',
  ARTIFACTS: 'artifacts',         // was 'quotes'
  LAST_SYNCED: 'lastSynced',
  GENERATION_LOG: 'generationLog', // was 'lastQuoteGenerated'
  CUSTOM_SELECTORS: 'customSelectors'
};

const MAX_CONVERSATIONS = 100;
const MAX_ARTIFACTS = 20;
const DEFAULT_DAILY_BUDGET = 3;

// --- Conversation storage (reuse from original as-is) ---

async function saveConversation(conversation) {
  const conversations = await getConversations();
  const existingIndex = conversations.findIndex(c => c.id === conversation.id);
  if (existingIndex >= 0) {
    conversations[existingIndex] = conversation;
  } else {
    conversations.unshift(conversation);
  }
  const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
  await chrome.storage.local.set({ [STORAGE_KEYS.CONVERSATIONS]: trimmed });
}

async function getConversations() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONVERSATIONS);
  return result[STORAGE_KEYS.CONVERSATIONS] || [];
}

async function updateLastSynced(platform) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_SYNCED);
  const lastSynced = result[STORAGE_KEYS.LAST_SYNCED] || {};
  lastSynced[platform] = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SYNCED]: lastSynced });
}

async function getLastSynced() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_SYNCED);
  return result[STORAGE_KEYS.LAST_SYNCED] || {};
}

// --- Artifact storage (replaces quote storage) ---

async function saveArtifact(artifact) {
  // Appends a new artifact, keeps last MAX_ARTIFACTS
  const artifacts = await getArtifacts();
  artifacts.unshift(artifact);
  const trimmed = artifacts.slice(0, MAX_ARTIFACTS);
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: trimmed });
}

async function getArtifacts() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ARTIFACTS);
  return result[STORAGE_KEYS.ARTIFACTS] || [];
}

// --- Daily budget tracking (replaces hourly TTL) ---

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function shouldGenerate() {
  const { dailyBudget } = await chrome.storage.sync.get('dailyBudget');
  const budget = dailyBudget || DEFAULT_DAILY_BUDGET;

  const result = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = result[STORAGE_KEYS.GENERATION_LOG] || {};
  const todayCount = log[getTodayKey()] || 0;

  return todayCount < budget;
}

async function recordGeneration() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = result[STORAGE_KEYS.GENERATION_LOG] || {};
  const today = getTodayKey();
  log[today] = (log[today] || 0) + 1;

  // Prune old entries (keep last 7 days)
  const keys = Object.keys(log).sort().slice(-7);
  const pruned = {};
  keys.forEach(k => pruned[k] = log[k]);

  await chrome.storage.local.set({ [STORAGE_KEYS.GENERATION_LOG]: pruned });
}

async function getGenerationStatus() {
  const { dailyBudget } = await chrome.storage.sync.get('dailyBudget');
  const budget = dailyBudget || DEFAULT_DAILY_BUDGET;
  const result = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = result[STORAGE_KEYS.GENERATION_LOG] || {};
  const todayCount = log[getTodayKey()] || 0;
  return { used: todayCount, budget };
}

// --- Selector storage (reuse from original as-is) ---
// saveCustomSelectors, getCustomSelectors, updateSelectorSuccess, isSelectorsStale
// ... (copy from original)

// Module export pattern
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { saveConversation, getConversations, updateLastSynced, getLastSynced,
    saveArtifact, getArtifacts, shouldGenerate, recordGeneration, getGenerationStatus,
    getTodayKey, STORAGE_KEYS, DEFAULT_DAILY_BUDGET };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, { saveConversation, getConversations, updateLastSynced, getLastSynced,
    saveArtifact, getArtifacts, shouldGenerate, recordGeneration, getGenerationStatus,
    getTodayKey, STORAGE_KEYS, DEFAULT_DAILY_BUDGET });
}
```

### New File: `shared/api-client.js`

Copy from the original with one change: update the default Anthropic model to `claude-sonnet-4-20250514`.

The core interface stays identical: `getApiClient(provider, apiKey, model)` returning an object with `generateCompletion(prompt, options) → { content: string }`.

Three classes: `OpenAIClient`, `AnthropicClient`, `OpenRouterClient`. OpenRouter keeps its retry logic and usage tracking. No structural changes needed — the art generation prompt is just a different string passed to the same `generateCompletion()`.

### New File: `shared/art-generator.js` (replaces `quote-generator.js`)

This is the core logic change. Instead of generating 25 quotes, we generate 1 self-contained HTML art piece.

```javascript
const TOPICS_PER_GENERATION = 3;

function pickRandomTopics(titles, count) {
  // Fisher-Yates shuffle on a copy, take first `count`
  const shuffled = [...titles];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function buildArtPrompt(topics) {
  return `Based on given topics that user has been chatting about, create a self-contained html/css/js page that can be shown to the user in an iframe on a new tab to reflect her state of mind. Pick one topic or some common theme, don't mix everything.

Create a minimal ascii or related art, html css based. e.g. Fractal, aquarium, scenery. Glitchy, whimsical, awe-inspiring. Black and white only. (White background preferred). Animated. Be creative. Reflect state of user's mind. Pick odd ones, surprise the user. Don't be boring.

RULES:
- Output ONLY the self-contained HTML. No explanation, no markdown.
- Must be a single HTML page with inline <style> and optional <script>.
- NO external assets (no image URLs, no CDN links, no external scripts/fonts).
- Colors: black, white, and grayscale ONLY.
- Keep it concise — under 8000 tokens of HTML.

Topics: ${topics.join(', ')}`;
}

function parseArtResponse(responseContent) {
  // The LLM should return raw HTML, but may wrap it in markdown code blocks
  let html = responseContent.trim();

  // Strip markdown code block wrapper if present
  const codeBlockMatch = html.match(/```(?:html)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    html = codeBlockMatch[1].trim();
  }

  // Validate: must contain meaningful HTML tags
  const hasHtmlTag = /<(?:html|style|canvas|svg|body|div)/i.test(html);
  if (!hasHtmlTag || html.length < 50) {
    throw new Error('Response does not appear to contain valid HTML');
  }

  // Size guard: reject if over 500KB
  if (html.length > 500000) {
    throw new Error('Generated HTML exceeds 500KB size limit');
  }

  // Inject strict CSP meta tag to block external requests
  const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:;">';
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + cspMeta);
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', '<html><head>' + cspMeta + '</head>');
  } else {
    html = cspMeta + html;
  }

  return html;
}

async function generateArt(allTitles) {
  console.log('Beauty on New Tabs: Starting art generation');

  const settings = await chrome.storage.sync.get(['provider', 'apiKey', 'model']);
  if (!settings.apiKey) {
    throw new Error('No API key configured');
  }

  const client = getApiClient(settings.provider || 'anthropic', settings.apiKey, settings.model);
  const topics = pickRandomTopics(allTitles, TOPICS_PER_GENERATION);

  console.log('Beauty on New Tabs: Generating art for topics:', topics);

  const prompt = buildArtPrompt(topics);
  const response = await client.generateCompletion(prompt, {
    maxTokens: 8000,
    temperature: 1.0
  });

  const html = parseArtResponse(response.content);

  const artifact = {
    id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    html: html,
    topics: topics,
    timestamp: Date.now()
  };

  console.log('Beauty on New Tabs: Art generated successfully, size:', html.length, 'bytes');
  return artifact;
}

// Module export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateArt, pickRandomTopics, buildArtPrompt, parseArtResponse, TOPICS_PER_GENERATION };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, { generateArt, pickRandomTopics, buildArtPrompt, parseArtResponse, TOPICS_PER_GENERATION });
}
```

### New File: `background/background.js`

Adapted orchestration: scrape → check daily budget → generate art → save artifact.

```javascript
importScripts('/shared/storage.js', '/shared/api-client.js', '/shared/art-generator.js');

// Debounce: ignore scrapes within 60s per platform
const lastScrapeTime = {};
const SCRAPE_DEBOUNCE_MS = 60000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONVERSATION_SCRAPED') {
    handleConversationScraped(message.data).catch(err => {
      console.error('Beauty on New Tabs: Error handling scraped conversation:', err);
    });
  }
  if (message.type === 'REQUEST_GENERATION') {
    // Triggered from new tab page when budget remains but no artifacts exist
    handleGenerationRequest().catch(err => {
      console.error('Beauty on New Tabs: Error handling generation request:', err);
    });
  }
  return true;
});

async function handleConversationScraped(data) {
  // Debounce: skip if same platform scraped within 60s
  const now = Date.now();
  if (lastScrapeTime[data.platform] && (now - lastScrapeTime[data.platform]) < SCRAPE_DEBOUNCE_MS) {
    console.log('Beauty on New Tabs: Debouncing scrape from', data.platform);
    return;
  }
  lastScrapeTime[data.platform] = now;

  console.log('Beauty on New Tabs: Received scraped data from', data.platform);

  // Save conversation
  const conversation = {
    id: `${data.platform}-${data.url}`,
    platform: data.platform,
    title: data.title,
    titles: data.titles,
    url: data.url,
    timestamp: Date.now()
  };
  await saveConversation(conversation);
  await updateLastSynced(data.platform);

  await tryGenerate();
}

async function handleGenerationRequest() {
  await tryGenerate();
}

async function tryGenerate() {
  // Check if we should generate
  const canGenerate = await shouldGenerate();
  if (!canGenerate) {
    console.log('Beauty on New Tabs: Daily budget exhausted, skipping generation');
    return;
  }

  // Gather all titles from recent conversations
  const conversations = await getConversations();
  const allTitles = [];
  for (const conv of conversations) {
    if (conv.titles) {
      allTitles.push(...conv.titles);
    }
  }
  // Deduplicate
  const uniqueTitles = [...new Set(allTitles)];

  if (uniqueTitles.length === 0) {
    console.log('Beauty on New Tabs: No titles available for generation');
    return;
  }

  try {
    const artifact = await generateArt(uniqueTitles);
    await saveArtifact(artifact);
    await recordGeneration();
    console.log('Beauty on New Tabs: Artifact saved successfully');
  } catch (err) {
    console.error('Beauty on New Tabs: Art generation failed:', err);
  }
}
```

### New Files: Content Scripts (`content-scripts/chatgpt.js`, `content-scripts/claude.js`)

These are copied from the original with only branding changes (`"Quote Surfacer:"` → `"Beauty on New Tabs:"`). The scraping logic, selector fallback chains, MutationObserver SPA detection, and message format all stay identical.

The message format remains:
```javascript
chrome.runtime.sendMessage({
  type: 'CONVERSATION_SCRAPED',
  data: {
    platform: 'chatgpt', // or 'claude'
    title: 'Recent ChatGPT Conversations',
    titles: titles,
    messages: titles.map(t => ({ role: 'user', content: t })),
    url: window.location.href
  }
});
```

No structural changes. The `messages` field is carried for backwards compatibility but won't be used by the new art generator (which uses `titles` directly via `getConversations()`).

### New File: `newtab/newtab.html`

Complete redesign. Instead of blockquote display, the page hosts a full-viewport iframe for the generated art.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Tab</title>
  <link rel="stylesheet" href="newtab.css">
</head>
<body>
  <div id="loading-state" class="state">
    <div class="spinner"></div>
  </div>

  <div id="onboarding-state" class="state" style="display:none">
    <div class="onboarding-container">
      <h1>Beauty on New Tabs</h1>
      <p>Generative art inspired by your AI conversations.</p>
      <p>Set up your API key to get started.</p>
      <button id="setup-btn" class="btn">Open Settings</button>
    </div>
  </div>

  <div id="art-display" class="state" style="display:none">
    <iframe id="art-frame" sandbox="allow-scripts" title="Generated Art"></iframe>
    <div id="art-meta">
      <span id="art-topics"></span>
      <span id="art-budget"></span>
    </div>
    <button id="refresh-btn" class="icon-btn" title="Show another">&#x21bb;</button>
    <a id="settings-link" href="#" title="Settings">&#x2699;</a>
  </div>

  <div id="empty-state" class="state" style="display:none">
    <div class="empty-container">
      <h2>No art yet</h2>
      <p>Visit <a href="https://chatgpt.com" target="_blank">ChatGPT</a> or
         <a href="https://claude.ai" target="_blank">Claude</a> to start generating.</p>
      <div id="sync-status"></div>
    </div>
  </div>

  <script src="../shared/storage.js"></script>
  <script src="newtab.js"></script>
</body>
</html>
```

### New File: `newtab/newtab.js`

```javascript
async function init() {
  // Check for API key
  const settings = await chrome.storage.sync.get('apiKey');
  if (!settings.apiKey) {
    showState('onboarding-state');
    document.getElementById('setup-btn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  // Check for artifacts
  const artifacts = await getArtifacts();
  if (!artifacts || artifacts.length === 0) {
    // Fallback: try to trigger generation from new tab if budget allows
    const canGenerate = await shouldGenerate();
    const conversations = await getConversations();
    if (canGenerate && conversations.length > 0) {
      chrome.runtime.sendMessage({ type: 'REQUEST_GENERATION' });
    }
    showState('empty-state');
    await showSyncStatus();
    return;
  }

  // Pick random artifact and display
  displayArtifact(artifacts);
}

function displayArtifact(artifacts) {
  let currentIndex = Math.floor(Math.random() * artifacts.length);
  const frame = document.getElementById('art-frame');
  const topicsEl = document.getElementById('art-topics');

  function showArtifact(index) {
    const artifact = artifacts[index];
    frame.srcdoc = artifact.html;
    topicsEl.textContent = artifact.topics.join(' · ');
  }

  showArtifact(currentIndex);

  // Show budget status
  getGenerationStatus().then(status => {
    const budgetEl = document.getElementById('art-budget');
    budgetEl.textContent = `${status.used}/${status.budget} today`;
  });

  showState('art-display');

  // Refresh button: pick a DIFFERENT random artifact (avoid repeats)
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (artifacts.length <= 1) return;
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * artifacts.length);
    } while (nextIndex === currentIndex);
    currentIndex = nextIndex;
    showArtifact(currentIndex);
  });

  // Settings link
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

async function showSyncStatus() {
  const lastSynced = await getLastSynced();
  const statusEl = document.getElementById('sync-status');
  const parts = [];
  if (lastSynced.chatgpt) parts.push(`ChatGPT: ${formatRelativeTime(lastSynced.chatgpt)}`);
  if (lastSynced.claude) parts.push(`Claude: ${formatRelativeTime(lastSynced.claude)}`);
  statusEl.textContent = parts.length > 0
    ? `Last synced: ${parts.join(' · ')}`
    : 'No conversations synced yet';
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showState(stateId) {
  document.querySelectorAll('.state').forEach(el => el.style.display = 'none');
  document.getElementById(stateId).style.display = '';
}

document.addEventListener('DOMContentLoaded', init);
```

### New File: `newtab/newtab.css`

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #fff;
  color: #333;
  overflow: hidden;
}

.state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Loading */
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #eee;
  border-top-color: #333;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Onboarding & Empty */
.onboarding-container,
.empty-container {
  text-align: center;
  max-width: 400px;
  padding: 2rem;
}

.onboarding-container h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.onboarding-container p,
.empty-container p {
  color: #666;
  margin-bottom: 1rem;
  line-height: 1.5;
}

.btn {
  padding: 0.6rem 1.5rem;
  background: #333;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.btn:hover {
  background: #555;
}

/* Art display */
#art-display {
  position: relative;
  flex-direction: column;
}

#art-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

#art-meta {
  position: fixed;
  bottom: 12px;
  left: 16px;
  font-size: 0.75rem;
  color: #aaa;
  display: flex;
  gap: 1rem;
}

#refresh-btn {
  position: fixed;
  bottom: 12px;
  right: 56px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 1rem;
  color: #aaa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

#refresh-btn:hover {
  color: #333;
  border-color: #999;
}

#settings-link {
  position: fixed;
  bottom: 12px;
  right: 16px;
  font-size: 1.2rem;
  color: #aaa;
  text-decoration: none;
}

#settings-link:hover {
  color: #333;
}

/* Empty state */
.empty-container h2 {
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
}

.empty-container a {
  color: #333;
}

#sync-status {
  font-size: 0.8rem;
  color: #999;
  margin-top: 1rem;
}
```

### New File: `options/options.html`

Simplified from the original. Adds a "Daily Budget" setting. Keeps API provider selection and selector configuration.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Beauty on New Tabs — Settings</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div class="container">
    <h1>Beauty on New Tabs</h1>

    <section class="section">
      <h2>API Configuration</h2>

      <label for="provider">Provider</label>
      <select id="provider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
      </select>

      <div id="model-group" style="display:none">
        <label for="model">Model</label>
        <input type="text" id="model" placeholder="e.g. anthropic/claude-sonnet-4-20250514">
      </div>

      <label for="apiKey">API Key</label>
      <input type="password" id="apiKey" placeholder="sk-...">

      <label for="dailyBudget">Daily generation limit</label>
      <input type="number" id="dailyBudget" min="1" max="20" value="3">
      <p class="hint">How many art pieces to generate per day (each uses one API call)</p>

      <button id="save-btn" class="btn">Save Settings</button>
      <div id="save-status" class="status"></div>
    </section>

    <section class="section">
      <h2>Generation Status</h2>
      <div id="gen-status">Loading...</div>
      <div id="artifact-count">Loading...</div>
    </section>

    <section class="section">
      <h2>Custom Selectors</h2>
      <p class="hint">Advanced: customize which elements are scraped from ChatGPT/Claude sidebars.</p>

      <div class="tabs">
        <button class="tab active" data-platform="chatgpt">ChatGPT</button>
        <button class="tab" data-platform="claude">Claude</button>
      </div>

      <div id="selector-config">
        <label for="primary-selector">Primary CSS Selector</label>
        <input type="text" id="primary-selector" placeholder="Leave empty for default">

        <label for="fallback-selectors">Fallback Selectors (one per line)</label>
        <textarea id="fallback-selectors" rows="3" placeholder="Leave empty for defaults"></textarea>

        <button id="save-selectors-btn" class="btn btn-secondary">Save Selectors</button>
      </div>
    </section>
  </div>

  <script src="../shared/storage.js"></script>
  <script src="../shared/api-client.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

### New File: `options/options.js`

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.sync.get(['provider', 'apiKey', 'model', 'dailyBudget']);
  if (settings.provider) document.getElementById('provider').value = settings.provider;
  if (settings.apiKey) document.getElementById('apiKey').value = settings.apiKey;
  if (settings.model) document.getElementById('model').value = settings.model;
  document.getElementById('dailyBudget').value = settings.dailyBudget || 3;

  // Show/hide model field for OpenRouter
  const providerSelect = document.getElementById('provider');
  toggleModelField(providerSelect.value);
  providerSelect.addEventListener('change', (e) => toggleModelField(e.target.value));

  // Save settings
  document.getElementById('save-btn').addEventListener('click', saveSettings);

  // Load generation status
  await loadStatus();

  // Selector tabs
  setupSelectorTabs();
});

function toggleModelField(provider) {
  document.getElementById('model-group').style.display =
    provider === 'openrouter' ? '' : 'none';
}

async function saveSettings() {
  const settings = {
    provider: document.getElementById('provider').value,
    apiKey: document.getElementById('apiKey').value,
    dailyBudget: parseInt(document.getElementById('dailyBudget').value) || 3
  };

  if (settings.provider === 'openrouter') {
    settings.model = document.getElementById('model').value;
  }

  await chrome.storage.sync.set(settings);

  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Saved';
  setTimeout(() => statusEl.textContent = '', 2000);
}

async function loadStatus() {
  const status = await getGenerationStatus();
  document.getElementById('gen-status').textContent =
    `Generated today: ${status.used} / ${status.budget}`;

  const artifacts = await getArtifacts();
  document.getElementById('artifact-count').textContent =
    `${artifacts.length} art pieces cached`;
}

function setupSelectorTabs() {
  // Tab switching and selector save logic
  // (Simplified version — full selector tool integration can be added later)
  const tabs = document.querySelectorAll('.tab');
  let activePlatform = 'chatgpt';

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activePlatform = tab.dataset.platform;
      loadSelectors(activePlatform);
    });
  });

  loadSelectors(activePlatform);

  document.getElementById('save-selectors-btn').addEventListener('click', async () => {
    const key = activePlatform === 'chatgpt' ? 'chatgptSelectors' : 'claudeSelectors';
    const primary = document.getElementById('primary-selector').value.trim();
    const fallbacks = document.getElementById('fallback-selectors').value
      .split('\n').map(s => s.trim()).filter(Boolean);

    const selectors = {};
    if (primary || fallbacks.length > 0) {
      selectors[key] = { primary, fallbacks };
    }
    await chrome.storage.sync.set(selectors);
  });
}

async function loadSelectors(platform) {
  const key = platform === 'chatgpt' ? 'chatgptSelectors' : 'claudeSelectors';
  const result = await chrome.storage.sync.get(key);
  const sel = result[key] || {};
  document.getElementById('primary-selector').value = sel.primary || '';
  document.getElementById('fallback-selectors').value = (sel.fallbacks || []).join('\n');
}
```

### New File: `options/options.css`

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #fff;
  color: #333;
  padding: 2rem;
}

.container {
  max-width: 560px;
  margin: 0 auto;
}

h1 {
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.section {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #eee;
}

label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.3rem;
  margin-top: 0.8rem;
}

input[type="text"],
input[type="password"],
input[type="number"],
select,
textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  font-family: inherit;
}

.hint {
  font-size: 0.8rem;
  color: #999;
  margin-top: 0.3rem;
}

.btn {
  margin-top: 1rem;
  padding: 0.5rem 1.2rem;
  background: #333;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn:hover { background: #555; }

.btn-secondary {
  background: #fff;
  color: #333;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background: #f5f5f5;
}

.status {
  font-size: 0.85rem;
  color: #4a4;
  margin-top: 0.5rem;
}

.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 1rem;
}

.tab {
  padding: 0.4rem 1rem;
  background: #f5f5f5;
  border: 1px solid #ddd;
  cursor: pointer;
  font-size: 0.85rem;
}

.tab:first-child { border-radius: 4px 0 0 4px; }
.tab:last-child { border-radius: 0 4px 4px 0; border-left: none; }

.tab.active {
  background: #333;
  color: #fff;
  border-color: #333;
}
```

### Icons

Placeholder icons needed at `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`. Simple black-and-white geometric icon matching the aesthetic. These can be generated or hand-crafted.

## Implementation Order

1. **Scaffold core infrastructure** — Create `manifest.json`, `shared/storage.js`, `shared/api-client.js`. Verify by: loading the extension in `chrome://extensions` without errors.

2. **Build art generator** — Create `shared/art-generator.js` with the prompt, topic picker, and HTML parser. Verify by: unit testing `pickRandomTopics()` and `parseArtResponse()` with sample data.

3. **Build background worker** — Create `background/background.js` with the message handler and orchestration. Verify by: loading extension, opening service worker DevTools, confirming it initializes without errors.

4. **Build new tab page** — Create `newtab/newtab.html`, `newtab/newtab.js`, `newtab/newtab.css`. Verify by: opening a new tab, seeing the onboarding state. Manually adding a test artifact to storage and refreshing to see the iframe display.

5. **Build options page** — Create `options/options.html`, `options/options.js`, `options/options.css`. Verify by: opening the options page, saving an API key, confirming it persists in `chrome.storage.sync`.

6. **Port content scripts** — Create `content-scripts/chatgpt.js` and `content-scripts/claude.js` from the original with branding changes. Verify by: visiting chatgpt.com or claude.ai and checking the service worker console for "Beauty on New Tabs: Received scraped data" messages.

7. **End-to-end test** — Configure API key, visit ChatGPT/Claude, open new tab, see generated art. Verify by: complete flow working.

8. **Create placeholder icons** — Add simple icons at the three required sizes. Verify by: icons visible in `chrome://extensions`.

## Edge Cases to Handle

1. **Generated HTML is too large for storage** — If an LLM returns a massive HTML page (>500KB), truncate or reject it. Add a size check in `saveArtifact()` with a 500KB limit per artifact.

2. **LLM returns non-HTML response** — `parseArtResponse()` validates the response contains HTML tags. On failure, log the error and don't save — the user keeps their existing artifacts.

3. **All artifacts displayed are the same** — The refresh button picks randomly, which could repeat. Track the current index and exclude it from the next pick.

4. **iframe content tries to escape sandbox** — The `sandbox="allow-scripts"` attribute blocks navigation, forms, popups, and top-level navigation. Only scripts run. Additionally, a strict CSP `<meta>` tag is injected into the HTML before loading, blocking all external network requests (images, scripts, fetch). The `srcdoc` approach without `allow-same-origin` provides a second layer of isolation.

5. **Daily budget resets at midnight local time** — `getTodayKey()` uses local date. If the user travels across time zones, the budget may reset early or late. This is acceptable for v1.

6. **No topics scraped yet but API key is set** — Show the empty state with sync status. Don't attempt generation with zero topics.

7. **Multiple rapid scrape events** — Same issue as original: no mutex. The `shouldGenerate()` check + `recordGeneration()` write aren't atomic. In the worst case, we overshoot the daily budget by 1-2. Acceptable for v1.

## What NOT to Do (Out of Scope)

- **No selector tool UI** (the visual selector mode from the original) — The advanced selector configuration can be typed manually. The full visual tool with injection, highlighting, and AI analysis is a v2 feature.
- **No selector health monitoring** — Another v2 feature.
- **No OpenRouter usage stats display** — Simplify the options page.
- **No image generation APIs** — We're using text LLMs to generate HTML art, not DALL-E/Midjourney.
- **No build system** — Stay consistent with plain JS, no webpack/vite/rollup.
- **No deduplication of displayed artifacts** — Random selection with possible repeats is fine for v1.
- **No export/share functionality** — Users can't save or share generated art pieces yet.

## Testing Approach

No test framework in the original, and no build system to run one easily. Testing strategy for v1:

1. **Manual testing via Chrome DevTools** — Load extension, use console to inspect storage, trigger flows manually.
2. **Storage inspection** — Use `chrome.storage.local.get(null, console.log)` in service worker console to verify data shape.
3. **Mock generation** — Manually inject test artifacts into storage to verify display without API calls:
   ```javascript
   // In service worker console:
   chrome.storage.local.set({ artifacts: [{
     id: 'test-1', html: '<html><body><h1 style="text-align:center;margin-top:40vh">Test</h1></body></html>',
     topics: ['testing'], timestamp: Date.now()
   }]});
   ```
4. **Content script verification** — Visit chatgpt.com/claude.ai and check console for scrape logs.

## Risks

1. **LLM output quality varies wildly** — Some models may produce broken HTML, overly verbose pages, or content that doesn't match the aesthetic (color, animation). The prompt is opinionated but models may not follow it well. Mitigation: test with multiple providers and tune the prompt.

2. **Storage limits** — If generated HTML pages are consistently large (50KB+), 20 artifacts = 1MB. Still within limits but worth monitoring. If models generate pages with embedded base64 images or large SVGs, we could hit limits faster.

3. **`srcdoc` iframe rendering** — Some complex CSS/JS in generated HTML may not render correctly in a sandboxed iframe without `allow-same-origin`. Canvas-based art and CSS animations should work fine. WebGL might not.

4. **Content script selectors break** — ChatGPT and Claude update their UIs frequently. The hardcoded CSS selectors may stop working. This is an inherited risk from the original architecture, mitigated by the fallback chain and custom selector support.

5. **Token cost** — Generating full HTML pages uses more tokens than generating quotes (maxTokens capped at 8000). Based on the example visual (~2,500-3,000 tokens for a rich multi-phase animated ASCII art piece), expect ~3K-6K tokens per generation. With default 3/day, this is ~9K-18K output tokens/day. Reasonable but users should be aware of cost implications with expensive models.

## Codex Review Notes

This plan was reviewed by OpenAI Codex. Key improvements incorporated from the review:
- **CSP injection**: Strict Content-Security-Policy meta tag injected into generated HTML to block external network requests and data exfiltration
- **Scrape debounce**: 60-second debounce per platform in background worker to prevent rapid-fire generation from SPA navigation
- **Fallback generation trigger**: New tab page sends `REQUEST_GENERATION` message to background worker if budget remains but no artifacts exist
- **Lower maxTokens**: Reduced from 16000 to 4000 to control cost and output size
- **Size guard**: Hard 500KB limit on generated HTML with validation
- **Stronger prompt guardrails**: Explicit rules for no external assets, no color, concise output
- **Non-repeating refresh**: Refresh button tracks current index and picks a different artifact
- **Stricter HTML validation**: Regex check for actual HTML tags instead of just checking for `<`
