/**
 * Test: shared/art-generator.js — art generation functions
 * Run: node tests/test-art-generator.js
 */

// Mock chrome.storage
const store = { sync: {} };
globalThis.chrome = {
  storage: {
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
      }
    },
    local: { get: async () => ({}), set: async () => {} }
  }
};

// Mock fetch for generateArt tests
let fetchResponse = null;
globalThis.fetch = async () => fetchResponse;

// Load modules
const apiModule = require('../shared/api-client.js');
Object.assign(globalThis, apiModule);
const artModule = require('../shared/art-generator.js');
Object.assign(globalThis, artModule);

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

// --- pickRandomTopics tests ---

function testPickRandomTopics() {
  console.log('\n--- pickRandomTopics ---');

  // TOPICS_PER_GENERATION constant
  assert(TOPICS_PER_GENERATION === 3, 'TOPICS_PER_GENERATION is 3');

  // Returns correct count
  const result = pickRandomTopics(['a', 'b', 'c', 'd', 'e'], 3);
  assert(result.length === 3, 'Returns exactly count items when titles.length >= count');

  // Returns all when fewer than count
  const small = pickRandomTopics(['a', 'b'], 5);
  assert(small.length === 2, 'Returns all items when titles.length < count');

  // Empty array
  const empty = pickRandomTopics([], 3);
  assert(empty.length === 0, 'Returns [] for empty input');

  // Count of 0
  const zero = pickRandomTopics(['a', 'b', 'c'], 0);
  assert(zero.length === 0, 'Returns [] for count 0');

  // Does not mutate original
  const original = ['a', 'b', 'c', 'd', 'e'];
  const copy = [...original];
  pickRandomTopics(original, 3);
  assert(
    original.length === copy.length && original.every((v, i) => v === copy[i]),
    'Original array is not mutated'
  );

  // Randomization: run 10 times, at least 2 different orderings
  const orderings = new Set();
  for (let i = 0; i < 20; i++) {
    orderings.add(pickRandomTopics(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 3).join(','));
  }
  assert(orderings.size >= 2, 'Results are randomized across calls');
}

// --- buildArtPrompt tests ---

function testBuildArtPrompt() {
  console.log('\n--- buildArtPrompt ---');

  const prompt = buildArtPrompt(['machine learning', 'philosophy', 'cooking']);

  assert(prompt.includes('self-contained'), 'Prompt mentions self-contained HTML/CSS/JS');
  assert(prompt.includes('black') && prompt.includes('white'), 'Prompt specifies black and white');
  assert(prompt.includes('White background') || prompt.includes('white background'), 'Prompt prefers white background');
  assert(prompt.includes('animated') || prompt.includes('Animated'), 'Prompt specifies animated');
  assert(prompt.includes('ASCII') || prompt.includes('ascii') || prompt.includes('Fractal') || prompt.includes('fractal'), 'Prompt mentions art styles');
  assert(prompt.includes('RULES') || prompt.includes('Rules'), 'Prompt includes RULES section');
  assert(prompt.includes('no markdown') || prompt.includes('No markdown') || prompt.includes('No explanation'), 'Rules say no markdown');
  assert(prompt.includes('external') || prompt.includes('CDN'), 'Rules prohibit external assets');
  assert(prompt.includes('grayscale') || prompt.includes('Grayscale') || (prompt.includes('black') && prompt.includes('white')), 'Rules limit colors');
  assert(prompt.includes('8000'), 'Rules mention 8000 token limit');
  assert(prompt.includes('machine learning') && prompt.includes('philosophy') && prompt.includes('cooking'), 'Topics included as comma-separated');
  assert(prompt.includes('one topic') || prompt.includes('Pick one') || prompt.includes('common theme'), 'Prompt says pick one topic or theme');
  assert(prompt.includes('state of mind') || prompt.includes('reflect'), 'Prompt mentions reflecting user state');
}

// --- parseArtResponse tests ---

