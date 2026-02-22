/**
 * Generate placeholder PNG icons for the Chrome extension.
 * Uses only Node.js built-in modules (no external deps).
 *
 * Creates a simple geometric "B" letter icon in black on white,
 * matching the extension's black-and-white aesthetic.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Image data: each row starts with filter byte (0 = none)
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 3)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const offset = y * (1 + width * 3) + 1 + x * 3;
      rawData[offset] = pixels[idx];     // R
      rawData[offset + 1] = pixels[idx + 1]; // G
      rawData[offset + 2] = pixels[idx + 2]; // B
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crc32Table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 3);

  // Fill white background
  pixels.fill(255);

  // Draw a geometric abstract design: a stylized "B" or abstract art pattern
  // Using circles and lines for a minimal aesthetic

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Outer ring
      const ringWidth = Math.max(1, size * 0.08);
      if (dist >= r - ringWidth && dist <= r) {
        setPixel(pixels, size, x, y, 0, 0, 0);
      }

      // Inner dot (smaller circle)
      const innerR = size * 0.12;
      if (dist <= innerR) {
        setPixel(pixels, size, x, y, 0, 0, 0);
      }

      // Cross-hair lines (horizontal and vertical through center)
      const lineWidth = Math.max(1, Math.floor(size * 0.06));
      const halfLine = lineWidth / 2;

      // Horizontal line segment (partial, from inner to outer ring)
      if (Math.abs(y - cy) < halfLine && Math.abs(dx) >= innerR && Math.abs(dx) <= r) {
        setPixel(pixels, size, x, y, 0, 0, 0);
      }

      // Vertical line segment
      if (Math.abs(x - cx) < halfLine && Math.abs(dy) >= innerR && Math.abs(dy) <= r) {
        setPixel(pixels, size, x, y, 0, 0, 0);
      }
    }
  }

  return Buffer.from(pixels);
}

function setPixel(pixels, size, x, y, r, g, b) {
  const idx = (y * size + x) * 3;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
}

// Generate icons
const iconsDir = path.join(__dirname, '..', 'icons');
const sizes = [16, 48, 128];

for (const size of sizes) {
  const pixels = drawIcon(size);
  const png = createPNG(size, size, pixels);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
}

console.log('All icons generated successfully');
