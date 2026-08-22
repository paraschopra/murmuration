const STORAGE_KEYS = {
  CONVERSATIONS: 'conversations',
  ARTIFACTS: 'artifacts',
  LAST_SYNCED: 'lastSynced',
  GENERATION_LOG: 'generationLog',
  GENERATION_STATS: 'generationStats',
  TOKEN_USAGE: 'tokenUsage',
  EMPTY_CACHE_RECOVERY: 'emptyCacheRecovery'
};

const MAX_CONVERSATIONS = 100;
const MAX_ARTIFACTS = 100;
const DEFAULT_DAILY_BUDGET = 3;

// --- Conversation storage ---

async function saveConversation(conversation) {
  const conversations = await getConversations();
  const existingIndex = conversations.findIndex(c => c.id === conversation.id);
  if (existingIndex >= 0) {
    conversations.splice(existingIndex, 1);
  }
  conversations.unshift(conversation);
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

// --- Artifact storage ---

async function saveArtifact(artifact) {
  let artifacts = await getArtifacts();
  artifacts.unshift(artifact);
  artifacts = artifacts.slice(0, MAX_ARTIFACTS);

  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: artifacts });
  } catch (err) {
    if (err && err.message && err.message.includes('QUOTA_BYTES')) {
      console.warn('Murmuration: Quota exceeded, removing oldest artifacts and retrying');
      artifacts = artifacts.slice(0, Math.max(1, artifacts.length - 5));
      try {
        await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: artifacts });
      } catch (retryErr) {
        console.error('Murmuration: Retry after quota cleanup also failed:', retryErr);
      }
    } else {
      throw err;
    }
  }
}

async function getArtifacts() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ARTIFACTS);
  return result[STORAGE_KEYS.ARTIFACTS] || [];
}

async function clearArtifacts() {
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: [] });
}

// --- Daily budget tracking ---

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function shouldGenerate() {
  const result = await chrome.storage.sync.get('dailyBudget');
  const budget = result.dailyBudget || DEFAULT_DAILY_BUDGET;

  const logResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = logResult[STORAGE_KEYS.GENERATION_LOG] || {};
  const todayCount = log[getTodayKey()] || 0;

  return todayCount < budget;
}

async function recordGeneration() {
  const logResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = logResult[STORAGE_KEYS.GENERATION_LOG] || {};
  const today = getTodayKey();
  log[today] = (log[today] || 0) + 1;

  // Prune old entries (keep last 7 days)
  const keys = Object.keys(log).sort().slice(-7);
  const pruned = {};
  keys.forEach(k => pruned[k] = log[k]);

  await chrome.storage.local.set({ [STORAGE_KEYS.GENERATION_LOG]: pruned });
}

async function resetTodayGeneration() {
  const logResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = logResult[STORAGE_KEYS.GENERATION_LOG] || {};
  delete log[getTodayKey()];
  await chrome.storage.local.set({ [STORAGE_KEYS.GENERATION_LOG]: log });
}

async function recoverEmptyArtifactCache() {
  const today = getTodayKey();
  const [budgetResult, localResult] = await Promise.all([
    chrome.storage.sync.get('dailyBudget'),
    chrome.storage.local.get([
      STORAGE_KEYS.ARTIFACTS,
      STORAGE_KEYS.GENERATION_LOG,
      STORAGE_KEYS.EMPTY_CACHE_RECOVERY
    ])
  ]);
  const artifacts = localResult[STORAGE_KEYS.ARTIFACTS] || [];
  const log = localResult[STORAGE_KEYS.GENERATION_LOG] || {};
  const budget = budgetResult.dailyBudget || DEFAULT_DAILY_BUDGET;
  const todayCount = log[today] || 0;
  const lastRecovery = localResult[STORAGE_KEYS.EMPTY_CACHE_RECOVERY];

  if (artifacts.length > 0 || todayCount < budget || lastRecovery === today) {
    return false;
  }

  delete log[today];
  await chrome.storage.local.set({
    [STORAGE_KEYS.GENERATION_LOG]: log,
    [STORAGE_KEYS.EMPTY_CACHE_RECOVERY]: today
  });
  return true;
}

