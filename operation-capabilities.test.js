import test from 'node:test';
test('ordinal minute comparisons never license a full-match operation window', () => {
  for (const question of [
    'Compare the first minute with the second minute. Which team had more shots in each?',
    'Which team had more passes in the third minute?',
    'Compare la première minute avec la deuxième minute.',
    'Compara el primer minuto con el segundo minuto.',
  ])
    assert.equal(allowedOperationWindow({ question, time: 120 }), null);
});
import assert from 'node:assert/strict';
import {
  requestedUnavailableMeasurements,
  unsupportedOperationMeasurementComponent,
  allowedOperationMetrics,
  allowedTypedOperationMetrics,
  allowedOperationOperators,
  allowedOperationSubjects,
  allowedOperationWindow,
  operationMetricPolicyDescription,
} from './operation-capabilities.js';

const allowed = (question, options = {}) => allowedOperationMetrics({ question, ...options });
const permits = (question, metric, options) =>
  assert.ok(allowed(question, options).includes(metric), question);
const denies = (question, metric, options) =>
  assert.ok(!allowed(question, options).includes(metric), question);

test('adjectival passing accuracy permits completion rate without licensing other accuracy metrics', () => {
  permits('How accurate has Cole’s passing been?', 'passCompletionRate');
  denies('How accurate has Cole’s shooting been?', 'passCompletionRate');
  denies('Show all passes, not just accurate passes.', 'passCompletionRate');
});

test('unqualified shots retain all attempts, not an on-target or goal-only inventory', () => {
  for (const question of [
    'Compare the first shot with the latest shot.',
    'How did the earliest attempt turn out?',
    'Comparez le premier tir et le dernier.',
    'Compara el primer tiro con el último.',
    'Compare a primeira tentativa com a última.',
    'What happened at 01:04 and 01:38?',
  ]) {
    assert.deepEqual(allowed(question), ['attempts', 'recoveries'], question);
  }
  assert.match(operationMetricPolicyDescription, /not universal natural-language entailment/);
});

test('nominal on-target subsets are licensed in four languages and independent of response language', () => {
  for (const question of [
    'How many shots on target?',
    'Compare the first on-target shot with the latest.',
    'Were there any shots on target?',
    'Combien de tirs cadrés ?',
    'Compare les tirs cadres.',
    '¿Cuántos tiros a puerta hubo?',
    'Quantos chutes no alvo?',
    'Compare os tiros à baliza.',
  ])
    permits(question, 'shotsOnTarget');
  permits('Compare on-target shots.', 'shotsOnTarget', { language: 'fr' });
});

test('asking an individual shot outcome never licenses a filtered historical timeline', () => {
  for (const question of [
    'Was the first shot on target?',
    'Is his latest shot on target?',
    'Was Reed’s first shot on target?',
    'Did the first shot go on target?',
    'Was it on target?',
    'Le premier tir était-il cadré ?',
    'Était-ce un tir cadré ?',
    '¿Fue el primer tiro a puerta?',
    'Foi o primeiro chute no alvo?',
  ])
    denies(question, 'shotsOnTarget');
});

test('negated, excluded and broadened subsets are not licensed', () => {
  for (const question of [
    'Compare all shots, including shots on target.',
    'Not just on-target shots: compare the first and latest.',
    'Compare shots, not only shots on target.',
    'Compare non on-target shots.',
    'Compare shots not on target.',
    'Compare shots excluding on-target shots.',
    'Comparez tous les tirs, y compris les tirs cadrés.',
    'Compara todos los tiros, no solo los tiros a puerta.',
    'Compare todos os chutes, incluindo chutes no alvo.',
  ])
    denies(question, 'shotsOnTarget');
  for (const question of [
    'How many passes were not completed?',
    'Which passes weren’t completed?',
    'How many passes were not fully completed?',
    'Compare passes, not just completed passes.',
    'Show failed passes instead of completed passes.',
  ])
    denies(question, 'completedPasses');
});

