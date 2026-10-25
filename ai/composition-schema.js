import { strictObject, answerSchema } from './answer-schema.js';
import { GenerationError } from '../ai.js';
import { linkedRecoveryContextFacts } from '../question-linked-context.js';

export function contextualActionProof(proof, reference) {
  if (!proof || !['event', 'ordered-event'].includes(proof.kind)) return false;
  const event = proof.kind === 'ordered-event' ? proof.event : proof;
  return (
    !event?.attributes &&
    (!reference || (event?.eventId === reference.id && event?.revision === reference.revision))
  );
}
export const attackingMeasureKey = (proof) =>
  JSON.stringify([
    proof.metric,
    proof.timeFrom,
    proof.timeTo,
    !!proof.timeFromExclusive,
    !!proof.timeToExclusive,
  ]);
export function attackingComparisons(manifest, requestedEvidence = []) {
  const candidates = (manifest?.facts || []).filter(
    (fact) =>
      fact.proof.kind === 'team-comparison' &&
      fact.proof.assessmentBounds === 'this-measure-only' &&
      ['attempts', 'shotsOnTarget'].includes(fact.proof.metric) &&
      requestedEvidence.some(
        (source) =>
          source.query.timeFrom === fact.proof.timeFrom &&
          source.query.timeTo === fact.proof.timeTo &&
          !!source.query.timeFromExclusive === !!fact.proof.timeFromExclusive &&
          !!source.query.timeToExclusive === !!fact.proof.timeToExclusive,
      ),
  );
  const unique = new Map();
  for (const fact of candidates) {
    const key = attackingMeasureKey(fact.proof);
    if (!unique.has(key)) unique.set(key, fact);
  }
  return [...unique.values()];
}
export function sourceScopedSequenceFacts(manifest, requestedEvidence = []) {
  return (manifest?.facts || []).filter(
    (fact) =>
      fact.proof?.modelGenerated === false &&
      ['linked-shot-supply', 'linked-goal-sequence'].includes(fact.proof.kind) &&
      Number.isFinite(fact.proof.time) &&
      requestedEvidence.some((source) => {
        const query = source.query;
        if (
          !query ||
          !Number.isFinite(query.timeFrom) ||
          !Number.isFinite(query.timeTo) ||
          fact.proof.time < query.timeFrom ||
          fact.proof.time > query.timeTo ||
          (query.timeFromExclusive && fact.proof.time === query.timeFrom) ||
          (query.timeToExclusive && fact.proof.time === query.timeTo)
        )
          return false;
        return (source.rows || []).some((row) =>
          (fact.claim.evidence || []).some(
            (ref) => ref.type === 'event' && ref.id === row.id && ref.revision === row.revision,
          ),
        );
      }),
  );
}
export function endpointStoryExtraRequirements(packet) {
  if (packet.requestedSourceAttributes?.length || packet.requiredResponseForms?.length) return true;
  if (
    (packet.requestedEvidence || []).some((source) =>
      ['bodyPart', 'passType', 'technique', 'recoveryKind', 'linkedShotOutcome'].some(
        (field) => source.query?.filters?.[field] != null,
      ),
    )
  )
    return true;
  const text = String(packet.question || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  // A complete chronological story does not supply a separately requested
  // technique, physical attribute, measurement, intention or alternative.
  return /\b(?:foot|feet|body|technique|type|style|distance|length|speed|pace|number|height|age|nationality|position|why|reason|choose|chose|instead|alternative|pied|pieds|corps|genre|vitesse|longueur|numero|taille|nationalite|pourquoi|choisi|plutot|cuerpo|tecnica|tipo|estilo|distancia|longitud|velocidad|dorsal|altura|nacionalidad|porque|alternativa|pe|pes|corpo|comprimento|velocidade|camisola|nacionalidade|escolheu)\b/u.test(
    text,
  );
}
export function compositionSchema(
  manifest,
  requestedForm,
  explanationTarget = null,
  answerFocus = null,
  context = {},
) {
  const ids = { $ref: '#/$defs/canonicalFactId' },
    claim = structuredClone(answerSchema.properties.claims.items);
  claim.properties.kind.enum = ['interpretation', 'limitation', 'general'];
  claim.properties.text.maxLength = 600;
  if (requestedForm === 'assessment') {
    claim.properties.text.description =
      'One or two complete sentences giving the qualified conclusion only. The selected application facts already supply exact counts and clocks. Do not repeat those observations in this paragraph.';
  }
  if (requestedForm === 'explanation')
    claim.properties.text.description =
      'Give only the concise conclusion or unknown requested detail. Exact selected observations are displayed separately. Do not repeat their actors/actions/counts/clocks/foot/technique in this paragraph. A credited assist can establish active contribution without inferring location or intent.';
  if (['assessment', 'explanation'].includes(requestedForm))
    claim.properties.text.description +=
      ' Goalkeeper-hold collections identify who gathered saved shots, not exhaustive personal save totals. Compare recorded collections or shots faced only; do not say a keeper saved more shots or made more saves. Match quantities must appear only in selected factIds, never in this paragraph. For saved shots the shot actor is the shooter, not the goalkeeper who saved it. A goalkeeper-hold recovery identifies the collecting player; an opponent-count identifies the defending team.';
  claim.properties.text.description =
    (claim.properties.text.description || '') +
    ' Write only a short qualitative judgment or qualification. Exact quantities and timestamps belong in selected factIds. Use a selected source-linked fact for a requested buildup example, not a new action description here.';
  claim.properties.evidence.maxItems = 0;
  claim.properties.dependsOn.description =
    'Interpretations only: distinct zero-based indices of the selected factIds supporting this paragraph. Other kinds use [].';
  const limitation = structuredClone(claim);
  limitation.properties.kind.enum = ['limitation'];
  limitation.properties.dependsOn.maxItems = 0;
  const modes = [];
  let focusedModes = null;
  if (manifest.facts.length) {
    const limitations = manifest.facts.filter(
        (fact) =>
          fact.proof.kind === 'capability-limitation' &&
          (explanationTarget === 'causal-attribution'
            ? fact.proof.attributes.includes('who forced a mistake or turnover')
            : !fact.proof.attributes.includes('who forced a mistake or turnover')),
      ),
      events = manifest.facts.filter((fact) =>
        contextualActionProof(fact.proof, context.requestedEventReference),
      );
    if (requestedForm === 'explanation' && limitations.length) {
      const queries = context.requestedEvidence || [];
      const causalLookup =
        explanationTarget === 'causal-attribution' &&
        !context.repair &&
        context.componentCount <= 2 &&
        queries.length > 0 &&
        queries.every(
          (source) =>
            source.query?.aggregate === 'list' &&
            ['pass', 'recovery'].includes(source.query.filters?.type),
        );
      // A recovery lookup can contain an over-specific model-chosen subtype.
      // Context is selected from current verified events, never inferred from a
      // zero query result. Match its requested action, actor, team and time; the
      // independent question review still owns whether that context is useful.
      let contextEvents = causalLookup
        ? events.filter((fact) =>
            queries.some((source) => {
              const q = source.query,
                p = fact.proof.kind === 'ordered-event' ? fact.proof.event : fact.proof,
                actor = source.entityResolution?.player?.canonicalId || q.filters.player;
              return (
                p.eventType === 'recovery' &&
                (!actor || p.playerId === actor) &&
                (!q.filters.team || p.team === q.filters.team) &&
                (!Number.isFinite(q.timeFrom) ||
                  p.time > q.timeFrom ||
                  (p.time === q.timeFrom && !q.timeFromExclusive)) &&
                (!Number.isFinite(q.timeTo) ||
                  p.time < q.timeTo ||
                  (p.time === q.timeTo && !q.timeToExclusive))
              );
            }),
          )
        : events;
      if (causalLookup) {
        const linked = linkedRecoveryContextFacts(
          events,
          queries,
          context.recordedActionLinks || [],
        );
        if (linked.length) contextEvents = linked;
      }
      const known = strictObject({
        mode: { type: 'string', enum: ['known-limitation'] },
        contextFactIds: {
          type: 'array',
          minItems: causalLookup && contextEvents.length ? 1 : 0,
          maxItems: contextEvents.length ? 1 : 0,
          items: contextEvents.length
            ? { type: 'string', enum: contextEvents.map((fact) => fact.id) }
            : { type: 'string' },
          description:
            'Select the actual referenced action if it is recorded, not a statistic or an unrelated event.',
        },
        limitationFactId: {
          type: 'string',
          enum: limitations.map((fact) => fact.id),
          description:
            'Select the relevant recorded-schema limitation instead of writing the same uncertainty again.',
        },
      });
      modes.push(known);
      if (causalLookup && contextEvents.length) focusedModes = [known];
    }
    if (!['assessment', 'explanation'].includes(requestedForm))
      modes.push(
        strictObject({
          mode: { type: 'string', enum: ['facts'] },
          factIds: { type: 'array', minItems: 1, maxItems: 4, items: ids },
        }),
      );
    const stories =
      explanationTarget === 'observed-sequence'
        ? sourceScopedSequenceFacts(manifest, context.requestedEvidence)
        : manifest.facts.filter((fact) =>
            ['linked-goal-sequence', 'linked-shot-supply'].includes(fact.proof.kind),
          );
    if (requestedForm === 'explanation' && stories.length)
      modes.push(
        strictObject({
          mode: { type: 'string', enum: ['facts'] },
          factIds: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: { type: 'string', enum: stories.map((fact) => fact.id) },
          },
        }),
      );
    const comparisons = manifest.facts.filter((fact) => fact.proof.kind === 'team-comparison');
    const playerIds = new Set((context.roster || []).map((player) => player.id));
    const supports = manifest.facts.filter(
      (fact) =>
        fact.proof.kind === 'credited-goal-assist' ||
        (fact.proof.kind === 'event' &&
          !fact.proof.attributes &&
          fact.proof.actionOutcome?.status === 'goal') ||
        (playerIds.has(fact.proof.subjectId) &&
          ((fact.proof.kind === 'shooting-profile' && fact.proof.operands?.[0]?.value > 0) ||
            (fact.proof.kind === 'count' &&
              fact.proof.value > 0 &&
              [
                'goals',
                'attempts',
                'shotsOnTarget',
                'completedPasses',
                'ballWins',
                'creditedAssists',
              ].includes(fact.proof.metric)))),
    );
    if (
      (!context.repair || context.pickBasisOnly) &&
      requestedForm === 'assessment' &&
      answerFocus === 'player-assessment' &&
      !['observed-sequence', 'decision-rationale'].includes(explanationTarget) &&
      context.explicitPlayerCount === 0 &&
      context.componentCount === 1 &&
      supports.length &&
      context.roster?.length
    )
      focusedModes = context.roster.flatMap((player) => {
        const own = supports.filter(
          (fact) =>
            (fact.proof.kind === 'credited-goal-assist'
              ? fact.proof.assisterId
              : fact.proof.subjectId || fact.proof.playerId) === player.id,
        );
        return own.length
          ? [
              strictObject({
                mode: { type: 'string', enum: ['player-pick'] },
                playerId: { type: 'string', enum: [player.id] },
                factIds: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: { type: 'string', enum: own.map((fact) => fact.id) },
                  description:
                    'Select the strongest relevant positive contribution by your provisional pick. Prefer a goal or explicit assist when decisive; do not select a team total or an unrelated player.',
                },
              }),
            ]
          : [];
      });
    const requestedScopes = new Set(
      (context.requestedEvidence || []).map((source) => JSON.stringify(source.scopeReference)),
    );
    const involvement = manifest.facts.filter(
      (fact) =>
        fact.proof.kind === 'count' &&
        playerIds.has(fact.proof.subjectId) &&
        fact.proof.value > 0 &&
        ['completedPasses', 'passes', 'receptions', 'ballWins'].includes(fact.proof.metric) &&
        requestedScopes.has(JSON.stringify(fact.proof.scope)),
    );
    if (
      !context.repair &&
      requestedForm === 'assessment' &&
      answerFocus === 'player-assessment' &&
      explanationTarget === 'observed-sequence' &&
      context.componentCount === 1 &&
      context.explicitPlayerCount === 0 &&
      involvement.length
    )
      focusedModes = [
        strictObject({
          mode: { type: 'string', enum: ['metric-player-pick'] },
          playerId: { type: 'string', enum: context.roster.map((player) => player.id) },
          factIds: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: { type: 'string', enum: involvement.map((fact) => fact.id) },
            description:
              'Choose the player contribution relevant to this involvement request. The application explicitly qualifies the pick by its measure, not overall player quality.',
          },
        }),
      ];
    const attacking = attackingComparisons(manifest, context.requestedEvidence);
    if (
      !context.repair &&
      requestedForm === 'explanation' &&
      answerFocus === 'team-attacking-assessment' &&
      attacking.length
    ) {
      const measures = new Set(attacking.map((fact) => attackingMeasureKey(fact.proof))).size;
      if (measures <= 3) {
        const boundary = structuredClone(limitation);
        boundary.properties.text.description =
          'Answer only the requested qualitative boundary: attempt volume and shots on target do not measure chance quality. The selected comparisons already display exact counts and leaders. Do not repeat numbers, add a buildup example, or claim possession, pressing, dominance or scoring probability.';
        focusedModes = [
          strictObject({
            mode: { type: 'string', enum: ['explanation'] },
            factIds: {
              type: 'array',
              minItems: measures,
              maxItems: measures,
              items: { type: 'string', enum: attacking.map((fact) => fact.id) },
              description:
                'Select one complete comparison for each supplied requested measure and window. Do not choose unrelated pass/recovery totals or a source-linked buildup that was not requested.',
            },
            claim: boundary,
          }),
        ];
      }
    }

    const facing = comparisons.filter((fact) => fact.proof.metric === 'shotsOnTargetFaced');
    if (
      ['assessment', 'explanation'].includes(requestedForm) &&
      answerFocus === 'player-performance' &&
      context.explicitPlayerCount === 0 &&
      facing.length &&
      (context.requestedEvidence || []).some(
        (source) => source.query?.filters?.type === 'shot' && !source.query.filters.player,
      )
    ) {
      const roleFacts = manifest.facts.filter(
        (fact) =>
          facing.includes(fact) ||
          fact.proof.kind === 'shot-outcome-profile' ||
          (fact.proof.kind === 'count' && fact.proof.metric === 'savedAttemptCollections'),
      );
      modes.push(
        strictObject({
          mode: { type: 'string', enum: ['facts'] },
          factIds: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', enum: roleFacts.map((fact) => fact.id) },
            description:
              'A qualified shots-faced comparison can answer which end has had more on-target work. Use the exact outcome partition when distinguishing blocks, saves and wide attempts. This cannot rate keeping ability, general workload or shot quality; use explanation or limitation when those are actually requested.',
          },
        }),
      );
    }
    if (
      requestedForm === 'assessment' &&
      answerFocus === 'team-attacking-assessment' &&
      attacking.length
    )
      focusedModes = [
        strictObject({
          mode: { type: 'string', enum: ['facts'] },
          factIds: {
            type: 'array',
            minItems: Math.min(
              4,
              new Set(attacking.map((fact) => attackingMeasureKey(fact.proof))).size,
            ),
            maxItems: 4,
            items: { type: 'string', enum: attacking.map((fact) => fact.id) },
            description:
              'Select the qualified attempts and shots-on-target comparisons available for the requested window, including both measures when supplied. A measured tie is a valid answer. These comparisons establish only those measures, never chance quality, scoring probability, pressing intensity or possession. Do not add speculative prose.',
          },
        }),
      ];
    if (
      requestedForm === 'assessment' &&
      answerFocus === 'team-attacking-assessment' &&
      attacking.length &&
      context.componentCount > 1 &&
      context.operationCoverageRecovery
    ) {
      const uncertainty = structuredClone(limitation),
        measureCount = new Set(attacking.map((f) => attackingMeasureKey(f.proof))).size;
      uncertainty.properties.dependsOn = { type: 'array', maxItems: 0, items: { type: 'integer' } };
      uncertainty.properties.text.description =
        'Give only the specific unmeasured conclusion or limitation requested. The selected facts already print the counts. Do not repeat any numbers, measured absence, shot outcomes or team comparison in this paragraph.';
      if (measureCount <= 3)
        focusedModes.push(
          strictObject({
            mode: { type: 'string', enum: ['explanation'] },
            factIds: {
              type: 'array',
              minItems: measureCount,
              maxItems: measureCount,
              items: { type: 'string', enum: attacking.map((f) => f.id) },
              description:
                'Select exactly one complete verified comparison for each supplied measure and window. Preserve the full required set during repair; the separate paragraph supplies only the missing limitation.',
            },
            claim: uncertainty,
          }),
        );
    }
    if (
      requestedForm === 'assessment' &&
      answerFocus === 'team-assessment' &&
      context.componentCount > 1 &&
      context.operationCoverageRecovery
    ) {
      const requestedMeasure = (proof) =>
        manifest.facts.some(
          (f) =>
            f.proof.kind === 'count' &&
            f.proof.modelGenerated === false &&
            f.proof.metric === proof.metric &&
            requestedScopes.has(JSON.stringify(f.proof.scope)) &&
            f.proof.timeFrom === proof.timeFrom &&
            f.proof.timeTo === proof.timeTo &&
            !!f.proof.timeFromExclusive === !!proof.timeFromExclusive &&
            !!f.proof.timeToExclusive === !!proof.timeToExclusive &&
            !f.proof.qualifiers,
        );
      const requestedComparisons = comparisons.filter(
        (fact) =>
          fact.proof.modelGenerated === false &&
          fact.proof.assessmentBounds === 'this-measure-only' &&
          (requestedMeasure(fact.proof) ||
            (context.recoveredOperationProofs || []).some(
              (operation) =>
                operation.operator === 'difference' &&
                operation.status === 'proved' &&
                operation.metric === fact.proof.metric &&
                operation.window?.from === fact.proof.timeFrom &&
                operation.window?.to === fact.proof.timeTo &&
                new Set([operation.values?.left?.id, operation.values?.right?.id]).size === 2 &&
                [operation.values?.left?.id, operation.values?.right?.id].every((id) =>
                  ['home', 'away'].includes(id),
                ),
            )),
      );
      if (requestedComparisons.length && requestedComparisons.length <= 3) {
        const uncertainty = structuredClone(limitation);
        uncertainty.properties.text.description =
          'State only the requested conclusion or limitation of the measurement. The selected canonical comparisons already print the exact totals and window. Do not repeat numerical counts or introduce other measures.';
        focusedModes = [
          strictObject({
            mode: { type: 'string', enum: ['explanation'] },
            factIds: {
              type: 'array',
              minItems: requestedComparisons.length,
              maxItems: requestedComparisons.length,
              items: { type: 'string', enum: requestedComparisons.map((fact) => fact.id) },
            },
            claim: uncertainty,
          }),
        ];
      }
    }
    if (
      requestedForm === 'assessment' &&
      !['player-assessment', 'player-performance'].includes(answerFocus) &&
      context.componentCount === 1 &&
      comparisons.some((fact) =>
        fact.proof.operands.every((operand) => requestedScopes.has(JSON.stringify(operand.scope))),
      )
    )
      modes.push(
        strictObject({
          mode: { type: 'string', enum: ['facts'] },
          factIds: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: {
              type: 'string',
              enum: comparisons
                .filter((fact) =>
                  fact.proof.operands.every((operand) =>
                    requestedScopes.has(JSON.stringify(operand.scope)),
                  ),
                )
                .map((fact) => fact.id),
            },
          },
        }),
      );
    for (
      let count = 1;
      count <= 3 && manifest.facts.some((fact) => fact.claim.kind === 'observation');
      count++
    ) {
      const interpretation = structuredClone(claim),
        nonInterpretive = structuredClone(claim);
      interpretation.properties.kind.enum = ['interpretation'];
      interpretation.properties.dependsOn = {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: { type: 'integer', enum: Array.from({ length: count }, (_v, index) => index) },
      };
      nonInterpretive.properties.kind.enum = ['limitation', 'general'];
      nonInterpretive.properties.dependsOn = {
        type: 'array',
        maxItems: 0,
        items: { type: 'integer' },
      };
      // Explanatory support must be observation evidence. Capability boundaries
      // remain selectable as facts or known limitations, never as dependencies.
      const observed = manifest.facts.filter(
        (fact) =>
          fact.claim.kind === 'observation' ||
          (fact.proof.modelGenerated === false &&
            ['linked-shot-supply', 'linked-goal-sequence'].includes(fact.proof.kind)),
      );
      if (observed.length)
        modes.push(
          strictObject({
            mode: { type: 'string', enum: ['explanation'] },
            factIds: {
              type: 'array',
              minItems: count,
              maxItems: count,
              items: { type: 'string', enum: observed.map((fact) => fact.id) },
            },
            claim: { anyOf: [interpretation, nonInterpretive] },
          }),
        );
    }
  }
  modes.push(
    strictObject({
      mode: { type: 'string', enum: ['limitation'] },
      factIds: { type: 'array', maxItems: 0, items: { type: 'string' } },
      claim: limitation,
    }),
  );
  const passing = manifest.facts.filter((f) => f.proof.kind === 'pass-completion-profile');
  if (
    context.passAccuracyRequested &&
    context.resolvedPlayerIds?.length === 1 &&
    context.componentCount === 1 &&
    passing.length
  )
    focusedModes = [
      strictObject({
        mode: { type: 'string', enum: ['facts'] },
        factIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { type: 'string', enum: passing.map((f) => f.id) },
          description:
            'The application-computed confirmed-outcome completion rate answers passing accuracy directly. Select the requested player and window; do not repeat its values in prose.',
        },
      }),
    ];
  const zeroGoals = manifest.facts.filter(
    (f) =>
      f.proof.kind === 'count' &&
      f.proof.metric === 'goals' &&
      f.proof.value === 0 &&
      context.resolvedPlayerIds?.includes(f.proof.subjectId),
  );
  const goalRoles = manifest.facts.filter(
    (f) =>
      f.proof.kind === 'credited-goal-assist' &&
      zeroGoals.some((z) => z.proof.subjectId === f.proof.assisterId) &&
      f.proof.assisterId !== f.proof.scorerId,
  );
  if (requestedForm === 'explanation' && zeroGoals.length && goalRoles.length)
    modes.push(
      strictObject({
        mode: { type: 'string', enum: ['facts'] },
        factIds: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'string', enum: [...zeroGoals, ...goalRoles].map((f) => f.id) },
          description:
            'A matching zero-goal proof and credited-assist fact explicitly identify the actual scorer and the named player’s different role. Both are required; do not repeat their numerical facts in prose.',
        },
      }),
    );
  const zeroActions = manifest.facts.filter(
    (f) =>
      f.proof.kind === 'count' &&
      f.proof.value === 0 &&
      ['attempts', 'passes'].includes(f.proof.metric) &&
      context.resolvedPlayerIds?.includes(f.proof.subjectId),
  );
  const correctionMode = strictObject({
    mode: { type: 'string', enum: ['no-action-correction'] },
    factIds: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'string',
        enum: zeroActions.length ? zeroActions.map((f) => f.id) : ['unavailable'],
      },
      description:
        'Select the complete zero-action proof for the person and action assumed by the question only when premiseCheck is contradicted. The application renders the correction; do not add adjacent events.',
    },
  });
  if (context.componentCount === 1 && zeroActions.length) {
    if (context.contradicted) focusedModes = [correctionMode];
    else if (explanationTarget === 'decision-rationale' && context.resolvedPlayerIds?.length === 1)
      focusedModes = [
        correctionMode,
        ...modes.filter((m) => m.properties.mode.enum.includes('known-limitation')),
      ];
  }
  if (
    requestedForm === 'assessment' &&
    answerFocus === 'team-attacking-assessment' &&
    (!attackingComparisons(manifest, context.requestedEvidence).length ||
      new Set(
        attackingComparisons(manifest, context.requestedEvidence).map((fact) =>
          attackingMeasureKey(fact.proof),
        ),
      ).size > 4)
  )
    focusedModes = modes.filter((mode) =>
      mode.properties.mode.enum.some((name) =>
        ['limitation', 'unavailable-roster-attribute'].includes(name),
      ),
    );
  const definitions = manifest.facts.filter(
    (fact) => fact.proof.kind === 'shot-outcome-definition',
  );
  if (explanationTarget === 'statistic-definition' && requestedForm === 'explanation') {
    if (!definitions.length)
      throw new GenerationError(
        'No source definition was established by the validated action query.',
        502,
        'question-invalid-fact-selection',
      );
    focusedModes = [
      strictObject({
        mode: { type: 'string', enum: ['facts'] },
        factIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { type: 'string', enum: definitions.map((fact) => fact.id) },
          description:
            'Select the source-contract definition only. Do not add prose, event counts or physical-work inferences.',
        },
      }),
    ];
  }
  if (requestedForm === 'fact' && context.requestComponents?.length === 1 && !focusedModes)
    modes.push(
      strictObject({
        mode: { type: 'string', enum: ['unavailable-roster-attribute'] },
        requestSpan: { type: 'string', enum: [context.requestComponents[0]] },
        sourceField: {
          type: 'string',
          pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,59}$',
          description:
            'The unavailable roster field actually requested. It must be absent from the exposed roster contract and all roster rows. No invented role-holder or event fact is selected.',
        },
      }),
    );
  const schema = strictObject({
    premiseCheck: structuredClone(answerSchema.properties.premiseCheck),
    scope: structuredClone(answerSchema.properties.scope),
    composition: {
      anyOf:
        focusedModes ||
        (['decision-rationale', 'causal-attribution'].includes(explanationTarget) &&
        context.componentCount === 1 &&
        modes.some((mode) => mode.properties.mode.enum.includes('known-limitation'))
          ? modes.filter((mode) => mode.properties.mode.enum.includes('known-limitation'))
          : modes),
    },
    followUp: structuredClone(answerSchema.properties.followUp),
  });
  // The observed actor took the referenced action, but the trusted schema does
  // not establish their alternatives. That is unknown, not a disproof that a
  // pass was possible. Do not let an internal guess force a redundant rewrite.
  if (
    context.requestedEventPlayerId &&
    (context.resolvedPlayerIds || []).every((id) => id === context.requestedEventPlayerId) &&
    schema.properties.composition.anyOf.every((mode) =>
      mode.properties.mode.enum.includes('known-limitation'),
    )
  )
    schema.properties.premiseCheck.properties.conclusion = {
      type: 'string',
      enum: ['unknown'],
      description:
        'The referenced action is recorded for this actor, but intentions and passing options are unavailable. The action does not contradict the possibility of an alternative.',
    };
  if (
    explanationTarget === 'causal-attribution' &&
    schema.properties.composition.anyOf.every((mode) =>
      mode.properties.mode.enum.includes('known-limitation'),
    )
  ) {
    schema.properties.premiseCheck.properties.conclusion = {
      type: 'string',
      enum: ['unknown'],
      description:
        'The selected source boundary proves causal attribution is unavailable, not that the cause was false. The action itself is separately verified.',
    };
  }
  // A multipart request for an observed sequence needs an actual source-linked
  // sequence slot. An assist identity or an isolated pass cannot replace it.
  const sequenceStories = sourceScopedSequenceFacts(manifest, context.requestedEvidence).filter(
    (fact) =>
      !context.resolvedPlayerIds?.length ||
      context.resolvedPlayerIds.some((id) =>
        [
          fact.proof.supplierId,
          fact.proof.playerId,
          fact.proof.scorerId,
          fact.proof.assisterId,
        ].includes(id),
      ),
  );
  if (
    requestedForm === 'explanation' &&
    explanationTarget === 'observed-sequence' &&
    context.componentCount > 1 &&
    sequenceStories.length &&
    (context.repair || answerFocus !== 'team-attacking-assessment')
  ) {
    const sequenceModes = [];
    for (let count = 1; count <= 3; count++) {
      const qualitative = structuredClone(claim);
      qualitative.properties.kind.enum = ['interpretation'];
      qualitative.properties.dependsOn = {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: { type: 'integer', enum: Array.from({ length: count }, (_v, index) => index) },
      };
      sequenceModes.push(
        strictObject({
          mode: { type: 'string', enum: ['sequence-explanation'] },
          sequenceFactId: {
            type: 'string',
            enum: sequenceStories.map((fact) => fact.id),
            description:
              'The source-proved action sequence answering the requested buildup. This is displayed first and is dependency index zero.',
          },
          factIds: {
            type: 'array',
            minItems: count - 1,
            maxItems: count - 1,
            items: ids,
            description:
              'Only additional distinct facts needed for the other requested parts, after the sequence at index zero.',
          },
          claim: qualitative,
        }),
      );
    }
    schema.properties.composition.anyOf = sequenceModes;
  }
  const endpointStories = sequenceStories.filter(
    (fact) =>
      fact.proof.eventId === context.requestedNamedShot?.id &&
      fact.proof.revision === context.requestedNamedShot?.revision,
  );
  if (
    (!context.repair || context.closedEndpointStoryId) &&
    requestedForm === 'explanation' &&
    explanationTarget === 'observed-sequence' &&
    context.componentCount === 1 &&
    !context.requestedSourceAttributes?.length &&
    !context.endpointStoryExtraRequirements &&
    context.requestedNamedShot &&
    endpointStories.length === 1
  ) {
    // This single source-proved story already answers the bounded buildup.
    // Unrelated global facts and a repeated qualitative paragraph add no
    // requested information. A complete endpoint-bound chain retains this
    // shape through repair; independent relevance/support review still runs.
    schema.properties.composition.anyOf = [
      strictObject({
        mode: { type: 'string', enum: ['facts'] },
        factIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { type: 'string', enum: [endpointStories[0].id] },
        },
      }),
    ];
  }
  const selectable = manifest.facts.filter(
    (fact) =>
      requestedForm !== 'explanation' ||
      fact.claim.kind === 'observation' ||
      (fact.proof.modelGenerated === false &&
        ['linked-shot-supply', 'linked-goal-sequence'].includes(fact.proof.kind)),
  );
  if (
    selectable.length &&
    schema.properties.composition.anyOf.some((mode) => mode.properties.factIds?.items?.$ref)
  )
    schema.$defs = { canonicalFactId: { type: 'string', enum: selectable.map((fact) => fact.id) } };
  return schema;
}
