import { createHash } from 'node:crypto';
import { matchState } from './match-stream.js';
import { momentMeaning } from './moment-meaning.js';
import { momentHeadline } from './viewer-copy.js';
import { isSafePlayerName } from './viewer-preferences.js';

const ref = (e) => ({ type: 'event', id: e.id, revision: e.revision });
const unique = (items) => [
  ...new Map(items.map((r) => [`${r.type}:${r.id}@${r.revision}`, r])).values(),
];
const normal = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const examples = [
  'How did this chance happen?',
  'Who intercepted the pass?',
  'Show me Reed’s chances',
  'Catch me up',
];

/** Bounded, received-only retrieval. This is not a language-model response. */
export function validateMatchQuestionInput(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          'kind',
          'seed',
          'time',
          'question',
          'anchorId',
          'language',
          'previousQuestion',
          'conversation',
          'audience',
          'favoriteClub',
          'favoritePlayer',
          'clarification',
        ].includes(k),
    ) ||
    (input.audience !== undefined && !['newcomer', 'analyst', 'player'].includes(input.audience)) ||
    (input.favoriteClub !== undefined && ![null, 'home', 'away'].includes(input.favoriteClub)) ||
    (input.favoritePlayer !== undefined &&
      input.favoritePlayer !== null &&
      !isSafePlayerName(input.favoritePlayer)) ||
    typeof input.question !== 'string' ||
    !input.question.trim() ||
    input.question.length > 400 ||
    /[\u0000-\u001f]/.test(input.question) ||
    (input.anchorId !== undefined &&
      (typeof input.anchorId !== 'string' || input.anchorId.length > 700)) ||
    (input.previousQuestion !== undefined &&
      (typeof input.previousQuestion !== 'string' ||
        input.previousQuestion.length > 400 ||
        /[\u0000-\u001f]/.test(input.previousQuestion))) ||
    (input.language !== undefined && !['en', 'es', 'fr', 'pt'].includes(input.language))
  )
    throw new RangeError('Ask a match question of 1–400 characters using valid match settings.');
  if (
    input.clarification !== undefined &&
    (!input.clarification ||
      typeof input.clarification !== 'object' ||
      Array.isArray(input.clarification) ||
      Object.keys(input.clarification).some((key) => !['question', 'time'].includes(key)) ||
      typeof input.clarification.question !== 'string' ||
      !input.clarification.question.trim() ||
      input.clarification.question.length > 400 ||
      /[\u0000-\u001f]/.test(input.clarification.question) ||
      !Number.isFinite(input.clarification.time) ||
      input.clarification.time < 0 ||
      input.clarification.time > input.time)
  )
    throw new RangeError(
      'Clarification context must stay within the received match and size limits.',
    );
  if (
    input.conversation !== undefined &&
    (!Array.isArray(input.conversation) ||
      input.conversation.length > 2 ||
      input.conversation.some(
        (turn) =>
          !turn ||
          typeof turn !== 'object' ||
          Object.keys(turn).some((k) => !['question', 'answer', 'time'].includes(k)) ||
          typeof turn.question !== 'string' ||
          turn.question.length > 200 ||
          typeof turn.answer !== 'string' ||
          turn.answer.length > 500 ||
          !Number.isFinite(turn.time) ||
          turn.time < 0 ||
          turn.time > input.time,
      ))
  )
    throw new RangeError(
      'Conversation context must stay within the received match and size limits.',
    );
}

