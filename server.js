import { createStreamCadence } from './stream-cadence.js';
import { createEventStreamTransport } from './stream-transport.js';
import { randomUUID } from 'node:crypto';
import {
  createQuestionDiagnostics,
  beginQuestionTiming,
  endQuestionTiming,
  questionTimingSegments,
} from './question-diagnostics.js';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { broadcastFrame } from './broadcast.js';
import { integratedFeed } from './match-stream.js';
import { serverSettings, modelBudget, authorized } from './server-settings.js';
import { readFile } from 'node:fs/promises';
import { configuration, generateDraft, GenerationError } from './ai.js';
import { sceneInvestigation } from './evidence.js';
import { matchRecap } from './narratives.js';
import { integratedMatch } from './match-stream.js';
import { investigateWithAgents } from './agent-workflow.js';
import { investigateFactStory } from './fact-workflow.js';
import { createAccessSessions } from './access-sessions.js';
import { localStatus, generateLocalDraft, investigateLocally } from './local-ai.js';
import { investigateLocalFactStory } from './local-fact-workflow.js';
import { generateRecapStory } from './recap-workflow.js';
import { buildRecapCue } from './recap-cue.js';
import { exportSyntheticDataset } from './dataset-export.js';
import { createPersistentModelBudget } from './persistent-budget.js';
import { validateProducerStories } from './producer-validation.js';
import { productionPackage } from './production-package.js';
import { answerMatchQuestion } from './match-questions.js';
import { answerMatchQuestionAI, needsQuestionClarification } from './match-question-ai.js';
const files = new Map([
  ['/', 'index.html'],
  ['/app.js', 'app.js'],
  ['/engine.js', 'engine.js'],
  ['/style.css', 'style.css'],
  ['/stream-ui.js', 'stream-ui.js'],
  ['/stream-state.js', 'stream-state.js'],
  ['/viewer-story.js', 'viewer-story.js'],
  ['/viewer-copy.js', 'viewer-copy.js'],
  ['/catchup.js', 'catchup.js'],
  ['/localization.js', 'localization.js'],
]);
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
files.set('/investigation-cache.js', 'investigation-cache.js');
files.set('/producer-cue.js', 'producer-cue.js');
files.set('/player-focus.js', 'player-focus.js');
files.set('/recap-view.js', 'recap-view.js');
files.set('/studio-preview.js', 'studio-preview.js');
files.set('/viewer-preferences.js', 'viewer-preferences.js');
files.set('/source-teams.js', 'source-teams.js');
files.set('/moment-path.js', 'moment-path.js');
for (const name of [
  'fixture-settings',
  'match-picture',
  'match-change',
  'producer-review',
  'producer-review-ui',
  'viewer-refresh',
  'viewer-moments',
  'pitch-motion',
  'pitch-renderer',
  'moment-replay',
  'moment-meaning',
  'fan-experience',
])
  files.set(`/${name}.js`, `${name}.js`);
files.set('/fan-experience.css', 'fan-experience.css');
for (const name of [
  'production-desk-ui',
  'production-desk-state',
  'match-chat-ui',
  'match-chat-state',
  'watch-insights',
  'watch-stats',
  'watch-snapshot',
  'recovery-classification',
])
  files.set(`/${name}.js`, `${name}.js`);
