const DEFAULT_TOPIC_COUNT = 3;
const MIN_TOPIC_COUNT = 1;
const MAX_TOPIC_COUNT = 20;
// Kept as an alias for compatibility with older callers.
const TOPICS_PER_GENERATION = DEFAULT_TOPIC_COUNT;

const DEFAULT_ART_PROMPT = `Based on given topics that user has been chatting about, create a self-contained html/css/js page that can be shown to the user in an iframe on a new tab to reflect her state of mind. Pick one topic or some common theme, don't mix everything.

Create a minimal ASCII or related art, html css based. e.g. Fractal, aquarium, scenery. Glitchy, whimsical, awe-inspiring. Black and white only. (White background preferred). Animated. Be creative. Reflect state of user's mind. Pick odd ones, surprise the user. Don't be boring.

RULES:
- Output ONLY the self-contained HTML. No explanation, no markdown.
- Must be a single HTML page with inline <style> and optional <script>.
- NO external assets (no image URLs, no CDN links, no external scripts/fonts).
- Colors: black, white, and grayscale ONLY.
- Keep it concise — under 8000 tokens of HTML.

Topics: {{topics}}`;

function normalizeTopicCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return DEFAULT_TOPIC_COUNT;
  return Math.min(MAX_TOPIC_COUNT, Math.max(MIN_TOPIC_COUNT, count));
}

function pickRandomTopics(titles, count) {
  if (!titles || titles.length === 0 || count <= 0) return [];
  const shuffled = [...titles];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function buildArtPrompt(topics, promptTemplate = DEFAULT_ART_PROMPT) {
  const topicText = Array.isArray(topics) ? topics.join(', ') : '';
  return promptTemplate.replace(/{{\s*topics\s*}}/gi, topicText);
}

function parseArtResponse(responseContent) {
  let html = responseContent.trim();

  // Strip markdown code block wrapper if present
  const codeBlockMatch = html.match(/```(?:html)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    html = codeBlockMatch[1].trim();
  }

  // Validate: must contain meaningful HTML tags
  const hasHtmlTag = /<(?:html|style|canvas|svg|body|div)/i.test(html);
  if (!hasHtmlTag || html.length < 50) {
    throw new Error('Response does not appear to contain valid HTML');
  }

  // Size guard: reject if over 500KB
  if (html.length > 500000) {
    throw new Error('Generated HTML exceeds 500KB size limit');
  }

  // Strip any existing CSP meta tags before injection
  html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  // Inject strict CSP meta tag
  const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; connect-src \'none\';">';

  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + cspMeta);
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', '<html><head>' + cspMeta + '</head>');
  } else {
    html = cspMeta + html;
  }

  return html;
}

async function generateArt(allTitles) {
  console.log('Murmuration: Starting art generation');

  const settings = await chrome.storage.sync.get(['apiKey', 'model', 'topicCount', 'artPrompt']);
  if (!settings.apiKey) {
    throw new Error('No API key configured');
  }

  const client = getApiClient(settings.apiKey, settings.model);
  const topicCount = normalizeTopicCount(settings.topicCount);
  const topics = pickRandomTopics(allTitles, topicCount);

  console.log('Murmuration: Generating art for topics:', topics);

  const promptTemplate = typeof settings.artPrompt === 'string' && settings.artPrompt.trim()
    ? settings.artPrompt
    : DEFAULT_ART_PROMPT;
  const prompt = buildArtPrompt(topics, promptTemplate);
  const response = await client.generateCompletion(prompt, {
    maxTokens: 8000,
    temperature: 1.0
  });

  const html = parseArtResponse(response.content);

  const artifact = {
    id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    html: html,
    topics: topics,
    timestamp: Date.now(),
    usage: response.usage
  };

  console.log('Murmuration: Art generated successfully, size:', html.length, 'bytes, tokens:', response.usage.totalTokens);
  return artifact;
}

// Module export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateArt, pickRandomTopics, buildArtPrompt, parseArtResponse, normalizeTopicCount,
    DEFAULT_ART_PROMPT, DEFAULT_TOPIC_COUNT, MIN_TOPIC_COUNT, MAX_TOPIC_COUNT,
    TOPICS_PER_GENERATION
  };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, {
    generateArt, pickRandomTopics, buildArtPrompt, parseArtResponse, normalizeTopicCount,
    DEFAULT_ART_PROMPT, DEFAULT_TOPIC_COUNT, MIN_TOPIC_COUNT, MAX_TOPIC_COUNT,
    TOPICS_PER_GENERATION
  });
}
