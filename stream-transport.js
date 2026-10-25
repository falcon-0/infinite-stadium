import { createGzip, constants } from 'node:zlib';

/** Respect an explicit gzip refusal, including when a wildcard is present. */
export function acceptsGzip(header = '') {
  const encodings = new Map(
    String(header)
      .toLowerCase()
      .split(',')
      .map((entry) => {
        const [name, ...parameters] = entry.trim().split(';');
        const quality = parameters.find((value) => value.trim().startsWith('q='));
        const q = quality ? Number(quality.trim().slice(2)) : 1;
        return [name.trim(), Number.isFinite(q) && q > 0 && q <= 1];
      }),
  );
  return encodings.has('gzip') ? encodings.get('gzip') : encodings.get('*') === true;
}

/** Flush each event so compression never waits for the replay to finish. */
export function createEventStreamTransport(req, res) {
  const compressed = acceptsGzip(req.headers['accept-encoding']);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    Vary: 'Accept-Encoding',
    ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
  });
  if (!compressed) return res;
  const writer = createGzip({ flush: constants.Z_SYNC_FLUSH });
  writer.on('error', () => res.destroy());
  res.once('close', () => writer.destroy());
  writer.pipe(res);
  return writer;
}
