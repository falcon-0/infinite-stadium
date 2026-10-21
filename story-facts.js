import { createHash } from 'node:crypto';
import { sourceTeams } from './source-teams.js';
const reference = (event) => ({ type: 'event', id: event.id, revision: event.revision });
const identity = (ref) => `${ref.type}:${ref.id}@${ref.revision}`;
const unique = (refs) =>
  [
    ...new Map(
      refs.map((r) => [identity(r), { type: r.type, id: r.id, revision: r.revision }]),
    ).values(),
  ].sort((a, b) => identity(a).localeCompare(identity(b)));
const validRef = (r) =>
  r &&
  ['event', 'frame', 'metric'].includes(r.type) &&
  typeof r.id === 'string' &&
  r.id &&
  Number.isInteger(r.revision) &&
  r.revision > 0;
const order = (a, b) => a.time - b.time || a.id.localeCompare(b.id);

/** Catalog of deterministic facts supported by executed, received-only tools.
 * This does not evaluate generated prose. Omitted tools cannot supply facts.
 * IDs encode exact values/references so corrections invalidate the fact ID.
 */
export function storyFacts(outputs, scope = {}) {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs))
    throw new TypeError('Provide executed tool outputs keyed by tool name.');
  const supplied = Object.values(outputs).find((output) => output?.scope)?.scope || {};
  scope = { ...supplied, ...scope };
  const teams = sourceTeams(scope.teams);
  if (
    typeof scope.anchorId !== 'string' ||
    !Number.isFinite(scope.eventTime) ||
    scope.eventTime < 0 ||
    !Number.isFinite(scope.observedAt) ||
    scope.observedAt < scope.eventTime
  )
    throw new RangeError('Provide a received anchor scope.');
  const facts = [];
  const add = (kind, sourceTool, values, text, refs) => {
    const output = outputs[sourceTool];
    if (
      output?.scope?.anchorId !== scope.anchorId ||
      output.scope.eventTime !== scope.eventTime ||
      output.scope.observedAt !== scope.observedAt
    )
      return;
    const outputTeams = sourceTeams(output.scope.teams);
    if (outputTeams.home !== teams.home || outputTeams.away !== teams.away) return;
    const allowed = new Set((output?.references || []).filter(validRef).map(identity));
    if (
      !Array.isArray(refs) ||
      !refs.length ||
      refs.some((r) => !validRef(r) || !allowed.has(identity(r)))
    )
      return;
    const evidence = unique(refs);
    const id =
      'fact-' +
      createHash('sha256')
        .update(
          `${kind}|${JSON.stringify(teams)}|${JSON.stringify(values)}|${evidence.map(identity).join('|')}`,
        )
        .digest('hex')
        .slice(0, 24);
    if (!facts.some((f) => f.id === id))
      facts.push({ id, kind, sourceTool, values, text, evidence });
  };
  const sequence = outputs.get_event_sequence;
  const events = (sequence?.events || [])
    .filter(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        Number.isInteger(e.revision) &&
        Number.isFinite(e.time) &&
        e.time <= scope.eventTime &&
        Number.isFinite(e.arrivedAt) &&
        e.arrivedAt <= scope.observedAt &&
        e.operation !== 'delete',
    )
    .sort(order);
  const anchor = events.find((e) => e.id === scope.anchorId && e.time === scope.eventTime);
  if (anchor) {
    const outcome =
      anchor.type === 'shot'
        ? anchor.result === true
          ? 'goal'
          : anchor.result === false
            ? 'no-goal'
            : 'pending'
        : anchor.type === 'pass'
          ? anchor.result === true
            ? 'completed'
            : anchor.result === false
              ? 'failed'
              : 'pending'
          : null;
    add(
      'moment',
      'get_event_sequence',
      {
        anchorId: anchor.id,
        time: anchor.time,
        team: anchor.team,
        playerId: anchor.playerId ?? null,
        player: anchor.player ?? null,
        action: anchor.type,
        outcome,
        ...(anchor.type === 'shot' &&
        anchor.result === false &&
        ['off-target', 'saved', 'blocked', 'on-target'].includes(anchor.outcome)
          ? { shotOutcome: anchor.outcome }
          : {}),
      },
      `${anchor.player || anchor.playerId || anchor.team}: recorded ${anchor.type} at ${anchor.time}s${outcome ? ` (${outcome})` : ''}.`,
      [reference(anchor)],
    );
    if (anchor.type === 'shot') {
      const recoveries = events.filter(
        (e) => e.team === anchor.team && e.type === 'recovery' && e.time < anchor.time,
      );
      const recovery = recoveries.at(-1);
      const uninterrupted =
        recovery &&
        recoveries.filter((e) => e.time === recovery.time).length === 1 &&
        !events.some(
          (e) =>
            e.type === 'recovery' &&
            e.team !== anchor.team &&
            e.time >= recovery.time &&
            e.time <= anchor.time,
        );
      if (uninterrupted) {
        add(
          'recovery-before-shot',
          'get_event_sequence',
          {
            anchorId: anchor.id,
            recoveryId: recovery.id,
            team: anchor.team,
            start: recovery.time,
            end: anchor.time,
            seconds: anchor.time - recovery.time,
          },
          `The recorded shot followed the team's recovery by ${anchor.time - recovery.time} seconds. This states chronology, not causation.`,
          [reference(recovery), reference(anchor)],
        );
        const passes = events.filter(
          (e) =>
            e.team === anchor.team &&
            e.type === 'pass' &&
            e.result === true &&
            e.time > recovery.time &&
            e.time < anchor.time,
        );
        if (passes.length)
          add(
            'completed-passes-between',
            'get_event_sequence',
            {
              anchorId: anchor.id,
              recoveryId: recovery.id,
              team: anchor.team,
              start: recovery.time,
              end: anchor.time,
              count: passes.length,
            },
            `${passes.length} completed ${passes.length === 1 ? 'pass was' : 'passes were'} recorded strictly between the recovery and the shot.`,
            [reference(recovery), ...passes.map(reference), reference(anchor)],
          );
      }
    }
  }
  const scoreOutput = outputs.score_at_moment;
  if (scoreOutput) {
    const goals = (scoreOutput.goals || []).filter(
      (e) =>
        e?.type === 'shot' &&
        e.result === true &&
        e.operation !== 'delete' &&
        e.time <= scope.eventTime &&
        e.arrivedAt <= scope.observedAt,
    );
    const home = goals.filter((e) => e.team === 'home').length,
      away = goals.filter((e) => e.team === 'away').length;
    if (goals.length && scoreOutput.score?.home === home && scoreOutput.score?.away === away) {
      const scoredAnchor = goals.find(
        (e) =>
          e.id === scope.anchorId &&
          e.revision === anchor?.revision &&
          e.team === anchor?.team &&
          e.time === scope.eventTime,
      );
      const uniqueGoals = new Set(goals.map((e) => e.id)).size === goals.length;
      const validGoals = goals.every(
        (e) =>
          validRef(reference(e)) &&
          ['home', 'away'].includes(e.team) &&
          Number.isFinite(e.time) &&
          e.time >= 0 &&
          Number.isFinite(e.arrivedAt) &&
          e.arrivedAt >= e.time,
      );
      const currentMoment = facts.some(
        (f) =>
          f.kind === 'moment' &&
          f.values.anchorId === scope.anchorId &&
          f.values.outcome === 'goal',
      );
      if (
        currentMoment &&
        anchor?.type === 'shot' &&
        anchor.result === true &&
        scoredAnchor &&
        uniqueGoals &&
        validGoals &&
        !goals.some((e) => e.id !== anchor.id && e.time === scope.eventTime)
      ) {
        const before = goals.filter((e) => e.id !== anchor.id);
        const beforeHome = before.filter((e) => e.team === 'home').length,
          beforeAway = before.filter((e) => e.team === 'away').length;
        const own = anchor.team === 'home' ? beforeHome : beforeAway,
          other = anchor.team === 'home' ? beforeAway : beforeHome;
        const effect =
          own === other
            ? 'took-lead'
            : own === other - 1
              ? 'equalized'
              : own > other
                ? 'extended-lead'
                : 'reduced-deficit';
        add(
          'goal-score-change',
          'score_at_moment',
          {
            anchorId: anchor.id,
            time: scope.eventTime,
            team: anchor.team,
            player: anchor.player ?? null,
            beforeHome,
            beforeAway,
            afterHome: home,
            afterAway: away,
            effect,
          },
          `The recorded goal changed the received score from ${beforeHome}-${beforeAway} to ${home}-${away} (${effect}). This describes the score at this moment, not a full-match result.`,
          goals.map(reference),
        );
      }
      add(
        'score',
        'score_at_moment',
        { time: scope.eventTime, home, away },
        `The received score at the selected moment was ${home}-${away}.`,
        goals.map(reference),
      );
    }
  }
  const metrics = outputs.measure_moment?.metrics || [];
  const sequenceAllowed = new Set((sequence?.references || []).filter(validRef).map(identity));
  const linkedSampleSupport = (metric, linked) => {
    if (
      !anchor ||
      !linked ||
      !facts.some((f) => f.kind === 'moment') ||
      !Array.isArray(metric.inputs) ||
      metric.inputs.length !== 4 ||
      !metric.inputs.every(validRef) ||
      unique(metric.inputs).length !== 4
    )
      return false;
    const eventRefs = metric.inputs.filter((r) => r.type === 'event'),
      frames = metric.inputs.filter((r) => r.type === 'frame');
    const required = [reference(anchor), reference(linked)];
    return (
      eventRefs.length === 2 &&
      frames.length === 2 &&
      frames[0].id !== frames[1].id &&
      required.every(
        (ref) =>
          sequenceAllowed.has(identity(ref)) &&
          eventRefs.some((r) => identity(r) === identity(ref)),
      )
    );
  };
  for (const metric of metrics) {
    if (
      metric?.anchorId !== scope.anchorId ||
      !Number.isFinite(metric.value) ||
      metric.value < 0 ||
      !Array.isArray(metric.inputs)
    )
      continue;
    const refs = [{ type: 'metric', id: metric.id, revision: metric.revision }, ...metric.inputs];
    if (metric.kind === 'nearest-opponent' && metric.unit === 'metres')
      add(
        'nearest-sampled-opponent',
        'measure_moment',
        {
          anchorId: scope.anchorId,
          time: scope.eventTime,
          playerId: metric.playerId,
          opponentId: metric.opponentId,
          value: metric.value,
          unit: metric.unit,
          formula: metric.formula,
        },
        `The nearest sampled opponent was ${metric.value} metres from ${metric.playerId} at ${scope.eventTime}s. This is sampled geometry, not tactical pressure.`,
        refs,
      );
    if (
      metric.kind === 'player-displacement-rate' &&
      metric.unit === 'metres/second' &&
      Number.isFinite(metric.interval?.start) &&
      metric.interval.start >= 0 &&
      metric.interval.start < metric.interval.end &&
      metric.interval.end === scope.eventTime
    )
      add(
        'player-sample-displacement-rate',
        'measure_moment',
        {
          anchorId: scope.anchorId,
          playerId: metric.playerId,
          start: metric.interval.start,
          end: metric.interval.end,
          value: metric.value,
          unit: metric.unit,
          formula: metric.formula,
        },
        `${metric.playerId}'s sample displacement rate was ${metric.value} metres/second between ${metric.interval.start}s and ${metric.interval.end}s. It is not maximum speed or a reconstructed path.`,
        refs,
      );
    const interval = metric.interval;
    if (
      Number.isFinite(interval?.start) &&
      interval.start >= 0 &&
      interval.start < interval.end &&
      interval.end === scope.eventTime
    ) {
      if (
        metric.kind === 'pass-displacement' &&
        metric.unit === 'metres' &&
        metric.formula === 'ball-endpoint-displacement-v1' &&
        anchor?.type === 'receive' &&
        typeof anchor.playerId === 'string' &&
        anchor.playerId
      ) {
        const pass = events.find(
          (e) =>
            e.id === metric.passId &&
            e.type === 'pass' &&
            e.result === true &&
            e.receiverId === anchor.playerId &&
            e.team === anchor.team &&
            e.time === interval.start,
        );
        const interrupted =
          pass &&
          events.some(
            (e) =>
              e.type === 'recovery' &&
              e.team !== pass.team &&
              e.time >= pass.time &&
              e.time <= anchor.time,
          );
        if (pass && !interrupted && linkedSampleSupport(metric, pass))
          add(
            'pass-endpoint-displacement',
            'measure_moment',
            {
              anchorId: anchor.id,
              passId: pass.id,
              start: interval.start,
              end: interval.end,
              value: metric.value,
              unit: metric.unit,
              formula: metric.formula,
            },
            `The sampled ball endpoints for the confirmed pass were ${metric.value} metres apart between ${interval.start}s and ${interval.end}s. Endpoint separation is not the actual ball path or a pass-difficulty rating.`,
            refs,
          );
      }
      if (
        metric.kind === 'shot-ball-displacement-rate' &&
        metric.unit === 'metres/second' &&
        metric.formula === 'shot-sample-displacement-over-time-v1' &&
        anchor?.type === 'flight' &&
        anchor.shotId === metric.shotId
      ) {
        const shot = events.find(
          (e) => e.id === metric.shotId && e.type === 'shot' && e.time === interval.start,
        );
        if (shot && linkedSampleSupport(metric, shot))
          add(
            'shot-ball-sample-displacement-rate',
            'measure_moment',
            {
              anchorId: anchor.id,
              shotId: shot.id,
              start: interval.start,
              end: interval.end,
              value: metric.value,
              unit: metric.unit,
              formula: metric.formula,
            },
            `The ball's sample displacement rate after the recorded shot was ${metric.value} metres/second between ${interval.start}s and ${interval.end}s. This is endpoint displacement over a sampled interval, not maximum speed or the actual ball path.`,
            refs,
          );
      }
    }
  }
  const patternOutput = outputs.get_match_patterns,
    comparison = patternOutput?.comparison,
    inputs = patternOutput?.comparisonInputs;
  const previous = comparison?.windows?.previous,
    recent = comparison?.windows?.recent;
  const validInputs =
    Array.isArray(inputs) &&
    inputs.length <= 10000 &&
    inputs.every(
      (row) =>
        typeof row?.id === 'string' &&
        row.id &&
        Number.isSafeInteger(row.revision) &&
        row.revision > 0 &&
        Number.isFinite(row.time) &&
        row.time >= 0 &&
        Number.isFinite(row.arrivedAt) &&
        row.arrivedAt >= row.time &&
        row.arrivedAt <= scope.observedAt &&
        row.time <= scope.eventTime &&
        ['home', 'away'].includes(row.team) &&
        typeof row.type === 'string',
    ) &&
    new Set(inputs.map((row) => row.id)).size === inputs.length;
  if (
    comparison?.status === 'insight' &&
    comparison.time === scope.eventTime &&
    comparison.scope?.observedAt === scope.observedAt &&
    comparison.scope.fullAdjacentWindows === true &&
    previous &&
    recent &&
    Number.isFinite(previous.start) &&
    previous.start >= 0 &&
    Number.isFinite(previous.end) &&
    previous.end > previous.start &&
    recent.start === previous.end &&
    recent.end === scope.eventTime &&
    recent.end - recent.start === previous.end - previous.start &&
    previous.startInclusive === false &&
    previous.endInclusive === true &&
    recent.startInclusive === false &&
    recent.endInclusive === true &&
    validInputs
  ) {
    const inside = (row, window) => row.time > window.start && row.time <= window.end;
    const before = inputs.filter((row) => inside(row, previous)),
      after = inputs.filter((row) => inside(row, recent));
    const matches = (refs, rows) =>
      Array.isArray(refs) &&
      refs.every(validRef) &&
      refs.length === rows.length &&
      unique(refs).map(identity).join('|') === unique(rows.map(reference)).map(identity).join('|');
    const candidates = ['home', 'away']
      .map((team) => {
        const previousCount = before.filter(
            (row) => row.team === team && row.type === 'shot',
          ).length,
          recentCount = after.filter((row) => row.team === team && row.type === 'shot').length;
        return { team, previousCount, recentCount, delta: recentCount - previousCount };
      })
      .filter(
        (row) =>
          (row.recentCount >= 2 && row.delta >= 2) ||
          (row.previousCount >= 2 && row.recentCount === 0),
      )
      .sort(
        (a, b) =>
          Math.abs(b.delta) - Math.abs(a.delta) ||
          b.recentCount - a.recentCount ||
          a.team.localeCompare(b.team),
      );
    const strongest = candidates[0],
      selected = Array.isArray(comparison.teams)
        ? comparison.teams.find((row) => row.id === strongest?.team)
        : null;
    if (
      strongest &&
      selected &&
      selected.previousShots === strongest.previousCount &&
      selected.recentShots === strongest.recentCount &&
      comparison.signal?.team === strongest.team &&
      comparison.signal.delta === strongest.delta &&
      comparison.signal.direction === (strongest.delta > 0 ? 'increase' : 'decrease') &&
      matches(previous.evidence, before) &&
      matches(recent.evidence, after)
    )
      add(
        'window-shot-change',
        'get_match_patterns',
        {
          team: strongest.team,
          previousCount: strongest.previousCount,
          recentCount: strongest.recentCount,
          previousStart: previous.start,
          previousEnd: previous.end,
          recentStart: recent.start,
          recentEnd: recent.end,
          direction: comparison.signal.direction,
        },
        `Received shots changed from ${strongest.previousCount} to ${strongest.recentCount} across equal adjacent windows; this is a literal count comparison, not pressure or cause.`,
        [...before, ...after].map(reference),
      );
  }
  const analysis = patternOutput?.analysis;
  if (analysis?.anchorTime === scope.eventTime && analysis.observedAt <= scope.observedAt) {
    const counts = [...(analysis.metrics || [])].sort((a, b) =>
      `${a.team}:${a.kind}`.localeCompare(`${b.team}:${b.kind}`),
    );
    for (const count of counts) {
      if (
        !['shots', 'completedPasses', 'pendingPasses', 'recoveries'].includes(count.kind) ||
        !['home', 'away'].includes(count.team) ||
        !Number.isInteger(count.value) ||
        count.value <= 0 ||
        count.unit !== 'events' ||
        count.evidence?.length !== count.value ||
        !count.evidence.every(validRef) ||
        unique(count.evidence).length !== count.value ||
        !Number.isFinite(count.window?.start) ||
        count.window.start < 0 ||
        count.window.end !== scope.eventTime
      )
        continue;
      add(
        'window-event-count',
        'get_match_patterns',
        {
          team: count.team,
          category: count.kind,
          count: count.value,
          start: count.window.start,
          end: count.window.end,
          inclusive: true,
        },
        `${count.team}: ${count.value} recorded ${count.kind} in the inclusive ${count.window.start}s–${count.window.end}s event window. These are supplied-event counts, not proof of feed completeness.`,
        count.evidence,
      );
    }
  }
  return {
    facts: facts.slice(0, 12),
    scope: {
      anchorId: scope.anchorId,
      eventTime: scope.eventTime,
      observedAt: scope.observedAt,
      teams,
    },
    limitation:
      'Deterministic facts from executed tools and exact received revisions. Synthetic, sampled evidence does not establish intent, tactical pressure, causation, probabilities, or maximum speed. A fact catalog does not establish that generated prose is correct. Zero event counts are omitted.',
  };
}
