const key = (ref) => `${ref?.type}:${ref?.id}@${ref?.revision}`;
const normalize = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Typed semantics, with missing fields distinct from explicit pending values. */
export function actionOutcome(record) {
  if (!['pass', 'shot'].includes(record?.type)) return null;
  if (!Object.hasOwn(record, 'result')) return { status: 'unknown', basis: 'result-absent' };
  if (record.result === null) return { status: 'pending', basis: 'result-null' };
  if (record.type === 'pass' && typeof record.result === 'boolean')
    return { status: record.result ? 'completed' : 'failed', basis: 'result-boolean' };
  if (record.type === 'shot' && record.result === true)
    return { status: 'goal', basis: 'result-boolean' };
  if (record.type === 'shot' && record.result === false)
    return {
      status: ['saved', 'blocked', 'off-target', 'on-target'].includes(record.outcome)
        ? record.outcome
        : 'not-goal',
      basis: record.outcome ? 'result-and-outcome' : 'result-boolean',
    };
  return { status: 'unknown', basis: 'invalid-result' };
}

function sourceRows(packet) {
  const rows = [
    ...(packet.queryResults || []).flatMap((query) => query.rows || []),
    ...(packet.requestedEvidence || []).flatMap((query) => query.rows || []),
    ...(packet.linkedContext?.rows || []),
    ...(packet.shotTimeline?.rows || []),
  ];
  const latest = new Map();
  for (const row of rows) {
    const prior = latest.get(row.id);
    if (!prior || prior.revision < row.revision) latest.set(row.id, row);
  }
  return latest;
}

/** Conservative assertion checks, independent of a model's actor/count labels.
 * Scope additions only expose proof already returned by a complete typed query.
 * They do not infer a different event, edit wording or repair an unknown fact. */
