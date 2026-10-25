import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGunzip, gunzipSync } from 'node:zlib';
import { createServer } from './server.js';
import { acceptsGzip } from './stream-transport.js';

test('stream compression respects explicit client encoding choices', () => {
  for (const value of ['gzip', 'br, gzip;q=0.6', '*;q=0.5']) assert.equal(acceptsGzip(value), true);
  for (const value of ['', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1', 'gzip;q=broken', 'gzip;q=2'])
    assert.equal(acceptsGzip(value), false);
});

async function start(t) {
  const server = createServer({ env: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

async function complete(base, encoding) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      base + '/api/stream?kind=sustained&seed=17&time=120',
      {
        headers: { 'accept-encoding': encoding },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ headers: response.headers, bytes: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}

test('compressed terminal stream decodes byte-for-byte to the identity event stream', async (t) => {
  const base = await start(t);
  const plain = await complete(base, 'identity');
  const compressed = await complete(base, 'gzip');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.deepEqual(gunzipSync(compressed.bytes), plain.bytes);
  assert.match(plain.bytes.toString(), /event: complete\ndata: \{\}\n\n$/);
  assert.ok(
    compressed.bytes.length < plain.bytes.length / 3,
    'compress the actual received payload',
  );
});

test(
  'gzip delivers a complete first event before the ongoing replay ends',
  { timeout: 5000 },
  async (t) => {
    const base = await start(t);
    await new Promise((resolve, reject) => {
      const request = http.get(
        base + '/api/stream?kind=sustained&seed=17&time=80',
        {
          headers: { 'accept-encoding': 'gzip' },
        },
        (response) => {
          const decoder = createGunzip();
          let text = '';
          decoder.on('error', reject);
          decoder.on('data', (chunk) => {
            text += chunk;
            if (!text.includes('\n\n')) return;
            try {
              assert.match(text, /^id: sustained:17:80\nevent: match\n/);
              assert.equal(
                response.complete,
                false,
                'the forty-second remainder is still streaming',
              );
              const event = JSON.parse(text.split('\ndata: ')[1].split('\n\n')[0]);
              assert.equal(event.time, 80);
              response.unpipe(decoder);
              decoder.destroy();
              request.destroy();
              resolve();
            } catch (error) {
              reject(error);
            }
          });
          response.pipe(decoder);
        },
      );
      request.on('error', reject);
    });
  },
);
