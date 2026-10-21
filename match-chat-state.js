// Pin questions to what is actually displayed, not a buffered future frame or
// the older editorial highlight. Explicit inspected moments keep their anchor.
export function captureQuestionMoment({ time, displayTime, following = true, anchorId }) {
  const shown =
    following && Number.isFinite(displayTime) ? Math.max(0, Math.min(time, displayTime)) : time;
  return { time: Math.floor(shown), ...(!following && anchorId ? { anchorId } : {}) };
}

// Query scopes cover absence and aggregate counts as well as returned events.
// Later arrivals or revisions inside a cited window can change those answers.
export function questionEvidenceSnapshot(records = [], observedAt = Infinity) {
  const latest = new Map();
  for (const event of records)
    if (
      event.time <= observedAt &&
      (event.arrivedAt ?? event.time) <= observedAt &&
      (!latest.has(event.id) || latest.get(event.id).revision < event.revision)
    )
      latest.set(event.id, { id: event.id, revision: event.revision, time: event.time });
  return latest;
}
export function questionEvidenceChanged(answer, before, records = []) {
  // A request for clarification or general explanation makes no match-evidence claim.
  if (answer.scope === 'clarify' || answer.scope === 'general') return false;
  const after = questionEvidenceSnapshot(records),
    refs = answer.evidence || [];
  if (
    refs.some(
      (r) => r.type === 'event' && after.has(r.id) && after.get(r.id).revision !== r.revision,
    )
  )
    return true;
  const scopes = new Set(refs.filter((r) => r.type === 'scope').map((r) => r.id));
  const windows = (answer.lookups || [])
    .filter((l) => scopes.has(l.scope.reference?.id))
    .map((l) => l.scope);
  // A declared query may span the whole passage, but the answer only knew
  // events through its pin. Later play cannot revise that historical answer.
  const observedAt = Number.isFinite(answer.observedAt) ? answer.observedAt : Infinity;
  const covered = (e) =>
    e.time <= observedAt && windows.some((w) => e.time >= w.timeFrom && e.time <= w.timeTo);
  for (const event of after.values())
    if (covered(event) && before.get(event.id)?.revision !== event.revision) return true;
  for (const event of before.values()) if (covered(event) && !after.has(event.id)) return true;
  return false;
}

const scopeKey = (c) => JSON.stringify([c.kind, c.seed, c.matchId]);
const fixtureKey = (c) => JSON.stringify([c.kind, c.seed]);

