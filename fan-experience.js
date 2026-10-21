// A presentation-only card. Callers supply the verified match interpretation;
// this component never infers a result, score, tactical cause, or confidence.
const labels = {
  en: {
    ready: 'Your match companion',
    live: 'Following the match',
    selected: 'Selected moment',
    corrected: 'Updated moment',
    loading: 'Updating this moment',
    unavailable: 'Moment unavailable',
    what: 'What happened',
    why: 'Why it matters',
    detail: 'How we know',
    watch: 'Watch buildup',
    stop: 'Stop replay',
    replaying: 'Replaying buildup',
  },
  es: {
    ready: 'Tu compañero de partido',
    live: 'Siguiendo el partido',
    selected: 'Momento seleccionado',
    corrected: 'Momento actualizado',
    loading: 'Actualizando este momento',
    unavailable: 'Momento no disponible',
    what: 'Qué ha pasado',
    why: 'Por qué importa',
    detail: 'Cómo lo sabemos',
    watch: 'Ver la jugada',
    stop: 'Detener repetición',
    replaying: 'Repitiendo la jugada',
  },
  fr: {
    ready: 'Votre compagnon de match',
    live: 'Suivi du match',
    selected: 'Moment sélectionné',
    corrected: 'Moment mis à jour',
    loading: 'Mise à jour du moment',
    unavailable: 'Moment indisponible',
    what: 'Ce qui s’est passé',
    why: 'Pourquoi c’est important',
    detail: 'Sur quelles informations',
    watch: 'Revoir la construction',
    stop: 'Arrêter la séquence',
    replaying: 'Relecture de la construction',
  },
  pt: {
    ready: 'O teu companheiro de jogo',
    live: 'A acompanhar o jogo',
    selected: 'Momento selecionado',
    corrected: 'Momento atualizado',
    loading: 'A atualizar este momento',
    unavailable: 'Momento indisponível',
    what: 'O que aconteceu',
    why: 'Porque importa',
    detail: 'Como sabemos',
    watch: 'Ver a jogada',
    stop: 'Parar repetição',
    replaying: 'A repetir a jogada',
  },
};
const states = new Set(['ready', 'live', 'selected', 'loading', 'unavailable']);
const kinds = new Set(['goal', 'shot', 'recovery', 'pass', 'receive']);
const text = (value) => (typeof value === 'string' ? value : '');

// Only suppress typed claims already represented in the visible moment card.
// Full claims/citations remain available in the AI evidence disclosure.
export function additionalFanClaims(draft, { current = false, hasScoreMeaning = false } = {}) {
  if (!current || draft?.status !== 'draft') return [];
  const claims = Array.isArray(draft.claims) ? draft.claims : [];
  if (draft.authorship?.wording !== 'application-fact-templates') return claims;
  const facts = new Map((draft.selectedFacts || []).map((fact) => [fact.id, fact]));
  return claims.filter((claim) => {
    const kind = facts.get(claim.factId)?.kind;
    return kind !== 'moment' && !(hasScoreMeaning && kind === 'goal-score-change');
  });
}

/**
 * Mount once inside the moment panel, then update as received evidence changes.
 * update({id,title,summary,why,state,timeLabel,language,kind,detail,corrected,metrics,
 *         onWatchBuildup,replaying,disabled})
 * detail is optional {title,text,items:string[]}; it remains collapsed by default.
 * metrics is optional [{label,value}], with at most two caller-supplied values.
 * The action callback is owned by the caller and receives the current moment id.
 */
