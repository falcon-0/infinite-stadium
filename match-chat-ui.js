import {
  createMatchConversation,
  questionFailureMessage,
  questionCanRetry,
  matchAssistantStatus,
  questionEvidenceSnapshot,
  questionEvidenceChanged,
  chatIsNearBottom,
  answerMomentLinks,
} from './match-chat-state.js';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function answerContent(data) {
  const claims = data.claims || [];
  if (!claims.length) return `<p>${esc(data.answer)}</p>`;
  const paragraphs = (items) => items.map((claim) => `<p>${esc(claim.text)}</p>`).join('');
  const explanations = claims.filter((claim) =>
    ['interpretation', 'limitation'].includes(claim.kind),
  );
  const observations = claims.filter((claim) => claim.kind === 'observation');
  // A limitation does not replace a separately requested factual answer.
  // Only analysis leads with its interpretation and collapses supporting detail.
  if (
    data.scope === 'match' &&
    claims.some((claim) => claim.kind === 'interpretation') &&
    observations.length
  )
    return `${paragraphs(explanations)}<details class="match-chat-facts"><summary>Match detail</summary>${paragraphs(observations)}</details>`;
  return paragraphs(claims);
}
const sourceDescription = (data) => {
  if (data.provenance?.source === 'verified-facts-with-ai-analysis')
    return data.provenance.modelGenerated
      ? 'Application-rendered match facts with AI-written interpretation. A model checked relevance; source references support the facts.'
      : 'AI-selected match facts rendered by the application. A model checked relevance.';
  if (data.provenance?.source === 'verified-rule-facts')
    return 'AI-selected English rule references. The application copies the sourced wording; a model checked relevance.';
  if (data.provenance?.modelGenerated)
    return data.scope === 'general'
      ? 'General football explanation; no match evidence is claimed.'
      : 'AI-written analysis checked by a model reviewer against received events. References support observations; interpretations remain uncertain.';
  return data.provenance?.aiInterpreted
    ? 'AI interpreted the question; the application retrieves and words supported facts.'
    : 'Recorded retrieval; no model was called.';
};