async function getGenerationStatus() {
  const result = await chrome.storage.sync.get('dailyBudget');
  const budget = result.dailyBudget || DEFAULT_DAILY_BUDGET;
  const logResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_LOG);
  const log = logResult[STORAGE_KEYS.GENERATION_LOG] || {};
  const todayCount = log[getTodayKey()] || 0;
  return { used: todayCount, budget };
}

// --- Generation stats tracking ---

async function recordGenerationResult(success) {
  const statsResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_STATS);
  const allStats = statsResult[STORAGE_KEYS.GENERATION_STATS] || {};
  const today = getTodayKey();

  if (!allStats[today]) {
    allStats[today] = { succeeded: 0, failed: 0 };
  }

  if (success) {
    allStats[today].succeeded++;
  } else {
    allStats[today].failed++;
  }

  // Prune old entries (keep last 7 days)
  const keys = Object.keys(allStats).sort().slice(-7);
  const pruned = {};
  keys.forEach(k => pruned[k] = allStats[k]);

  await chrome.storage.local.set({ [STORAGE_KEYS.GENERATION_STATS]: pruned });
}

async function getGenerationStats() {
  const statsResult = await chrome.storage.local.get(STORAGE_KEYS.GENERATION_STATS);
  const allStats = statsResult[STORAGE_KEYS.GENERATION_STATS] || {};
  const today = getTodayKey();
  const todayStats = allStats[today] || { succeeded: 0, failed: 0 };

  const total = todayStats.succeeded + todayStats.failed;
  const successRate = total > 0 ? Math.round((todayStats.succeeded / total) * 100) : 0;

  return {
    total,
    succeeded: todayStats.succeeded,
    failed: todayStats.failed,
    successRate
  };
}

// --- Token usage tracking ---

async function recordTokenUsage(tokens) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TOKEN_USAGE);
  const usage = result[STORAGE_KEYS.TOKEN_USAGE] || {};
  const today = getTodayKey();

  if (!usage[today]) {
    usage[today] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  usage[today].promptTokens += tokens.promptTokens || 0;
  usage[today].completionTokens += tokens.completionTokens || 0;
  usage[today].totalTokens += tokens.totalTokens || 0;

  // Prune old entries (keep last 10 days)
  const keys = Object.keys(usage).sort().slice(-10);
  const pruned = {};
  keys.forEach(k => pruned[k] = usage[k]);

  await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN_USAGE]: pruned });
}

async function getTokenUsage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TOKEN_USAGE);
  return result[STORAGE_KEYS.TOKEN_USAGE] || {};
}

// --- Module export ---
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    saveConversation, getConversations, updateLastSynced, getLastSynced,
    saveArtifact, getArtifacts, clearArtifacts,
    shouldGenerate, recordGeneration, resetTodayGeneration, recoverEmptyArtifactCache,
    getGenerationStatus, getTodayKey,
    recordGenerationResult, getGenerationStats,
    recordTokenUsage, getTokenUsage,
    STORAGE_KEYS, MAX_CONVERSATIONS, MAX_ARTIFACTS, DEFAULT_DAILY_BUDGET
  };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, {
    saveConversation, getConversations, updateLastSynced, getLastSynced,
    saveArtifact, getArtifacts, clearArtifacts,
    shouldGenerate, recordGeneration, resetTodayGeneration, recoverEmptyArtifactCache,
    getGenerationStatus, getTodayKey,
    recordGenerationResult, getGenerationStats,
    recordTokenUsage, getTokenUsage,
    STORAGE_KEYS, MAX_CONVERSATIONS, MAX_ARTIFACTS, DEFAULT_DAILY_BUDGET
  });
}
