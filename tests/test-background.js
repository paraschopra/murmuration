/**
 * Test: background/background.js — service worker orchestration
 * Run: node tests/test-background.js
 */

// --- Mock chrome APIs ---
const store = { local: {}, sync: {} };
let messageListeners = [];
let consoleLogs = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Capture console output
console.log = (...args) => { consoleLogs.push(args.join(' ')); };
console.warn = (...args) => { consoleLogs.push(args.join(' ')); };
console.error = (...args) => { consoleLogs.push(args.join(' ')); };

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        const result = {};
        for (const k of keys) {
          if (store.local[k] !== undefined) result[k] = JSON.parse(JSON.stringify(store.local[k]));
        }
        return result;
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          store.local[k] = JSON.parse(JSON.stringify(v));
        }
      }
    },
    sync: {
      get: async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) {
            if (store.sync[k] !== undefined) result[k] = JSON.parse(JSON.stringify(store.sync[k]));
          }
          return result;
        }
        return {};
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          store.sync[k] = JSON.parse(JSON.stringify(v));
        }
      }
    }
  },
  runtime: {
    onMessage: {
      addListener: (fn) => { messageListeners.push(fn); }
    }
  }
};

// Mock fetch for API calls
let fetchResponse = null;
globalThis.fetch = async () => {
  if (fetchResponse instanceof Error) throw fetchResponse;
  return fetchResponse;
};

// Mock importScripts (no-op, we load modules via require)
globalThis.importScripts = () => {};

// Load shared modules
const storageModule = require('../shared/storage.js');
Object.assign(globalThis, storageModule);
const apiModule = require('../shared/api-client.js');
Object.assign(globalThis, apiModule);
const artModule = require('../shared/art-generator.js');
Object.assign(globalThis, artModule);

// Load background worker
require('../background/background.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    originalLog(`  PASS: ${message}`);
    passed++;
  } else {
    originalError(`  FAIL: ${message}`);
    failed++;
  }
}

function resetState() {
  store.local = {};
  store.sync = {};
  consoleLogs = [];
  fetchResponse = null;
}

function mockSuccessfulGeneration() {
  const htmlContent = '<html><head></head><body><canvas id="art"></canvas><script>/* animated art piece with enough characters */</script></body></html>';
  fetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: htmlContent } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content: htmlContent } }] })
  };
}

// --- Tests ---

async function testMessageListener() {
  originalLog('\n--- Message Listener ---');

  assert(messageListeners.length >= 1, 'At least one message listener registered');

  // Test that listener returns true (async response)
  const listener = messageListeners[messageListeners.length - 1];
  const result = listener({ type: 'UNKNOWN' }, {}, () => {});
  assert(result === true, 'Listener returns true for async response');
}

async function testConversationScraped() {
  originalLog('\n--- handleConversationScraped ---');
  resetState();

  const listener = messageListeners[messageListeners.length - 1];

  // Set up API key so generation can be attempted
  store.sync.apiKey = 'sk-test';
  mockSuccessfulGeneration();

  // Send a scrape message
  const data = {
    platform: 'chatgpt',
    title: 'Recent ChatGPT Conversations',
    titles: ['Machine Learning', 'Philosophy', 'Cooking'],
    url: 'https://chatgpt.com/c/123'
  };
  listener({ type: 'CONVERSATION_SCRAPED', data }, {}, () => {});

  // Wait for async processing
  await new Promise(r => setTimeout(r, 200));

  // Check conversation was saved
  const convos = await getConversations();
  assert(convos.length >= 1, 'Conversation saved after scrape');
  assert(convos[0].platform === 'chatgpt', 'Conversation has correct platform');

  // Check last synced was updated
  const synced = await getLastSynced();
  assert(typeof synced.chatgpt === 'number', 'Last synced updated for chatgpt');

  // Check debounce: second scrape within 60s should be ignored
  const convoCountBefore = (await getConversations()).length;
  consoleLogs = [];
  listener({ type: 'CONVERSATION_SCRAPED', data }, {}, () => {});
  await new Promise(r => setTimeout(r, 100));
  const hasDebounceLog = consoleLogs.some(l => l.includes('Debouncing') || l.includes('debouncing'));
  assert(hasDebounceLog, 'Second scrape within 60s is debounced (logs debounce message)');
}

