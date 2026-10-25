// A reason for an evaluative pick is its evidential basis, not an intention
// attributed to an action. Keep this narrow, source-independent distinction
// separate from genuine action motives, alternatives and mixed requests.
export function playerPickBasisRequest(input, plan, components, roster = []) {
  if (
    plan?.answerFocus !== 'player-assessment' ||
    !Array.isArray(plan.mentionedPlayers) ||
    plan.mentionedPlayers.length ||
    input.anchorId ||
    input.conversation?.length ||
    !Array.isArray(components) ||
    !components.length ||
    components.length > 2 ||
    !['none', 'other', 'decision-rationale'].includes(plan.explanationTarget) ||
    !['assessment', 'explanation'].includes(plan.requestedForm)
  )
    return false;
  const question = String(input.question || '').normalize('NFKC');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    roster.some((player) =>
      [player.name, player.name?.split(/\s+/).at(-1)]
        .filter(Boolean)
        .some((name) => new RegExp(`\\b${escape(name)}\\b`, 'iu').test(question)),
    )
  )
    return false;
  if (
    !/\b(?:who|which\s+player|qui|quel\s+joueur|quelle\s+joueuse|qui[eé]n|qu[eé]\s+jugador|quem|qual\s+jogador)\b/iu.test(
      components[0],
    )
  )
    return false;
  if (
    !/\b(?:(?:stand(?:s|ing)?|stood)\s+out|standout|best|impress\w*|influential|effective|valuable|pick|meilleur|démarque|destac\w*|mejor|melhor)\b/iu.test(
      components[0],
    )
  )
    return false;
  if (
    components
      .slice(1)
      .some(
        (part) =>
          !/^(?:why|pourquoi|por\s+qu[eéê]|on\s+what\s+basis|for\s+what\s+reason)$/iu.test(
            part.trim(),
          ),
      )
  )
    return false;
  if (
    /\b(?:he|she|his|her|their|they|shot|shoot\w*|pass(?:ed|es|ing)?|recover\w*|goal|scor\w*|intend\w*|decid\w*|cho(?:ose|se|sen)|option\w*|alternative\w*|instead|rather|could|should|would|forc\w*|caus\w*|ready|readiness|blame|press\w*|tir|passe|choisi\w*|voul\w*|opci[oó]n\w*|chut\w*|escolh\w*)\b/iu.test(
      question,
    )
  )
    return false;
  return true;
}
