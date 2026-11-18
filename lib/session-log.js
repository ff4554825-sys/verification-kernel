/** Read DSH session JSONL logs, including concatenated zstd frames. */

import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decodeZstdFrames(buffer) {
  const offsets = [];
  let index = 0;
  while (index <= buffer.length - 4) {
    const found = buffer.indexOf(ZSTD_MAGIC, index);
    if (found < 0) break;
    offsets.push(found);
    index = found + 4;
  }
  if (offsets.length === 0) return null;
  let text = '';
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length;
    try {
      text += zlib.zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
    } catch {
      /* a corrupt frame is skipped; other frames may still be readable */
    }
  }
  return text;
}

/** Read a session log as parsed events. Supports .jsonl and .jsonl.zstd. */
export async function readSessionEvents(filePath) {
  const buffer = await fs.readFile(filePath);
  const decoded = decodeZstdFrames(buffer);
  const text = decoded ?? buffer.toString('utf8');
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }
  return events;
}
