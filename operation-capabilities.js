// This registry licenses declared data filters, not answers or complete intent.
// A model still selects the operation and its scope; review checks relevance.
// Unsupported paraphrases keep the ordinary evidence/query route available.
export const operationMetricPolicyDescription =
  'attempts means ALL shots, including blocked, off-target and pending attempts; recoveries means explicitly classified ball wins, excluding initial segment possession and unknown recovery kinds; raw provider recovery records are a separate query concept. Restrictive metrics require an explicit matching metric concept in the current question: completedPasses (completion/success), goals (goals/scoring), shotsOnTarget (a nominal on-target subset), creditedAssists (explicit assist credit). A question asking whether one shot was on target does not request an on-target-only timeline. Never substitute a restrictive metric for an unqualified one. History can supply a metric topic only for a deictic follow-up with no explicit current metric noun. Missing permission means use the ordinary evidence/query route, not a renamed or broadened metric. For passing-accuracy ratio, subjects [] denotes one combined rate from summed completed and failed passes across both teams; one or two team IDs denote separate rates. Never average team percentages or treat a combined rate as two team results. This conservative EN/ES/FR/PT lexical filter license is not universal natural-language entailment.';

const normalize = (value) =>
  typeof value === 'string'
    ? value
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[‐‑‒–—-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const matches = (text, pattern) => [...text.matchAll(new RegExp(pattern, 'gu'))];
const bounded = (pattern) => `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`;
const passNoun = 'pass(?:es)?|pases|passe';
const completion =
  'completed|complete|successful|complet(?:ed|ados?|as?|os?|ou|o|ar|ee?s?)|reussi(?:e?s?|t)?|acertados?|exitosos?|certos?|bem sucedidos?';
const goalNoun =
  'goals?|goles?|gols?|buts|(?:un|une|le|du|ce|quel|aucun|chaque|premier|dernier) but';
const assistNoun =
  'assists?|assisted|assisting|asistencias?|asistio|assistencias?|assistiu|passes? decisiv(?:e?s?|os?|as?)';
const metricNoun = bounded(
  `${passNoun}|shots?|attempts?|tiros?|tirs?|chutes?|tentativ(?:e?s?|as?)|intentos?|${goalNoun}|${assistNoun}|recover(?:y|ies)|recupera(?:tion|tions|cao|coes|cion|ciones)|saves?|defesas?|arrets?|possession|pressure|pressing|probability|probabilite|probabilidad|probabilidade|xg|accuracy|precision|precisao|completion|score|scored|scoring`,
);
const explicitTopic = (text) => new RegExp(metricNoun, 'u').test(text);
const deictic = (text) =>
  new RegExp(
    bounded(
      'and|what about|how about|same|those|that|them|again|he|she|his|her|they|it|which side|which team|who leads|how many|how much|first|latest|last|et|et ensuite|les memes|ceux|cela|il|elle|combien|y|y ahora|esos|eso|el mismo|ella|cuantos|cuantas|e|e agora|esses|isso|o mesmo|ele|ela|quantos|quantas',
    ),
    'u',
  ).test(text);

function topicFor(input) {
  const current = normalize(input?.question);
  if (explicitTopic(current) || !deictic(current)) return current;
  const questions = Array.isArray(input?.conversation)
    ? input.conversation.map((turn) => normalize(turn?.question))
    : [];
  if (!questions.length && input?.previousQuestion)
    questions.push(normalize(input.previousQuestion));
  for (const question of questions.toReversed()) {
    if (explicitTopic(question)) return question;
    if (!deictic(question)) break;
  }
  return current;
}

function broadens(text) {
  return new RegExp(
    bounded(
      'not just|not only|rather than|instead of|including|regardless of|whether or not|pas seulement|pas uniquement|y compris|plutot que|no solo|no solamente|incluidos?|incluyendo|en vez de|nao apenas|nao so|incluindo|em vez de',
    ),
    'u',
  ).test(text);
}
function deniedBefore(text, index) {
  return /\b(?:not|never|isn't|aren't|wasn't|weren't|didn't|without|excluding|except|non|sans|sauf|sin|excepto|nao|sem)\s+(?:\p{L}+\s+){0,2}$/u.test(
    text.slice(0, index),
  );
}
function nominalOnTarget(text) {
  if (broadens(text)) return false;
  // These expressions describe a filtered set. Merely asking whether a given
  // shot had this outcome must retain the broader attempt inventory.
  const nouns = 'shots?|attempts?|tirs?|tiros?|chutes?';
  const patterns = [
    `(?:shots?|attempts?) on target`,
    `on target (?:shots?|attempts?)`,
    `tirs? cadres?`,
    `tiros? a puerta`,
    `(?:tiros?|chutes?) (?:no alvo|a baliza)`,
  ];
  return patterns.some((pattern) =>
    matches(text, bounded(pattern)).some((match) => {
      if (deniedBefore(text, match.index)) return false;
      const before = text
        .slice(0, match.index)
        .split(/[.!?;,]/)
        .at(-1);
      // Existential/count wording ('were there shots on target?') is a subset;
      // copular outcome questions ('was the first shot on target?') are not.
      if (
        /\b(?:was|were|is|are|est|etait|etaient|sont|fue|fueron|es|eran|era|foi|foram|e|sao)\s+(?!there\b|il\s+y\b|hay\b|ha\b)[^.!?;,]{0,100}$/u.test(
          before,
        )
      )
        return false;
      if (
        new RegExp(
          bounded(`(?:all|every|tous les|toutes les|todos los|todos os|todas as) (?:${nouns})`),
          'u',
        ).test(text)
      )
        return false;
      return true;
    }),
  );
}

const rateConcept =
  /\b(?:accurate|accuracy|precision|precisao|percentage|percent|pourcentage|porcentaje|percentagem|completion rate|taux de reussite)\b/u;
const passingConcept = /\b(?:pass(?:ing|es)?|passes?|pases)\b/u;
// Separate independent requests before associating a measurement with its noun.
// These bounded EN/ES/FR/PT separators are a license, not a universal parser.
const metricClauses = (text) =>
  normalize(text)
    .split(
      /[.!?;,]|\b(?:and|et|y|e)\s+(?=(?:how|what|who|do|does|is|are|give|tell|show|combien|quel|qui|cuanto|cuanta|cual|quien|quanto|quanta|qual|quem)\b)/u,
    )
    .filter(Boolean);
const passingRateRequested = (text) =>
  metricClauses(text).some(
    (clause) =>
      passingConcept.test(clause) &&
      rateConcept.test(clause) &&
      (!unsupportedOperationMeasurementComponent(clause) ||
        /\b(?:passing accuracy|pass completion rate|accuracy of (?:the )?passes|precision (?:des|de los) passes|precisao dos passes)\b/u.test(
          clause,
        )),
  );
export function requestedUnavailableMeasurements(text) {
  const clauses = metricClauses(text);
  // The event capability contract explicitly lacks measured possession, pressing
  // and xG. An unfamiliar metric alone is NOT proof that it is unavailable.
  const found = [];
  // Readiness is an explicitly unrecorded player attribute, not something a
  // failed pass or an interception can establish. Keep causal/blame questions
  // distinct from known outcomes and identities in their other components.
  if (
    clauses.some(
      (clause) =>
        /\b(?:ready|readiness|unready|pret|prete|listo|lista|preparado|preparada|pronto|pronta)\b/u.test(
          clause,
        ) && /\b(?:because|why|reason|blame|pourquoi|parce que|porque|por que)\b/u.test(clause),
    )
  )
    found.push('readiness');
  for (const [name, dimension] of [
    ['possession', 'possession|posesion|posse'],
    ['pressing', 'pressing|pressure|pression|presion|pressao'],
    ['xG', 'xg|expected goals|goles esperados|gols esperados|buts attendus'],
  ]) {
    const measure =
      'percentage|percent|pourcentage|porcentaje|percentagem|accuracy|precision|precisao|rate|ratio|share';
    const attached = bounded(
      `(?:${dimension}) (?:${measure})|(?:${measure}) (?:(?:of|de|du|des|da|do|dos|the|la|el) ){0,3}(?:${dimension})`,
    );
    const requested =
      (name === 'xG' &&
        clauses.some((clause) =>
          matches(clause, bounded(dimension)).some((match) => !deniedBefore(clause, match.index)),
        )) ||
      clauses.some((clause) =>
        matches(clause, attached).some((match) => {
          // Additive negation asks for this measure as well; it does not exclude it.
          const additive =
            /(?:not only|not just|non seulement|pas seulement|pas uniquement|no solo|no solamente|nao apenas|nao so)\s+(?:(?:the|le|la|el|a|o)\s+)?$/u.test(
              clause.slice(0, match.index),
            );
          return additive || !deniedBefore(clause, match.index);
        }),
      );
    if (requested) found.push(name);
  }
  return found;
}
export function unsupportedOperationMeasurementComponent(text) {
  return requestedUnavailableMeasurements(text).length > 0;
}

/** Pure, total metric license. No model calls, fixture access, question catalog,
 * alias rewriting, answer-fact inheritance or user-language assumptions. */
export function allowedOperationMetrics(input = {}) {
  const current = normalize(input?.question),
    topic = topicFor(input),
    allowed = ['attempts', 'recoveries'];
  const changesInheritedScope =
    topic !== current &&
    /\b(?:not|without|excluding|except|pas|sans|sin|nao|sem|all)\b/u.test(current);
  const restrictedBlocked = broadens(topic) || broadens(current) || changesInheritedScope;
  const completionPattern = bounded(
    `(?:${completion}) (?:${passNoun})|(?:${passNoun}) (?:${completion})|pass completions?`,
  );
  const completionClause = topic
    .split(/[.!?;,]/)
    .some(
      (clause) =>
        new RegExp(bounded(passNoun), 'u').test(clause) &&
        new RegExp(bounded(completion), 'u').test(clause) &&
        !explicitTopic(clause.replace(new RegExp(bounded(passNoun), 'gu'), '')) &&
        !new RegExp(
          bounded(
            `(?:not|never|weren't|wasn't|isn't|aren't|nao|non|sans|sin) (?:\\p{L}+ ){0,2}(?:${completion})`,
          ),
          'u',
        ).test(clause),
    );
  if (
    !restrictedBlocked &&
    (matches(topic, completionPattern).some((match) => !deniedBefore(topic, match.index)) ||
      completionClause)
  )
    allowed.push('completedPasses');
  const scoring = bounded(
    `${goalNoun}|score|scored|marcaron|marcou|marquer|(?:a|ont|avait) marque`,
  );
  if (
    !restrictedBlocked &&
    matches(topic, scoring).some((match) => !deniedBefore(topic, match.index))
  )
    allowed.push('goals');
  if (!restrictedBlocked && nominalOnTarget(topic)) allowed.push('shotsOnTarget');
  if (
    !restrictedBlocked &&
    matches(topic, bounded(assistNoun)).some((match) => !deniedBefore(topic, match.index))
  )
    allowed.push('creditedAssists');
  if (!restrictedBlocked && passingRateRequested(topic)) allowed.push('passCompletionRate');
  return allowed;
}

// These licenses only restrict the optimized arithmetic route. Questions outside
// this deliberately small operation grammar still use free-form query planning.
// Entity licenses come from the request, never the latest event or answer text.
export function allowedOperationSubjects(input = {}) {
  const question = normalize(input?.question),
    roster = Array.isArray(input?.roster) ? input.roster : [],
    teams = input?.teams || {};
  const contains = (name) => {
    const value = normalize(name);
    return (
      value.length > 1 &&
      new RegExp(bounded(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'u').test(question)
    );
  };
  const namedPlayers = roster
    .filter((player) => {
      const name = normalize(player?.name),
        surname = name.split(/\s+/).at(-1);
      return (
        contains(name) ||
        (surname?.length > 2 &&
          roster.filter((other) => normalize(other?.name).split(/\s+/).at(-1) === surname)
            .length === 1 &&
          contains(surname))
      );
    })
    .map((player) => player.id)
    .filter((id) => typeof id === 'string');
  const namedTeams = ['home', 'away'].filter(
    (id) =>
      contains(teams[id]) ||
      new RegExp(
        bounded(id === 'home' ? 'home|domicile|local|casa' : 'away|visiteurs?|visitantes?|fora'),
        'u',
      ).test(question),
  );
  const teamComparison =
    new RegExp(
      bounded(
        'teams?|sides?|clubs?|both|each side|either side|equipes?|equipos?|times?|ambos|ambas|les deux|as duas',
      ),
      'u',
    ).test(question) || namedTeams.length === 2;
  const difference = [];
  if (teamComparison) difference.push(['home', 'away']);
  if (namedPlayers.length === 2) difference.push(namedPlayers);
  // A comparative follow-up can preserve the previous question's explicit scope.
  // No inherited subject is allowed when the new question names a different one.
  if (!difference.length && !namedPlayers.length && !namedTeams.length && deictic(question)) {
    const previous = Array.isArray(input?.conversation)
      ? input.conversation.at(-1)?.question
      : input?.previousQuestion;
    if (typeof previous === 'string' && previous !== input.question) {
      const inherited = allowedOperationSubjects({
        ...input,
        question: previous,
        conversation: [],
        previousQuestion: null,
      });
      difference.push(...inherited.difference);
    }
  }
  // Aggregate scope is a bounded lexical license, not a canned answer. One
  // explicit team remains scoped to that team even when described as combined.
  const combinedRatio = new RegExp(
    bounded(
      'combined|pooled|together|combinad[oa]s?|en conjunto|conjuntamente|reunies|reunis|ensemble|ambas equipes juntas|ambos equipos juntos',
    ),
    'u',
  ).test(question);
  const separateRatios = new RegExp(
    bounded(
      'each side|each team|per team|separately|respectively|cada equipo|cada time|cada equipe|chaque equipe|separement',
    ),
    'u',
  ).test(question);
  const ratio = namedPlayers.length
    ? []
    : namedTeams.length === 1
      ? [namedTeams]
      : combinedRatio
        ? [[]]
        : namedTeams.length === 2 || separateRatios
          ? [['home', 'away']]
          : [[], ['home', 'away']];
  return {
    difference,
    orderedEndpoints: [[], ...[...new Set([...namedPlayers, ...namedTeams])].map((id) => [id])],
    ratio,
  };
}

export function allowedOperationOperators(input = {}) {
  const question = normalize(input?.question),
    topic = topicFor(input);
  const ratio = allowedTypedOperationMetrics(input).includes('passCompletionRate');
  // These require different tools than a count difference or two endpoints.
  if (
    new RegExp(
      bounded(
        'why|pourquoi|por que|porque|standout|best|man of the match|player of the match|playing|lineup|offside|left foot|right foot|pied gauche|pied droit|pie izquierdo|pie derecho|pe esquerdo|pe direito|xg|probability|probabilite|probabilidad|probabilidade|speed|distance|vitesse|velocidad|velocidade|distancia',
      ),
      'u',
    ).test(question)
  )
    return [];
  if (unsupportedOperationMeasurementComponent(question)) return [];
  if (ratio) return allowedOperationSubjects(input).ratio.length ? ['ratio'] : [];
  if (
    new RegExp(bounded('accuracy|precision|precisao|percentage|percent|rate|ratio'), 'u').test(
      question,
    )
  )
    return [];
  const supportedTopic =
    /\b(?:shots?|attempts?|tirs?|tiros?|chutes?|tentativ(?:es?|as?)|intentos?|recover(?:y|ies)|recupera\w*|goals?|goles?|gols?|buts|assists?|asistencias?|assistencias?|pass(?:es)?|passes?|pases)\b/u.test(
      topic,
    );
  if (!supportedTopic || !allowedTypedOperationMetrics(input).length) return [];
  const result = [],
    subjects = allowedOperationSubjects(input);
  const first = /\b(?:first|earliest|premier\w*|primer\w*|primeir\w*)\b/u.test(question);
  const latest = /\b(?:latest|last|most recent|dernier\w*|ultim\w*)\b/u.test(question);
  if (first && latest) result.push('orderedEndpoints');
  const comparative =
    /\b(?:more|fewer|less|most|difference|gap|margin|lead\w*|level|tie\w*|equal|compare|comparison|plus|moins|ecart|egal\w*|compar\w*|mas|menos|diferencia|empat\w*|mais|diferenca|vantagem)\b/u.test(
      question,
    );
  if (comparative && subjects.difference.length) result.push('difference');
  return result;
}

export function allowedTypedOperationMetrics(input = {}) {
  const topic = topicFor(input),
    licensed = allowedOperationMetrics(input);
  const domains = {
    attempts: /\b(?:shots?|attempts?|tirs?|tiros?|chutes?|tentativ(?:es?|as?)|intentos?)\b/u,
    recoveries: /\b(?:recover(?:y|ies)|recupera\w*)\b/u,
    completedPasses: /\b(?:pass(?:es)?|passes?|pases|completion\w*)\b/u,
    goals: /\b(?:goals?|goles?|gols?|buts|scor\w*|marqu\w*|marcou|marcaron)\b/u,
    shotsOnTarget: /\b(?:shots?|attempts?|tirs?|tiros?|chutes?)\b/u,
    creditedAssists: /\b(?:assists?|assisted|asistencias?|assistencias?|decisiv\w*)\b/u,
    passCompletionRate: /\b(?:pass(?:ing|es)?|passes?|pases)\b/u,
  };
  if (licensed.includes('passCompletionRate')) return ['passCompletionRate'];
  return licensed.filter(
    (metric) =>
      domains[metric].test(topic) && !(metric === 'attempts' && licensed.includes('shotsOnTarget')),
  );
}

export function allowedOperationWindow(input = {}) {
  const question = normalize(input?.question);
  const explicit =
    /\b\d{1,3}:\d{2}\b|\b(?:\d+(?:\.\d+)?|half|thirty|sixty|trente|treinta|trinta|one|two|une?|dos|dois|uma?)\s*(?:seconds?|minutes?|secondes?|segundos?|minutos?)\b/u.test(
      question,
    );
  if (explicit) return { kind: 'explicit' };
  // Leave implicit periods and conversational relative windows to query planning,
  // rather than silently treating them as the whole received segment.
  if (
    /\b(?:since|before|after|between|recently|half time|halftime|second half|first half|depuis|avant|apres|entre|desde|antes|despues|apos|intervalo|last few|past few|recent play)\b/u.test(
      question,
    )
  )
    return null;
  if (!Number.isFinite(input?.time) || input.time < 0) return null;
  return { kind: 'full', from: 0, to: input.time };
}

// A deliberately narrow absolute-clock contract for query planning. This does
// not alter operation-window licensing or infer times from relative events.
export function explicitClockQueryWindow(input = {}) {
  const text = normalize(input.question),
    observed = input.time;
  if (!Number.isFinite(observed) || observed < 0) return null;
  const clocks = [...text.matchAll(/\b(\d{1,3}):([0-5]\d)\b/gu)];
  if (clocks.length !== 1 || [...text.matchAll(/\b\d+:\d+\b/gu)].length !== 1) return null;
  const boundary = [
    ...text.matchAll(
      /\b(before|avant|antes(?: de)?|after|apres|despues(?: de)?|apos|since|depuis|desde)\s+(\d{1,3}):([0-5]\d)\b/gu,
    ),
  ];
  if (boundary.length !== 1) return null;
  const prefix = text.slice(0, boundary[0].index),
    tail = text.slice(boundary[0].index + boundary[0][0].length);
  // A single clock does not give every independently requested measure the
  // same window. Decline global inference for competing whole-match scopes or
  // another question/clause. Only a clearly anaphoric identity follow-up is
  // allowed to share the bounded action set.
  if (
    /\b(?:overall|whole match|whole game|all game|entire match|entire game|au total|tout le match|toute la rencontre|ensemble du match|todo el partido|partido completo|en general|jogo inteiro|todo o jogo|partida inteira|no geral)\b/u.test(
      text,
    )
  )
    return null;
  if (
    /[,;?!]/u.test(prefix) ||
    /\b(?:and|et|y|e)\s+(?:how|what|which|combien|quel|quelle|cuantos?|cuantas?|que|quantos?|quantas?|qual)\b/u.test(
      prefix,
    )
  )
    return null;
  const remaining = tail
    .trim()
    .replace(/[?.!]+$/u, '')
    .trim();
  if (remaining) {
    const identity = remaining.replace(/^[,;?!]\s*/u, '').replace(/^(?:and|et|y|e)\s+/u, '');
    if (
      !/^(?:who|which player|qui|quel joueur|quien|quienes|que jugador|quem|qual jogador)\b/u.test(
        identity,
      ) ||
      !/\b(?:them|those|these|les|ceux|celles|los|las|esos|esas|os|as|esses|essas)\b/u.test(
        identity,
      ) ||
      /[,;?!]|\b(?:and|et|y|e)\b/u.test(identity)
    )
      return null;
  }
  // Other temporal clauses make a global window ambiguous. Identity follow-ups
  // may share this window, but a second timing demand must remain model-planned.
  const rest =
    text.slice(0, boundary[0].index) + text.slice(boundary[0].index + boundary[0][0].length);
  if (
    /\b(?:before|after|avant|apres|antes|despues|apos|since|depuis|desde|between|entre|until|jusqu|hasta|now|maintenant|ahora|agora|current|recent|last|first|second|dernier|premier|ultimo|primero)\b/u.test(
      rest,
    ) ||
    /\b\d+\s*(?:seconds?|minutes?|secondes?|segundos?|minutos?)\b/u.test(rest)
  )
    return null;
  const seconds = Number(boundary[0][2]) * 60 + Number(boundary[0][3]);
  if (seconds > observed) return null;
  const before = /^(?:before|avant|antes)/u.test(boundary[0][1]);
  const since = /^(?:since|depuis|desde)$/u.test(boundary[0][1]);
  return {
    timeFrom: before ? 0 : seconds,
    timeTo: before ? seconds : observed,
    timeFromExclusive: !before && !since,
    timeToExclusive: before,
  };
}

/** Pin only the first exact fronted request component. A later component
 * does not inherit this frame and may declare a different scope. */
export function explicitFrontedComponentWindow(input = {}, components = []) {
  if (
    !Array.isArray(components) ||
    components.length < 2 ||
    components.length > 3 ||
    typeof input.question !== 'string' ||
    new Set(components).size !== components.length ||
    components.some(
      (span) => typeof span !== 'string' || !span.trim() || !input.question.includes(span),
    )
  )
    return [];
  const first = normalize(components[0]);
  if (!normalize(input.question).startsWith(first)) return [];
  const frame =
    /^(before|avant|antes(?: de)?|after|apres|despues(?: de)?|apos|depois de|since|depuis|desde)\s+(\d{1,3}:[0-5]\d)\s*,\s*/u.exec(
      first,
    );
  if (!frame) return [];
  const body = first.slice(frame[0].length);
  // Competing event-relative/absolute frames in this component remain planned.
  if (
    /[,;?!]|\b(?:at|during|from|through|throughout|kickoff|kick off|halftime|half time|start|end|earlier|later|then|pendant|lors|durante|inicio|debut|fin)\b/u.test(
      body,
    )
  )
    return [];
  const relation = frame[1] === 'depois de' ? 'after' : frame[1];
  const window = explicitClockQueryWindow({
    question: body + ' ' + relation + ' ' + frame[2],
    time: input.time,
  });
  return window ? [{ requestSpan: components[0], window }] : [];
}

/** Exact component-owned absolute windows. A binding is opt-in only when all
 * supplied request components have one unambiguous clock and retain their
 * original text. It never assigns a query by array position or edits bounds. */
export function explicitComponentQueryWindows(input = {}, components = []) {
  if (
    !input ||
    typeof input.question !== 'string' ||
    !Number.isFinite(input.time) ||
    input.time < 0 ||
    !Array.isArray(components) ||
    components.length < 2 ||
    components.length > 3
  )
    return [];
  if (
    components.some(
      (span) =>
        typeof span !== 'string' ||
        !span.trim() ||
        !input.question.includes(span) ||
        /[\u0000-\u001f]/u.test(span),
    ) ||
    new Set(components).size !== components.length
  )
    return [];
  // A clock outside these exact spans may qualify a different clause. Do not
  // discard it and pretend the remaining components establish ownership.
  const clocks = (text) => [...text.matchAll(/\b\d+:\d+\b/gu)].length;
  if (clocks(input.question) !== components.length) return [];
  const bindings = [];
  for (const requestSpan of components) {
    const text = normalize(requestSpan);
    if (clocks(text) !== 1) return [];
    const relations = [
      ...text.matchAll(
        /\b(before|avant|antes(?: de)?|after|apres|despues(?: de)?|apos|since|depuis|desde)\s+(\d{1,3}):([0-5]\d)\b/gu,
      ),
    ];
    if (relations.length !== 1) return [];
    const relation = relations[0],
      prefix = text.slice(0, relation.index),
      suffix = text.slice(relation.index + relation[0].length);
    if (
      deniedBefore(text, relation.index) ||
      /\b(?:at or|on or|up to and)\s*$/u.test(prefix) ||
      /\binclusive(?:ly)?\b/u.test(suffix)
    )
      return [];
    const rest = prefix + ' ' + suffix;
    if (
      /\b(?:before|after|since|avant|apres|antes|despues|apos|depuis|desde|between|entre|until|jusqu|hasta|overall|whole match|whole game|entire match|entire game|all game|au total|tout le match|todo el partido|jogo inteiro|no geral|recently|recent|last|first half|second half|dernier|ultimo)\b/u.test(
        rest,
      ) ||
      /\b\d+\s*(?:seconds?|minutes?|secondes?|segundos?|minutos?)\b/u.test(rest)
    )
      return [];
    const seconds = Number(relation[2]) * 60 + Number(relation[3]);
    if (seconds > input.time) return [];
    const before = /^(?:before|avant|antes)/u.test(relation[1]),
      since = /^(?:since|depuis|desde)$/u.test(relation[1]);
    bindings.push({
      requestSpan,
      window: {
        timeFrom: before ? 0 : seconds,
        timeTo: before ? seconds : input.time,
        timeFromExclusive: !before && !since,
        timeToExclusive: before,
      },
    });
  }
  return bindings;
}
