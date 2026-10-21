import {
  snapshot,
  stories,
  describe,
  players,
  events,
  duration,
  teams,
  explainMoment,
  validateExplanation,
} from './engine.js';
import './stream-ui.js';
const $ = (id) => document.getElementById(id);
let time = 0,
  playing = false,
  last = performance.now();
let investigation = null,
  previousInvestigation = null,
  lastExplanationKey = null;
let aiConfigured = false,
  aiBusy = false,
  aiDraft = null,
  aiMessage = 'Checking server configuration…',
  aiRequest = 0;
let sceneResult = null,
  scenePrevious = null,
  sceneRequest = 0,
  sceneDraft = null,
  sceneBusy = false,
  sceneMessage = 'Select a received event to generate a draft.',
  sceneAnchor = null;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const stamp = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
Object.values(players)
  .flat()
  .forEach((name) => {
    const o = document.createElement('option');
    o.textContent = name;
    $('player').append(o);
  });
$('player').value = 'A. Reed';
function render() {
  const state = snapshot(time),
    latest = state.events.at(-1);
  if (investigation && !validateExplanation(investigation, state).valid) {
    const next = explainMoment(state, investigation.anchorId);
    previousInvestigation = next ? investigation : null;
    investigation = next;
  }
  $('explain').disabled = !latest;
  $('correct').disabled = time >= 190;
  $('close-explanation').disabled = !investigation;
  renderAI();
  $('score').innerHTML = `${state.stats.home.goals} <span>:</span> ${state.stats.away.goals}`;
  $('clock').textContent = stamp(time);
  $('phase').textContent =
    time >= duration
      ? 'SEGMENT COMPLETE'
      : playing
        ? 'REPLAY RUNNING'
        : time
          ? 'PAUSED'
          : 'READY TO REPLAY';
  $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Play match';
  $('seek').value = time;
  $('elapsed').textContent = `${state.events.length} / ${events.length} events`;
  $('latest').textContent = latest
    ? `${stamp(latest.time)} · ${describe(latest)}`
    : 'Press play to begin the match.';
  const action = $('action');
  action.replaceChildren();
  const shown = investigation ? investigation.sequence : latest ? [latest] : [];
  shown.forEach((event, index) => {
    const point = (x, y) => [35 + x * 9.3, 35 + y * 5.3];
    const [x, y] = point(event.x, event.y),
      [ex, ey] = point(event.endX, event.endY);
    const color = event.team === 'home' ? '#b7f778' : '#ffb581';
    const svg = (tag, attrs) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      action.append(el);
      return el;
    };
    svg('line', {
      x1: x,
      y1: y,
      x2: ex,
      y2: ey,
      stroke: color,
      'stroke-width': 4,
      'stroke-dasharray': event.result ? 'none' : '9 7',
    });
    svg('circle', { cx: ex, cy: ey, r: 13, fill: color, stroke: '#fff', 'stroke-width': 3 });
    const label = svg('text', {
      x: Math.min(850, Math.max(60, ex)),
      y: Math.max(65, ey - 27 - index * 22),
      fill: '#fff',
      'font-size': 20,
      'text-anchor': 'middle',
    });
    label.textContent = `${investigation ? `${index + 1}. ` : ''}${event.player}`;
  });
  if (investigation)
    $('latest').textContent =
      `INVESTIGATION · ${investigation.title} · ${stamp(investigation.sequence.at(-1).time)}`;
  const explanationKey = investigation ? investigation.key : 'empty';
  if (explanationKey !== lastExplanationKey) {
    lastExplanationKey = explanationKey;
    $('explanation').innerHTML = investigation
      ? `<div><span class="pill">${investigation.updated ? 'REVISED EVIDENCE' : 'SUPPORTED BY RECEIVED EVENTS'}</span><h3>${escape(investigation.title)}</h3><p>${escape(investigation.text)}</p><p class="disclosure">${escape(investigation.limit)}</p><h3>Current recap entry</h3><p>${escape(investigation.recap)}</p>${previousInvestigation ? `<details><summary>Earlier version · superseded</summary><p>${escape(previousInvestigation.text)}</p><p>${escape(previousInvestigation.recap)}</p></details>` : ''}</div><ol class="sequence">${investigation.sequence.map((e) => `<li><b>${stamp(e.time)} · ${escape(describe(e))}</b><small>${e.id} / revision ${e.revision} · received ${stamp(e.arrivedAt)}</small></li>`).join('')}</ol>`
      : '<p>Select a moment to inspect its preceding event sequence.</p>';
  }
  const status = state.updates.length
    ? `Correction received at ${stamp(state.updates.at(-1).arrivedAt)}: ${state.updates.at(-1).reason}`
    : 'No corrections have arrived at this replay time.';
  if ($('revision-status').textContent !== status) $('revision-status').textContent = status;
  $('stats').innerHTML = [
    ['Shots', 'shots'],
    ['Passes completed', 'completed'],
    ['Recoveries', 'recoveries'],
  ]
    .map(
      ([label, key]) =>
        `<div><b>${state.stats.home[key]}</b><span>${label}</span><b>${state.stats.away[key]}</b></div>`,
    )
    .join('');
  $('feed').innerHTML = state.events.length
    ? [...state.events]
        .reverse()
        .map(
          (e) =>
            `<div class="event ${e.team}"><time>${stamp(e.time)}</time><div><strong>${describe(e)}</strong><small>${teams[e.team]} · ${e.id} / v${e.revision} · received ${stamp(e.arrivedAt)}</small><button class="event-explain secondary" data-event="${e.id}">Explain</button></div>${e.type === 'shot' && e.result ? '<span class="goal">GOAL</span>' : ''}</div>`,
        )
        .join('')
    : '<div class="empty">The story starts at kickoff.<br>Play the match to reveal events.</div>';
  const cards = stories(state, $('player').value);
  // Preserve evidence expansion while the clock updates.
  const opened = [...$('stories').querySelectorAll('details')].map((d) => d.open);
  $('stories').innerHTML = cards.length
    ? cards
        .map(
          (c, i) =>
            `<article><div class="card-top"><span>0${i + 1} / ${c.mode.toUpperCase()}</span><i>LOCAL TEMPLATE</i></div><h3>${c.title}</h3><p>${c.text}</p><details ${opened[i] ? 'open' : ''}><summary>Inspect evidence · ${c.evidence.length} events</summary><div class="evidence">${
              c.evidence.length
                ? c.evidence
                    .map((id) => {
                      const e = state.events.find((x) => x.id === id);
                      return `<p><b>${id} · ${stamp(e.time)}</b><br>${describe(e)}</p>`;
                    })
                    .join('')
                : 'No matching events yet.'
            }</div></details></article>`,
        )
        .join('')
    : ['The newcomer', 'The analyst', 'The player follower']
        .map(
          (title, i) =>
            `<article><div class="card-top">0${i + 1} / ${title.toUpperCase()}</div><h3>Waiting for kickoff.</h3><p>Commentary appears as match events arrive. No future events are used.</p></article>`,
        )
        .join('');
}
$('play').onclick = () => {
  if (time >= duration) time = 0;
  playing = !playing;
  last = performance.now();
  render();
};
$('restart').onclick = () => {
  time = 0;
  playing = false;
  investigation = null;
  previousInvestigation = null;
  render();
};
$('seek').oninput = (e) => {
  time = Number(e.target.value);
  investigation = null;
  previousInvestigation = null;
  render();
};
function investigate(id) {
  investigation = explainMoment(snapshot(time), id);
  previousInvestigation = null;
  lastExplanationKey = null;
  render();
}
$('explain').onclick = () => investigate(snapshot(time).events.at(-1)?.id);
$('feed').onclick = (e) => {
  const button = e.target.closest('[data-event]');
  if (button) investigate(button.dataset.event);
};
$('demo').onclick = () => {
  time = 169;
  playing = false;
  investigate('EV-017');
};
$('correct').onclick = () => {
  if (!investigation) investigation = explainMoment(snapshot(169), 'EV-017');
  time = 190;
  playing = false;
  render();
};
$('close-explanation').onclick = () => {
  investigation = null;
  previousInvestigation = null;
  render();
};
$('player').onchange = render;
let lastWhole = -1;
function frame(now) {
  if (playing) {
    time = Math.min(duration, time + ((now - last) / 1000) * Number($('speed').value));
    if (time >= duration) playing = false;
    if (Math.floor(time) !== lastWhole) {
      lastWhole = Math.floor(time);
      render();
    }
  }
  last = now;
  requestAnimationFrame(frame);
}
render();
requestAnimationFrame(frame);

