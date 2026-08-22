function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeFilenamePart(value) {
  const safe = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || 'untitled';
}

function buildArtifactFilename(artifact, index) {
  const rawTimestamp = Number(artifact && artifact.timestamp);
  const timestamp = Number.isFinite(rawTimestamp) ? rawTimestamp : 0;
  const isoTimestamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  const firstTopic = artifact && Array.isArray(artifact.topics) ? artifact.topics[0] : '';
  const sequence = String(index + 1).padStart(3, '0');
  return `${sequence}-${isoTimestamp}-${sanitizeFilenamePart(firstTopic)}.html`;
}

function getDosDateTime(timestamp) {
  const rawTimestamp = Number(timestamp);
  const date = new Date(Number.isFinite(rawTimestamp) ? rawTimestamp : 0);
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function createArtifactArchive(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('No generated art to download');
  }

  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  artifacts.forEach((artifact, index) => {
    const filenameBytes = encoder.encode(buildArtifactFilename(artifact, index));
    const htmlBytes = encoder.encode(String(artifact.html || ''));
    const checksum = crc32(htmlBytes);
    const dos = getDosDateTime(artifact.timestamp);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dos.time, true);
    localView.setUint16(12, dos.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, htmlBytes.length, true);
    localView.setUint32(22, htmlBytes.length, true);
    localView.setUint16(26, filenameBytes.length, true);
    localView.setUint16(28, 0, true);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dos.time, true);
    centralView.setUint16(14, dos.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, htmlBytes.length, true);
    centralView.setUint32(24, htmlBytes.length, true);
    centralView.setUint16(28, filenameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);

    localChunks.push(localHeader, filenameBytes, htmlBytes);
    centralChunks.push(centralHeader, filenameBytes);
    localOffset += localHeader.length + filenameBytes.length + htmlBytes.length;
  });

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, artifacts.length, true);
  endView.setUint16(10, artifacts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, endRecord], { type: 'application/zip' });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createArtifactArchive, buildArtifactFilename, sanitizeFilenamePart, crc32 };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, { createArtifactArchive, buildArtifactFilename, sanitizeFilenamePart, crc32 });
}
