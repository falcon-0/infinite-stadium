export const languages = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese' };
export function languagePreference(code = 'en') {
  if (!Object.hasOwn(languages, code)) throw new RangeError('Choose en, es, fr or pt.');
  return { code, name: languages[code] };
}
export function recapSummary(language, home, away, homeGoals, awayGoals, shots) {
  languagePreference(language);
  const score = `${home} ${homeGoals}-${awayGoals} ${away}`;
  if (language === 'es') return `${score}. ${shots} ${shots === 1 ? 'tiro' : 'tiros'}.`;
  if (language === 'fr') return `${score}. ${shots} ${shots === 1 ? 'tir' : 'tirs'}.`;
  if (language === 'pt') return `${score}. ${shots} ${shots === 1 ? 'remate' : 'remates'}.`;
  return `${score}. ${shots} ${shots === 1 ? 'shot' : 'shots'}.`;
}
const momentCopy = {
  en: {
    goal: (p) => `${p} scored`,
    miss: (p) => `${p} shot but did not score`,
    pending: (p) => `${p} took a shot; the outcome is not yet known`,
    outcomes: {
      'off-target': (p) => `${p} shot off target`,
      saved: (p) => `${p} had a shot saved`,
      blocked: (p) => `${p} had a shot blocked`,
      'on-target': (p) => `${p} shot on target`,
    },
    tally: (s) => `Score at this moment: ${s.home}-${s.away}.`,
  },
  es: {
    goal: (p) => `${p} marcó`,
    miss: (p) => `${p} disparó sin marcar`,
    pending: (p) => `${p} disparó; el resultado aún no se conoce`,
    outcomes: {
      'off-target': (p) => `${p} remató sin encontrar portería`,
      saved: (p) => `El remate de ${p} fue detenido`,
      blocked: (p) => `El remate de ${p} fue bloqueado`,
      'on-target': (p) => `${p} remató a puerta`,
    },
    tally: (s) => `Marcador en este momento: ${s.home}-${s.away}.`,
  },
  fr: {
    goal: (p) => `${p} a marqué`,
    miss: (p) => `${p} a tiré sans marquer`,
    pending: (p) => `${p} a tiré ; le résultat n’est pas encore connu`,
    outcomes: {
      'off-target': (p) => `${p} n’a pas cadré son tir`,
      saved: (p) => `Le tir de ${p} a été arrêté`,
      blocked: (p) => `Le tir de ${p} a été contré`,
      'on-target': (p) => `${p} a cadré son tir`,
    },
    tally: (s) => `Score à cet instant : ${s.home}-${s.away}.`,
  },
  pt: {
    goal: (p) => `${p} marcou`,
    miss: (p) => `${p} rematou sem marcar`,
    pending: (p) => `${p} rematou; o resultado ainda não é conhecido`,
    outcomes: {
      'off-target': (p) => `${p} rematou sem acertar na baliza`,
      saved: (p) => `O remate de ${p} foi defendido`,
      blocked: (p) => `O remate de ${p} foi bloqueado`,
      'on-target': (p) => `${p} rematou à baliza`,
    },
    tally: (s) => `Resultado neste momento: ${s.home}-${s.away}.`,
  },
};
export function localizedMoment(language, anchor, club, score, audience, detail) {
  languagePreference(language);
  const c = momentCopy[language],
    action =
      anchor.result === true
        ? c.goal
        : anchor.result === false
          ? Object.hasOwn(c.outcomes, anchor.outcome)
            ? c.outcomes[anchor.outcome]
            : c.miss
          : c.pending;
  const lead = `${action(anchor.player)} (${club}).`;
  return `${lead} ${c.tally(score)}${detail ? ` ${detail}` : ''}`;
}