function renderAI() {
  $('generate-ai').disabled = !aiConfigured || aiBusy || !investigation;
  $('ai-audience').disabled = aiBusy;
  $('ai-status').textContent = aiMessage;
  if (!aiDraft) {
    $('ai-draft').replaceChildren();
    return;
  }
  const current =
    investigation &&
    aiDraft.anchorId === investigation.anchorId &&
    aiDraft.key === investigation.key;
  $('ai-draft').innerHTML =
    `<span class="pill">${current ? 'AI DRAFT · REVIEW REQUIRED' : 'SUPERSEDED AI DRAFT'} · ${escape(aiDraft.audience.toUpperCase())}</span><p class="disclosure">${current ? escape(aiDraft.review) : 'This draft no longer matches the selected evidence. Generate a new draft before using it.'}</p>${aiDraft.claims.map((c) => `<p>${escape(c.text)}<small>${c.evidence.map((e) => `${escape(e.id)} / v${e.revision}`).join(' · ')}</small></p>`).join('')}`;
}
$('generate-ai').onclick = async () => {
  if (!investigation || aiBusy) return;
  const selected = investigation,
    request = ++aiRequest;
  aiBusy = true;
  aiMessage = 'Generating an AI draft…';
  renderAI();
  try {
    const response = await fetch('/api/ai/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time, anchorId: selected.anchorId, audience: $('ai-audience').value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Generation failed.');
    if (request === aiRequest) {
      aiDraft = data;
      aiMessage = 'AI returned a draft. Inspect its evidence and wording.';
    }
  } catch (error) {
    if (request === aiRequest) aiMessage = error.message;
  } finally {
    if (request === aiRequest) {
      aiBusy = false;
      renderAI();
    }
  }
};
fetch('/api/ai/status')
  .then((r) => {
    if (!r.ok) throw new Error();
    return r.json();
  })
  .then((status) => {
    aiConfigured = status.configured && !status.authRequired;
    aiMessage =
      status.error ||
      (status.authRequired
        ? 'AI access is restricted on this deployment.'
        : aiConfigured
          ? 'AI configured · select a moment and generate to test the connection.'
          : 'AI not configured · local evidence templates remain available.');
    renderAI();
    renderSceneAI();
  })
  .catch(() => {
    aiMessage = 'AI server unavailable. Restart the updated server.';
    renderAI();
  });