export function checkActionEvidence(answer, packet) {
  const checked = structuredClone(answer),
    issues = [],
    augmentations = [],
    rows = sourceRows(packet);
  const queries = [
    ...new Map(
      [
        ...(packet.requestedEvidence || []),
        ...(packet.queryResults || []),
        ...(packet.shotTimeline ? [packet.shotTimeline] : []),
      ].map((query) => [key(query.scopeReference), query]),
    ).values(),
  ];
  for (const [claimIndex, claim] of checked.claims.entries()) {
    if (claim.kind === 'general') continue;
    const text = normalize(claim.text),
      cited = (claim.evidence || [])
        .filter((ref) => ref.type === 'event')
        .map((ref) => rows.get(ref.id))
        .filter(
          (row) =>
            row && claim.evidence.some((ref) => ref.id === row.id && ref.revision === row.revision),
        );
    const passes = cited.filter((row) => row.type === 'pass');
    const unavailable =
      /\b(?:outcome|result|completion|success|resultado|resultado do passe|resultat|issue)\b[^.!?;]{0,45}\b(?:unknown|unclear|unavailable|unrecorded|not (?:recorded|known|available)|inconnu|inconnue|inconnu[e]?|non (?:enregistre|connu)|desconocido|desconocida|no (?:registrado|se conoce)|desconhecido|desconhecida|nao (?:registado|registrado|conhecido))\b/u.test(
        text,
      ) ||
      /\b(?:no|not|without)\s+(?:recorded\s+)?(?:outcome|result|completion result)\b/u.test(text);
    if (
      unavailable &&
      passes.length === 1 &&
      cited.every((row) => row.type === 'pass') &&
      typeof passes[0].result === 'boolean'
    )
      issues.push({
        claimIndex,
        reason:
          'The cited current pass has a recorded boolean result; its completion outcome is known, not unavailable.',
        correctRecord: {
          id: passes[0].id,
          revision: passes[0].revision,
          actionOutcome: actionOutcome(passes[0]),
        },
      });
    const matches = [
      ...text.matchAll(
        /\b(first|earliest|latest|last|most recent|premier\w*|dernier\w*|primer\w*|ultim\w*|primeir\w*)\s+((?:[\p{L}]+\s+){0,5})(pass(?:es)?|pases?|passe|shot|shots|attempt|attempts|tir|tirs|tiro|tiros|chute|chutes|recovery|recoveries)\b/gu,
      ),
    ];
    // A subsequent sentence may assert no later action by referring to the cited
    // event. This is an ordered-scope assertion, not an individual event fact.
    if (
      /\bno\s+(?:other\s+|later\s+|further\s+)+(?:[\p{L}]+\s+){0,3}(?:pass(?:es)?|shots?|attempts?|recoveries)\b[^.!?;]*\b(?:after|later|since)\b/u.test(
        text,
      )
    ) {
      const type = cited.length === 1 ? cited[0].type : null;
      if (type) matches.push(Object.assign(['', 'latest', '', type], { index: 0 }));
    }
    for (const match of matches) {
      if (/\b(?:before|preceding|prior to|avant|antes de)\s*$/u.test(text.slice(0, match.index)))
        continue;
      const type = /^(?:pass|pase)/u.test(match[3])
        ? 'pass'
        : match[3].startsWith('recover')
          ? 'recovery'
          : 'shot';
      const order = /^(?:first|earliest|premier|primer|primeir)/u.test(match[1]) ? 'asc' : 'desc';
      const candidates = cited.filter((row) => row.type === type);
      if (!candidates.length) continue;
      const context = normalize(
        [packet.question, packet.previousQuestion].filter(Boolean).join(' '),
      );
      const eligible = queries.filter((source) => {
        const query = source.query,
          filters = query?.filters || {},
          observedAt = packet.observedAt ?? packet.currentTime;
        if (
          source.scopeReference?.type !== 'scope' ||
          query?.aggregate !== 'list' ||
          filters.type !== type ||
          filters.id ||
          query.timeFrom !== 0 ||
          query.timeTo !== observedAt ||
          Object.values(source.scope?.missingFields || {}).some((count) => count > 0)
        )
          return false;
        if (
          type === 'pass' &&
          !passQueryOutcomeAllowed(
            {
              question: packet.question,
              previousQuestion: packet.previousQuestion,
              conversation: packet.conversation,
            },
            query,
          )
        )
          return false;
        if (type === 'shot') {
          const metrics = allowedOperationMetrics({
            question: packet.question,
            previousQuestion: packet.previousQuestion,
            conversation: packet.conversation,
          });
          if (
            Object.hasOwn(filters, 'result') &&
            !(filters.result === true && metrics.includes('goals'))
          )
            return false;
          if (
            filters.outcome &&
            !(filters.outcome === 'on-target' && metrics.includes('shotsOnTarget')) &&
            !context.includes(normalize(filters.outcome))
          )
            return false;
        }
        if (filters.bodyPart) {
          const qualifiers = {
            'right-foot': /\b(?:right foot\w*|pied droit|pie derecho|pe direito)\b/u,
            'left-foot': /\b(?:left foot\w*|pied gauche|pie izquierdo|pe esquerdo)\b/u,
            head: /\b(?:head\w*|tete|cabeza|cabeca)\b/u,
          };
          if (!qualifiers[filters.bodyPart]?.test(context)) return false;
        }
        for (const field of ['passType', 'technique', 'recoveryKind', 'linkedShotOutcome'])
          if (filters[field] && !context.includes(normalize(filters[field]))) return false;
        for (const field of ['player', 'team', 'receiver'])
          if (filters[field]) {
            const entity =
              field === 'team'
                ? packet.teams?.[filters[field]]
                : (packet.roster || []).find(
                    (player) => player.id === filters[field] || player.name === filters[field],
                  )?.name;
            if (
              !entity ||
              (!context.includes(normalize(entity)) &&
                !context.includes(normalize(entity.split(' ').at(-1))))
            )
              return false;
          }
        const sourceRows = (source.rows || []).length
          ? source.rows
          : (source.rowReferences || []).map((ref) => rows.get(ref.id)).filter(Boolean);
        // LIMIT1 may be truncated but still proves one endpoint of its exact query.
        // A complete ordered list can prove either endpoint without a second query.
        const complete = source.truncated === false && source.count === sourceRows.length;
        if (!complete && (query.order || 'asc') !== order) return false;
        if (!complete && query.limit !== 1) return false;
        if (!sourceRows.length) return false;
        const sorted = [...sourceRows].sort(
          (a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id)),
        );
        const expected = order === 'asc' ? sorted[0] : sorted.at(-1);
        return candidates.some(
          (row) => row.id === expected.id && row.revision === expected.revision,
        );
      });
      const already = eligible.find((source) =>
        claim.evidence.some((ref) => key(ref) === key(source.scopeReference)),
      );
      if (already) continue;
      const proof = eligible[0];
      if (!proof) {
        issues.push({
          claimIndex,
          reason:
            'A first/latest or no-later-event assertion needs its complete ordered query scope as well as the current event; an event alone does not prove chronology.',
          assertion: match[0],
        });
        continue;
      }
      claim.evidence.push(structuredClone(proof.scopeReference));
      augmentations.push({
        claimIndex,
        reference: structuredClone(proof.scopeReference),
        reason: 'verified-ordered-event-scope',
        assertion: match[0],
      });
    }
  }
  return { answer: checked, issues, augmentations };
}
import { passQueryOutcomeAllowed } from './pass-query-permissions.js';
import { allowedOperationMetrics } from './operation-capabilities.js';
