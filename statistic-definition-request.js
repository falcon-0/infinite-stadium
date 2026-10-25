// Request semantics only: no match records, actors, answers or event clocks.
// Unknown phrasings retain ordinary model classification; explicit retrievals
// cannot be replaced by the optimized category-definition-only composition.
export function statisticDefinitionRequestScope(question, components = [question]) {
  const text = String(question || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const concept =
    /\b(?:mean(?:s|ing)?|defin\w*|signifi\w*|classif\w*|categor\w*|difference|differ\w*|distinguish|distinction|count(?:ed|s)?\s+as|compt\w*\s+comme|cuenta\w*\s+como|conta\w*\s+como|(?:added|included)\s+(?:to|in|as))\b/u.test(
      text,
    ) ||
    /\b(?:what\s+(?:is|are)\s+(?:a|an)|qu['’]est.ce\s+qu['’]un|que\s+(?:es|son)\s+un|o\s+que\s+e\s+um)\b/u.test(
      text,
    );
  const retrieval = components.some((component) => {
    const span = String(component)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/^[¿¡\s]+/u, '');
    return (
      /\b(?:how\s+many|combien|cuantos|cuantas|quantos|quantas)\b/u.test(span) ||
      (/^(?:who\b|which\s+(?:player|team|keeper)\b|qui\b|quel(?:le)?\s+(?:joueur|joueuse|equipe|gardien)\b|quien\b|que\s+(?:jugador|equipo)\b|quem\b|qual\s+(?:jogador|equipe)\b)/u.test(
        span,
      ) &&
        /\b(?:shots?|attempts?|passes?|goals?|saves?|ball\s+wins?|tirs?|tiros?|remates?|pases?|buts?|gols?)\b/u.test(
          span,
        ) &&
        /\b(?:most|fewest|first|last|latest|had|has|made|took|leads?|leading|plus|moins|tire\w*|fait|mas|menos|hizo|tiro|mais|menos|fez|remat\w*)\b/u.test(
          span,
        )) ||
      /\b(?:how\s+did\b.*\b(?:turn\s+out|end|finish)|what\s+happened|what\s+were\b.*\boutcomes?|comment\b.*\b(?:termine\w*|fini\w*)|como\b.*\b(?:termin\w*|acabar\w*|sairam))\b/u.test(
        span,
      )
    );
  });
  return retrieval ? (concept ? 'mixed' : 'match') : concept ? 'definition' : 'unknown';
}