const handlerStarts = new WeakMap();
function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(data),
    duration = Math.max(0, performance.now() - handlerStarts.get(res));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Server-Timing': `app;dur=${duration.toFixed(3)}`,
  });
  res.end(body);
}
function budgetFilename(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 300)
    throw new Error('Invalid model budget file configuration.');
  const root = fileURLToPath(new URL('.', import.meta.url)),
    runtime = resolve(root, '.runtime'),
    filename = resolve(root, value);
  if (
    dirname(filename) !== runtime ||
    !/^[-a-zA-Z0-9_]{1,100}\.json$/.test(basename(filename)) ||
    (existsSync(runtime) &&
      (!lstatSync(runtime).isDirectory() || lstatSync(runtime).isSymbolicLink())) ||
    (existsSync(filename) && lstatSync(filename).isSymbolicLink())
  )
    throw new Error('Invalid model budget file configuration.');
  return filename;
}
export function createServer({
  env = process.env,
  fetcher = fetch,
  localRunner,
  localStatusReader = localStatus,
  sharedBudget,
  sharedAccess,
  questionFailureLogger = (summary) => console.error(JSON.stringify(summary)),
} = {}) {
  const settings = serverSettings(env),
    filename = budgetFilename(env.MODEL_BUDGET_FILE);
  const accessCode = env.APP_ACCESS_CODE;
  if (
    accessCode !== undefined &&
    (typeof accessCode !== 'string' ||
      accessCode.length < 6 ||
      accessCode.length > 128 ||
      !settings.token)
  )
    throw new Error('Invalid project access code configuration.');
  if (
    sharedBudget &&
    !(
      sharedBudget.durable === true &&
      typeof sharedBudget.snapshot === 'function' &&
      typeof sharedBudget.take === 'function'
    )
  )
    throw new Error('Invalid shared model budget.');
  if (
    settings.publicHost &&
    env.AZURE_OPENAI_ENDPOINT &&
    env.AZURE_OPENAI_DEPLOYMENT &&
    env.AZURE_OPENAI_API_KEY &&
    !filename &&
    !sharedBudget
  )
    throw new Error(
      'Public Azure hosting requires MODEL_BUDGET_FILE in the project .runtime directory. Mount that directory on persistent storage.',
    );
  const budget =
    sharedBudget ||
    (filename
      ? createPersistentModelBudget({ limit: settings.dailyModelCalls, filename })
      : modelBudget(settings.dailyModelCalls));
  const access = sharedAccess || createAccessSessions(settings);
  const local = env.AI_PROVIDER === 'local';
  if (local && settings.publicHost)
    throw new Error('Local inference currently requires loopback hosting.');
  let generating = false,
    streams = 0;
  const countedFetch = async (...args) => {
    args[1]?.signal?.throwIfAborted();
    await budget.take();
    args[1]?.signal?.throwIfAborted();
    return fetcher(...args);
  };
  const server = http.createServer(async (req, res) => {
    handlerStarts.set(res, performance.now());
    beginQuestionTiming(res, 'handler');
    try {
      let requestURL;
      try {
        requestURL = new URL(req.url, 'http://localhost');
      } catch {
        json(res, 400, { error: 'Invalid request URL.' });
        return;
      }
      const path = requestURL.pathname;
      const questionDiagnostics =
        path === '/api/agent/question' && req.method === 'POST'
          ? createQuestionDiagnostics(randomUUID())
          : null;
      if (questionDiagnostics) res.setHeader('X-Request-Id', questionDiagnostics.requestId);
      if (
        path === '/' &&
        req.method === 'GET' &&
        requestURL.searchParams.get('view') === 'studio'
      ) {
        requestURL.searchParams.set('view', 'watch');
        res.writeHead(302, { Location: `/${requestURL.search}`, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (path === '/api/health' && req.method === 'GET') {
        json(res, 200, { healthy: true, synthetic: true });
        return;
      }
      if (
        ['/api/production/package', '/api/match/question'].includes(path) &&
        req.method === 'POST'
      ) {
        if (req.headers.origin && !settings.origins.includes(req.headers.origin)) {
          json(res, 403, { error: 'Origin is not allowed.' });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'Use application/json.' });
          return;
        }
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 262144) throw new GenerationError('Request is too large.', 413);
            chunks.push(chunk);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new GenerationError('Invalid JSON request.', 400);
          }
          json(
            res,
            200,
            path === '/api/match/question' ? answerMatchQuestion(input) : productionPackage(input),
          );
        } catch (error) {
          json(res, error instanceof GenerationError ? error.status : 400, {
            error:
              error instanceof GenerationError
                ? error.message
                : path === '/api/match/question'
                  ? 'Ask a valid match question of up to 400 characters.'
                  : 'Choose a current received shot and valid output settings.',
          });
        }
        return;
      }
      if (path === '/api/producer/validate' && req.method === 'POST') {
        if (req.headers.origin && !settings.origins.includes(req.headers.origin)) {
          json(res, 403, { error: 'Origin is not allowed.' });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'Use application/json.' });
          return;
        }
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 262144) throw new GenerationError('Request is too large.', 413);
            chunks.push(chunk);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new GenerationError('Invalid JSON request.', 400);
          }
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            Object.keys(input).length !== 3 ||
            !['preferences', 'time', 'items'].every((key) => Object.hasOwn(input, key))
          )
            throw new GenerationError('Invalid producer validation request.', 400);
          json(res, 200, validateProducerStories(input));
        } catch (error) {
          json(res, error instanceof GenerationError ? error.status : 400, {
            error:
              error instanceof GenerationError
                ? error.message
                : 'Choose a valid received story and review scope.',
          });
        }
        return;
      }
      if (path === '/api/access' && ['POST', 'DELETE'].includes(req.method)) {
        try {
          if (req.method === 'POST') {
            // A human-friendly project code creates the same opaque session. The
            // internal bearer credential stays private and is never sent to browsers.
            const login =
              accessCode && authorized(req.headers.authorization, accessCode)
                ? { headers: { ...req.headers, authorization: `Bearer ${settings.token}` } }
                : req;
            await access.authenticate(login, res);
          } else await access.clear(req, res);
          json(res, 200, { authenticated: req.method === 'POST' || (await access.status(req)) });
        } catch (error) {
          json(res, error instanceof GenerationError ? error.status : 500, {
            error: error instanceof GenerationError ? error.message : 'Unable to update AI access.',
          });
        }
        return;
      }
      if (path === '/api/stream' && req.method === 'GET') {
        if (streams >= 4) {
          json(res, 429, { error: 'Stream limit reached.' });
          return;
        }
        const params = new URL(req.url, 'http://localhost').searchParams;
        const input = {
          kind: params.get('kind') || 'extended',
          seed: Number(params.get('seed') || 17),
          time: Number(params.get('time') || 0),
          audience: params.get('audience') || 'newcomer',
          language: params.get('language') || 'en',
          favoriteClub: params.get('favoriteClub') || null,
          favoritePlayer: params.get('favoritePlayer') || null,
        };
        const speed = Number(params.get('speed') || 1);
        if (!Number.isFinite(speed) || speed < 1 || speed > 12) {
          json(res, 400, { error: 'Choose a stream speed from 1 to 12.' });
          return;
        }
        let first, feed;
        try {
          feed = integratedFeed(input.kind, input.seed);
          first = integratedMatch(input, feed);
        } catch {
          json(res, 400, { error: 'Invalid stream settings.' });
          return;
        }
        const resume = req.headers['last-event-id'];
        if (resume) {
          const prefix = `${input.kind}:${input.seed}:`;
          const time = Number(String(resume).slice(prefix.length));
          if (
            !String(resume).startsWith(prefix) ||
            !Number.isFinite(time) ||
            time < 0 ||
            time > first.state.metadata.observationHorizon
          ) {
            json(res, 400, { error: 'Invalid stream resume cursor.' });
            return;
          }
          input.time = time;
        }
        const writer = createEventStreamTransport(req, res);
        streams++;
        let previous = null,
          timer = null,
          closed = false;
        const nextDelay = createStreamCadence(speed);
        const close = () => {
          if (closed) return;
          closed = true;
          streams--;
          if (timer) clearTimeout(timer);
        };
        res.on('close', close);
        const tick = () => {
          if (closed) return;
          try {
            const frame = broadcastFrame(input, previous, feed);
            previous = frame.bundle;
            const ready = writer.write(
              `id: ${input.kind}:${input.seed}:${input.time}\nevent: match\ndata: ${JSON.stringify(frame.message)}\n\n`,
            );
            if (input.time >= previous.state.metadata.observationHorizon) {
              writer.write('event: complete\ndata: {}\n\n');
              close();
              writer.end();
              return;
            }
            input.time = Math.min(previous.state.metadata.observationHorizon, input.time + 1);
            const schedule = () => {
              if (!closed) timer = setTimeout(tick, nextDelay());
            };
            if (ready) schedule();
            else writer.once('drain', schedule);
          } catch {
            writer.write('event: error\ndata: {"error":"Stream stopped."}\n\n');
            close();
            writer.end();
          }
        };
        tick();
        return;
      }
      if (path === '/api/match' && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        try {
          json(
            res,
            200,
            integratedMatch({
              kind: params.get('kind') || 'central',
              seed: Number(params.get('seed') || 17),
              time: Number(params.get('time') || 0),
              anchorId: params.get('anchorId') || undefined,
              audience: params.get('audience') || 'newcomer',
              favoriteClub: params.get('favoriteClub') || null,
              favoritePlayer: params.get('favoritePlayer') || null,
              limit: Number(params.get('limit') || 5),
              language: params.get('language') || 'en',
            }),
          );
        } catch {
          json(res, 400, { error: 'Invalid integrated match query.' });
        }
        return;
      }
      if (path === '/api/data/synthetic' && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        try {
          if (
            [...params.keys()].some((key) => !['kind', 'seed', 'observedAt'].includes(key)) ||
            [...params.keys()].some((key) => params.getAll(key).length !== 1)
          )
            throw new Error('Invalid dataset parameters.');
          json(
            res,
            200,
            exportSyntheticDataset({
              kind: params.get('kind') || 'extended',
              seed: Number(params.get('seed') || 17),
              observedAt: Number(params.get('observedAt') || 0),
            }),
          );
        } catch {
          json(res, 400, {
            error: 'Choose a valid synthetic fixture, seed and received observation time.',
          });
        }
        return;
      }
      if (path === '/api/recap' && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        try {
          json(
            res,
            200,
            matchRecap(Number(params.get('time') || 0), {
              audience: params.get('audience') || 'newcomer',
              favoriteClub: params.get('favoriteClub') || null,
              favoritePlayer: params.get('favoritePlayer') || null,
              limit: Number(params.get('limit') || 5),
              language: params.get('language') || 'en',
            }),
          );
        } catch {
          json(res, 400, { error: 'Invalid recap query.' });
        }
        return;
      }
      if (path === '/api/scene' && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        try {
          json(
            res,
            200,
            sceneInvestigation({
              kind: params.get('kind') || 'central',
              seed: Number(params.get('seed') || 17),
              time: Number(params.get('time') || 0),
              anchorId: params.get('anchorId') || undefined,
            }),
          );
        } catch {
          json(res, 400, { error: 'Invalid scene query.' });
        }
        return;
      }
      if (path === '/api/ai/status' && req.method === 'GET') {
        try {
          const accessStatus = {
            authRequired: !!settings.token && !(await access.status(req)),
            accessConfigured: !!settings.token,
          };
          if (local) {
            json(res, 200, { ...(await localStatusReader()), ...accessStatus });
            return;
          }
          const status = {
            provider: 'azure',
            configured: !!configuration(env),
            connected: false,
            ...accessStatus,
          };
          if (!status.configured) {
            json(res, 200, { ...status, available: false });
            return;
          }
          try {
            const modelBudget = await budget.snapshot(),
              available = modelBudget.calls < modelBudget.limit;
            json(res, 200, {
              ...status,
              available,
              questionAvailable: modelBudget.limit - modelBudget.calls >= 3,
              modelBudget,
              ...(!available
                ? { error: 'Daily model-call limit reached. Recorded insights remain available.' }
                : {}),
            });
          } catch {
            json(res, 200, {
              ...status,
              available: false,
              error: 'AI request counter is unavailable. Recorded insights remain available.',
            });
          }
        } catch {
          json(res, 200, {
            provider: local ? 'local' : 'azure',
            configured: false,
            connected: false,
            error: local
              ? 'Local AI status is unavailable.'
              : 'Azure configuration needs attention.',
          });
        }
        return;
      }
      if (path === '/api/studio/recap-cue' && req.method === 'POST') {
        if (req.headers.origin && !settings.origins.includes(req.headers.origin)) {
          json(res, 403, { error: 'Origin is not allowed.' });
          return;
        }
        if (!(await access.isAuthorized(req))) {
          json(res, 401, { error: 'Authorization required.' });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'Use application/json.' });
          return;
        }
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 131072) throw new GenerationError('Request is too large.', 413);
            chunks.push(chunk);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new GenerationError('Invalid JSON request.', 400);
          }
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            Object.keys(input).length !== 4 ||
            !['draft', 'time', 'preferences', 'requestKey'].every((key) =>
              Object.hasOwn(input, key),
            ) ||
            typeof input.requestKey !== 'string' ||
            input.requestKey.length > 4096
          )
            throw new GenerationError('Invalid recap export request.', 400);
          const bundle = integratedMatch({ ...input.preferences, time: input.time });
          json(
            res,
            200,
            buildRecapCue(input.draft, {
              records: bundle.state.events,
              time: input.time,
              preferences: input.preferences,
              requestKey: input.requestKey,
            }),
          );
        } catch (error) {
          json(res, error instanceof GenerationError ? error.status : 400, {
            error:
              error instanceof GenerationError
                ? error.message
                : 'Recap is unavailable or superseded. Create a current canonical recap before exporting.',
          });
        }
        return;
      }
      if (
        [
          '/api/ai/explain',
          '/api/agent/investigate',
          '/api/agent/story',
          '/api/agent/recap',
          '/api/agent/question',
        ].includes(path) &&
        req.method === 'POST'
      ) {
        // Generation is guarded regardless of whether it consumes local compute or cloud credits.
        if (req.headers.origin && !settings.origins.includes(req.headers.origin)) {
          json(res, 403, { error: 'Origin is not allowed.' });
          return;
        }
        if (!(await access.isAuthorized(req))) {
          json(res, 401, { error: 'Authorization required.' });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'Use application/json.' });
          return;
        }
        if (generating) {
          json(res, 429, {
            error: 'Another draft is generating. Please wait.',
            code: 'generation-busy',
          });
          return;
        }
        let ownsGeneration = false;
        try {
          let body = '';
          if (questionDiagnostics) beginQuestionTiming(res, 'requestBody');
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > (path === '/api/agent/question' ? 8192 : 4096))
              throw new GenerationError('Request is too large.', 413);
          }
          let input;
          try {
            input = JSON.parse(body);
          } catch {
            throw new GenerationError('Invalid JSON request.', 400);
          }
          if (questionDiagnostics) endQuestionTiming(res, 'requestBody');
          if (generating)
            throw new GenerationError(
              'Another draft is generating. Please wait.',
              429,
              'generation-busy',
            );
          generating = true;
          ownsGeneration = true;
          const controller = new AbortController();
          const cancel = () => controller.abort();
          res.once('close', cancel);
          try {
            const options = local
              ? { runner: localRunner, signal: controller.signal }
              : { config: configuration(env), fetcher: countedFetch, signal: controller.signal };
            const generate = local
              ? path === '/api/agent/story'
                ? investigateLocalFactStory
                : path === '/api/agent/investigate'
                  ? investigateLocally
                  : generateLocalDraft
              : path === '/api/agent/story'
                ? investigateFactStory
                : path === '/api/agent/investigate'
                  ? investigateWithAgents
                  : generateDraft;
            if (path === '/api/agent/question') {
              let checked;
              try {
                checked = answerMatchQuestion(input);
              } catch {
                throw new GenerationError(
                  'Ask a valid match question of up to 400 characters.',
                  400,
                );
              }
              if (local)
                throw new GenerationError(
                  'Natural-language question interpretation currently requires Azure. Recorded match search remains available.',
                  503,
                );
              if (
                !needsQuestionClarification(input) &&
                !(input.anchorId && checked.status === 'no-results')
              ) {
                const remaining = await budget.snapshot();
                if (remaining.limit - remaining.calls < 3)
                  throw new GenerationError(
                    'Daily model-call limit: not enough allowance remains for a complete reviewed answer.',
                    429,
                  );
              }
              json(
                res,
                200,
                await answerMatchQuestionAI(input, {
                  ...options,
                  onDiagnostic: (event) => questionDiagnostics?.record(event),
                  canRepair: async (required = 2) => {
                    const remaining = await budget.snapshot();
                    return remaining.limit - remaining.calls >= required;
                  },
                }),
              );
            } else
              json(
                res,
                200,
                await (path === '/api/agent/recap'
                  ? generateRecapStory(input, { ...options, provider: local ? 'local' : 'azure' })
                  : generate(input, options)),
              );
          } finally {
            res.removeListener('close', cancel);
          }
        } catch (error) {
          if (questionDiagnostics) {
            endQuestionTiming(res, 'requestBody');
            try {
              questionFailureLogger({
                ...questionDiagnostics.failure(
                  error,
                  error instanceof GenerationError ? error.status : 500,
                  performance.now() - handlerStarts.get(res),
                ),
                timings: questionTimingSegments(res),
              });
            } catch {}
          }
          json(res, error instanceof GenerationError ? error.status : 500, {
            error: error instanceof GenerationError ? error.message : 'Unable to generate a draft.',
            ...(error instanceof GenerationError && error.code ? { code: error.code } : {}),
          });
        } finally {
          if (ownsGeneration) generating = false;
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }
      const file = files.get(path);
      if (!file) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      try {
        const data = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, {
          'Content-Type': `${types[file.split('.').pop()]}; charset=utf-8`,
          'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch {
        res.writeHead(500);
        res.end('Unable to load file');
      }
    } catch (error) {
      if (!res.headersSent)
        json(res, error instanceof GenerationError ? error.status : 500, {
          error: error instanceof GenerationError ? error.message : 'Request is unavailable.',
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = serverSettings(process.env);
  createServer().listen(settings.port, settings.host, () =>
    console.log(`Infinite Stadium: http://${settings.host}:${settings.port}`),
  );
}
