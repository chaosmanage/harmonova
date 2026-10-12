import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
export const dummyApiKey = 'harmonova-dummy-key-not-a-credential';
export const loggedInHn = fs.readFileSync(new URL('../fixtures/hn/synthetic/news-in.html', import.meta.url), 'utf8');
export const incognitoSender = id => ({ id, frameId: 0, url: 'https://news.ycombinator.com/news', tab: { id: 1, incognito: true, url: 'https://news.ycombinator.com/news' } });
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, bytes) => {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
};
const png = (width, height) => {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND', Buffer.alloc(0))]);
};
export const tinyPng = png(1, 1);
export const oversizedPng = () => png(100000, 100000);
export const chunkedBody = (chunks = 4096, bytes = 1024) => new ReadableStream({ pull(controller) { if (chunks-- > 0) controller.enqueue(new Uint8Array(bytes)); else controller.close(); } });
export const opaqueRedirect = () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), url: '' });

export const seedDummyKey = worker => worker.evaluate(key => chrome.storage.session.set({ harmonovaAiApiKeySession: key }), dummyApiKey);