test('explicit completion, goals and credits license their filters across all supported languages', () => {
  const samples = {
    completedPasses: [
      'Compare completed passes.',
      'Are pass completions level?',
      'Compare pass completion.',
      'How many passes has Cole completed?',
      'Compare successful passes.',
      '¿Cuántos pases completó Cole?',
      'Compare les passes réussies.',
      'Quantos passes completos?',
    ],
    goals: [
      'Who scored the goals?',
      'Compare confirmed goals.',
      '¿Cuántos goles?',
      'Combien de buts ?',
      'Qui a marqué un but ?',
      'Quantos gols?',
    ],
    creditedAssists: [
      'Compare credited assists.',
      'Who assisted that goal?',
      '¿Cuántas asistencias?',
      'Compare les passes décisives.',
      'Quantas assistências?',
    ],
  };
  for (const [metric, questions] of Object.entries(samples))
    for (const question of questions) permits(question, metric);
});

test('English but is not a French goal token and qualifiers need actual metric context', () => {
  for (const question of [
    'Compare the shots, but include both outcomes.',
    'But what happened first?',
    'The pass was late, but accurate.',
  ])
    denies(question, 'goals', { language: 'fr' });
  for (const question of [
    'What happened on target?',
    'Compare target positions.',
    'How did it turn out?',
    'Give me the successful outcome.',
    'How much clinical edge did they have?',
  ]) {
    denies(question, 'shotsOnTarget');
    denies(question, 'completedPasses');
  }
  permits('Combien de buts ?', 'goals');
  permits('Est-ce un but ?', 'goals');
});

test('irrelevant clock and window wording cannot create restrictive metric permission', () => {
  assert.deepEqual(allowed('Compare shots on either side of 00:30, from first to latest.'), [
    'attempts',
    'recoveries',
  ]);
  assert.deepEqual(allowed('Compare the first and latest shots after a successful minute.'), [
    'attempts',
    'recoveries',
  ]);
  permits('Compare completed passes from 00:30 to 01:20.', 'completedPasses');
  permits('Compare shots on target during the last thirty seconds.', 'shotsOnTarget');
});

test('current explicit topic overrides history and answers cannot supply metric permission', () => {
  const conversation = [
    {
      question: 'Who has completed more passes?',
      answer: 'Northbridge has more completed passes and goals.',
    },
  ];
  assert.deepEqual(allowed('And shots?', { conversation }), ['attempts', 'recoveries']);
  permits('And the other side?', 'completedPasses', { conversation });
  denies('And the other side?', 'goals', { conversation });
  assert.deepEqual(allowed('And possession?', { conversation }), ['attempts', 'recoveries']);
  assert.deepEqual(allowed('And shots?', { previousQuestion: 'How many shots on target?' }), [
    'attempts',
    'recoveries',
  ]);
  permits('Et les mêmes ?', 'shotsOnTarget', {
    conversation: [{ question: 'Combien de tirs cadrés ?' }],
  });
  permits('And now?', 'completedPasses', {
    conversation: [{ question: 'Compare completed passes.' }, { question: 'And the other side?' }],
  });
  denies('And now?', 'completedPasses', {
    conversation: [{ question: 'Compare completed passes.' }, { question: 'What is a low block?' }],
  });
  denies('And not just those?', 'shotsOnTarget', {
    conversation: [{ question: 'Compare shots on target.' }],
  });
  denies('And all of them?', 'completedPasses', { conversation });
});

test('mixed explicit concepts may license both filters, unfamiliar paraphrases never get silently translated', () => {
  const mixed = allowed('Compare completed passes and credited assists.');
  assert.ok(mixed.includes('completedPasses'));
  assert.ok(mixed.includes('creditedAssists'));
  assert.ok(!mixed.includes('shotsOnTarget'));
  denies('Compare passes and successful shots.', 'completedPasses');
  for (const question of [
    'Compare their clinical efforts.',
    'How much did they threaten?',
    'Compare deliveries that found a friend.',
    'Compare the first effort that tested the keeper with the latest.',
  ])
    assert.deepEqual(allowed(question), ['attempts', 'recoveries']);
  for (const input of [
    undefined,
    null,
    {},
    [],
    { question: 42 },
    { question: '', conversation: [null] },
  ])
    assert.deepEqual(allowedOperationMetrics(input), ['attempts', 'recoveries']);
});

