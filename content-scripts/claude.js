(function() {
  'use strict';

  const PLATFORM = 'claude';
  const LOG_PREFIX = 'Beauty on New Tabs:';
  const SCRAPE_DELAY_MS = 3000;
  const OBSERVER_DEBOUNCE_MS = 2000;
  const MAX_TITLES = 20;
  const MIN_TITLE_LENGTH = 3;
  const MAX_TITLE_LENGTH = 200;

  // Noise filter: sidebar items that aren't conversation titles
  const NOISE_ITEMS = ['new chat', 'chats', 'projects', 'recents', 'starred'];

  // Selector fallback chain (tried in order)
  const DEFAULT_SELECTORS = [
    'a[data-dd-action-name="sidebar-chat-item"] span.truncate',
    'a[href*="/chat/"]',
    'nav[aria-label="Sidebar"] a'
  ];

  let observerDebounceTimer = null;

  async function getSelectors() {
    try {
      const result = await chrome.storage.sync.get('claudeSelectors');
      const custom = result.claudeSelectors;
      if (custom && (custom.primary || (custom.fallbacks && custom.fallbacks.length > 0))) {
        const selectors = [];
        if (custom.primary) selectors.push(custom.primary);
        if (custom.fallbacks) selectors.push(...custom.fallbacks);
        return [...selectors, ...DEFAULT_SELECTORS];
      }
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to load custom selectors:', e);
    }
    return DEFAULT_SELECTORS;
  }

  function isNoise(text) {
    return NOISE_ITEMS.includes(text.toLowerCase());
  }

  function extractTitles(selectors) {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const titles = [];
          elements.forEach(el => {
            const text = (el.textContent || '').trim();
            if (text.length >= MIN_TITLE_LENGTH && text.length <= MAX_TITLE_LENGTH && !isNoise(text)) {
              titles.push(text);
            }
          });

          // Deduplicate
          const unique = [...new Set(titles)];
          if (unique.length > 0) {
            console.log(LOG_PREFIX, `Found ${unique.length} titles using selector: ${selector}`);
            return unique.slice(0, MAX_TITLES);
          }
        }
      } catch (e) {
        // Invalid selector, try next
      }
    }
    return [];
  }

  async function scrapeAndSend() {
    const selectors = await getSelectors();
    const titles = extractTitles(selectors);

    if (titles.length === 0) {
      console.log(LOG_PREFIX, 'No Claude conversation titles found');
      return;
    }

    console.log(LOG_PREFIX, `Sending ${titles.length} Claude titles to background`);

    try {
      chrome.runtime.sendMessage({
        type: 'CONVERSATION_SCRAPED',
        data: {
          platform: PLATFORM,
          title: 'Recent Claude Conversations',
          titles: titles,
          url: window.location.href
        }
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to send message:', e);
    }
  }

  // Initial scrape after page load
  setTimeout(() => {
    scrapeAndSend();
  }, SCRAPE_DELAY_MS);

  // Watch for SPA navigation
  const observer = new MutationObserver(() => {
    if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      scrapeAndSend();
    }, OBSERVER_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log(LOG_PREFIX, 'Claude content script loaded');
})();
