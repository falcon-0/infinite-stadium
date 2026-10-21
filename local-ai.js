import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRequest, GenerationError, validateDraft } from './ai.js';
import { createInvestigationTools } from './investigation-tools.js';
import { languagePreference } from './localization.js';
import { momentBrief, briefCoverage } from './moment-brief.js';
import { reviewClaimRisks } from './claim-guards.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const python = fileURLToPath(
  new URL(
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
    import.meta.url,
  ),
);
export const localModel = 'qwen3:4b';
function rejectInstructionEcho(draft) {
  const instructions = new Set([
    'explain this recorded moment in one short sentence',
    'explain this synthetic moment briefly',
  ]);
  if (
    draft.claims.some((claim) =>
      instructions.has(
        claim.text
          .trim()
          .toLowerCase()
          .replace(/[.!?]+$/, ''),
      ),
    )
  )
    throw new GenerationError(
      'The local model echoed its task instead of explaining the evidence.',
    );
  return draft;
}

export async function localStatus({ fetcher = fetch } = {}) {
  const libraries = [new URL('.venv/Lib/site-packages/', import.meta.url)];
  const posixLib = new URL('.venv/lib/', import.meta.url);
  if (existsSync(posixLib))
    for (const name of readdirSync(posixLib))
      if (/^python3\.\d+$/.test(name)) libraries.push(new URL(`${name}/site-packages/`, posixLib));
  const installed =
    existsSync(python) &&
    libraries.some(
      (root) =>
        existsSync(new URL('agent_framework/', root)) &&
        existsSync(new URL('agent_framework_ollama/', root)),
    );
  let runtime = false,
    modelReady = false;
  try {
    const response = await fetcher('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json();
      runtime = true;
      modelReady = data.models?.some((model) => model.name === localModel) === true;
    }
  } catch {}
  return {
    provider: 'local',
    model: localModel,
    runtime,
    installed,
    modelReady,
    configured: installed && modelReady,
    connected: false,
    apiCharges: 0,
  };
}

export async function runLocalPacket(packet, { signal, timeoutMs = 180000 } = {}) {
  if (!existsSync(python))
    throw new GenerationError('Install the optional local Python requirements first.', 503);
  if (signal?.aborted) throw new GenerationError('Local generation was cancelled.', 499);
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    );
    env.PYTHONUTF8 = '1';
    const child = spawn(python, ['local_agents.py'], {
      cwd: directory,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => {
      child.kill();
      finish(new GenerationError('Local generation was cancelled.', 499));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new GenerationError('Local generation exceeded its 180-second deadline.', 504));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () =>
      finish(new GenerationError('Unable to start the local Python worker.', 503)),
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1000000) {
        child.kill();
        finish(new GenerationError('Local response exceeded the output limit.'));
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () =>
      finish(new GenerationError('Unable to send evidence to the local worker.')),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        finish(
          new GenerationError(
            'Local worker failed. Check Ollama, model download and Python requirements.',
            503,
          ),
        );
        return;
      }
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(new GenerationError('Local worker returned malformed JSON.'));
      }
    });
    child.stdin.end(JSON.stringify(packet));
  });
}

function execution(result) {
  if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0)
    throw new GenerationError('Invalid local execution metadata.');
  if (!Number.isInteger(result.modelCalls) || result.modelCalls < 1 || result.modelCalls > 8)
    throw new GenerationError('Invalid local model-call count.');
  const reported = result.usageReportedCalls ?? 0;
  if (!Number.isInteger(reported) || reported < 0 || reported > result.modelCalls)
    throw new GenerationError('Invalid local token-report count.');
  const usage = result.usage ?? null;
  if (
    usage &&
    (!Number.isSafeInteger(usage.promptTokens) ||
      usage.promptTokens < 0 ||
      !Number.isSafeInteger(usage.completionTokens) ||
      usage.completionTokens < 0)
  )
    throw new GenerationError('Invalid local token usage.');
  if (![0, 1].includes(result.repairCount ?? 0))
    throw new GenerationError('Invalid local repair count.');
  return {
    elapsedMs: result.elapsedMs,
    modelCalls: result.modelCalls,
    toolCalls: result.tools?.length ?? 0,
    repairCount: result.repairCount ?? 0,
    trace: result.tools ?? [],
    usage,
    usageReportedCalls: reported,
  };
}