const scope = {
  teams: { home: 'Northbridge', away: 'Harbour Athletic' },
  roster: [
    { id: 'h1', name: 'J. Cole' },
    { id: 'h2', name: 'M. Costa' },
    { id: 'a1', name: 'L. Costa' },
    { id: 'a2', name: 'D. Silva' },
  ],
};
test('operation grammar leaves qualitative, unary, roster and unsupported filters to free-form planning', () => {
  for (const question of [
    'Why did Cole not pass there?',
    'Who has been the standout so far, and why?',
    'Who last played a pass with the left foot?',
    'Did that shot count? What is the score now?',
    'What is offside?',
    'Is Messi playing in either lineup?',
    'Which side has more passes with the right foot?',
    'Compare the first and latest shots by xG.',
    'Compare the speed of the first and latest shots.',
  ]) {
    assert.deepEqual(allowedOperationOperators({ ...scope, question }), [], question);
  }
  assert.deepEqual(
    allowedOperationOperators({
      ...scope,
      question: 'Compare the first shot with the latest shot.',
    }),
    ['orderedEndpoints'],
  );
  assert.deepEqual(
    allowedOperationOperators({
      ...scope,
      question: 'Which team has completed more passes, and by how many?',
    }),
    ['difference'],
  );
});
test('typed metrics cannot silently cross from passes to shots or recoveries', () => {
  assert.deepEqual(
    allowedTypedOperationMetrics({ question: 'Which team has completed more passes?' }),
    ['completedPasses'],
  );
  assert.deepEqual(allowedTypedOperationMetrics({ question: 'Compare first and latest shots.' }), [
    'attempts',
  ]);
  assert.deepEqual(
    allowedTypedOperationMetrics({ question: 'Compare first and latest shots on target.' }),
    ['shotsOnTarget'],
  );
  assert.deepEqual(
    allowedTypedOperationMetrics({ question: 'Compare first and latest passes.' }),
    [],
  );
  assert.deepEqual(allowedTypedOperationMetrics({ question: 'Which side has more recoveries?' }), [
    'recoveries',
  ]);
});
test('global questions cannot inherit a player from the current event; ambiguous surnames are unlicensed', () => {
  assert.deepEqual(
    allowedOperationSubjects({
      ...scope,
      question: 'Compare the first and latest shots.',
      selectedAnchor: 'a2',
      recentActions: [{ player: 'a2' }],
    }),
    { difference: [], orderedEndpoints: [[]], ratio: [[], ['home', 'away']] },
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'Compare Costa’s first and latest shots.' })
      .orderedEndpoints,
    [[]],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'Compare Silva’s first and latest shots.' })
      .orderedEndpoints,
    [[], ['a2']],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'Compare Cole and Silva on completed passes.' })
      .difference,
    [['h1', 'a2']],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'Which side has more shots?' }).difference,
    [['home', 'away']],
  );
});
test('follow-ups inherit only explicit question scope, never fabricated entities from answer prose', () => {
  const conversation = [
    { question: 'Which team has completed more passes?', answer: 'Cole leads Silva.' },
  ];
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'And what is the gap in shots?', conversation })
      .difference,
    [['home', 'away']],
  );
  assert.deepEqual(
    allowedOperationOperators({
      ...scope,
      question: 'And what is the gap in shots?',
      conversation,
    }),
    ['difference'],
  );
  assert.deepEqual(
    allowedOperationSubjects({
      ...scope,
      question: 'Compare first and latest shots.',
      conversation,
    }).orderedEndpoints,
    [[]],
  );
});
test('operation windows cannot narrow a full received-match question without a time request', () => {
  assert.deepEqual(
    allowedOperationWindow({ question: 'Compare first and latest shots.', time: 110 }),
    { kind: 'full', from: 0, to: 110 },
  );
  for (const question of [
    'Which side has more shots in the last 30 seconds?',
    'Compare shots from 00:30 to 01:10.',
    'Which side has more shots over the last half minute?',
  ])
    assert.deepEqual(allowedOperationWindow({ question, time: 110 }), { kind: 'explicit' });
  for (const question of [
    'Compare shots since halftime.',
    'Which side has had more shots recently?',
    'Compare shots in the last few minutes.',
  ])
    assert.equal(allowedOperationWindow({ question, time: 110 }), null);
});
test('pass percentage requests use a ratio, with raw counts and other percentage domains kept distinct', () => {
  for (const question of [
    'What is the passing accuracy for each side?',
    'What is the pass completion rate?',
    'Quel est le pourcentage de passes réussies ?',
    '¿Cuál es el porcentaje de pases completados?',
    'Qual é a precisão dos passes?',
  ]) {
    assert.deepEqual(
      allowedTypedOperationMetrics({ ...scope, question }),
      ['passCompletionRate'],
      question,
    );
    assert.deepEqual(allowedOperationOperators({ ...scope, question }), ['ratio'], question);
  }
  assert.deepEqual(
    allowedOperationOperators({ ...scope, question: 'Why is the pass completion rate low?' }),
    [],
  );
  assert.deepEqual(
    allowedOperationOperators({ ...scope, question: 'What is Cole’s passing accuracy?' }),
    [],
  );
  assert.deepEqual(
    allowedOperationOperators({ ...scope, question: 'Which team has better shot accuracy?' }),
    [],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'What is Northbridge’s passing accuracy?' })
      .ratio,
    [['home']],
  );
  assert.deepEqual(
    allowedTypedOperationMetrics({ ...scope, question: 'Which team has completed more passes?' }),
    ['completedPasses'],
  );
});

