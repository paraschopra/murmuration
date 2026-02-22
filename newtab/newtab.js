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
      chrome.runtime.sendMessage({ type: 'REQUEST_GENERATION' });
    }
    showState('empty-state');
    await showSyncStatus();
    return;
  }

  // Display art
  displayArtifact(artifacts);
}

function displayArtifact(artifacts) {
  let currentIndex = Math.floor(Math.random() * artifacts.length);
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

function showState(stateId) {
  document.querySelectorAll('.state').forEach(el => el.style.display = 'none');
  document.getElementById(stateId).style.display = '';
}

document.addEventListener('DOMContentLoaded', init);