export async function generateLocalDraft(input, { runner = runLocalPacket, signal } = {}) {
  const { explanation, audience } = buildRequest(input);
  const language = languagePreference(input.language ?? 'en');
  const frameIds = new Set(
    (explanation.metrics ?? []).flatMap((metric) =>
      metric.inputs.filter((ref) => ref.type === 'frame').map((ref) => ref.id),
    ),
  );
  const playerIds = new Set(
    [
      ...(explanation.metrics ?? []).flatMap((metric) => [metric.playerId, metric.opponentId]),
      ...(explanation.sequence ?? []).flatMap((event) => [event.playerId, event.receiverId]),
    ].filter(Boolean),
  );
  const positions = (explanation.positions ?? [])
    .filter((frame) => frameIds.has(frame.id))
    .map((frame) => ({
      ...frame,
      players: frame.players.filter((player) => playerIds.has(player.id)),
      selection:
        'Only tracks involved in supplied events or measurements; not the full team configuration.',
    }));
  const brief = momentBrief(explanation),
    plain = ['newcomer', 'player'].includes(audience) && !!brief;
  const context = {
    source: explanation.source,
    anchorId: explanation.anchorId,
    task: explanation.task,
    brief,
    text: explanation.text,
    limit: explanation.limit,
    sequence: explanation.sequence,
    positions,
    metrics: explanation.metrics ?? [],
    evidence: explanation.evidence.filter((ref) => ref.type !== 'frame' || frameIds.has(ref.id)),
  };
  if (plain) {
    context.text = brief.facts.map((f) => f.text).join(' ');
    context.positions = [];
    context.metrics = [];
    context.sequence = context.sequence.map(
      ({ id, revision, time, arrivedAt, team, player, type, result, receiverId }) => ({
        id,
        revision,
        time,
        arrivedAt,
        team,
        player,
        type,
        result,
        receiverId,
      }),
    );
    context.evidence = context.evidence.filter((r) => !r.type || r.type === 'event');
  }
  const result = await runner(
    { mode: 'single', audience, language, explanation: context },
    { signal },
  );
  const validated = rejectInstructionEcho(validateDraft(result.draft, context)),
    coverage = briefCoverage(validated, brief);
  return {
    source: 'microsoft-agent-framework-ollama',
    provider: 'local',
    model: localModel,
    status: 'draft',
    evidenceSource: explanation.source || 'match',
    anchorId: explanation.anchorId,
    key: explanation.key,
    audience,
    language: language.code,
    ...validated,
    coverage,
    execution: execution(result),
    review:
      'Local AI draft. Human factual review is required.' +
      (coverage.warning ? ' ' + coverage.warning : ''),
  };
}

export async function investigateLocally(input, { runner = runLocalPacket, signal } = {}) {
  const registry = createInvestigationTools(input, { compactPositions: true });
  const outputs = Object.fromEntries(
    registry.definitions.map((d) => [d.function.name, registry.execute(d.function.name, {})]),
  );
  const result = await runner(
    {
      mode: 'investigator-reviewer',
      scope: registry.scope,
      audience: registry.audience,
      language: registry.language,
      outputs,
    },
    { signal },
  );
  if (
    !Array.isArray(result.tools) ||
    !result.tools.length ||
    result.tools.length > 6 ||
    result.tools.some((name) => !Object.hasOwn(outputs, name))
  )
    throw new GenerationError('Local investigator did not use valid evidence tools.');
  if (
    !['approve', 'revise'].includes(result.review?.decision) ||
    !Array.isArray(result.review.issues) ||
    result.review.issues.length > 8 ||
    result.review.issues.some((issue) => typeof issue !== 'string' || issue.length > 500)
  )
    throw new GenerationError('Local reviewer returned an invalid decision.');
  if (
    (result.review.decision === 'approve' && result.review.issues.length) ||
    (result.review.decision === 'revise' && !result.review.issues.length)
  )
    throw new GenerationError('Local reviewer returned a contradictory decision.');
  const evidence = result.tools.flatMap((name) => outputs[name].references);
  const draft = rejectInstructionEcho(validateDraft(result.draft, { evidence }));
  const risks = reviewClaimRisks(draft, {
    outputs: Object.fromEntries(result.tools.map((name) => [name, outputs[name]])),
    language: registry.language.code,
  });
  const released = result.review.decision === 'approve' && !risks.length;
  return {
    source: 'microsoft-agent-framework-ollama',
    provider: 'local',
    model: localModel,
    evidenceSource: 'integrated-match',
    status: released ? 'draft' : 'withheld',
    key: registry.key,
    anchorId: registry.anchorId,
    audience: registry.audience,
    language: registry.language.code,
    claims: released ? draft.claims : [],
    issues: [...result.review.issues, ...risks],
    execution: execution(result),
    review:
      'Local investigator and reviewer. Human factual review is required; model approval does not prove truth.',
  };
}