test('ratio scope permits true combined results without confusing explicit individual teams', () => {
  for (const question of [
    'What is the combined passing accuracy?',
    'What is the pooled pass completion rate?',
    '¿Cuál es la precisión combinada de los pases?',
    'Quel est le pourcentage de passes réussies des deux équipes réunies ?',
    'Qual é a precisão combinada dos passes?',
  ])
    assert.deepEqual(allowedOperationSubjects({ ...scope, question }).ratio, [[]], question);
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'What is the passing accuracy?' }).ratio,
    [[], ['home', 'away']],
  );
  for (const question of [
    'What is the passing accuracy for each side?',
    'Quel est le pourcentage de passes pour chaque équipe ?',
    'What is the passing accuracy separately?',
  ])
    assert.deepEqual(
      allowedOperationSubjects({ ...scope, question }).ratio,
      [['home', 'away']],
      question,
    );
  assert.deepEqual(
    allowedOperationSubjects({
      ...scope,
      question: 'What is Northbridge’s combined passing accuracy?',
    }).ratio,
    [['home']],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'What is Cole’s combined passing accuracy?' })
      .ratio,
    [],
  );
  assert.deepEqual(
    allowedOperationSubjects({ ...scope, question: 'What is the uncombined passing accuracy?' })
      .ratio,
    [[], ['home', 'away']],
    'Aggregate token must be bounded',
  );
});
import {
  explicitClockQueryWindow,
  explicitComponentQueryWindows,
  explicitFrontedComponentWindow,
} from './operation-capabilities.js';

test('component-owned clocks preserve inclusive since and strict before or after without positional inference', () => {
  const components = ['How many shots since 00:20', 'how many passes before 00:50'];
  const input = { question: components.join(', and '), time: 80 };
  const expected = [
    {
      requestSpan: components[0],
      window: { timeFrom: 20, timeTo: 80, timeFromExclusive: false, timeToExclusive: false },
    },
    {
      requestSpan: components[1],
      window: { timeFrom: 0, timeTo: 50, timeFromExclusive: false, timeToExclusive: true },
    },
  ];
  assert.deepEqual(explicitComponentQueryWindows(input, components), expected);
  assert.deepEqual(
    explicitComponentQueryWindows(input, components.toReversed()),
    expected.toReversed(),
    'Bindings follow their exact span, not query position',
  );
  for (const word of ['since', 'depuis', 'desde'])
    assert.deepEqual(
      explicitClockQueryWindow({ question: `Count shots ${word} 00:20`, time: 80 }),
      expected[0].window,
    );
  const repeated = ['How many passes since 00:20', 'what is the passing accuracy since 00:20'];
  assert.ok(
    explicitComponentQueryWindows({ question: repeated.join(' and '), time: 80 }, repeated).every(
      (binding) => binding.window.timeFrom === 20 && !binding.window.timeFromExclusive,
    ),
  );
  for (const [relation, exclusive] of [
    ['after', true],
    ['après', true],
    ['después de', true],
    ['após', true],
    ['since', false],
    ['depuis', false],
    ['desde', false],
  ]) {
    const parts = [`Count shots ${relation} 00:20`, 'count passes before 00:50'];
    const bound = explicitComponentQueryWindows({ question: parts.join(' and '), time: 80 }, parts);
    assert.equal(bound.length, 2, relation);
    assert.equal(bound[0].window.timeFromExclusive, exclusive, relation);
  }
});

