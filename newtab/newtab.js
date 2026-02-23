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
    // Try to trigger generation if budget allows and conversations exist
    const canGenerate = await shouldGenerate();
    const conversations = await getConversations();
    if (canGenerate && conversations.length > 0) {
      showState('generating-state');
      chrome.runtime.sendMessage({ type: 'REQUEST_GENERATION' });
      // Poll for new artifacts while generating
      pollForArtifacts();
    } else {
      showState('empty-state');
      await showSyncStatus();
    }
    return;
  }

  // Display art
  displayArtifact(artifacts);
}

// Pick an index biased towards recent artifacts (index 0 = newest).
// Each index i has weight decay^i, so newer items are more likely.
function weightedRandomIndex(length) {
  const decay = 0.95;
  let r = Math.random() * (1 - Math.pow(decay, length)) / (1 - decay);
  for (let i = 0; i < length; i++) {
    r -= Math.pow(decay, i);
    if (r <= 0) return i;
  }
  return length - 1;
}

function displayArtifact(artifacts) {
  let currentIndex = weightedRandomIndex(artifacts.length);
  const frame = document.getElementById('art-frame');
  const topicsEl = document.getElementById('art-topics');
  const budgetEl = document.getElementById('art-budget');
  let sandboxReady = false;

  function showArtifact(index) {
    const artifact = artifacts[index];
    if (sandboxReady) {
      frame.contentWindow.postMessage(artifact.html, '*');
    }
    topicsEl.textContent = artifact.topics.join(' \u00b7 ');
  }

  // Load sandbox page, then send first artifact via postMessage
  frame.src = '../sandbox.html';
  frame.addEventListener('load', function onLoad() {
    frame.removeEventListener('load', onLoad);
    sandboxReady = true;
    showArtifact(currentIndex);
  });

  // Show budget status
  getGenerationStatus().then(status => {
    budgetEl.textContent = `${status.used}/${status.budget} today`;
  });

  showState('art-display');

  // Refresh button: pick a DIFFERENT random artifact
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
    ? `Last synced: ${parts.join(' \u00b7 ')}`
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

function pollForArtifacts() {
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max
  const interval = setInterval(async () => {
    attempts++;
    const artifacts = await getArtifacts();
    if (artifacts && artifacts.length > 0) {
      clearInterval(interval);
      displayArtifact(artifacts);
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      showState('empty-state');
      await showSyncStatus();
    }
  }, 1000);
}

function showState(stateId) {
  document.querySelectorAll('.state').forEach(el => el.style.display = 'none');
  document.getElementById(stateId).style.display = '';
}

document.addEventListener('DOMContentLoaded', init);