export function initializeMatchChat({
  parent,
  getContext,
  showSources = false,
  allowRecordedSearch = false,
  onInspect,
  onRequestSettled = async () => {},
}) {
  const panel = document.createElement('section');
  panel.className = 'match-chat';
  panel.setAttribute('aria-labelledby', 'match-chat-title');
  panel.innerHTML = `<div class="match-chat-heading"><h3 id="match-chat-title">Ask about the match</h3><span data-chat-mode></span></div>
 <div class="match-chat-welcome" data-chat-welcome><p>What caught your attention?</p><small>Ask about the play while the match continues.</small></div>
 <form><label class="sr-only" for="match-question">Your match question</label><div class="match-chat-input"><input id="match-question" maxlength="400" autocomplete="off" placeholder="Ask about the match"><button type="submit">Ask</button><button type="button" class="secondary" data-chat-cancel hidden>Cancel</button></div></form>
 <p class="disclosure" data-chat-hint>Keep watching. Your question is pinned to the moment you ask about.</p><p data-chat-status role="status" aria-live="polite"></p><p data-chat-correction class="disclosure" hidden></p><div data-chat-answer></div>`;
  parent.append(panel);
  const q = (s) => panel.querySelector(s);
  let controller = null,
    result = null,
    scope = null,
    requestId = 0,
    conversation = createMatchConversation(),
    turns = [];
  if (!showSources) q('[data-chat-status]').classList.add('sr-only');
  const transcript = q('[data-chat-answer]');
  panel.querySelector('form').before(transcript);
  transcript.setAttribute('aria-label', 'Match conversation');
  transcript.setAttribute('role', 'region');
  transcript.tabIndex = 0;
  const newAnswer = document.createElement('button');
  newAnswer.type = 'button';
  newAnswer.className = 'secondary';
  newAnswer.dataset.chatNewAnswer = '';
  newAnswer.textContent = 'New answer ↓';
  newAnswer.hidden = true;
  transcript.after(newAnswer);
  const contextWaiters = new Set();
  function waitForReceivedMatch(signal) {
    if (getContext().matchId) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        contextWaiters.delete(resume);
        signal.removeEventListener('abort', cancel);
      };
      const resume = () => {
        if (getContext().matchId) {
          cleanup();
          resolve();
        }
      };
      const cancel = () => {
        cleanup();
        reject(new DOMException('Question cancelled', 'AbortError'));
      };
      contextWaiters.add(resume);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  transcript.onscroll = () => {
    if (chatIsNearBottom(transcript)) newAnswer.hidden = true;
  };
  const key = (c) => JSON.stringify([c.kind, c.seed, c.matchId]);
  function update() {
    const c = getContext(),
      ai = c.configured && c.provider === 'azure';
    const availability = matchAssistantStatus(c, { allowRecordedSearch });
    q('[data-chat-mode]').textContent = availability.label;
    q('[data-chat-hint]').textContent = availability.hint;
    q('[data-chat-hint]').hidden = !showSources && ai;
    q('button[type=submit]').textContent = ai ? 'Ask' : allowRecordedSearch ? 'Search' : 'Ask';
    if (conversation.sync(c)) {
      const hadQuestion = !!scope;
      controller?.abort();
      controller = null;
      requestId++;
      result = null;
      scope = null;
      turns = [];
      q('input').value = '';
      q('[data-chat-answer]').replaceChildren();
      newAnswer.hidden = true;
      q('[data-chat-status]').textContent = hadQuestion
        ? 'The replay changed. Ask again for the current received evidence.'
        : '';
    }
    for (const resume of contextWaiters) resume();
    for (const turn of turns) {
      const retry = turn.node.querySelector('[data-chat-retry]');
      if (retry)
        retry.disabled =
          !!controller ||
          !c.matchId ||
          (!ai && !allowRecordedSearch) ||
          turn.request.scope !== key(c);
      if (!turn.answer) continue;
      const notice = turn.node.querySelector('[data-turn-correction]');
      notice.hidden = !questionEvidenceChanged(turn.answer, turn.snapshot, c.eventRecords);
      const available = new Set(
        answerMomentLinks(turn.answer, c.eventRecords, c.time).map((moment) => moment.anchorId),
      );
      for (const button of turn.node.querySelectorAll('[data-chat-moment]'))
        button.disabled = !available.has(button.dataset.chatMoment);
    }
    q('[data-chat-welcome]').hidden = turns.length > 0 || !!controller;
    q('button[type=submit]').disabled = !!controller || !c.matchId || (!ai && !allowRecordedSearch);
    q('[data-chat-cancel]').hidden = !controller;
  }
  async function ask(retryTurn = null) {
    if (retryTurn && (!turns.includes(retryTurn) || !retryTurn.retryable)) return;
    const question = retryTurn ? retryTurn.request.payload.question : q('input').value.trim();
    if (!question) {
      q('input').focus();
      return;
    }
    const live = { ...getContext() };
    if (
      !live.matchId ||
      controller ||
      (!(live.configured && live.provider === 'azure') && !allowRecordedSearch)
    ) {
      update();
      return;
    }
    const c = retryTurn ? retryTurn.context : live;
    const request = retryTurn
      ? conversation.retry(retryTurn.request, live)
      : conversation.begin(c, question);
    if (!request) return;
    const id = ++requestId;
    controller = new AbortController();
    scope = key(live);
    const snapshot = retryTurn
      ? retryTurn.snapshot
      : questionEvidenceSnapshot(c.eventRecords, c.time);
    const selectedMoment =
      c.anchorId &&
      c.eventRecords?.find((event) => event.id === c.anchorId && event.time <= c.time);
    const momentLabel = retryTurn
      ? retryTurn.momentLabel
      : selectedMoment
        ? `About ${clock(selectedMoment.time)} · evidence through ${clock(c.time)}`
        : `Match at ${clock(c.time)}`;
    const turn = retryTurn ? retryTurn.node : document.createElement('article');
    turn.className = 'match-chat-turn';
    turn.dataset.turnState = 'pending';
    turn.innerHTML = `<p class="disclosure">You asked: ${esc(question)}<br>${esc(momentLabel)}</p><div class="match-chat-response" lang="${esc(c.language || 'en')}"><p>Checking the match…</p></div>`;
    const followPending = chatIsNearBottom(transcript);
    const turnRecord = retryTurn || { node: turn, answer: null, snapshot, context: c, momentLabel };
    turnRecord.request = request;
    turnRecord.retryable = false;
    if (!retryTurn) {
      transcript.append(turn);
      turns.push(turnRecord);
      if (turns.length > 8) turns.shift().node.remove();
      q('input').value = '';
    }
    if (followPending && !retryTurn) transcript.scrollTop = transcript.scrollHeight;
    q('[data-chat-status]').classList.toggle('sr-only', !showSources);
    q('[data-chat-status]').textContent = showSources
      ? `Checking the match at ${clock(c.time)}...`
      : 'Checking the match…';
    update();
    try {
      const ai = c.configured && c.provider === 'azure';
      const response = await fetch(ai ? '/api/agent/question' : '/api/match/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(request.payload),
      }).catch((error) => {
        if (error.name === 'AbortError') throw error;
        throw Object.assign(new Error(questionFailureMessage(502, 'azure-network')), {
          userFacing: true,
          retryable: true,
        });
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw Object.assign(new Error(questionFailureMessage(response.status, failure?.code)), {
          userFacing: true,
          retryable: questionCanRetry(response.status, failure?.code),
        });
      }
      const data = await response.json();
      if (id !== requestId) return;
      await waitForReceivedMatch(controller.signal);
      if (id !== requestId || scope !== key(getContext())) return;
      if (!conversation.accept(request, getContext(), data)) return;
      result = data;
      q('[data-chat-status]').textContent = showSources
        ? `${data.provenance?.modelGenerated ? (data.scope === 'general' ? 'Football explainer' : 'AI match analysis') : data.provenance?.aiInterpreted ? 'AI-assisted answer' : 'Recorded match answer'} · received through ${clock(data.observedAt)}`
        : 'Answer ready.';
      const followAnswer = chatIsNearBottom(transcript);
      turn.dataset.turnState = 'answered';
      // Identity clarifications can resolve an earlier question while play continues.
      const answerTime = Number.isFinite(data.observedAt) ? data.observedAt : c.time;
      const answerMomentLabel =
        selectedMoment && selectedMoment.time <= answerTime
          ? `About ${clock(selectedMoment.time)} · evidence through ${clock(answerTime)}`
          : `Match at ${clock(answerTime)}`;
      turn.innerHTML = `<p class="disclosure">You asked: ${esc(data.question)}<br>${esc(answerMomentLabel)}</p><div class="match-chat-response">${answerContent(data)}</div>${(data.scope === 'general' && !showSources ? [] : data.notices || []).map((n) => `<p class="disclosure">${esc(n)}</p>`).join('')}${
        showSources
          ? `<details><summary>Answer sources</summary><p>${sourceDescription(data)}</p>${(
              data.lookups || []
            )
              .map(
                (l) =>
                  `<p>${esc(l.count)} matching events / ${clock(l.scope.timeFrom)} to ${clock(l.scope.timeTo)}<br>Filters: ${esc(
                    Object.entries(l.query.filters || {})
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ') || 'all received events',
                  )}</p>`,
              )
              .join(
                '',
              )}<ul>${(data.evidence || []).map((e) => `<li>${esc(e.type)}: ${esc(e.id)} / v${esc(e.revision)}</li>`).join('')}</ul></details>`
          : ''
      }`;
      turn.querySelector('.match-chat-response').lang = data.language || c.language || 'en';
      if (onInspect) {
        const moments = answerMomentLinks(data, getContext().eventRecords, getContext().time);
        if (moments.length) {
          const links = document.createElement('div');
          links.className = 'match-chat-moments';
          links.innerHTML = moments
            .map(
              (moment) =>
                `<button type="button" class="secondary" data-chat-moment="${esc(moment.anchorId)}" aria-label="View moment at ${clock(moment.time)}: ${esc(moment.label)}">View moment · ${clock(moment.time)}</button>`,
            )
            .join('');
          turn.append(links);
        }
      }
      const notice = document.createElement('p');
      notice.className = 'disclosure';
      notice.dataset.turnCorrection = '';
      notice.hidden = true;
      notice.textContent =
        'The match record has since been updated. This answer uses the earlier evidence.';
      turn.append(notice);
      turnRecord.answer = data;
      if (followAnswer) {
        transcript.scrollTop = transcript.scrollHeight;
        newAnswer.hidden = true;
      } else newAnswer.hidden = false;
    } catch (error) {
      if (id === requestId) {
        const message =
          error.name === 'AbortError'
            ? 'Question cancelled.'
            : error.userFacing
              ? error.message
              : questionFailureMessage();
        turn.dataset.turnState = error.name === 'AbortError' ? 'cancelled' : 'failed';
        turn.querySelector('.match-chat-response').textContent = message;
        q('[data-chat-status]').textContent = message;
        q('[data-chat-status]').classList.add('sr-only');
        if (error.retryable && error.name !== 'AbortError') {
          turnRecord.retryable = true;
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'secondary';
          retry.dataset.chatRetry = '';
          retry.textContent = 'Try again';
          retry.setAttribute('aria-label', `Retry question at ${clock(c.time)}`);
          turn.append(retry);
        }
      }
    } finally {
      if (id === requestId) {
        controller = null;
        update();
        try {
          await onRequestSettled();
        } catch {
          /* Availability refresh must not erase a completed answer. */
        }
      }
    }
  }
  q('form').onsubmit = (e) => {
    e.preventDefault();
    void ask();
  };
  panel.onclick = (e) => {
    const retry = e.target.closest('[data-chat-retry]');
    if (retry && !retry.disabled) {
      const record = turns.find((turn) => turn.node.contains(retry));
      if (record) void ask(record);
    }
    if (e.target.closest('[data-chat-cancel]')) {
      conversation.cancel();
      controller?.abort();
    }
    if (e.target.closest('[data-chat-new-answer]')) {
      transcript.scrollTop = transcript.scrollHeight;
      newAnswer.hidden = true;
      transcript.focus({ preventScroll: true });
    }
    const moment = e.target.closest('[data-chat-moment]');
    if (
      moment &&
      !moment.disabled &&
      turns.some(
        (turn) =>
          turn.answer &&
          answerMomentLinks(turn.answer, getContext().eventRecords, getContext().time).some(
            (item) => item.anchorId === moment.dataset.chatMoment,
          ),
      )
    )
      onInspect?.(moment.dataset.chatMoment);
  };
  return { panel, update };
}