test('component clock contracts decline missing, conflicting, future, malformed or detached timing', () => {
  for (const first of [
    'How many shots before 00:99',
    'How many shots before 02:00',
    'How many shots not before 00:20',
    'How many shots at or before 00:20',
    'How many shots before 00:20 inclusive',
    'How many shots before 00:20 overall',
    'How many shots between 00:20 and 00:30',
    'How many shots after 00:20 in the last 5 seconds',
    'How many shots',
  ]) {
    const components = [first, 'how many passes before 00:50'];
    assert.deepEqual(
      explicitComponentQueryWindows({ question: components.join(' and '), time: 80 }, components),
      [],
      first,
    );
  }
  const components = ['How many shots before 00:20', 'how many passes after 00:50'];
  assert.deepEqual(
    explicitComponentQueryWindows(
      { question: 'Since 00:10, ' + components.join(' and '), time: 80 },
      components,
    ),
    [],
    'Dropped timing prefix cannot be reassigned',
  );
  assert.deepEqual(
    explicitComponentQueryWindows({ question: components.join(' and '), time: 80 }, [
      'Invented request before 00:20',
      components[1],
    ]),
    [],
  );
  for (const input of [null, undefined, {}, { question: 'x', time: -1 }])
    assert.deepEqual(explicitComponentQueryWindows(input, components), []);
});

test('single absolute query clock licenses exact exclusive seconds without altering operation windows', () => {
  for (const word of ['before', 'avant', 'antes', 'antes de'])
    assert.deepEqual(
      explicitClockQueryWindow({ question: `Count passes ${word} 00:15`, time: 15 }),
      { timeFrom: 0, timeTo: 15, timeFromExclusive: false, timeToExclusive: true },
    );
  for (const word of ['after', 'après', 'después de', 'após'])
    assert.deepEqual(
      explicitClockQueryWindow({ question: `Count passes ${word} 01:05`, time: 118 }),
      { timeFrom: 65, timeTo: 118, timeFromExclusive: true, timeToExclusive: false },
    );
  for (const question of [
    'before 00:15 and after 00:05',
    'between 00:05 and 00:15',
    'before the shot at 00:15',
    'after 00:15 who passed before the second shot?',
    'before 00:15 and in the last 5 seconds',
    'before 00:99',
    'before 00:30',
    'before 00:15, and who scores now?',
  ])
    assert.equal(explicitClockQueryWindow({ question, time: 15 }), null, question);
  assert.equal(explicitClockQueryWindow({ question: 'before 00:15' }), null);
  assert.deepEqual(allowedOperationWindow({ question: 'before 00:15', time: 15 }), {
    kind: 'explicit',
  });
});

test('one clock never globally narrows an independently scoped quantity or ratio', () => {
  const mixed = [
    'How many completed passes before 00:15, and how many shots overall?',
    'How many completed passes before 00:15, and what is the overall passing accuracy?',
    'How many completed passes before 00:15 and how many shots?',
    'How many shots, and how many passes before 00:15?',
    'Combien de passes avant 00:15, et combien de tirs sur tout le match ?',
    'Combien de passes avant 00:15 et quel est le taux de réussite ?',
    '¿Cuántos pases antes de 00:15 y cuántos tiros en todo el partido?',
    'Cuantos pases antes de 00:15 y cual es la precision de pase?',
    'Quantos passes antes de 00:15 e quantos chutes no jogo inteiro?',
    'Quantos passes antes de 00:15 e qual e a precisao dos passes?',
    'Count passes before 00:15 and shots',
  ];
  for (const question of mixed)
    assert.equal(explicitClockQueryWindow({ question, time: 118 }), null, question);
  for (const question of [
    'How many crosses before 00:15, and who attempted them?',
    'Combien de centres avant 00:15, et qui les a tentés ?',
    'Cuantos centros antes de 00:15 y quien los intento?',
    'Quantos cruzamentos antes de 00:15 e quem os tentou?',
  ])
    assert.deepEqual(
      explicitClockQueryWindow({ question, time: 118 }),
      { timeFrom: 0, timeTo: 15, timeFromExclusive: false, timeToExclusive: true },
      question,
    );
});

