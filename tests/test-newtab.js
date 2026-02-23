/**
 * Test: newtab/ — HTML structure, CSS, and JS logic validation
 * Run: node tests/test-newtab.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// --- HTML Tests ---
console.log('\n--- newtab.html ---');
const html = fs.readFileSync(path.join(__dirname, '..', 'newtab', 'newtab.html'), 'utf-8');

assert(html.includes('id="loading-state"'), 'loading-state div exists');
assert(html.includes('id="onboarding-state"'), 'onboarding-state div exists');
assert(html.includes('id="art-display"'), 'art-display div exists');
assert(html.includes('id="generating-state"'), 'generating-state div exists');
assert(html.includes('Generating art'), 'Generating state shows generating message');
assert(html.includes('id="empty-state"'), 'empty-state div exists');
assert(html.includes('class="spinner"'), 'Spinner element in loading state');
assert(html.includes('id="setup-btn"'), 'Setup button in onboarding');
assert(html.includes('Open Settings'), 'Open Settings button text');
assert(html.includes('sandbox="allow-scripts"'), 'iframe has sandbox=allow-scripts');
assert(html.includes('title="Generated Art"'), 'iframe has title');
assert(html.includes('id="art-frame"'), 'art-frame iframe exists');
assert(html.includes('id="art-topics"'), 'art-topics element exists');
assert(html.includes('id="art-budget"'), 'art-budget element exists');
assert(html.includes('id="refresh-btn"'), 'refresh button exists');
assert(html.includes('&#x21bb;') || html.includes('\u21bb'), 'Refresh button has refresh icon');
assert(html.includes('id="settings-link"'), 'settings link exists');
assert(html.includes('&#x2699;') || html.includes('\u2699'), 'Settings link has gear icon');
assert(html.includes('chatgpt.com'), 'Empty state links to ChatGPT');
assert(html.includes('claude.ai'), 'Empty state links to Claude');
assert(html.includes('target="_blank"'), 'External links open in new tab');
assert(html.includes('id="sync-status"'), 'sync-status div exists');
assert(html.includes('../shared/storage.js'), 'Loads storage.js');
assert(html.includes('newtab.js'), 'Loads newtab.js');
assert(html.includes('newtab.css'), 'Loads newtab.css');

// Footer and info popup
assert(html.includes('id="art-footer"'), 'Footer bar exists');
assert(html.includes('id="info-trigger"'), 'Info trigger icon exists');
assert(html.includes('id="info-popup"'), 'Info popup exists');
assert(html.includes('id="footer-label"'), 'Footer label exists');
assert(html.includes('Murmuration'), 'Footer shows extension name');

// --- CSS Tests ---
console.log('\n--- newtab.css ---');
const css = fs.readFileSync(path.join(__dirname, '..', 'newtab', 'newtab.css'), 'utf-8');

assert(css.includes('width: 100%') && css.includes('height: 100%'), 'html/body are 100% width/height');
assert(css.includes('overflow: hidden'), 'No overflow on body');
assert(css.includes('display: flex') || css.includes('display:flex'), '.state uses flexbox');
assert(css.includes('align-items: center') || css.includes('align-items:center'), 'States are centered');
assert(css.includes('@keyframes spin'), 'Spinner animation defined');
assert(css.includes('max-width'), 'Onboarding/empty have max-width');
assert(css.includes('border: none') || css.includes('border:none'), 'iframe has no border');
assert(css.includes('position: fixed') || css.includes('position:fixed'), 'Footer uses fixed positioning');
assert(css.includes('cursor: pointer') || css.includes('cursor:pointer'), 'Interactive elements have pointer cursor');
assert(css.includes('border-radius: 50%') || css.includes('border-radius:50%'), 'Refresh button is circular');
assert(css.includes('opacity: 0'), 'Footer hidden by default');
assert(css.includes('opacity: 1'), 'Footer visible on hover');
assert(css.includes('#info-popup'), 'Info popup styled');
assert(css.includes('display: none'), 'Info popup hidden by default');
assert(css.includes('display: block'), 'Info popup shown on hover');

// --- JS Tests ---
console.log('\n--- newtab.js ---');
const js = fs.readFileSync(path.join(__dirname, '..', 'newtab', 'newtab.js'), 'utf-8');

// init function
assert(js.includes('async function init'), 'init function defined');
assert(js.includes("chrome.storage.sync.get('apiKey')") || js.includes('chrome.storage.sync.get("apiKey")'),
  'init checks for apiKey');
assert(js.includes("showState('onboarding-state')") || js.includes('showState("onboarding-state")'),
  'Shows onboarding when no API key');
assert(js.includes('openOptionsPage'), 'Setup button opens options page');
assert(js.includes('getArtifacts'), 'init calls getArtifacts');
assert(js.includes('REQUEST_GENERATION'), 'Triggers generation from new tab if needed');
assert(js.includes('shouldGenerate'), 'Checks budget before triggering');
assert(js.includes('getConversations'), 'Checks conversations exist before triggering');
assert(js.includes("showState('generating-state')") || js.includes('showState("generating-state")'),
  'Shows generating state when generation is triggered');
assert(js.includes('pollForArtifacts'), 'Polls for artifacts after triggering generation');

// displayArtifact
assert(js.includes('function displayArtifact'), 'displayArtifact function defined');
assert(js.includes('postMessage'), 'Sends art HTML via postMessage to sandbox');
assert(js.includes('sandbox.html'), 'Loads sandbox.html in iframe');
assert(js.includes('.join'), 'Joins topics with separator');
assert(js.includes('getGenerationStatus'), 'Shows budget status');

// Refresh button logic
assert(js.includes('refresh-btn'), 'Wires up refresh button');
assert(js.includes('nextIndex') || js.includes('currentIndex'), 'Tracks current index for non-repeat');
assert(js.includes('while') && js.includes('currentIndex'), 'Avoids repeating same artifact');
assert(js.includes('artifacts.length <= 1'), 'Handles single artifact case');

// showSyncStatus
assert(js.includes('function showSyncStatus') || js.includes('async function showSyncStatus'),
  'showSyncStatus function defined');
assert(js.includes('getLastSynced'), 'Reads last synced data');
assert(js.includes('No conversations synced yet'), 'Shows message when no syncs');

// formatRelativeTime
assert(js.includes('function formatRelativeTime'), 'formatRelativeTime defined');
assert(js.includes('just now'), 'Handles "just now"');
assert(js.includes('m ago'), 'Handles minutes ago');
assert(js.includes('h ago'), 'Handles hours ago');
assert(js.includes('d ago'), 'Handles days ago');

// showState
assert(js.includes('function showState'), 'showState function defined');
assert(js.includes("querySelectorAll('.state')") || js.includes('querySelectorAll(".state")'),
  'showState hides all states');

// DOMContentLoaded
assert(js.includes('DOMContentLoaded'), 'Triggers init on DOMContentLoaded');

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