async function testRequestGeneration() {
  originalLog('\n--- REQUEST_GENERATION ---');
  resetState();

  store.sync.apiKey = 'sk-test';
  mockSuccessfulGeneration();

  // Add some conversations first
  await saveConversation({
    id: 'chatgpt-test',
    platform: 'chatgpt',
    titles: ['AI Ethics', 'Neural Networks', 'Deep Learning'],
    timestamp: Date.now()
  });

  const listener = messageListeners[messageListeners.length - 1];
  listener({ type: 'REQUEST_GENERATION' }, {}, () => {});

  await new Promise(r => setTimeout(r, 300));

  // Check artifact was generated
  const arts = await getArtifacts();
  assert(arts.length >= 1, 'Artifact generated after REQUEST_GENERATION');
}

async function testTryGenerateBudgetExhausted() {
  originalLog('\n--- tryGenerate budget exhausted ---');
  resetState();

  store.sync.apiKey = 'sk-test';
  store.sync.dailyBudget = 1;

  // Record one generation to exhaust budget
  await recordGeneration();

  // Add conversations
  await saveConversation({
    id: 'test',
    platform: 'chatgpt',
    titles: ['Topic1'],
    timestamp: Date.now()
  });

  consoleLogs = [];
  const listener = messageListeners[messageListeners.length - 1];
  listener({ type: 'REQUEST_GENERATION' }, {}, () => {});
  await new Promise(r => setTimeout(r, 200));

  const hasBudgetLog = consoleLogs.some(l => l.includes('budget') || l.includes('Budget'));
  assert(hasBudgetLog, 'Logs budget exhausted message');

  // No new artifacts
  const arts = await getArtifacts();
  assert(arts.length === 0, 'No artifact generated when budget exhausted');
}

async function testTryGenerateNoTitles() {
  originalLog('\n--- tryGenerate no titles ---');
  resetState();

  store.sync.apiKey = 'sk-test';

  consoleLogs = [];
  const listener = messageListeners[messageListeners.length - 1];
  listener({ type: 'REQUEST_GENERATION' }, {}, () => {});
  await new Promise(r => setTimeout(r, 200));

  const hasNoTitlesLog = consoleLogs.some(l => l.includes('No titles') || l.includes('no titles'));
  assert(hasNoTitlesLog, 'Logs no titles message when no conversations exist');
}

async function testTryGenerateFailurePreservesBudget() {
  originalLog('\n--- tryGenerate failure preserves budget ---');
  resetState();

  store.sync.apiKey = 'sk-test';

  // Mock a failed API call
  fetchResponse = {
    ok: false,
    status: 500,
    headers: { get: () => null },
    json: async () => ({ error: { message: 'Internal error' } }),
    text: async () => '{"error":{"message":"Internal error"}}'
  };

  await saveConversation({
    id: 'test',
    platform: 'chatgpt',
    titles: ['Topic1', 'Topic2', 'Topic3'],
    timestamp: Date.now()
  });

  const listener = messageListeners[messageListeners.length - 1];
  listener({ type: 'REQUEST_GENERATION' }, {}, () => {});
  await new Promise(r => setTimeout(r, 300));

  // Budget should NOT be consumed on failure
  const status = await getGenerationStatus();
  assert(status.used === 0, 'Budget not consumed on failed generation');

  // Stats should record the failure
  const stats = await getGenerationStats();
  assert(stats.failed >= 1, 'Failure recorded in stats');
  assert(stats.succeeded === 0, 'No success recorded');
}

async function testTryGenerateSuccessRecordsBudget() {
  originalLog('\n--- tryGenerate success records budget ---');
  resetState();

  store.sync.apiKey = 'sk-test';
  mockSuccessfulGeneration();

  await saveConversation({
    id: 'test',
    platform: 'chatgpt',
    titles: ['Topic1', 'Topic2', 'Topic3'],
    timestamp: Date.now()
  });

  const listener = messageListeners[messageListeners.length - 1];
  listener({ type: 'REQUEST_GENERATION' }, {}, () => {});
  await new Promise(r => setTimeout(r, 300));

  // Budget should be consumed on success
  const status = await getGenerationStatus();
  assert(status.used === 1, 'Budget consumed on successful generation');

  // Stats should record success
  const stats = await getGenerationStats();
  assert(stats.succeeded >= 1, 'Success recorded in stats');
}

// Run all tests
(async () => {
  try {
    await testMessageListener();
    await testConversationScraped();
    await testRequestGeneration();
    await testTryGenerateBudgetExhausted();
    await testTryGenerateNoTitles();
    await testTryGenerateFailurePreservesBudget();
    await testTryGenerateSuccessRecordsBudget();
  } catch (e) {
    originalError('Test runner error:', e);
    failed++;
  }

  // Restore console
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
