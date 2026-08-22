/**
 * Test: shared/artifact-archive.js — ZIP export of generated HTML artifacts
 * Run: node tests/test-artifact-archive.js
 */

const {
  createArtifactArchive,
  buildArtifactFilename,
  sanitizeFilenamePart,
  crc32
} = require('../shared/artifact-archive.js');

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

async function run() {
  console.log('\n--- Artifact Archive ---');

  assert(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'CRC-32 matches known value');
  assert(sanitizeFilenamePart('../../Odd topic?!') === 'Odd-topic', 'Filename parts are sanitized');

  const filename = buildArtifactFilename({ timestamp: 0, topics: ['A/B test'] }, 0);
  assert(filename.startsWith('001-1970-01-01T00-00-00-000Z-'), 'Filename includes sequence and timestamp');
  assert(filename.endsWith('A-B-test.html'), 'Filename includes safe topic and HTML extension');

  let threw = false;
  try {
    createArtifactArchive([]);
  } catch (error) {
    threw = true;
  }
  assert(threw, 'Empty archives are rejected');

  const artifacts = [
    { html: '<html><body>First</body></html>', topics: ['First Topic'], timestamp: 1000 },
    { html: '<html><body>Second</body></html>', topics: ['Second Topic'], timestamp: 2000 }
  ];
  const archive = createArtifactArchive(artifacts);
  assert(archive.type === 'application/zip', 'Creates a ZIP blob');

  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert(view.getUint32(0, true) === 0x04034b50, 'ZIP starts with a local file header');

  const endOffset = bytes.length - 22;
  assert(view.getUint32(endOffset, true) === 0x06054b50, 'ZIP ends with an end-of-central-directory record');
  assert(view.getUint16(endOffset + 10, true) === 2, 'ZIP records every artifact as a file');

  const archiveText = new TextDecoder().decode(bytes);
  assert(archiveText.includes('First Topic'.replace(' ', '-')), 'ZIP contains first HTML filename');
  assert(archiveText.includes('<html><body>First</body></html>'), 'ZIP contains original HTML bytes');

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
