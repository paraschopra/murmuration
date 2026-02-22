document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.sync.get(['apiKey', 'model', 'dailyBudget']);
  if (settings.apiKey) document.getElementById('apiKey').value = settings.apiKey;
  if (settings.model) document.getElementById('model').value = settings.model;
  document.getElementById('dailyBudget').value = settings.dailyBudget || 3;

  // Save settings
  document.getElementById('save-btn').addEventListener('click', saveSettings);

  // Load generation status and stats
  await loadStatus();

  // Load token usage history
  await loadTokenUsage();

  // Selector tabs
  setupSelectorTabs();
});

async function saveSettings() {
  const settings = {
    apiKey: document.getElementById('apiKey').value,
    model: document.getElementById('model').value || undefined,
    dailyBudget: parseInt(document.getElementById('dailyBudget').value) || 3
  };

  // Don't store undefined model
  if (!settings.model) delete settings.model;

  await chrome.storage.sync.set(settings);

  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Saved';
  setTimeout(() => statusEl.textContent = '', 2000);
}

async function loadStatus() {
  // Generation status
  const status = await getGenerationStatus();
  document.getElementById('gen-status').textContent =
    `Generated today: ${status.used} / ${status.budget}`;

  // Generation stats (success rate)
  const stats = await getGenerationStats();
  if (stats.total === 0) {
    document.getElementById('gen-stats').textContent = 'No attempts today';
  } else {
    document.getElementById('gen-stats').textContent =
      `Success rate: ${stats.successRate}% (${stats.succeeded} succeeded, ${stats.failed} failed)`;
  }

  // Artifact count
  const artifacts = await getArtifacts();
  document.getElementById('artifact-count').textContent =
    `${artifacts.length} art pieces cached`;
}

async function loadTokenUsage() {
  const usage = await getTokenUsage();
  const container = document.getElementById('token-usage');
  const days = Object.keys(usage).sort().reverse();

  if (days.length === 0) {
    container.textContent = 'No token usage recorded yet';
    return;
  }

  const table = document.createElement('table');
  table.className = 'token-table';
  table.innerHTML = '<thead><tr><th>Date</th><th>Prompt</th><th>Completion</th><th>Total</th></tr></thead>';
  const tbody = document.createElement('tbody');

  let grandTotal = 0;
  for (const day of days) {
    const d = usage[day];
    grandTotal += d.totalTokens;
    const row = document.createElement('tr');
    row.innerHTML = `<td>${day}</td><td>${d.promptTokens.toLocaleString()}</td><td>${d.completionTokens.toLocaleString()}</td><td>${d.totalTokens.toLocaleString()}</td>`;
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);

  const totalEl = document.createElement('div');
  totalEl.className = 'token-total';
  totalEl.textContent = `Total: ${grandTotal.toLocaleString()} tokens`;
  container.appendChild(totalEl);
}

function setupSelectorTabs() {
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

    if (primary || fallbacks.length > 0) {
      const selectors = {};
      selectors[key] = { primary, fallbacks };
      await chrome.storage.sync.set(selectors);
    } else {
      // Clear custom selectors for this platform
      await chrome.storage.sync.remove(key);
    }
  });
}

async function loadSelectors(platform) {
  const key = platform === 'chatgpt' ? 'chatgptSelectors' : 'claudeSelectors';
  const result = await chrome.storage.sync.get(key);
  const sel = result[key] || {};
  document.getElementById('primary-selector').value = sel.primary || '';
  document.getElementById('fallback-selectors').value = (sel.fallbacks || []).join('\n');
}
