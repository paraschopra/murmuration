/**
 * Test: shared/storage.js — all storage functions
 * Run: node tests/test-storage.js
 *
 * Uses a mock chrome.storage API to test without a browser.
 */

// --- Mock chrome.storage ---
const store = { local: {}, sync: {} };

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
        // Simulate quota error if _simulateQuotaError is set
        if (store.local._simulateQuotaError) {
          store.local._simulateQuotaError--;
          const err = new Error('QUOTA_BYTES quota exceeded');
          err.message = 'QUOTA_BYTES quota exceeded';
          throw err;
        }
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
        // Object form with defaults
        const result = {};
        for (const [k, v] of Object.entries(keys)) {
          result[k] = store.sync[k] !== undefined ? JSON.parse(JSON.stringify(store.sync[k])) : v;
        }
        return result;
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          store.sync[k] = JSON.parse(JSON.stringify(v));
        }
      }
    }
  }
};

// Load the storage module and expose as globals (mimicking browser behavior)
const storageModule = require('../shared/storage.js');
Object.assign(globalThis, storageModule);

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

function resetStore() {
  store.local = {};
  store.sync = {};
}

async function testConversationStorage() {
  console.log('\n--- Conversation Storage ---');
  resetStore();

  // STORAGE_KEYS should exist
  assert(typeof STORAGE_KEYS === 'object', 'STORAGE_KEYS is defined');
  assert(STORAGE_KEYS.CONVERSATIONS === 'conversations', 'CONVERSATIONS key defined');
  assert(STORAGE_KEYS.ARTIFACTS === 'artifacts', 'ARTIFACTS key defined');
  assert(STORAGE_KEYS.LAST_SYNCED === 'lastSynced', 'LAST_SYNCED key defined');
  assert(STORAGE_KEYS.GENERATION_LOG === 'generationLog', 'GENERATION_LOG key defined');
  assert(STORAGE_KEYS.GENERATION_STATS === 'generationStats', 'GENERATION_STATS key defined');

  // getConversations returns empty array when empty
  let convos = await getConversations();
  assert(Array.isArray(convos) && convos.length === 0, 'getConversations returns [] when empty');

  // saveConversation adds new conversation
  await saveConversation({ id: 'test-1', title: 'First', timestamp: 1 });
  convos = await getConversations();
  assert(convos.length === 1, 'saveConversation adds new conversation');
  assert(convos[0].id === 'test-1', 'Saved conversation has correct id');

  // saveConversation upserts (replaces existing)
  await saveConversation({ id: 'test-1', title: 'Updated', timestamp: 2 });
  convos = await getConversations();
  assert(convos.length === 1, 'saveConversation upserts - no duplicate');
  assert(convos[0].title === 'Updated', 'saveConversation upserts - value updated');

  // saveConversation prepends new conversations
  await saveConversation({ id: 'test-2', title: 'Second', timestamp: 3 });
  convos = await getConversations();
  assert(convos.length === 2, 'Two conversations stored');
  assert(convos[0].id === 'test-2', 'New conversation is prepended (first)');

  // saveConversation trims to MAX_CONVERSATIONS (100)
  resetStore();
  for (let i = 0; i < 105; i++) {
    await saveConversation({ id: `conv-${i}`, title: `Conv ${i}`, timestamp: i });
  }
  convos = await getConversations();
  assert(convos.length === 100, 'Trims to MAX_CONVERSATIONS (100)');
  assert(convos[0].id === 'conv-104', 'Most recent is first after trim');
}

async function testLastSynced() {
  console.log('\n--- Last Synced ---');
  resetStore();

  // getLastSynced returns empty object when empty
  let synced = await getLastSynced();
  assert(typeof synced === 'object' && Object.keys(synced).length === 0, 'getLastSynced returns {} when empty');

  // updateLastSynced stores per-platform timestamp
  await updateLastSynced('chatgpt');
  synced = await getLastSynced();
  assert(typeof synced.chatgpt === 'number', 'chatgpt timestamp stored');

  await updateLastSynced('claude');
  synced = await getLastSynced();
  assert(typeof synced.chatgpt === 'number' && typeof synced.claude === 'number',
    'Both platform timestamps stored independently');
}