function testParseArtResponse() {
  console.log('\n--- parseArtResponse ---');

  // Basic HTML passthrough
  const basic = '<html><head></head><body><div>Art</div></body></html>';
  const result = parseArtResponse(basic);
  assert(result.includes('<div>Art</div>'), 'Basic HTML passes through');
  assert(result.includes('Content-Security-Policy'), 'CSP meta tag injected');

  // Strips markdown html code block
  const mdHtml = '```html\n<html><body><div>Test art piece with enough characters to pass the minimum length validation requirement</div></body></html>\n```';
  const parsed1 = parseArtResponse(mdHtml);
  assert(!parsed1.includes('```'), 'Strips ```html...``` wrapper');
  assert(parsed1.includes('<div>Test art piece'), 'Content preserved after stripping markdown');

  // Strips plain code block
  const mdPlain = '```\n<html><body><canvas id="art-canvas"></canvas><script>/* enough chars for validation */</script></body></html>\n```';
  const parsed2 = parseArtResponse(mdPlain);
  assert(!parsed2.includes('```'), 'Strips plain ```...``` wrapper');

  // Validates meaningful HTML tags
  let threw = false;
  try {
    parseArtResponse('This is just plain text without any HTML tags at all');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Throws for non-HTML content');

  // Rejects too-short content
  threw = false;
  try {
    parseArtResponse('<div>x</div>');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Throws for content under 50 chars');

  // Rejects over 500KB
  threw = false;
  try {
    parseArtResponse('<html><body><div>' + 'x'.repeat(500001) + '</div></body></html>');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Throws for content over 500KB');

  // Strips existing CSP meta tags
  const withCSP = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><div>Test content here for the art display page with enough characters</div></body></html>';
  const parsed3 = parseArtResponse(withCSP);
  assert(!parsed3.includes('default-src *'), 'Existing CSP tag content stripped');
  assert(parsed3.includes("default-src 'none'"), 'New CSP injected');

  // CSP includes connect-src 'none'
  const simpleHtml = '<html><head></head><body><div>Art piece with enough characters to pass the minimum length check</div></body></html>';
  const parsed4 = parseArtResponse(simpleHtml);
  assert(parsed4.includes("connect-src 'none'"), 'CSP includes connect-src none');
  assert(parsed4.includes("style-src 'unsafe-inline'"), 'CSP includes style-src unsafe-inline');
  assert(parsed4.includes("script-src 'unsafe-inline'"), 'CSP includes script-src unsafe-inline');
  assert(parsed4.includes("img-src data:"), 'CSP includes img-src data:');

  // CSP injection into HTML without <head>
  const noHead = '<html><body><div>Art piece with enough characters for the minimum length validation check to pass</div></body></html>';
  const parsed5 = parseArtResponse(noHead);
  assert(parsed5.includes('Content-Security-Policy'), 'CSP injected even without <head>');

  // CSP injection into HTML without <html>
  const noHtml = '<style>body{background:#000}</style><canvas id="c"></canvas><script>console.log("art piece with enough characters")</script>';
  const parsed6 = parseArtResponse(noHtml);
  assert(parsed6.includes('Content-Security-Policy'), 'CSP prepended when no <html> tag');
}

// --- generateArt tests ---

async function testGenerateArt() {
  console.log('\n--- generateArt ---');

  // No API key configured
  store.sync = {};
  let threw = false;
  try {
    await generateArt(['topic1', 'topic2', 'topic3']);
  } catch (e) {
    threw = true;
    assert(e.message.includes('API key') || e.message.includes('apiKey'), 'Error message mentions API key');
  }
  assert(threw, 'Throws when no API key configured');

  // Successful generation
  store.sync = { apiKey: 'sk-test', model: 'test-model' };
  const htmlContent = '<html><head></head><body><canvas id="art"></canvas><script>/* animated art with enough characters to pass validation */</script></body></html>';
  fetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: htmlContent } }],
      usage: { prompt_tokens: 500, completion_tokens: 1500, total_tokens: 2000 }
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: htmlContent } }] })
  };

  const artifact = await generateArt(['machine learning', 'philosophy', 'cooking', 'music', 'art']);
  assert(artifact.id && artifact.id.startsWith('art-'), 'Artifact id starts with art-');
  assert(typeof artifact.html === 'string' && artifact.html.length > 0, 'Artifact has html string');
  assert(Array.isArray(artifact.topics) && artifact.topics.length === 3, 'Artifact has 3 topics');
  assert(typeof artifact.timestamp === 'number', 'Artifact has timestamp');
  assert(artifact.html.includes('Content-Security-Policy'), 'HTML has CSP injected');
  assert(artifact.usage !== undefined, 'Artifact includes usage data');
  assert(artifact.usage.totalTokens === 2000, 'Artifact usage has correct totalTokens');
}

// --- Module exports ---

function testExports() {
  console.log('\n--- Module Exports ---');
  assert(typeof pickRandomTopics === 'function', 'pickRandomTopics exported');
  assert(typeof buildArtPrompt === 'function', 'buildArtPrompt exported');
  assert(typeof parseArtResponse === 'function', 'parseArtResponse exported');
  assert(typeof generateArt === 'function', 'generateArt exported');
  assert(typeof TOPICS_PER_GENERATION === 'number', 'TOPICS_PER_GENERATION exported');
}

// Run
(async () => {
  try {
    testPickRandomTopics();
    testBuildArtPrompt();
    testParseArtResponse();
    await testGenerateArt();
    testExports();
  } catch (e) {
    console.error('Test runner error:', e);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
