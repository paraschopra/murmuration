importScripts('/shared/storage.js', '/shared/api-client.js', '/shared/art-generator.js');

// Debounce: ignore scrapes within 60s per platform
const lastScrapeTime = {};
const SCRAPE_DEBOUNCE_MS = 60000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONVERSATION_SCRAPED') {
    handleConversationScraped(message.data).catch(err => {
      console.error('Murmuration: Error handling scraped conversation:', err);
    });
  }
  if (message.type === 'REQUEST_GENERATION') {
    handleGenerationRequest().catch(err => {
      console.error('Murmuration: Error handling generation request:', err);
    });
  }
  return true;
});

async function handleConversationScraped(data) {
  const now = Date.now();
  if (lastScrapeTime[data.platform] && (now - lastScrapeTime[data.platform]) < SCRAPE_DEBOUNCE_MS) {
    console.log('Murmuration: Debouncing scrape from', data.platform);
    return;
  }
  lastScrapeTime[data.platform] = now;

  console.log('Murmuration: Received scraped data from', data.platform);

  const conversation = {
    id: `${data.platform}-${data.url}`,
    platform: data.platform,
    title: data.title,
    titles: data.titles,
    url: data.url,
    timestamp: Date.now()
  };
  await saveConversation(conversation);
  await updateLastSynced(data.platform);

  await tryGenerate();
}

async function handleGenerationRequest() {
  await tryGenerate();
}

async function tryGenerate() {
  const canGenerate = await shouldGenerate();
  if (!canGenerate) {
    console.log('Murmuration: Daily budget exhausted, skipping generation');
    return;
  }

  const conversations = await getConversations();
  const allTitles = [];
  for (const conv of conversations) {
    if (conv.titles) {
      allTitles.push(...conv.titles);
    }
  }
  const uniqueTitles = [...new Set(allTitles)];

  console.log('Murmuration: Total unique topics available:', uniqueTitles.length, '— will pick 3');

  if (uniqueTitles.length === 0) {
    console.log('Murmuration: No titles available for generation');
    return;
  }

  try {
    const artifact = await generateArt(uniqueTitles);
    await saveArtifact(artifact);
    await recordGeneration();
    await recordGenerationResult(true);
    if (artifact.usage) {
      await recordTokenUsage(artifact.usage);
    }
    console.log('Murmuration: Artifact saved successfully, size:', artifact.html.length, 'bytes');
  } catch (err) {
    await recordGenerationResult(false);
    console.error('Murmuration: Art generation failed:', err);
  }
}
