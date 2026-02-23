(function() {
  'use strict';

  const PLATFORM = 'chatgpt';
  const LOG_PREFIX = 'Murmuration:';
  const SCRAPE_DELAY_MS = 3000;
  const OBSERVER_DEBOUNCE_MS = 2000;
  const MAX_TITLES = 20;
  const MIN_TITLE_LENGTH = 3;
  const MAX_TITLE_LENGTH = 200;

  // Selector fallback chain (tried in order)
  const DEFAULT_SELECTORS = [
    'a[data-sidebar-item="true"] span.truncate',
    '#history a',
    'a[href*="/c/"]'
  ];

  let observerDebounceTimer = null;

  async function getSelectors() {
    try {
      const result = await chrome.storage.sync.get('chatgptSelectors');
      const custom = result.chatgptSelectors;
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

  function extractTitles(selectors) {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const titles = [];
          elements.forEach(el => {
            const text = (el.textContent || '').trim();
            if (text.length >= MIN_TITLE_LENGTH && text.length <= MAX_TITLE_LENGTH) {
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
      console.log(LOG_PREFIX, 'No ChatGPT conversation titles found');
      return;
    }

    console.log(LOG_PREFIX, `Sending ${titles.length} ChatGPT titles to background`);

    try {
      chrome.runtime.sendMessage({
        type: 'CONVERSATION_SCRAPED',
        data: {
          platform: PLATFORM,
          title: 'Recent ChatGPT Conversations',
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

  console.log(LOG_PREFIX, 'ChatGPT content script loaded');
})();