export function answerMatchQuestion(input) {
  validateMatchQuestionInput(input);
  const state = matchState(input),
    q = normal(input.question),
    events = state.events;
  const selected = input.anchorId ? events.find((e) => e.id === input.anchorId) : null;
  let intent = 'unsupported',
    status = 'unsupported',
    answer =
      'I can search received shots, recoveries, the score, and chance buildups. Try one of the suggested questions.',
    chosen = [],
    evidence = [];
  const result = () => {
    const moments = chosen.slice(-8).map((e) => ({
      anchorId: e.id,
      time: e.time,
      revision: e.revision,
      label: momentHeadline(e, 'en'),
      evidence: [ref(e)],
    }));
    const out = {
      schema: 'infinite-stadium.match-question.v1',
      status,
      intent,
      question: input.question.trim(),
      answer,
      matchId: state.metadata.id,
      kind: state.metadata.kind,
      seed: state.metadata.seed,
      observedAt: state.time,
      language: 'en',
      moments,
      evidence: unique(evidence),
      totalMoments: chosen.length,
      truncated: chosen.length > 8,
      provenance: {
        source: 'recorded-retrieval',
        modelGenerated: false,
        label: 'Answer from recorded match events',
      },
      notices:
        input.language && input.language !== 'en'
          ? [
              'Match questions currently accept and answer English; translated match stories remain available.',
            ]
          : [],
      limitation:
        'Synthetic segment. Only events received by this replay time are available. Recorded actions do not establish tactical intent or causation.',
      suggestions: examples,
    };
    return {
      ...out,
      key: 'question:' + createHash('sha256').update(JSON.stringify(out)).digest('hex'),
    };
  };
  if (input.anchorId && !selected) {
    status = 'no-results';
    answer = 'The selected moment has not arrived or has been withdrawn. Choose a current moment.';
    return result();
  }
  const momentum =
    /\b(push\w*|momentum|on top|dominant|dominating|attacking more|more dangerous|more threatening|upper hand|stronger team|better team)\b/.test(
      q,
    ) || /\b(who|which|more|most)\b.*\b(pressure|pressing|attack\w*)\b/.test(q);
  if (momentum) {
    intent = 'momentum';
    const start = Math.max(0, state.time - 30),
      window = events.filter((e) => e.time >= start);
    const counts = (team) => {
      const own = window.filter((e) => e.team === team),
        shots = own.filter((e) => e.type === 'shot');
      return {
        shots: shots.length,
        onTarget: shots.filter(
          (e) =>
            e.result === true || (e.result === false && ['saved', 'on-target'].includes(e.outcome)),
        ).length,
        passes: own.filter((e) => e.type === 'pass' && e.result === true).length,
      };
    };
    const home = counts('home'),
      away = counts('away'),
      leader = home.shots > away.shots ? 'home' : away.shots > home.shots ? 'away' : null;
    status = window.length ? 'answered' : 'limited';
    chosen = window.filter((e) => e.type === 'shot');
    evidence = window.map(ref);
    answer = leader
      ? `${state.metadata.teams[leader]} looks more threatening right now, based on the recent shots.`
      : home.shots
        ? 'Neither side has a clear edge in recent shot volume.'
        : 'There is not enough recent shooting activity to say either side is pushing harder.';
    answer += ` From ${clock(start)} to ${clock(state.time)}: ${state.metadata.teams.home} ${home.shots} shots (${home.onTarget} confirmed on target), ${state.metadata.teams.away} ${away.shots} (${away.onTarget} on target). Completed passes: ${home.passes}–${away.passes}. That is the last ${Math.min(30, state.time)} seconds of received play. It does not measure off-ball pressing or prove possession dominance.`;
    return result();
  }
  if (
    /\b(possession|passing|pass accuracy|completed passes)\b/.test(q) &&
    !/\b(won|wins|recover\w*|intercept\w*)\b/.test(q)
  ) {
    intent = 'passing';
    status = 'answered';
    chosen = events.filter((e) => e.type === 'pass');
    evidence = chosen.map(ref);
    const passText = (team) => {
      const own = chosen.filter((e) => e.team === team),
        known = own.filter((e) => typeof e.result === 'boolean'),
        complete = known.filter((e) => e.result);
      return `${state.metadata.teams[team]}: ${complete.length} completed from ${known.length} confirmed passes${known.length ? ` (${Math.round((complete.length / known.length) * 100)}%)` : ''}${own.length > known.length ? `, ${own.length - known.length} pending` : ''}`;
    };
    answer = `${passText('home')}. ${passText('away')}. These counts cover received events through ${clock(state.time)}. Passing counts do not establish time in possession; possession percentage is unavailable.`;
    return result();
  }
  if (/\b(caus\w*|blame|fault|forced|force|pressure|pressing|intent|tactic\w*|why)\b/.test(q)) {
    intent = 'causal';
    status = 'limited';
    chosen = /\b(intercept\w*|recover\w*)\b/.test(q)
      ? events
          .filter((e) => e.type === 'recovery' && (!selected || e.time <= selected.time))
          .slice(-1)
      : selected
        ? [selected]
        : events.filter((e) => e.type === 'recovery').slice(-1);
    evidence = chosen.map(ref);
    answer =
      'The received data cannot establish who caused this or why a player acted. I can show the recorded action and its buildup.';
    if (chosen.length) answer += ` ${momentHeadline(chosen[0], 'en')} at ${clock(chosen[0].time)}.`;
    return result();
  }
  if (/\b(score|winning|leading)\b/.test(q)) {
    intent = 'score';
    status = 'answered';
    chosen = events.filter((e) => e.type === 'shot' && e.result === true);
    evidence = chosen.map(ref);
    answer = `Recorded score: ${state.metadata.teams.home} ${state.stats.home.goals}–${state.stats.away.goals} ${state.metadata.teams.away}, through ${clock(state.time)} of this synthetic segment.`;
  } else if (/\b(catch me up|recap|summary|summarize|missed)\b/.test(q)) {
    intent = 'catchup';
    status = 'answered';
    chosen = events.filter((e) => e.type === 'shot');
    evidence = events.filter((e) => ['shot', 'recovery'].includes(e.type)).map(ref);
    answer = `Through ${clock(state.time)}: ${state.metadata.teams.home} ${state.stats.home.goals}–${state.stats.away.goals} ${state.metadata.teams.away}. Recorded shots: ${state.stats.home.shots}–${state.stats.away.shots}.`;
    if (chosen.length)
      answer += ` Latest attempt: ${momentHeadline(chosen.at(-1), 'en')} at ${clock(chosen.at(-1).time)}.`;
    else answer += ' No shots have arrived yet.';
  } else if (/\b(intercept\w*|recover\w*|won the ball|wins the ball|won possession)\b/.test(q)) {
    const interception = /\b(intercept\w*)\b/.test(q);
    intent = interception ? 'interception' : 'recovery';
    const candidates = events.filter(
      (e) => e.type === 'recovery' && (!selected || e.time <= selected.time),
    );
    const supported = candidates.filter((e) => {
      const pass = events.find((p) => p.id === e.passId);
      return (
        pass?.type === 'pass' && pass.result === false && pass.team !== e.team && pass.time < e.time
      );
    });
    chosen = (interception ? supported : candidates).slice(-1);
    evidence = chosen.flatMap((e) => {
      const p = events.find((p) => p.id === e.passId);
      return p ? [ref(e), ref(p)] : [ref(e)];
    });
    status = chosen.length ? 'answered' : 'no-results';
    answer = chosen.length
      ? `${chosen[0].player} ${interception ? 'intercepted the pass' : 'had the latest recorded recovery'} at ${clock(chosen[0].time)}${selected ? ' at or before the selected moment' : ''}.`
      : `No ${interception ? 'explicitly linked interception' : 'recovery'} is recorded in the received events${selected ? ' at or before the selected moment' : ''}.`;
  } else if (
    /\b(how|buildup|build up|led to|develop\w*|start\w*)\b/.test(q) &&
    /\b(chance|shot|goal|moment|happen\w*|buildup|build up)\b/.test(q)
  ) {
    intent = 'buildup';
    const anchor = selected || events.filter((e) => e.type === 'shot').at(-1);
    if (anchor) {
      const meaning = momentMeaning(events, anchor.id, { observedAt: state.time, language: 'en' });
      const ids = new Set(meaning.steps.map((s) => s.id));
      chosen = meaning.steps.length ? events.filter((e) => ids.has(e.id)) : [anchor];
      evidence = meaning.evidence;
      status = meaning.buildup ? 'answered' : 'limited';
      answer = `${meaning.headline}. ${meaning.buildup || 'The received events do not contain a linked buildup for this moment.'}`;
    } else {
      status = 'no-results';
      answer = 'No shot has arrived yet. Choose a received moment or wait for the next chance.';
    }
  } else if (/\b(chances|shots|attempts|goals)\b/.test(q)) {
    intent = 'player-chances';
    const names = [...new Set(events.map((e) => e.player).filter(Boolean))];
    const matches = names.filter((name) => {
      const full = normal(name),
        last = full.split(' ').at(-1);
      return ` ${q} `.includes(` ${full} `) || ` ${q} `.includes(` ${last} `);
    });
    const general =
      /^(show (me )?)?(all |the |latest |recent )?(shots|chances|attempts|goals)( so far)?$/.test(
        q,
      );
    if (matches.length > 1) {
      status = 'limited';
      answer = 'That name matches more than one player. Include their first initial.';
      const exact = matches.filter((name) => ` ${q} `.includes(` ${normal(name)} `));
      if (exact.length === 1) matches.splice(0, matches.length, exact[0]);
    }
    if (matches.length === 1 || general) {
      chosen = events.filter(
        (e) =>
          e.type === 'shot' &&
          (!matches.length || e.player === matches[0]) &&
          (!/\bgoals\b/.test(q) || e.result === true),
      );
      evidence = chosen.map(ref);
      status = chosen.length ? 'answered' : 'no-results';
      answer = `${chosen.length} recorded ${/\bgoals\b/.test(q) ? 'goals' : 'shots'}${matches.length ? ` for ${matches[0]}` : ''} through ${clock(state.time)}.${chosen.length > 8 ? ' Showing the latest eight.' : ''}`;
    } else if (!matches.length) {
      status = 'no-results';
      answer =
        'I could not match that player in the received events. Try their surname or ask “Show all shots”.';
    }
  }
  return result();
}