test('measurement identity stays clause-local across unknown percentage and known completed counts', () => {
  for (const question of [
    "Do we know Northbridge's possession percentage yet, and how many passes have they completed?",
    'How many passes have they completed, and what is their possession percentage?',
    'Quel est le pourcentage de possession, et combien de passes réussies ?',
    '¿Cuál es el porcentaje de posesión, y cuántos pases completados?',
    'Qual é a percentagem de posse, e quantos passes completos?',
  ]) {
    assert.ok(!allowedOperationMetrics({ question }).includes('passCompletionRate'));
    assert.deepEqual(allowedOperationOperators({ question }), []);
    assert.ok(unsupportedOperationMeasurementComponent(question));
  }
  for (const question of [
    'What percentage of passes were completed?',
    'How accurate has Cole’s passing been?',
    'What is their passing accuracy, and how many passes were completed?',
    'Quel est le pourcentage de passes réussies ?',
    '¿Cuál es el porcentaje de pases completados?',
    'Qual é a precisão dos passes?',
  ])
    assert.ok(allowedOperationMetrics({ question }).includes('passCompletionRate'), question);
  assert.equal(
    unsupportedOperationMeasurementComponent('What is the shot conversion percentage?'),
    false,
    'unrecognized capability is not assumed unavailable',
  );
  assert.equal(
    unsupportedOperationMeasurementComponent('How many times did they regain possession?'),
    false,
    'action count is not measured possession share',
  );
  assert.ok(
    !allowedOperationMetrics({ question: 'Possession percentage and completed passes' }).includes(
      'passCompletionRate',
    ),
  );
});

test('unmeasured metric obligations do not absorb negated or unrelated possession mentions', () => {
  for (const question of [
    'Give passing accuracy, not possession percentage.',
    'Who regained possession and what is the passing accuracy?',
    'Give passing accuracy, excluding possession percentage.',
  ])
    assert.equal(unsupportedOperationMeasurementComponent(question), false, question);
});

test('passing measurement contextual possession or pressure qualifiers do not change its metric', () => {
  for (const question of [
    'What is passing accuracy while in possession?',
    'What is the pass completion percentage under pressure?',
    'What percentage of passes were completed under pressure?',
  ]) {
    assert.ok(allowedOperationMetrics({ question }).includes('passCompletionRate'), question);
    assert.equal(unsupportedOperationMeasurementComponent(question), false, question);
  }
});

test('additive not-only measurement requests retain their unavailable component without reversing true exclusions', () => {
  for (const question of [
    'Give not only possession percentage but also completed passes.',
    'Not only possession percentage, but how many passes were completed?',
    'Not just the possession percentage, also completed passes.',
    'Non seulement le pourcentage de possession, mais les passes réussies.',
    'No solo el porcentaje de posesión, también los pases completados.',
    'Não apenas a percentagem de posse, mas também passes completos.',
  ])
    assert.equal(unsupportedOperationMeasurementComponent(question), true, question);
  for (const question of [
    'Give completed passes, not possession percentage.',
    'Give not only completed passes but excluding possession percentage.',
    'Give not just completed passes but without possession percentage.',
    'Non le pourcentage de possession.',
    'Sem percentagem de posse.',
    'Sin porcentaje de posesión.',
  ])
    assert.equal(unsupportedOperationMeasurementComponent(question), false, question);
});

test('explicit xG metric is a source-contract unavailable measurement without requiring percentage wording', () => {
  assert.equal(unsupportedOperationMeasurementComponent('what is his xG for that spell'), true);
  assert.equal(unsupportedOperationMeasurementComponent('what are his expected goals'), true);
  assert.equal(unsupportedOperationMeasurementComponent('Give shots, not xG'), false);
});