export function createFanMomentCard(container) {
  if (!container?.ownerDocument) throw new TypeError('A DOM container is required.');
  const document = container.ownerDocument;
  const make = (tag, className, parent) => {
    const element = document.createElement(tag);
    element.className = className;
    parent?.append(element);
    return element;
  };
  const element = make('article', 'fan-moment-card', container);
  const meta = make('div', 'fan-moment-card__meta', element);
  const status = make('span', 'fan-moment-card__state', meta);
  const clock = make('span', 'fan-moment-card__time', meta);
  const happenedLabel = make('p', 'fan-moment-card__eyebrow', element);
  const title = make('h3', 'fan-moment-card__title moment-title', element);
  const summary = make('p', 'fan-moment-card__summary recorded-summary', element);
  const whyBlock = make('div', 'fan-moment-card__meaning', element);
  const whyLabel = make('h4', 'fan-moment-card__why-label', whyBlock);
  const why = make('p', 'fan-moment-card__why', whyBlock);
  // Lead with significance before the chronological buildup.
  whyBlock.after(summary);
  const sequence = make('ol', 'fan-moment-card__sequence', element);
  let sequenceKey = '';
  const metrics = make('dl', 'fan-moment-card__metrics', element);
  const metricSlots = Array.from({ length: 2 }, () => {
    const cell = make('div', 'fan-moment-card__metric', metrics);
    return {
      cell,
      label: make('dt', 'fan-moment-card__metric-label', cell),
      value: make('dd', 'fan-moment-card__metric-value', cell),
    };
  });
  const actions = make('div', 'fan-moment-card__actions', element);
  const action = make('button', 'fan-moment-card__watch secondary', actions);
  action.type = 'button';
  const actionIcon = make('span', 'fan-moment-card__action-icon', action);
  actionIcon.setAttribute('aria-hidden', 'true');
  const actionText = make('span', 'fan-moment-card__action-text', action);
  const detail = make('details', 'fan-moment-card__detail', element);
  const detailLabel = make('summary', 'fan-moment-card__detail-label', detail);
  const detailText = make('p', 'fan-moment-card__detail-copy', detail);
  const detailItems = make('ul', 'fan-moment-card__detail-items', detail);
  const announcement = make('span', 'sr-only', element);
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  let currentId = null,
    handler = null,
    destroyed = false,
    detailKey = '',
    announcementKey = '',
    wasReplaying = false;
  action.addEventListener('click', () => {
    if (!action.disabled && handler) handler(currentId);
  });
  const setText = (node, value) => {
    const next = text(value);
    if (node.textContent !== next) node.textContent = next;
  };

  function update(model = {}) {
    if (destroyed) return;
    const language = Object.hasOwn(labels, model.language) ? model.language : 'en';
    const copy = labels[language];
    const state = states.has(model.state) ? model.state : 'selected';
    const corrected = model.corrected === true;
    const stateLabel = model.replaying
      ? copy.replaying
      : corrected && ['live', 'selected'].includes(state)
        ? copy.corrected
        : copy[state];
    const nextId = text(model.id);
    const nextTitle = text(model.title);
    const nextDetail = model.detail && typeof model.detail === 'object' ? model.detail : {};
    const nextItems = Array.isArray(nextDetail.items)
      ? nextDetail.items.filter((item) => typeof item === 'string' && item)
      : [];
    const hasDetail = Boolean(text(nextDetail.text) || nextItems.length);
    currentId = nextId;
    handler = typeof model.onWatchBuildup === 'function' ? model.onWatchBuildup : null;
    element.lang = language;
    element.dataset.state = state;
    element.dataset.kind = kinds.has(model.kind) ? model.kind : '';
    element.setAttribute('aria-busy', String(state === 'loading'));
    setText(status, stateLabel);
    setText(clock, model.timeLabel);
    clock.hidden = !text(model.timeLabel);
    setText(happenedLabel, copy.what);
    happenedLabel.hidden = state === 'ready' || state === 'unavailable';
    setText(title, nextTitle);
    title.hidden = !nextTitle;
    setText(summary, model.summary);
    summary.hidden = !text(model.summary);
    const steps = Array.isArray(model.steps)
      ? model.steps.filter((step) => Number.isFinite(step.time) && typeof step.text === 'string')
      : [];
    const shown = steps.length > 4 ? [steps[0], ...steps.slice(-3)] : steps;
    const nextSequenceKey = JSON.stringify(shown);
    sequence.hidden = shown.length < 2;
    if (nextSequenceKey !== sequenceKey) {
      sequence.replaceChildren();
      for (const step of shown) {
        const item = make('li', '', sequence),
          time = make('span', 'fan-moment-card__step-time', item);
        setText(
          time,
          `${String(Math.floor(step.time / 60)).padStart(2, '0')}:${String(Math.floor(step.time % 60)).padStart(2, '0')}`,
        );
        setText(make('span', '', item), step.text);
      }
      sequenceKey = nextSequenceKey;
    }
    setText(whyLabel, copy.why);
    setText(why, model.why);
    whyBlock.hidden = !text(model.why);
    const nextMetrics = (Array.isArray(model.metrics) ? model.metrics : [])
      .filter(
        (metric) =>
          metric &&
          text(metric.label) &&
          (text(metric.value) ||
            (typeof metric.value === 'number' && Number.isFinite(metric.value))),
      )
      .slice(0, 2);
    metrics.hidden = !nextMetrics.length;
    metrics.dataset.count = String(nextMetrics.length);
    metricSlots.forEach((slot, index) => {
      const metric = nextMetrics[index];
      slot.cell.hidden = !metric;
      setText(slot.label, metric?.label);
      setText(slot.value, metric ? String(metric.value) : '');
    });
    actions.hidden = !handler;
    action.disabled = Boolean(model.disabled || state === 'loading' || state === 'unavailable');
    action.dataset.replaying = String(Boolean(model.replaying));
    setText(actionIcon, model.replaying ? '■' : '▶');
    setText(actionText, model.replaying ? copy.stop : copy.watch);
    setText(detailLabel, text(nextDetail.title) || copy.detail);
    setText(detailText, nextDetail.text);
    detailText.hidden = !text(nextDetail.text);
    const nextDetailKey = JSON.stringify(nextItems);
    if (nextDetailKey !== detailKey) {
      detailItems.replaceChildren();
      for (const item of nextItems) setText(make('li', '', detailItems), item);
      detailKey = nextDetailKey;
    }
    detailItems.hidden = !nextItems.length;
    detail.hidden = !hasDetail;
    // Repeated stream ticks do not recreate controls, collapse details, or make
    // a screen reader repeat a story. Corrections to its wording do announce.
    const nextAnnouncementKey = `${nextId}|${state}|${nextTitle}|${text(model.why)}|${language}|${corrected}`;
    if (announcementKey !== nextAnnouncementKey) {
      setText(announcement, [stateLabel, nextTitle, text(model.why)].filter(Boolean).join('. '));
      announcementKey = nextAnnouncementKey;
    } else if (wasReplaying !== Boolean(model.replaying)) {
      setText(announcement, stateLabel);
    }
    wasReplaying = Boolean(model.replaying);
  }

  update({ state: 'ready' });
  return {
    element,
    update,
    destroy() {
      destroyed = true;
      handler = null;
      element.remove();
    },
  };
}