export function chatIsNearBottom({ scrollHeight, scrollTop, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight <= 48;
}

// Only offer received, unchanged events that the returned answer actually cites.
export function answerMomentLinks(answer, records = [], time = Infinity) {
  const current = new Map();
  for (const event of records)
    if (
      event.time <= time &&
      (event.arrivedAt ?? event.time) <= time &&
      (!current.has(event.id) || current.get(event.id).revision < event.revision)
    )
      current.set(event.id, event);
  const seen = new Set();
  return (answer.moments || []).filter((moment) => {
    const event = current.get(moment.anchorId);
    if (
      seen.has(moment.anchorId) ||
      !event ||
      event.operation === 'delete' ||
      event.revision !== moment.revision ||
      event.time !== moment.time ||
      moment.time > answer.observedAt ||
      !(answer.evidence || []).some(
        (ref) =>
          ref.type === 'event' && ref.id === moment.anchorId && ref.revision === moment.revision,
      )
    )
      return false;
    seen.add(moment.anchorId);
    return true;
  });
}

// Replay time deliberately does not identify a conversation: playback keeps running.
export function createMatchConversation() {
  let scope = null,
    fixture = null,
    generation = 0,
    history = [],
    pendingClarification = null;
  return {
    sync(context) {
      // A seek briefly empties the received stream. Keep the known conversation,
      // but accept answers only after the actual match identity is received again.
      if (!context.matchId && scope !== null && fixture === fixtureKey(context)) return false;
      const next = scopeKey(context);
      if (next === scope) return false;
      const changed = scope !== null;
      scope = next;
      fixture = fixtureKey(context);
      generation++;
      history = [];
      pendingClarification = null;
      return changed;
    },
    begin(context, question) {
      this.sync(context);
      const conversation = history.filter((turn) => turn.time <= context.time).slice(-2);
      const previousQuestion = conversation.at(-1)?.question;
      return {
        id: ++generation,
        scope,
        payload: {
          kind: context.kind,
          seed: context.seed,
          time: context.time,
          question,
          language: context.language,
          conversation,
          ...Object.fromEntries(
            ['audience', 'favoriteClub', 'favoritePlayer']
              .filter((key) => context[key] !== undefined)
              .map((key) => [key, context[key]]),
          ),
          ...(previousQuestion ? { previousQuestion } : {}),
          ...(pendingClarification && pendingClarification.time <= context.time
            ? { clarification: { ...pendingClarification } }
            : {}),
          ...(context.anchorId ? { anchorId: context.anchorId } : {}),
        },
      };
    },
    retry(request, context) {
      this.sync(context);
      if (!context.matchId || request.scope !== scopeKey(context)) return null;
      // Explicit retries retain the question's original moment and context even
      // when playback or the selected response language has since advanced.
      return {
        id: ++generation,
        scope,
        payload: {
          ...request.payload,
          conversation: request.payload.conversation.map((turn) => ({ ...turn })),
        },
      };
    },
    accept(request, context, answer) {
      if (
        !context.matchId ||
        request.id !== generation ||
        request.scope !== scopeKey(context) ||
        (answer.matchId && answer.matchId !== context.matchId)
      )
        return false;
      // Display clarification normally, but do not let an unresolved question replace
      // the successful topic used to understand the next follow-up.
      if (answer.scope === 'clarify') {
        if (answer.provenance?.source === 'verified-lineup-resolution')
          pendingClarification = {
            question: request.payload.question.slice(0, 400),
            time: request.payload.time,
          };
        return true;
      }
      pendingClarification = null;
      // Store only successfully answered turns. A failed/cancelled question adds no context.
      history = history.filter((turn) => turn.time <= request.payload.time);
      history.push({
        question: (answer.questionResolution?.kind === 'source-lineup-clarification'
          ? answer.questionResolution.question
          : answer.question
        ).slice(0, 200),
        answer: answer.answer.slice(0, 500),
        time: request.payload.time,
      });
      history = history.slice(-2);
      return true;
    },
    cancel() {
      generation++;
    },
  };
}

export function questionCanRetry(status, code) {
  if (status === 401 || status === 403 || code?.startsWith('question-')) return false;
  if (code === 'azure-rate-limit' || code === 'generation-busy') return true;
  if (status === 429) return false; // The application allowance needs renewal.
  return (
    status === 504 ||
    ['azure-network', 'azure-timeout'].includes(code) ||
    (code === 'azure-http' && status >= 500)
  );
}

export function questionFailureMessage(status, code) {
  if (code === 'azure-rate-limit')
    return 'The AI service is temporarily busy. Keep watching and try again shortly.';
  if (code === 'generation-busy')
    return 'Another answer is being prepared. Please try again when it finishes.';
  if (code === 'question-unsupported-cause')
    return 'The match data cannot establish who forced the mistake. A ball recovery alone does not prove what caused it.';
  if (code === 'question-withheld')
    return 'I could not support that answer with the available match data.';
  if (code === 'question-time-unit') return 'I could not verify the timing in that answer.';
  if (status === 429)
    return 'The AI usage limit has been reached. Please try again when the allowance renews.';
  if (status === 401 || status === 403)
    return 'The match assistant could not connect. Please try again later.';
  if (code === 'azure-network' || code === 'azure-http')
    return 'The match assistant could not connect. You can keep watching and try again.';
  if (status === 504) return 'The answer took too long. You can keep watching and try again.';
  if (status === 502)
    return 'I could not verify an answer from the available match evidence. Please try again.';
  if (status === 503) return 'The AI assistant is unavailable right now. Please try again later.';
  return 'The question could not be completed. Check your connection and try again.';
}

export function matchAssistantStatus(context, { allowRecordedSearch = false } = {}) {
  if (context.configured && context.provider === 'azure')
    return {
      label: 'AI match assistant',
      hint: 'Ask in your own words. Keep watching while I answer.',
    };
  if (allowRecordedSearch)
    return {
      label: 'Recorded match search',
      hint: 'Recorded search covers a limited set of match facts.',
    };
  if (context.aiUnavailableReason === 'budget')
    return {
      label: 'AI allowance used',
      hint: 'There is not enough AI allowance left for another answer today. You can keep watching.',
    };
  if (context.aiUnavailableReason === 'access')
    return {
      label: 'AI access required',
      hint: 'The match assistant needs project access before it can answer.',
    };
  return {
    label: 'AI unavailable',
    hint: 'The AI is unavailable right now. Keep watching and try again later.',
  };
}
