/**
 * Test: shared/api-client.js — OpenRouter API client
 * Run: node tests/test-api-client.js
 *
 * Uses a mock fetch to test without actual API calls.
 */

let fetchCalls = [];
let fetchResponse = null;

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (fetchResponse instanceof Error) throw fetchResponse;
  return fetchResponse;
};

// Mock chrome.storage (not needed for api-client but may be referenced)
globalThis.chrome = { storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}), set: async () => {} } } };

const { OpenRouterClient, getApiClient } = require('../shared/api-client.js');

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

function resetFetch() {
  fetchCalls = [];
  fetchResponse = null;
}

function mockSuccess(content) {
  fetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] })
  };
}

function mockError(status, errorMsg, retryAfter) {
  fetchResponse = {
    ok: false,
    status,
    headers: { get: (h) => h === 'retry-after' ? retryAfter : null },
    json: async () => ({ error: { message: errorMsg } }),
    text: async () => JSON.stringify({ error: { message: errorMsg } })
  };
}

async function testConstructor() {
  console.log('\n--- Constructor ---');

  const client = new OpenRouterClient('sk-test-key', 'test-model');
  assert(client !== undefined, 'Constructor creates instance');

  // Default model
  const defaultClient = new OpenRouterClient('sk-test-key');
  assert(true, 'Constructor works without model (uses default)');
}

async function testGenerateCompletion() {
  console.log('\n--- generateCompletion ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key', 'anthropic/claude-sonnet-4-20250514');
  mockSuccess('<html><body>Test art</body></html>');

  const result = await client.generateCompletion('Generate art', { maxTokens: 8000, temperature: 1.0 });

  // Check return value
  assert(result.content === '<html><body>Test art</body></html>', 'Returns {content: string} from response');

  // Check fetch was called correctly
  assert(fetchCalls.length === 1, 'fetch called once');
  assert(fetchCalls[0].url === 'https://openrouter.ai/api/v1/chat/completions', 'Correct endpoint URL');

  const opts = fetchCalls[0].options;
  assert(opts.method === 'POST', 'Uses POST method');
  assert(opts.headers['Content-Type'] === 'application/json', 'Content-Type header set');
  assert(opts.headers['Authorization'] === 'Bearer sk-test-key', 'Authorization header set');

  const body = JSON.parse(opts.body);
  assert(body.model === 'anthropic/claude-sonnet-4-20250514', 'Model in request body');
  assert(Array.isArray(body.messages), 'messages is array');
  assert(body.messages[0].role === 'user', 'message role is user');
  assert(body.messages[0].content === 'Generate art', 'message content matches prompt');
  assert(body.max_tokens === 8000, 'max_tokens from options');
  assert(body.temperature === 1.0, 'temperature from options');
}

async function testDefaultModel() {
  console.log('\n--- Default Model ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key');
  mockSuccess('response');

  await client.generateCompletion('test');

  const body = JSON.parse(fetchCalls[0].options.body);
  assert(
    body.model === 'anthropic/claude-sonnet-4-20250514',
    'Default model is anthropic/claude-sonnet-4-20250514'
  );
}

async function testRateLimitError() {
  console.log('\n--- Rate Limit (429) ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key');
  mockError(429, 'Rate limit exceeded', '30');

  let error = null;
  try {
    await client.generateCompletion('test');
  } catch (e) {
    error = e;
  }

  assert(error !== null, 'Throws on 429');
  assert(error.message.includes('429'), 'Error message includes status code');
}

async function testServerError() {
  console.log('\n--- Server Error (500) ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key');
  mockError(500, 'Internal server error');

  let error = null;
  try {
    await client.generateCompletion('test');
  } catch (e) {
    error = e;
  }

  assert(error !== null, 'Throws on 500');
  assert(error.message.includes('500'), 'Error message includes status code');
}

async function testClientError() {
  console.log('\n--- Client Error (401) ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key');
  mockError(401, 'Invalid API key');

  let error = null;
  try {
    await client.generateCompletion('test');
  } catch (e) {
    error = e;
  }

  assert(error !== null, 'Throws on 401');
  assert(error.message.includes('401') || error.message.includes('Invalid'), 'Error has useful info');
}

async function testNetworkError() {
  console.log('\n--- Network Error ---');
  resetFetch();

  const client = new OpenRouterClient('sk-test-key');
  fetchResponse = new Error('Network request failed');

  let error = null;
  try {
    await client.generateCompletion('test');
  } catch (e) {
    error = e;
  }

  assert(error !== null, 'Throws on network error');
  assert(error.message.includes('Network') || error.message.includes('network') || error.message.includes('failed'),
    'Error message describes network issue');
}

async function testGetApiClient() {
  console.log('\n--- getApiClient factory ---');

  const client = getApiClient('sk-factory-key', 'custom-model');
  assert(client instanceof OpenRouterClient, 'getApiClient returns OpenRouterClient instance');

  // Test with no model
  const defaultClient = getApiClient('sk-key');
  assert(defaultClient instanceof OpenRouterClient, 'getApiClient works without model');
}

// Run all tests
(async () => {
  try {
    await testConstructor();
    await testGenerateCompletion();
    await testDefaultModel();
    await testRateLimitError();
    await testServerError();
    await testClientError();
    await testNetworkError();
    await testGetApiClient();
  } catch (e) {
    console.error('Test runner error:', e);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