test('requested source-absent dimensions retain exact identity and genuine exclusions', () => {
  assert.deepEqual(requestedUnavailableMeasurements('Possession percentage and xG'), [
    'possession',
    'xG',
  ]);
  assert.deepEqual(requestedUnavailableMeasurements('Passing accuracy while in possession'), []);
  assert.deepEqual(requestedUnavailableMeasurements('Shots, not xG'), []);
  assert.deepEqual(requestedUnavailableMeasurements('Shot conversion percentage'), []);
});

test('fronted review window pins only its owning component and leaves later scopes independent', () => {
  const parts = [
    'Since 00:18, how many passes are unresolved',
    'what is their completion percentage',
  ];
  const input = { question: parts.join(', and ') + '?', time: 90 };
  const expected = [
    {
      requestSpan: parts[0],
      window: { timeFrom: 18, timeTo: 90, timeFromExclusive: false, timeToExclusive: false },
    },
  ];
  assert.deepEqual(explicitFrontedComponentWindow(input, parts), expected);
  const independent = [parts[0], 'how many passes were completed at kickoff'];
  assert.deepEqual(
    explicitFrontedComponentWindow(
      { ...input, question: independent.join(', and ') + '?' },
      independent,
    ),
    expected,
    'later kickoff clause must not inherit the first window',
  );
  for (const [word, from, to, left, right] of [
    ['Before', 0, 18, false, true],
    ['After', 18, 90, true, false],
    ['Depuis', 18, 90, false, false],
    ['Desde', 18, 90, false, false],
  ]) {
    const components = [word + ' 00:18, how many passes are unresolved', parts[1]];
    assert.deepEqual(
      explicitFrontedComponentWindow(
        { question: components.join(', and ') + '?', time: 90 },
        components,
      ),
      [
        {
          requestSpan: components[0],
          window: { timeFrom: from, timeTo: to, timeFromExclusive: left, timeToExclusive: right },
        },
      ],
    );
  }
  for (const first of [
    'Since 00:18, how many passes at kickoff',
    'Since 00:18, how many passes in the last 5 seconds',
    'Since 00:99, how many passes',
    'Since 01:31, how many passes',
    'Since 00:18, how many passes before 00:30',
  ]) {
    const components = [first, parts[1]];
    assert.deepEqual(
      explicitFrontedComponentWindow(
        { question: components.join(', and ') + '?', time: 90 },
        components,
      ),
      [],
      first,
    );
  }
});

test('readiness cause questions request the absent attribute rather than proving blame from an outcome', () => {
  for (const q of [
    "Did the pass fail because he wasn't ready?",
    'Pourquoi la passe a-t-elle échoué parce que le joueur était prêt ?',
    '¿Falló el pase porque no estaba listo?',
    'O passe falhou porque ele não estava preparado?',
  ])
    assert.ok(requestedUnavailableMeasurements(q).includes('readiness'), q);
  for (const q of [
    'Who received the pass?',
    'Ignore readiness and tell me who intercepted.',
    'What does being ready mean?',
  ])
    assert.ok(!requestedUnavailableMeasurements(q).includes('readiness'), q);
});

test('shooting percentages license shot-share arithmetic without licensing conversion or passing ratios', () => {
  for (const question of [
    'What percentage of all shots was on target?',
    'De todos los tiros del partido, que porcentaje fue a puerta?',
    'Quel pourcentage des tirs est cadre ?',
    'Qual percentagem dos remates foi no alvo?',
  ]) {
    // Portuguese remates is included in the explicit shot-domain grammar.
    assert.ok(allowedOperationMetrics({ question }).includes('shotOnTargetRate'), question);
    assert.deepEqual(allowedOperationOperators({ question }), ['ratio']);
  }
  for (const question of [
    'What percentage of shots became goals?',
    'What percentage of passes was completed?',
    'Were those shots on target?',
  ])
    assert.ok(!allowedOperationMetrics({ question }).includes('shotOnTargetRate'), question);
  assert.equal(
    unsupportedOperationMeasurementComponent('Who played the longest completed pass?'),
    true,
  );
  assert.equal(
    unsupportedOperationMeasurementComponent('Who played the latest completed pass?'),
    false,
  );
});
