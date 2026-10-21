import { performance } from 'node:perf_hooks';
import { GenerationError } from './ai.js';
import { createInvestigationTools } from './investigation-tools.js';
import { runLocalPacket, localModel } from './local-ai.js';
import { storyFacts } from './story-facts.js';
import { storyContextRequirement, validateStoryContext } from './story-context.js';
import { renderFactStory } from './fact-renderer.js';
import {
  requiredStoryTools,
  storyRequirements,
  validateRequiredStoryFacts,
} from './story-requirements.js';

/** Local SDK selects tools/facts and reviews relevance. The application owns
 * canonical wording and citations; model editorial approval is not truth proof.
 */
export async function investigateLocalFactStory(
  input,
  { runner = runLocalPacket, signal: callerSignal } = {},
) {
  const registry = createInvestigationTools(input, { compactPositions: true }),
    started = performance.now(),
    expiresAt = Date.now() + 180000;
  const deadline = AbortSignal.timeout(180000),
    signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  const maximum = ['newcomer', 'player'].includes(registry.audience) ? 3 : 5;
  const allOutputs = Object.fromEntries(
    registry.definitions.map((d) => [d.function.name, registry.execute(d.function.name, {})]),
  );
  const trace = [],
    frameworkTrace = [],
    usage = { promptTokens: 0, completionTokens: 0 };
  let workerCalls = 0,
    modelCalls = 0,
    usageReportedCalls = 0,
    repairCount = 0;
  const checkSignal = () => {
    if (callerSignal?.aborted) throw new GenerationError('Local generation was cancelled.', 499);
    if (signal.aborted)
      throw new GenerationError('Local fact investigation exceeded its 180-second deadline.', 504);
  };
  const run = async (mode, payload) => {
    checkSignal();
    if (workerCalls >= 5)
      throw new GenerationError('Local fact investigation exceeded its worker-call budget.');
    workerCalls++;
    let result;
    try {
      result = await runner(
        {
          mode,
          scope: registry.scope,
          audience: registry.audience,
          preferences: registry.preferences,
          language: registry.language,
          ...payload,
        },
        { signal, timeoutMs: Math.max(1, expiresAt - Date.now()) },
      );
    } catch (error) {
      checkSignal();
      throw error;
    }
    checkSignal();
    if (
      !result ||
      result.modelCalls !== 1 ||
      !Number.isFinite(result.elapsedMs) ||
      result.elapsedMs < 0 ||
      !Array.isArray(result.tools)
    )
      throw new GenerationError('Invalid local fact worker execution metadata.');
    const reported = result.usageReportedCalls ?? 0;
    if (
      ![0, 1].includes(reported) ||
      (reported === 1 &&
        (!result.usage ||
          !Number.isSafeInteger(result.usage.promptTokens) ||
          result.usage.promptTokens < 0 ||
          !Number.isSafeInteger(result.usage.completionTokens) ||
          result.usage.completionTokens < 0))
    )
      throw new GenerationError('Invalid local fact worker token metadata.');
    if (mode !== 'fact-tool-selector' && result.tools.length)
      throw new GenerationError(
        'A local fact selection or review worker invoked unexpected tools.',
      );
    modelCalls++;
    usageReportedCalls += reported;
    if (reported) {
      usage.promptTokens += result.usage.promptTokens;
      usage.completionTokens += result.usage.completionTokens;
    }
    trace.push({ stage: mode, type: 'model', modelCalls: 1, elapsedMs: result.elapsedMs });
    if (Array.isArray(result.trace))
      frameworkTrace.push({ mode, trace: structuredClone(result.trace) });
    return result;
  };
  const selectedTools = await run('fact-tool-selector', { outputs: allOutputs });
  const plan = selectedTools.raw,
    names = plan?.tools;
  if (
    !plan ||
    typeof plan !== 'object' ||
    Array.isArray(plan) ||
    Object.keys(plan).length !== 1 ||
    !Array.isArray(names) ||
    names.length < 1 ||
    names.length > 4 ||
    names.some((name) => typeof name !== 'string' || !Object.hasOwn(allOutputs, name)) ||
    new Set(names).size !== names.length ||
    !names.includes('get_event_sequence') ||
    selectedTools.tools.length !== names.length ||
    selectedTools.tools.some((name, index) => name !== names[index])
  )
    throw new GenerationError('Invalid local fact evidence-tool selection or execution trace.');
  const outputs = Object.fromEntries(names.map((name) => [name, registry.execute(name, {})]));
  for (const name of names)
    trace.push({
      stage: 'fact-tool-selector',
      type: 'tool',
      name,
      referenceCount: outputs[name].references.length,
    });
  const audienceTools =
    registry.audience === 'analyst'
      ? ['get_match_patterns']
      : registry.audience === 'spatial'
        ? ['measure_moment']
        : [];
  const applicationRequiredTools = [
    ...new Set([
      ...requiredStoryTools(outputs.get_event_sequence, registry.anchorId),
      ...audienceTools,
    ]),
  ].filter((name) => !names.includes(name));
  for (const name of applicationRequiredTools) {
    outputs[name] = registry.execute(name, {});
    trace.push({
      stage: 'application-required-evidence',
      type: 'tool',
      name,
      referenceCount: outputs[name].references.length,
    });
  }
  const catalog = storyFacts(outputs, registry.scope);
  const requirements = storyRequirements(catalog, registry.anchorId);
  const contextRequirement = storyContextRequirement(catalog, registry.audience);
  const contextSlots = {
    candidateSlots: contextRequirement.candidateFactIds.map(
      (id) => catalog.facts.findIndex((fact) => fact.id === id) + 1,
    ),
    minimum: contextRequirement.minimum,
    reason: contextRequirement.reason,
  };
  const requiredSlots = requirements.requiredFactIds.map(
    (id) => catalog.facts.findIndex((fact) => fact.id === id) + 1,
  );
  const selectionCapacity = {
    maximumFacts: maximum,
    mandatoryFactCount: requiredSlots.length,
    optionalFactCapacity: maximum - requiredSlots.length,
  };
  const selectionContext = {
    requiredSlots,
    mandatorySlots: requiredSlots,
    selectionCapacity,
    maximum,
    requiredFactAmbiguity: requirements.ambiguity,
    contextRequirement: contextSlots,
  };
  trace.push({
    stage: 'application-story-requirements',
    type: 'domain-rules',
    ...requirements,
    selectionCapacity,
  });
  const compact = {
    facts: catalog.facts.map((fact, index) => ({
      slot: index + 1,
      kind: fact.kind,
      values: fact.values,
    })),
    scope: catalog.scope,
    limitation: catalog.limitation,
  };
  trace.push({ stage: 'fact-catalog', type: 'catalog', factCount: catalog.facts.length });
  function validate(raw) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      !Object.hasOwn(raw, 'slots') ||
      !Array.isArray(raw.slots) ||
      raw.slots.length < 1 ||
      raw.slots.length > maximum ||
      raw.slots.some(
        (slot) => !Number.isSafeInteger(slot) || slot < 1 || slot > catalog.facts.length,
      ) ||
      new Set(raw.slots).size !== raw.slots.length
    )
      throw new GenerationError(
        `Return only slots with one to ${maximum} unique current integer slots; no prose or extra fields.`,
      );
    const facts = raw.slots.map((slot) => catalog.facts[slot - 1]);
    if (facts[0].kind !== 'moment' || facts[0].values.anchorId !== registry.anchorId)
      throw new GenerationError('The selected anchor moment slot must be first.');
    const ids = facts.map((f) => f.id);
    try {
      validateRequiredStoryFacts(ids, requirements);
      validateStoryContext(ids, contextRequirement);
    } catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      throw new GenerationError(error.message);
    }
    let rendered;
    try {
      rendered = renderFactStory(catalog, ids, {
        language: registry.language.code,
        audience: registry.audience,
      });
    } catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      throw new GenerationError(`Selected local facts cannot be rendered: ${error.message}`);
    }
    return { slots: [...raw.slots], ids, facts, rendered };
  }
  const verdict = (raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 2 ||
      !['approve', 'revise'].includes(raw.decision) ||
      !Array.isArray(raw.issues) ||
      raw.issues.length > 8 ||
      raw.issues.some(
        (issue) => typeof issue !== 'string' || !issue.trim() || issue.length > 500,
      ) ||
      (raw.decision === 'approve' && raw.issues.length) ||
      (raw.decision === 'revise' && !raw.issues.length)
    )
      return {
        decision: 'revise',
        issues: [
          'The local editorial reviewer returned an invalid decision; a valid review is required.',
        ],
      };
    return raw;
  };
  let accepted = null,
    issues = [],
    repair = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const selection = await run('fact-selection', {
      catalog: compact,
      ...selectionContext,
      repair,
    });
    try {
      accepted = validate(selection.raw);
      issues = [];
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      accepted = null;
      issues = [error.message];
      trace.push({ stage: 'selection-validation', type: 'rejection', issues });
    }
    if (accepted) {
      const response = await run('fact-editorial-review', {
        catalog: compact,
        ...selectionContext,
        selectedSlots: accepted.slots,
        renderedClaims: accepted.rendered.claims,
      });
      const review = verdict(response.raw);
      trace.push({
        stage: 'fact-editorial-review',
        type: 'decision',
        decision: review.decision,
        issues: review.issues,
      });
      if (review.decision === 'approve') break;
      issues = review.issues;
      repair = { issues, previousSlots: accepted.slots };
      accepted = null;
    } else repair = { issues, previousSlots: [] };
    if (attempt === 0) repairCount++;
  }
  checkSignal();
  return {
    source: 'microsoft-agent-framework-ollama-fact-workflow',
    provider: 'local',
    model: localModel,
    evidenceSource: 'integrated-match',
    status: accepted ? 'draft' : 'withheld',
    anchorId: registry.anchorId,
    key: registry.key,
    audience: registry.audience,
    language: registry.language.code,
    claims: accepted?.rendered.claims || [],
    selectedFactIds: accepted?.ids || [],
    selectedFacts: accepted ? structuredClone(accepted.facts) : [],
    issues,
    requirements: structuredClone(requirements),
    contextRequirement: structuredClone(contextRequirement),
    requiredFactIds: [...requirements.requiredFactIds],
    selectionCapacity,
    authorship: {
      selection: 'local-model',
      wording: 'application-fact-templates',
      mandatoryFacts: 'application-domain-rules',
      additionalContext: 'local-model',
    },
    review: accepted
      ? 'Local AI selected facts and passed model editorial review. Application templates supplied wording and complete citations; model approval does not establish source completeness, football realism or real-world truth. Human review is required.'
      : 'No local story released: selection validation or editorial review failed after one repair.',
    limitation: accepted?.rendered.limitation || catalog.limitation,
    execution: {
      modelCalls,
      workerCalls,
      toolCalls: names.length + applicationRequiredTools.length,
      modelSelectedTools: [...names],
      applicationRequiredTools,
      repairCount,
      elapsedMs: performance.now() - started,
      usage: usageReportedCalls ? usage : null,
      usageReportedCalls,
      frameworkTrace,
    },
    trace,
  };
}
