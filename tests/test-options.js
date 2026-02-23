/**
 * Test: options/ — HTML structure, CSS, and JS logic validation
 * Run: node tests/test-options.js
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
console.log('\n--- options.html ---');
const html = fs.readFileSync(path.join(__dirname, '..', 'options', 'options.html'), 'utf-8');

assert(html.includes('Murmuration'), 'Page title contains extension name');
assert(html.includes('<title>Murmuration'), 'HTML title tag set');
assert(html.includes('id="apiKey"'), 'API key input exists');
assert(html.includes('type="password"'), 'API key input is password type');
assert(html.includes('id="model"'), 'Model input exists');
assert(html.includes('id="dailyBudget"'), 'Daily budget input exists');
assert(html.includes('type="number"'), 'Budget is number input');
assert(html.includes('min="1"'), 'Budget min is 1');
assert(html.includes('max="20"'), 'Budget max is 20');
assert(html.includes('value="3"'), 'Budget default is 3');
assert(html.includes('id="save-btn"'), 'Save button exists');
assert(html.includes('id="save-status"'), 'Save status area exists');
assert(html.includes('id="gen-status"'), 'Generation status display exists');
assert(html.includes('id="gen-stats"'), 'Generation stats display exists');
assert(html.includes('id="artifact-count"'), 'Artifact count display exists');
assert(html.includes('data-platform="chatgpt"'), 'ChatGPT tab exists');
assert(html.includes('data-platform="claude"'), 'Claude tab exists');
assert(html.includes('id="primary-selector"'), 'Primary selector input exists');
assert(html.includes('id="fallback-selectors"'), 'Fallback selectors textarea exists');
assert(html.includes('id="save-selectors-btn"'), 'Save selectors button exists');
assert(html.includes('../shared/storage.js'), 'Loads storage.js');
assert(html.includes('options.js'), 'Loads options.js');
assert(html.includes('options.css'), 'Loads options.css');

// --- CSS Tests ---
console.log('\n--- options.css ---');
const css = fs.readFileSync(path.join(__dirname, '..', 'options', 'options.css'), 'utf-8');

assert(css.includes('max-width: 560px') || css.includes('max-width:560px'), 'Container has max-width ~560px');
assert(css.includes('border-bottom'), 'Sections have border separators');
assert(css.includes('width: 100%') || css.includes('width:100%'), 'Form inputs have full width');
assert(css.includes('padding'), 'Form inputs have padding');
assert(css.includes('background: #333') || css.includes('background:#333'), 'Primary buttons have dark background');
assert(css.includes('.btn:hover') || css.includes('.btn:hover'), 'Buttons have hover states');
assert(css.includes('.btn-secondary'), 'Secondary button style defined');
assert(css.includes('.tab.active'), 'Active tab style defined');
assert(css.includes('color: #fff') || css.includes('color:#fff'), 'Active tab has white text');
assert(css.includes('.hint'), 'Hint text style defined');
assert(css.includes('color: #999') || css.includes('color:#999'), 'Hint text is muted');
assert(css.includes('color: #4a4') || css.includes('color:#4a4'), 'Status text is green');

// --- JS Tests ---
console.log('\n--- options.js ---');
const js = fs.readFileSync(path.join(__dirname, '..', 'options', 'options.js'), 'utf-8');

// Settings load
assert(js.includes('DOMContentLoaded'), 'Waits for DOMContentLoaded');
assert(js.includes("chrome.storage.sync.get") && js.includes("'apiKey'"), 'Loads apiKey from storage');
assert(js.includes("'model'"), 'Loads model from storage');
assert(js.includes("'dailyBudget'"), 'Loads dailyBudget from storage');

// Settings save
assert(js.includes('async function saveSettings') || js.includes('function saveSettings'), 'saveSettings defined');
assert(js.includes('chrome.storage.sync.set'), 'Saves to chrome.storage.sync');
assert(js.includes("'Saved'") || js.includes('"Saved"'), 'Shows Saved status');
assert(js.includes('setTimeout'), 'Auto-clears status after timeout');
assert(js.includes('parseInt'), 'Parses daily budget as integer');

// Generation stats
assert(js.includes('getGenerationStatus'), 'Calls getGenerationStatus');
assert(js.includes('getGenerationStats'), 'Calls getGenerationStats');
assert(js.includes('successRate'), 'Displays success rate');
assert(js.includes('No attempts today'), 'Shows "No attempts today" when no attempts');
assert(js.includes('getArtifacts'), 'Gets artifact count');
assert(js.includes('art pieces cached'), 'Shows cached count text');

// Token usage
assert(html.includes('id="token-usage"'), 'Token usage container exists');
assert(html.includes('Token Usage'), 'Token usage section heading exists');
assert(js.includes('loadTokenUsage'), 'loadTokenUsage function defined');
assert(js.includes('getTokenUsage'), 'Calls getTokenUsage from storage');
assert(js.includes('token-table'), 'Creates token usage table');
assert(js.includes('promptTokens'), 'Shows prompt tokens');
assert(js.includes('completionTokens'), 'Shows completion tokens');
assert(js.includes('totalTokens'), 'Shows total tokens');
assert(js.includes('toLocaleString'), 'Formats token numbers with commas');
assert(css.includes('.token-table'), 'Token table styled');
assert(css.includes('.token-total'), 'Token total styled');

// Selector tabs
assert(js.includes('setupSelectorTabs'), 'setupSelectorTabs function defined');
assert(js.includes('chatgptSelectors'), 'Handles chatgptSelectors key');
assert(js.includes('claudeSelectors'), 'Handles claudeSelectors key');
assert(js.includes("classList.remove('active')") || js.includes('classList.remove("active")'),
  'Removes active class on tab switch');
assert(js.includes("classList.add('active')") || js.includes('classList.add("active")'),
  'Adds active class on tab switch');
assert(js.includes('loadSelectors'), 'loadSelectors function defined');
assert(js.includes('primary-selector'), 'Reads primary selector input');
assert(js.includes('fallback-selectors'), 'Reads fallback selectors textarea');

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