async function testArtifactStorage() {
  console.log('\n--- Artifact Storage ---');
  resetStore();

  // getArtifacts returns empty array when empty
  let arts = await getArtifacts();
  assert(Array.isArray(arts) && arts.length === 0, 'getArtifacts returns [] when empty');

  // saveArtifact prepends
  await saveArtifact({ id: 'art-1', html: '<h1>1</h1>', topics: ['a'], timestamp: 1 });
  arts = await getArtifacts();
  assert(arts.length === 1, 'saveArtifact adds artifact');
  assert(arts[0].id === 'art-1', 'Artifact has correct id');

  await saveArtifact({ id: 'art-2', html: '<h1>2</h1>', topics: ['b'], timestamp: 2 });
  arts = await getArtifacts();
  assert(arts.length === 2, 'Two artifacts stored');
  assert(arts[0].id === 'art-2', 'New artifact prepended');

  // Trims to MAX_ARTIFACTS (100)
  resetStore();
  for (let i = 0; i < 105; i++) {
    await saveArtifact({ id: `art-${i}`, html: `<h1>${i}</h1>`, topics: ['x'], timestamp: i });
  }
  arts = await getArtifacts();
  assert(arts.length === 100, 'Trims to MAX_ARTIFACTS (100)');
  assert(arts[0].id === 'art-104', 'Most recent is first');

  // Quota error handling: removes oldest and retries
  resetStore();
  for (let i = 0; i < 10; i++) {
    await saveArtifact({ id: `art-${i}`, html: `<h1>${i}</h1>`, topics: ['x'], timestamp: i });
  }
  // Simulate quota error on next save (1 failure, then success on retry)
  store.local._simulateQuotaError = 1;
  await saveArtifact({ id: 'art-new', html: '<h1>new</h1>', topics: ['y'], timestamp: 100 });
  arts = await getArtifacts();
  assert(arts[0].id === 'art-new', 'Artifact saved after quota retry');
  assert(arts.length <= 6, 'Oldest artifacts removed during quota recovery (10 - 5 + 1 = 6)');

  // Double quota error: graceful degradation (no throw)
  resetStore();
  store.local._simulateQuotaError = 99; // always fail
  let threw = false;
  try {
    await saveArtifact({ id: 'art-fail', html: '<h1>fail</h1>', topics: ['z'], timestamp: 200 });
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'Double quota error does not throw (graceful degradation)');
  store.local._simulateQuotaError = 0;
}

async function testDailyBudget() {
  console.log('\n--- Daily Budget ---');
  resetStore();

  // getTodayKey returns YYYY-MM-DD format
  const key = getTodayKey();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(key), 'getTodayKey returns YYYY-MM-DD format');

  // shouldGenerate returns true when no generations today
  let can = await shouldGenerate();
  assert(can === true, 'shouldGenerate returns true when no generations today');

  // DEFAULT_DAILY_BUDGET is 3
  assert(DEFAULT_DAILY_BUDGET === 3, 'DEFAULT_DAILY_BUDGET is 3');

  // recordGeneration increments count
  await recordGeneration();
  let status = await getGenerationStatus();
  assert(status.used === 1, 'recordGeneration increments to 1');
  assert(status.budget === 3, 'Default budget is 3');

  await recordGeneration();
  await recordGeneration();
  status = await getGenerationStatus();
  assert(status.used === 3, 'Three generations recorded');

  // shouldGenerate returns false when at budget
  can = await shouldGenerate();
  assert(can === false, 'shouldGenerate returns false at budget limit');

  // Custom budget via chrome.storage.sync
  store.sync.dailyBudget = 5;
  can = await shouldGenerate();
  assert(can === true, 'shouldGenerate respects custom budget from sync storage');

  // Prune old entries
  resetStore();
  // Manually add old entries
  const oldLog = {};
  for (let i = 1; i <= 10; i++) {
    oldLog[`2020-01-${String(i).padStart(2, '0')}`] = i;
  }
  store.local[STORAGE_KEYS.GENERATION_LOG] = oldLog;
  await recordGeneration(); // Should prune old entries
  const result = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = result[STORAGE_KEYS.GENERATION_LOG];
  const logKeys = Object.keys(log);
  assert(logKeys.length <= 7, 'recordGeneration prunes to last 7 days');
}

