/**
 * Test: content-scripts/chatgpt.js and claude.js — structural validation
 * Run: node tests/test-content-scripts.js
 *
 * Content scripts run in browser context with DOM APIs.
 * These tests validate file structure, selectors, and message format.
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

function testScript(filename, platform, expectedSelectors) {
  const filePath = path.join(__dirname, '..', 'content-scripts', filename);
  assert(fs.existsSync(filePath), `${filename} exists`);

  const content = fs.readFileSync(filePath, 'utf-8');

  // Selectors
  for (const sel of expectedSelectors) {
    assert(content.includes(sel), `Contains selector: ${sel}`);
  }
  assert((content.match(/DEFAULT_SELECTORS/) || []).length >= 1, 'Defines DEFAULT_SELECTORS array');

  // Platform
  assert(content.includes(`'${platform}'`), `Platform is '${platform}'`);

  // Message format
  assert(content.includes('CONVERSATION_SCRAPED'), 'Sends CONVERSATION_SCRAPED message type');
  assert(content.includes('chrome.runtime.sendMessage'), 'Uses chrome.runtime.sendMessage');
  assert(content.includes('platform:'), 'Message includes platform field');
  assert(content.includes('titles:'), 'Message includes titles field');
  assert(content.includes('window.location.href'), 'Message includes URL from window.location');

  // MutationObserver for SPA
  assert(content.includes('MutationObserver'), 'Uses MutationObserver for SPA detection');

  // Debounce
  assert(content.includes('Debounce') || content.includes('debounce') || content.includes('DEBOUNCE'),
    'Has debounce mechanism');

  // Log prefix
  assert(content.includes('Murmuration:'), 'Log messages use correct prefix');

  // IIFE wrapper (no global pollution)
  assert(content.includes('(function()') || content.includes('(() =>'), 'Wrapped in IIFE');

  // Does not throw when sidebar is collapsed (no aggressive DOM access without try/catch)
  assert(content.includes('try') || content.includes('catch'), 'Has error handling for selector failures');
}

console.log('\n--- ChatGPT Content Script ---');
testScript('chatgpt.js', 'chatgpt', [
  'a[data-sidebar-item="true"] span.truncate',
  'a[href*="/c/"]'
]);

console.log('\n--- Claude Content Script ---');
testScript('claude.js', 'claude', [
  'a[data-dd-action-name="sidebar-chat-item"] span.truncate',
  'a[href*="/chat/"]'
]);

// Claude-specific: noise filtering
const claudeContent = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'claude.js'), 'utf-8');
console.log('\n--- Claude Noise Filtering ---');
assert(claudeContent.includes('New chat') || claudeContent.includes('new chat'), 'Claude filters "New chat" noise');
assert(claudeContent.includes('NOISE_ITEMS') || claudeContent.includes('noise'), 'Claude has noise item filtering');

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
