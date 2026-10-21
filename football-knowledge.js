import { createHash } from 'node:crypto';

// Curated factual reference data, verified against IFAB 2026/27.
// Sources are selection metadata; retrieval does not verify a generated claim.
const knowledge = {
  version: 'ifab-core-2026-27.v1',
  edition: '2026/27',
  verifiedAt: '2026-10-14',
  scope:
    'General association-football laws; competition options and match-specific decisions are not established by this reference.',
  sources: [
    {
      id: 'law-11',
      title: 'IFAB Law 11: Offside',
      url: 'https://www.theifab.com/laws/latest/offside/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-10',
      title: 'IFAB Law 10: Determining the Outcome of a Match',
      url: 'https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-12',
      title: 'IFAB Law 12: Fouls and Misconduct',
      url: 'https://www.theifab.com/laws/latest/fouls-and-misconduct/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-14',
      title: 'IFAB Law 14: The Penalty Kick',
      url: 'https://www.theifab.com/laws/latest/the-penalty-kick/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-5',
      title: 'IFAB Law 5: The Referee',
      url: 'https://www.theifab.com/laws/latest/the-referee/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-13',
      title: 'IFAB Law 13: Free Kicks',
      url: 'https://www.theifab.com/laws/latest/free-kicks/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'law-3',
      title: 'IFAB Law 3: The Players',
      url: 'https://www.theifab.com/laws/latest/the-players/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'var-protocol',
      title: 'IFAB Video Assistant Referee protocol',
      url: 'https://www.theifab.com/laws/latest/video-assistant-referee-var-protocol/',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
    {
      id: 'changes-2026-27',
      title: 'IFAB Laws of the Game 2026/27: Law changes, updated July 2026',
      url: 'https://downloads.theifab.com/downloads/changes-to-the-laws-of-the-game-202627?l=en',
      edition: '2026/27',
      verifiedAt: '2026-10-14',
    },
  ],
  concepts: [
    {
      id: 'offside',
      title: 'Offside',
      description: 'Position, timing, active involvement and restart exceptions.',
      facts: [
        {
          id: 'offside.position',
          role: 'condition',
          text: "Offside position requires a relevant part of the head, body or feet in the opponents' half, excluding the halfway line, nearer their goal line than both the ball and second-last opponent.",
          sourceId: 'law-11',
          section: '11.1',
        },
        {
          id: 'offside.body-and-level',
          role: 'exception',
          text: 'Hands and arms do not count. Being level with the second-last opponent or last two opponents is onside.',
          sourceId: 'law-11',
          section: '11.1',
        },
        {
          id: 'offside.timing',
          role: 'condition',
          text: "Position is assessed at a teammate's first contact when playing or touching the ball; for a goalkeeper's throw, use the release contact.",
          sourceId: 'law-11',
          section: '11.2',
        },
        {
          id: 'offside.involvement',
          role: 'condition',
          text: 'Position alone is not an offence. Active involvement requires playing the ball, interfering with an opponent, or gaining advantage from a rebound, deflection or deliberate save.',
          sourceId: 'law-11',
          section: '11.2',
        },
        {
          id: 'offside.deliberate-play',
          role: 'exception',
          text: "An opponent's deliberate play can reset offside; a deliberate save cannot. A deflection is not automatically deliberate play.",
          sourceId: 'law-11',
          section: '11.2',
        },
        {
          id: 'offside.direct-restarts',
          role: 'exception',
          text: 'Direct reception from a goal kick, throw-in or corner kick is exempt.',
          sourceId: 'law-11',
          section: '11.3',
        },
        {
          id: 'offside.restart',
          role: 'procedure',
          text: "The sanction is an indirect free kick where involvement occurred, potentially in the player's own half after returning from an offside position.",
          sourceId: 'law-11',
          section: '11.4',
        },
      ],
    },
    {
      id: 'goal',
      title: 'Scoring a goal',
      description: 'Whole-ball crossing and attacking-offence conditions.',
      facts: [
        {
          id: 'goal.crossing',
          role: 'condition',
          text: 'A goal requires the whole ball to cross the goal line between the posts and beneath the crossbar, with no offence by the scoring team.',
          sourceId: 'law-10',
          section: '10.1',
        },
        {
          id: 'goal.keeper-throw',
          role: 'exception',
          text: "A goalkeeper's throw directly into the opponents' goal produces a goal kick rather than a goal.",
          sourceId: 'law-10',
          section: '10.1',
        },
      ],
    },
    {
      id: 'handball',
      title: 'Handball',
      description: 'Deliberate handling, body enlargement and scoring exceptions.',
      facts: [
        {
          id: 'handball.not-every-touch',
          role: 'condition',
          text: 'Hand or arm contact alone is not necessarily an offence; the arm boundary is level with the bottom of the armpit.',
          sourceId: 'law-12',
          section: '12.1 Handling the ball',
        },
        {
          id: 'handball.offence',
          role: 'condition',
          text: 'Deliberate handling, or contact with an arm position unjustifiably enlarging the body for that movement, can be an offence.',
          sourceId: 'law-12',
          section: '12.1 Handling the ball',
        },
        {
          id: 'handball.scoring',
          role: 'exception',
          text: 'A player cannot score directly with their hand or arm, or immediately after their own hand or arm contact, even accidentally.',
          sourceId: 'law-12',
          section: '12.1 Handling the ball',
        },
        {
          id: 'handball.keeper',
          role: 'condition',
          text: 'Outside their penalty area, goalkeepers face the same handling restrictions as other players.',
          sourceId: 'law-12',
          section: '12.1 Handling the ball',
        },
      ],
    },
    {
      id: 'fouls',
      title: 'Fouls and cards',
      description: 'Challenge severity, contact and disciplinary consequences.',
      facts: [
        {
          id: 'fouls.severity',
          role: 'condition',
          text: 'Qualifying careless challenges are fouls without an automatic card; reckless challenges require a caution; excessive force or endangered opponent safety requires dismissal.',
          sourceId: 'law-12',
          section: '12.1',
        },
        {
          id: 'fouls.contact',
          role: 'condition',
          text: 'Holding and impeding with contact are direct-free-kick offences; dangerous play without contact can instead produce an indirect free kick.',
          sourceId: 'law-12',
          section: '12.1 and 12.2',
        },
        {
          id: 'fouls.cards',
          role: 'definition',
          text: 'Yellow signifies a caution; red signifies dismissal.',
          sourceId: 'law-12',
          section: '12.4',
        },
      ],
    },
    {
      id: 'penalty',
      title: 'Penalty kicks',
      description: 'Award conditions, player positions and the kick.',
      facts: [
        {
          id: 'penalty.award',
          role: 'condition',
          text: "A player's direct-free-kick offence inside their own penalty area produces a penalty; specified off-field offences can also qualify.",
          sourceId: 'law-14',
          section: 'Introduction',
        },
        {
          id: 'penalty.ball',
          role: 'procedure',
          text: 'The ball is stationary on the penalty mark and must be kicked forward; a goal may be scored directly.',
          sourceId: 'law-14',
          section: '14.1',
        },
        {
          id: 'penalty.positions',
          role: 'condition',
          text: 'Other players remain outside the penalty area, behind the mark and at least 9.15 metres away. At the kick, part of one goalkeeper foot is touching, level with or behind the goal line.',
          sourceId: 'law-14',
          section: '14.1',
        },
      ],
    },
    {
      id: 'advantage',
      title: 'Advantage',
      description: 'Continuing play for benefit and returning to the offence.',
      facts: [
        {
          id: 'advantage.benefit',
          role: 'condition',
          text: 'The referee may continue play when the non-offending team benefits after an offence or an incorrectly taken restart with the ball in play.',
          sourceId: 'law-5',
          section: '5.3 Advantage',
        },
        {
          id: 'advantage.return',
          role: 'condition',
          text: 'If the expected benefit fails immediately or within a few seconds, the referee may penalise the offence or order a retake.',
          sourceId: 'law-5',
          section: '5.3 Advantage',
        },
      ],
    },
    {
      id: 'free-kicks',
      title: 'Direct and indirect free kicks',
      description: 'Whether another player must touch the ball before a goal.',
      facts: [
        {
          id: 'free-kicks.direct',
          role: 'definition',
          text: "A direct free kick can score directly against the opponents; an indirect free kick requires another player's touch before a goal.",
          sourceId: 'law-13',
          section: '13.1',
        },
        {
          id: 'free-kicks.untouched',
          role: 'exception',
          text: "An untouched indirect kick into the opponents' goal produces a goal kick. Either kind kicked directly into the kicker's own goal produces a corner.",
          sourceId: 'law-13',
          section: '13.1',
        },
        {
          id: 'free-kicks.signal',
          role: 'procedure',
          text: 'A raised referee arm signals an indirect free kick.',
          sourceId: 'law-13',
          section: '13.1',
        },
      ],
    },
    {
      id: 'substitutions',
      title: 'Substitutions',
      description: 'Competition limits, opportunities and entry procedure.',
      facts: [
        {
          id: 'substitutions.limits',
          role: 'condition',
          text: 'Competition rules determine permitted substitutes. Official competitions may allow up to five; applicable senior competitions allowing five provide three substitution opportunities plus half-time.',
          sourceId: 'law-3',
          section: '3.2 Official competitions',
        },
        {
          id: 'substitutions.extra',
          role: 'exception',
          text: 'Extra-time and concussion allowances depend on the applicable competition provisions; five is not a universal limit for every match format.',
          sourceId: 'law-3',
          section: '3.2',
        },
        {
          id: 'substitutions.entry',
          role: 'procedure',
          text: 'A substitute normally enters at halfway during a stoppage after the replaced player leaves and the referee signals permission.',
          sourceId: 'law-3',
          section: '3.3',
        },
        {
          id: 'substitutions.time',
          role: 'procedure',
          text: 'The 2026/27 procedure normally gives the departing player ten seconds; exceeding this delays substitute entry until the first stoppage after one minute of restarted play, with safety and injury exceptions.',
          sourceId: 'changes-2026-27',
          section: 'Law 3 amendments, pages 5–6',
        },
      ],
    },
    {
      id: 'var',
      title: 'Video assistant referee',
      description: 'Review scope, referee authority and competition options.',
      facts: [
        {
          id: 'var.authority',
          role: 'condition',
          text: 'VAR assists with specified major incidents involving clear errors or serious missed incidents. The referee initiates a review and retains the final decision.',
          sourceId: 'var-protocol',
          section: '1 Principles',
        },
        {
          id: 'var.categories',
          role: 'condition',
          text: 'Review categories include goal decisions, penalty decisions, red cards and mistaken identity; this is not a review mechanism for every disagreement.',
          sourceId: 'var-protocol',
          section: '2 Reviewable decisions/incidents',
        },
        {
          id: 'var.second-caution',
          role: 'exception',
          text: 'The 2026/27 changes allow review of a red card resulting from a clearly incorrect second caution, and mistaken identity involving an offender from either team.',
          sourceId: 'changes-2026-27',
          section: 'Outline summary, pages 1–3',
        },
        {
          id: 'var.corner-option',
          role: 'exception',
          text: 'Competitions may optionally review a clearly wrongly awarded corner only when correction is immediate and does not delay the restart.',
          sourceId: 'changes-2026-27',
          section: 'VAR protocol summary, page 3',
        },
        {
          id: 'var.availability',
          role: 'condition',
          text: "VAR use requires the organiser to meet implementation requirements and obtain FIFA permission. A competition's adoption of optional procedures cannot be inferred from these laws.",
          sourceId: 'var-protocol',
          section: '1 Principles',
        },
      ],
    },
  ],
};

const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
freeze(knowledge);
const contentHash = createHash('sha256').update(JSON.stringify(knowledge)).digest('hex');
export const footballKnowledgeVersion = knowledge.version;
export const footballKnowledgeCatalog = freeze(
  knowledge.concepts.map(({ id, title, description }) => ({ id, title, description })),
);

/** Retrieve an allowlisted reference, not a match ruling or a generated answer.
 * No network, user-authored source content, question routing or model calls.
 * Canonical ordering makes equivalent selections deterministic. */
export function retrieveFootballKnowledge(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > 3 ||
    new Set(ids).size !== ids.length ||
    Array.from(ids).some(
      (id) => typeof id !== 'string' || !knowledge.concepts.some((concept) => concept.id === id),
    )
  )
    throw new RangeError('Select zero to three unique known football concept IDs.');
  const selected = new Set(ids),
    concepts = knowledge.concepts.filter((concept) => selected.has(concept.id));
  const sourceIds = new Set(
    concepts.flatMap((concept) => concept.facts.map((fact) => fact.sourceId)),
  );
  return freeze(
    structuredClone({
      version: knowledge.version,
      edition: knowledge.edition,
      verifiedAt: knowledge.verifiedAt,
      contentHash,
      concepts,
      sources: knowledge.sources.filter((source) => sourceIds.has(source.id)),
    }),
  );
}