async function renderScene() {
  const request = ++sceneRequest,
    kind = $('scene-kind').value,
    t = Number($('scene-time').value);
  $('scene-clock').textContent = `${t}s`;
  $('scene-analysis').textContent = 'Loading received evidence...';
  for (const id of ['scene-evidence', 'scene-recap', 'scene-previous', 'scene-refs'])
    $(id).textContent = '';
  sceneResult = null;
  renderSceneAI();
  $('scene-players').replaceChildren();
  try {
    const query = new URLSearchParams({ kind, seed: 17, time: t });
    if (sceneAnchor) query.set('anchorId', sceneAnchor);
    const response = await fetch(`/api/scene?${query}`);
    if (!response.ok) throw new Error('Scene unavailable. Restart the updated server.');
    const result = await response.json();
    if (request !== sceneRequest) return;
    sceneResult = result;
    const { state, explanation } = result,
      frame = explanation?.frame || state.frame;
    const layer = $('scene-players');
    const svg = (tag, attrs) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      layer.append(el);
      return el;
    };
    if (frame) {
      const metric = explanation?.metrics[0],
        runner = frame.players.find((p) => p.id === metric?.playerId),
        opponent = frame.players.find((p) => p.id === metric?.opponentId);
      if (runner && opponent)
        svg('line', {
          x1: runner.x * 10,
          y1: runner.y * 10,
          x2: opponent.x * 10,
          y2: opponent.y * 10,
          stroke: '#fff',
          'stroke-width': 2,
          'stroke-dasharray': '5 5',
        });
      frame.players.forEach((p) => {
        svg('circle', {
          cx: p.x * 10,
          cy: p.y * 10,
          r: 15,
          fill: p.team === 'home' ? '#b7f778' : '#ffb581',
          stroke: p.id === 'home-10' ? '#fff' : 'none',
          'stroke-width': 4,
        });
        const label = svg('text', {
          x: p.x * 10,
          y: p.y * 10 + 5,
          'text-anchor': 'middle',
          fill: '#14291f',
          'font-size': 14,
          'font-weight': 700,
        });
        label.textContent = p.number;
      });
      svg('circle', {
        cx: frame.ball.x * 10,
        cy: frame.ball.y * 10,
        r: 6,
        fill: '#fff',
        stroke: '#000',
        'stroke-width': 2,
      });
    }
    $('scene-analysis').textContent =
      explanation?.text ||
      'Waiting for the first event. Home attacks toward the right; the ball is white.';
    $('scene-evidence').textContent = frame
      ? `Displayed sample: ${frame.time}s | ${frame.id} / v${frame.revision} | received ${frame.arrivedAt}s | ${state.events.length} events received`
      : 'No positional sample available.';
    $('scene-limit').textContent = state.limit;
    $('scene-recap').textContent = explanation?.recap || 'No recap entry yet.';
    $('scene-refs').textContent =
      explanation?.evidence.map((e) => `${e.type}: ${e.id} / v${e.revision}`).join('\n') ||
      'No event selected.';
    $('scene-previous').textContent =
      scenePrevious &&
      explanation &&
      scenePrevious.anchorId === explanation.anchorId &&
      scenePrevious.key !== explanation.key
        ? `Superseded recap: ${scenePrevious.recap}`
        : '';
    renderSceneAI();
  } catch (error) {
    if (request === sceneRequest) $('scene-analysis').textContent = error.message;
  }
}
function renderSceneAI() {
  $('scene-generate').disabled = !aiConfigured || sceneBusy || !sceneResult?.explanation;
  $('scene-ai-status').textContent = aiConfigured
    ? sceneMessage
    : 'AI not configured | local evidence analysis is available.';
  const current = sceneDraft && sceneDraft.key === sceneResult?.explanation?.key;
  $('scene-ai-draft').innerHTML = sceneDraft
    ? `<span class="pill">${current ? 'AI DRAFT | REVIEW REQUIRED' : 'SUPERSEDED AI DRAFT'}</span><p>${escape(sceneDraft.review)}</p>${sceneDraft.claims.map((c) => `<p>${escape(c.text)}<small>${c.evidence.map((e) => `${escape(e.id)} / v${e.revision}`).join(' | ')}</small></p>`).join('')}`
    : '';
}
$('scene-kind').onchange = () => {
  $('scene-time').value = 0;
  sceneAnchor = null;
  scenePrevious = null;
  renderScene();
};
$('scene-time').oninput = () => {
  sceneAnchor = null;
  renderScene();
};
$('scene-shot').onclick = () => {
  scenePrevious = null;
  sceneAnchor = `${$('scene-kind').value}-17-shot`;
  $('scene-time').value = 8;
  renderScene();
};
$('scene-correct').onclick = () => {
  scenePrevious = sceneResult?.explanation;
  sceneAnchor = `${$('scene-kind').value}-17-shot`;
  $('scene-time').value = 10;
  renderScene();
};
$('scene-generate').onclick = async () => {
  if (sceneBusy || !sceneResult?.explanation) return;
  const selected = sceneResult;
  sceneBusy = true;
  sceneMessage = 'Generating an AI draft...';
  renderSceneAI();
  try {
    const response = await fetch('/api/ai/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'scene',
        kind: selected.state.kind,
        seed: selected.state.seed,
        time: selected.state.time,
        anchorId: selected.explanation.anchorId,
        audience: $('scene-audience').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Generation failed.');
    sceneDraft = data;
    sceneMessage = 'Draft received. Review its wording and evidence.';
  } catch (error) {
    sceneMessage = error.message;
  } finally {
    sceneBusy = false;
    renderSceneAI();
  }
};
renderScene();
document.documentElement.classList.remove('app-loading');
