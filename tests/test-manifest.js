/**
 * Test: Validate manifest.json and directory structure
 * Run: node tests/test-manifest.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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

console.log('Testing manifest.json and directory structure...\n');

// 1. manifest.json exists and is valid JSON
const manifestPath = path.join(ROOT, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert(true, 'manifest.json is valid JSON');
} catch (e) {
  assert(false, 'manifest.json is valid JSON');
  process.exit(1);
}

// 2. Manifest version
assert(manifest.manifest_version === 3, 'manifest_version is 3');

// 3. Permissions
const requiredPerms = ['storage', 'activeTab', 'tabs', 'scripting'];
for (const perm of requiredPerms) {
  assert(
    manifest.permissions && manifest.permissions.includes(perm),
    `permissions includes "${perm}"`
  );
}

// 4. Host permissions
assert(
  manifest.host_permissions && manifest.host_permissions.includes('https://chatgpt.com/*'),
  'host_permissions includes https://chatgpt.com/*'
);
assert(
  manifest.host_permissions && manifest.host_permissions.includes('https://claude.ai/*'),
  'host_permissions includes https://claude.ai/*'
);

// 5. Background service worker
assert(
  manifest.background && manifest.background.service_worker === 'background/background.js',
  'background.service_worker points to background/background.js'
);

// 6. Content scripts
assert(
  Array.isArray(manifest.content_scripts) && manifest.content_scripts.length >= 2,
  'content_scripts has at least 2 entries'
);

const chatgptScript = manifest.content_scripts.find(
  cs => cs.matches && cs.matches.includes('https://chatgpt.com/*')
);
assert(
  chatgptScript && chatgptScript.js && chatgptScript.js.includes('content-scripts/chatgpt.js'),
  'content_scripts entry for chatgpt.com with correct js path'
);
assert(
  chatgptScript && chatgptScript.run_at === 'document_idle',
  'chatgpt content script run_at is document_idle'
);

const claudeScript = manifest.content_scripts.find(
  cs => cs.matches && cs.matches.includes('https://claude.ai/*')
);
assert(
  claudeScript && claudeScript.js && claudeScript.js.includes('content-scripts/claude.js'),
  'content_scripts entry for claude.ai with correct js path'
);
assert(
  claudeScript && claudeScript.run_at === 'document_idle',
  'claude content script run_at is document_idle'
);

// 7. New tab override
assert(
  manifest.chrome_url_overrides && manifest.chrome_url_overrides.newtab === 'newtab/newtab.html',
  'chrome_url_overrides.newtab points to newtab/newtab.html'
);

// 8. Options page
assert(
  manifest.options_page === 'options/options.html',
  'options_page points to options/options.html'
);

// 9. Required directories exist
const requiredDirs = ['background', 'shared', 'content-scripts', 'newtab', 'options', 'icons'];
for (const dir of requiredDirs) {
  const dirPath = path.join(ROOT, dir);
  assert(
    fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory(),
    `Directory "${dir}/" exists`
  );
}

// Summary
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