async function testGenerationStats() {
  console.log('\n--- Generation Stats ---');
  resetStore();

  // getGenerationStats returns zeros when empty
  let stats = await getGenerationStats();
  assert(stats.total === 0, 'total is 0 when empty');
  assert(stats.succeeded === 0, 'succeeded is 0 when empty');
  assert(stats.failed === 0, 'failed is 0 when empty');
  assert(stats.successRate === 0, 'successRate is 0 when empty');

  // recordGenerationResult(true) increments succeeded
  await recordGenerationResult(true);
  stats = await getGenerationStats();
  assert(stats.succeeded === 1, 'recordGenerationResult(true) increments succeeded');
  assert(stats.total === 1, 'total is 1 after one success');
  assert(stats.successRate === 100, 'successRate is 100% with all successes');

  // recordGenerationResult(false) increments failed
  await recordGenerationResult(false);
  stats = await getGenerationStats();
  assert(stats.failed === 1, 'recordGenerationResult(false) increments failed');
  assert(stats.total === 2, 'total is 2 after one success and one failure');
  assert(stats.successRate === 50, 'successRate is 50% with 1 success 1 failure');

  // Pruning old stats
  resetStore();
  const oldStats = {};
  for (let i = 1; i <= 10; i++) {
    oldStats[`2020-01-${String(i).padStart(2, '0')}`] = { succeeded: 1, failed: 0 };
  }
  store.local[STORAGE_KEYS.GENERATION_STATS] = oldStats;
  await recordGenerationResult(true);
  const result = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_STATS);
  const statsStore = result[STORAGE_KEYS.GENERATION_STATS];
  assert(Object.keys(statsStore).length <= 7, 'Old stats entries pruned to 7 days');
}

async function testTokenUsage() {
  console.log('\n--- Token Usage ---');
  resetStore();

  // getTokenUsage returns empty object when empty
  let usage = await getTokenUsage();
  assert(typeof usage === 'object' && Object.keys(usage).length === 0, 'getTokenUsage returns {} when empty');

  // recordTokenUsage stores token data for today
  await recordTokenUsage({ promptTokens: 100, completionTokens: 200, totalTokens: 300 });
  usage = await getTokenUsage();
  const today = getTodayKey();
  assert(usage[today] !== undefined, 'Token usage recorded for today');
  assert(usage[today].promptTokens === 100, 'Prompt tokens recorded correctly');
  assert(usage[today].completionTokens === 200, 'Completion tokens recorded correctly');
  assert(usage[today].totalTokens === 300, 'Total tokens recorded correctly');

  // recordTokenUsage accumulates within same day
  await recordTokenUsage({ promptTokens: 50, completionTokens: 150, totalTokens: 200 });
  usage = await getTokenUsage();
  assert(usage[today].promptTokens === 150, 'Prompt tokens accumulated');
  assert(usage[today].completionTokens === 350, 'Completion tokens accumulated');
  assert(usage[today].totalTokens === 500, 'Total tokens accumulated');

  // Prune old entries to 10 days
  resetStore();
  const oldUsage = {};
  for (let i = 1; i <= 15; i++) {
    oldUsage[`2020-01-${String(i).padStart(2, '0')}`] = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
  }
  store.local[STORAGE_KEYS.TOKEN_USAGE] = oldUsage;
  await recordTokenUsage({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  usage = await getTokenUsage();
  assert(Object.keys(usage).length <= 10, 'Token usage pruned to last 10 days');
}

async function testModuleExports() {
  console.log('\n--- Module Exports ---');

  assert(typeof saveConversation === 'function', 'saveConversation exported');
  assert(typeof getConversations === 'function', 'getConversations exported');
  assert(typeof updateLastSynced === 'function', 'updateLastSynced exported');
  assert(typeof getLastSynced === 'function', 'getLastSynced exported');
  assert(typeof saveArtifact === 'function', 'saveArtifact exported');
  assert(typeof getArtifacts === 'function', 'getArtifacts exported');
  assert(typeof shouldGenerate === 'function', 'shouldGenerate exported');
  assert(typeof recordGeneration === 'function', 'recordGeneration exported');
  assert(typeof getGenerationStatus === 'function', 'getGenerationStatus exported');
  assert(typeof getTodayKey === 'function', 'getTodayKey exported');
  assert(typeof recordGenerationResult === 'function', 'recordGenerationResult exported');
  assert(typeof getGenerationStats === 'function', 'getGenerationStats exported');
  assert(typeof recordTokenUsage === 'function', 'recordTokenUsage exported');
  assert(typeof getTokenUsage === 'function', 'getTokenUsage exported');
}

// Run all tests
(async () => {
  try {
    await testConversationStorage();
    await testLastSynced();
    await testArtifactStorage();
    await testDailyBudget();
    await testGenerationStats();
    await testTokenUsage();
    await testModuleExports();
  } catch (e) {
    console.error('Test runner error:', e);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
