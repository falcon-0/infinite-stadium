import { ProductionDesk } from './production-desk-state.js';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function initializeProductionDesk({
  parent,
  getState,
  getPreferences,
  getAIStory,
  onSeek,
  onInspect,
  onAI,
}) {
  const desk = new ProductionDesk(),
    panel = document.createElement('section');
  panel.className = 'production-desk';
  panel.setAttribute('aria-labelledby', 'production-title');
  panel.innerHTML = `<div class="production-heading"><div><p class="eyebrow">ONE CHANCE · THREE AUDIENCES</p><h2 id="production-title">Keep the story current.</h2><p>Prepare the story. Review the outputs. Catch the correction before it reaches the screen.</p></div><span class="pill">LOCAL STUDIO PREVIEW</span></div>
 <ol class="production-journey"><li>1. Select a chance</li><li>2. Review three outputs</li><li>3. Preview the graphic</li><li>4. Receive a correction</li></ol>
 <div class="production-toolbar"><button data-desk-start>Load demonstration chance</button><button class="secondary" data-desk-prepare>Prepare latest received shot</button><label>Graphic language <select data-desk-language aria-label="Graphic language"><option value="es">Spanish</option><option value="fr">French</option><option value="pt">Portuguese</option></select></label></div>
 <p class="disclosure">The demonstration loads the shot at 01:36. Its provider correction arrives at 01:38. Preparation makes no model call; AI investigation is a separate action.</p>
 <p data-desk-notice role="status" aria-live="polite"></p><div data-desk-body><p class="production-empty">Select the demonstration chance to follow a pass, a shot and its corrected outcome through the production process.</p></div>
 <div class="production-actions" hidden><label class="production-consent"><input type="checkbox" data-desk-reviewed> I have reviewed all three outputs and their sources.</label><button data-desk-approve>Approve this package</button><button class="secondary" data-desk-preview>Preview approved graphic</button><button class="secondary" data-desk-export>Download approved package</button><button class="secondary" data-desk-replace hidden>Review replacement package</button><button class="secondary" data-desk-correct>Receive provider correction</button><button class="secondary" data-desk-inspect>Inspect chance on pitch</button><button class="secondary" data-desk-ai>Investigate this chance with AI</button></div>
 <section class="production-stage" aria-label="Local broadcast graphic preview"><p class="production-stage-label">GRAPHIC PREVIEW · NOT ON AIR</p><div data-desk-graphic><p>No approved graphic in preview.</p></div></section>
 <details class="production-audit"><summary>Review history and limitations</summary><div data-desk-audit></div><p>Approvals are local to this visit. Model editorial review is separate from human approval. Downloaded graphics cannot update themselves. Translations need language review; no broadcast service is connected.</p></details>`;
  parent.querySelector('.workspace').before(panel);
  const q = (s) => panel.querySelector(s),
    notice = q('[data-desk-notice]'),
    body = q('[data-desk-body]');
  let anchorId = null,
    requestKey = null,
    completedKey = null,
    controller = null,
    requestNumber = 0,
    html = '',
    aiInput = null,
    loading = false,
    aiBusy = false;
  const language = () => q('[data-desk-language]').value;
  const scopeKey = () =>
    JSON.stringify([
      getPreferences().kind,
      getPreferences().seed,
      getState().matchId,
      getState().time,
      language(),
      anchorId,
      aiInput?.key || null,
    ]);
  function render() {
    const p = desk.saved,
      current = desk.current,
      status = desk.status;
    const execution = aiInput?.execution;
    const aiReceipt = execution
      ? `<details class="production-ai-receipt"><summary>AI investigation completed ? ${esc(execution.modelCalls)} model calls</summary><p>${esc(aiInput.review || 'Model selection returned; human review is still required.')}</p><p>${esc((execution.elapsedMs / 1000).toFixed(1))} seconds ? ${esc(execution.toolCalls || 0)} application tools${execution.usage ? ` ? ${esc(execution.usage.promptTokens)} input / ${esc(execution.usage.completionTokens)} output tokens` : ''}</p><p>This records the completed investigation. Each card identifies whether its current wording uses that selection.</p></details>`
      : '';
    q('.production-actions').hidden = !p;
    if (p) {
      const next = `<div class="production-chance"><span class="production-status" data-status="${status}">${{ checking: 'Checking received evidence', review: 'Needs human review', approved: 'Approved for local preview', withdrawn: 'WITHDRAWN — evidence changed' }[status] || status}</span><h3>${esc(p.headline)}</h3><p>${esc(p.why || 'Review the received outcome and its preceding actions.')}</p><ol class="production-sequence">${p.steps.map((s) => `<li><time>${clock(s.time)}</time> ${esc(s.text)}</li>`).join('')}</ol><p class="disclosure">Selected chance ${clock(p.eventTime)} · source revision ${p.revision} · received through ${clock(getState().time)}</p></div>
   ${status === 'withdrawn' ? `<div class="production-correction" role="status"><h3>Review the changed package</h3><p>The previous approval cannot be used. ${esc(current?.headline || 'Current evidence is unavailable.')}</p><p>Review the replacement before another graphic can appear.</p></div>` : ''}
   <div class="production-outputs">${p.outputs
     .map((o) => {
       const replacement = current?.outputs.find((n) => n.id === o.id);
       return `<article><p class="eyebrow">${esc(o.label)} · ${esc(o.language.toUpperCase())}</p><p lang="${esc(o.language)}">${esc(o.text)}</p><small>${o.source === 'ai' ? 'AI-selected facts · application wording' : 'Recorded facts · application wording'}</small>${status === 'withdrawn' && replacement ? `<div class="production-replacement"><strong>Replacement to review</strong><p lang="${esc(replacement.language)}">${esc(replacement.text)}</p></div>` : ''}<details><summary>Sources for this output</summary><ul>${o.evidence.map((e) => `<li>${esc(e.type)}: ${esc(e.id)} / v${e.revision}</li>`).join('')}</ul></details></article>`;
     })
     .join(
       '',
     )}</div>${aiReceipt}${(current?.notices || []).map((n) => `<p class="disclosure">${esc(n)}</p>`).join('')}`;
      if (next !== html) {
        body.innerHTML = next;
        html = next;
      }
    }
    q('[data-desk-approve]').disabled = status !== 'review' || !q('[data-desk-reviewed]').checked;
    q('[data-desk-approve]').hidden = status !== 'review';
    q('.production-consent').hidden = status !== 'review';
    q('[data-desk-preview]').hidden = status !== 'approved';
    q('[data-desk-export]').hidden = status !== 'approved';
    q('[data-desk-reviewed]').disabled = status !== 'review';
    q('[data-desk-preview]').disabled = status !== 'approved';
    q('[data-desk-export]').disabled = status !== 'approved';
    q('[data-desk-preview]').textContent = desk.graphic
      ? 'Stop graphic preview'
      : 'Preview approved graphic';
    q('[data-desk-replace]').hidden = status !== 'withdrawn';
    q('[data-desk-replace]').disabled = loading;
    const demonstration =
      p?.kind === 'sustained' && p.seed === 17 && p.anchorId === 'comparison-sustained-17-shot-96';
    q('[data-desk-correct]').hidden = !demonstration || getState().time >= 98;
    q('[data-desk-correct]').disabled = getState().time >= 98 || loading;
    q('[data-desk-ai]').disabled =
      aiBusy || loading || !p || status === 'withdrawn' || status === 'checking';
    q('[data-desk-ai]').textContent = aiBusy
      ? 'Investigating received evidence…'
      : 'Investigate this chance with AI';
    q('[data-desk-inspect]').disabled = loading || !p;
    q('[data-desk-prepare]').disabled = loading || !getState().matchId;
    const graphic = desk.graphic;
    q('[data-desk-graphic]').innerHTML = graphic
      ? `<div class="production-lower-third"><span>${clock(graphic.eventTime)} · ${esc(graphic.outputs[2].language.toUpperCase())}</span><p lang="${esc(graphic.outputs[2].language)}">${esc(graphic.outputs[2].text)}</p></div>`
      : `<p>${status === 'withdrawn' ? 'Graphic withdrawn. Replacement awaits human review.' : status === 'checking' ? 'Graphic hidden while evidence is checked.' : 'No approved graphic in preview.'}</p>`;
    q('[data-desk-audit]').innerHTML =
      desk.audit
        .map(
          (a) =>
            `<p>${clock(a.at)} · ${a.action === 'approved' ? 'Human approved the package' : 'Package changed: preview withdrawn'}</p>`,
        )
        .join('') || '<p>No human review decisions yet.</p>';
  }
  async function refresh(force = false) {
    if (!anchorId || !getState().matchId) return;
    const key = scopeKey();
    if (!force && (key === requestKey || key === completedKey)) return;
    const id = ++requestNumber;
    controller?.abort();
    controller = new AbortController();
    requestKey = key;
    loading = true;
    desk.beginCheck();
    render();
    try {
      const prefs = getPreferences(),
        response = await fetch('/api/production/package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            kind: prefs.kind,
            seed: prefs.seed,
            time: getState().time,
            anchorId,
            language: language(),
            ...(aiInput ? { aiDraft: aiInput } : {}),
          }),
        });
      const result = await response.json();
      if (id !== requestNumber || scopeKey() !== key) return;
      if (!response.ok) throw new Error(result.error || 'Package evidence could not be checked.');
      const previousKey = desk.saved?.key;
      desk.receive(result);
      completedKey = key;
      if (desk.saved?.key !== previousKey || desk.status === 'withdrawn')
        q('[data-desk-reviewed]').checked = false;
      notice.textContent =
        desk.status === 'withdrawn'
          ? 'The package changed. Its preview is withdrawn; review the replacements before approving again.'
          : 'Package checked against the current received match.';
    } catch (error) {
      if (error.name !== 'AbortError' && id === requestNumber) {
        desk.failCheck();
        notice.textContent = error.message;
        completedKey = key;
      }
    } finally {
      if (id === requestNumber) {
        loading = false;
        requestKey = null;
        render();
      }
    }
  }
  function update() {
    if (anchorId && (!getState().matchId || scopeKey() !== completedKey)) {
      desk.beginCheck();
      render();
    }
    if (anchorId) void refresh();
    else render();
  }
  q('[data-desk-reviewed]').onchange = render;
  q('[data-desk-language]').onchange = () => {
    q('[data-desk-reviewed]').checked = false;
    void refresh(true);
  };
  panel.addEventListener('click', async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      if (b.hasAttribute('data-desk-start')) {
        anchorId = 'comparison-sustained-17-shot-96';
        aiInput = null;
        completedKey = null;
        onSeek(96);
        update();
      } else if (b.hasAttribute('data-desk-prepare')) {
        const shots = [...getState().events.values()]
          .filter((e) => e.type === 'shot')
          .sort((a, b) => b.time - a.time);
        if (!shots.length) throw new Error('Receive a shot before preparing a package.');
        anchorId = shots[0].id;
        aiInput = null;
        await refresh(true);
      } else if (b.hasAttribute('data-desk-correct')) onSeek(98);
      else if (b.hasAttribute('data-desk-inspect')) onInspect(anchorId);
      else if (b.hasAttribute('data-desk-ai')) {
        aiBusy = true;
        notice.textContent =
          'AI is investigating the received chance. Its result will still need human review.';
        render();
        try {
          await onAI(anchorId);
          const ai = getAIStory();
          if (!ai || ai.draft.anchorId !== anchorId)
            throw new Error(
              'No current AI story was returned. The recorded package remains available.',
            );
          aiInput = ai.draft;
          await refresh(true);
        } finally {
          aiBusy = false;
          render();
        }
      } else if (b.hasAttribute('data-desk-replace')) {
        desk.reviewReplacement();
        q('[data-desk-reviewed]').checked = false;
        notice.textContent = 'Replacement loaded for review. No previous approval carries over.';
        render();
      } else if (b.hasAttribute('data-desk-approve')) {
        await refresh(true);
        desk.approve(q('[data-desk-reviewed]').checked);
        notice.textContent = 'Human approval recorded for all three current outputs.';
        render();
      } else if (b.hasAttribute('data-desk-preview')) {
        if (desk.graphic) {
          desk.showing = false;
          render();
        } else {
          await refresh(true);
          desk.preview();
          render();
        }
      } else if (b.hasAttribute('data-desk-export')) {
        await refresh(true);
        const output = desk.export(),
          url = URL.createObjectURL(
            new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }),
          ),
          link = document.createElement('a');
        link.href = url;
        link.download = 'infinite-stadium-reviewed-graphics.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notice.textContent =
          'Reviewed package downloaded. Replace that file if its source evidence changes.';
      }
    } catch (error) {
      notice.textContent = error.message;
      render();
    }
  });
  return { update, panel };
}
