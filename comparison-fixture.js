import { passFlight } from './pass-flight.js';
import { fixtureTeams } from './fixture-settings.js';
const scenarios = new Set(['sustained', 'interrupted', 'quiet', 'counter', 'duel']);
const playerNames = {
  home: [
    'I. Kerr',
    'B. Ward',
    'R. Osei',
    'T. Novak',
    'C. Vega',
    'E. Costa',
    'J. Cole',
    'R. Mensah',
    'O. Bennett',
    'A. Reed',
    'N. Aziz',
  ],
  away: [
    'M. Carter',
    'A. Rossi',
    'L. Kamara',
    'S. Olsen',
    'K. Moreau',
    'T. Santos',
    'M. Costa',
    'H. Diallo',
    'L. Park',
    'D. Silva',
    'R. Hughes',
  ],
};
const normalized = (point) => ({ x: (point.x / 105) * 100, y: (point.y / 68) * 100 });
const mix = (a, b, r) => ({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = (value) => value * value * (3 - 2 * value);

/** Bounded authored passages. Player routes and ball custody are explicit;
 * interpolation samples those routes, never invents a pass between contacts.
 * This is a schematic football example, not a validated physical simulator.
 */
export function comparisonFixture(seed = 17, { scenario = 'sustained' } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 100000 || !scenarios.has(scenario))
    throw new RangeError('Choose a bounded fixture seed and comparison scenario.');
  const variant =
    seed === 41 && scenario === 'interrupted'
      ? {
          home: [
            'L. Grant',
            'J. Brooks',
            'M. Okoro',
            'P. Jensen',
            'A. Malik',
            'T. Evans',
            'C. Osei',
            'D. Ferreira',
            'S. Blake',
            'N. Walker',
            'E. Haddad',
          ],
          away: [
            'R. Dawson',
            'F. Laurent',
            'K. Bello',
            'A. Lind',
            'J. Duarte',
            'M. Chen',
            'B. Kamau',
            'O. Patel',
            'L. Fischer',
            'I. Moreno',
            'S. Ali',
          ],
        }
      : seed === 73 && scenario === 'quiet'
        ? {
            home: [
              'A. Stone',
              'T. Murray',
              'J. Adeyemi',
              'L. Eriksen',
              'P. Duarte',
              'N. Kato',
              'D. Hughes',
              'M. Sarr',
              'O. Lewis',
              'C. Silva',
              'R. Ahmed',
            ],
            away: [
              'K. Hart',
              'S. Martin',
              'A. Diallo',
              'J. Berg',
              'E. Mendes',
              'L. Park',
              'T. Wilson',
              'I. Demir',
              'M. James',
              'D. Santos',
              'N. Khan',
            ],
          }
        : playerNames;
  const generated = seed >= 1000 && seed <= 1016;
  const surnames = [
    'Walker',
    'Okoro',
    'Jensen',
    'Malik',
    'Brooks',
    'Evans',
    'Kamau',
    'Duarte',
    'Grant',
    'Moreno',
    'Blake',
    'Kato',
    'Hart',
    'Chen',
    'Sarr',
    'Lewis',
    'Berg',
    'Haddad',
    'Ali',
    'Fischer',
    'Stone',
    'Demir',
    'Ahmed',
    'Wilson',
    'Murray',
    'Laurent',
    'Bello',
    'James',
    'Khan',
    'Martin',
    'Patel',
    'Eriksen',
  ];
  const name = (id) => {
    if (!generated) return variant[id.split('-')[0]][Number(id.split('-')[1]) - 1];
    const n = Number(id.split('-')[1]) - 1,
      offset = seed + (id.startsWith('home') ? 0 : 13);
    return `${String.fromCharCode(65 + ((offset * 3 + n * 5) % 26))}. ${surnames[(offset + n) % surnames.length]}`;
  };
  // Generated variants change timing and geometry without compressing authored contacts.
  const at = (t) =>
    generated ? Math.round(t * (1 + (seed % 11) * 0.008)) + (t ? seed % 3 : 0) : t;
  const prefix = `comparison-${scenario}-${seed}`,
    events = [],
    frames = [],
    segments = [],
    routes = new Map();
  const shift = ((seed % 19) - 9) / 20;
  const home = [
    [5, 34],
    [17, 23],
    [19, 34],
    [22, 48],
    [39, 15],
    [48, 27],
    [65, 34],
    [62, 44],
    [70, 54],
    [76, 34],
    [68, 12],
  ];
  const away = [
    [100, 34],
    [89, 23],
    [88, 34],
    [87, 48],
    [72, 15],
    [70, 27],
    [58, 34],
    [63, 44],
    [36, 54],
    [29, 34],
    [40, 12],
  ];
  const roster = ['home', 'away'].flatMap((team) =>
    (team === 'home' ? home : away).map(([x, y], index) => {
      const id = `${team}-${index + 1}`;
      routes.set(id, [{ time: 0, x, y: y + shift }]);
      return { id, team, number: index + 1, name: name(id) };
    }),
  );
  const point = (id, time) => {
    const route = routes.get(id),
      before = route.filter((p) => p.time <= time).at(-1) || route[0],
      after = route.find((p) => p.time >= time) || route.at(-1);
    return mix(
      before,
      after,
      ease(after.time === before.time ? 0 : (time - before.time) / (after.time - before.time)),
    );
  };
  const waypoint = (id, time, position) => {
    const route = routes.get(id),
      existing = route.find((p) => p.time === time);
    if (existing) Object.assign(existing, position);
    else route.push({ time, ...position });
    route.sort((a, b) => a.time - b.time);
  };
  const position = (x, y) => ({
    x: generated ? clamp(x + Math.sin(seed + x * 0.3) * 1.8, 2, 103) : x,
    y: clamp(y + shift + (generated ? Math.sin(seed + y * 0.17) * 3 : 0), 3, 65),
  });
  let cursor = 0,
    owner = 'home-7',
    dead = null,
    lastCompletedPass = null;
  const event = (type, time, playerId, extra = {}) => {
    const row = {
      id: `${prefix}-${type}-${time}`,
      revision: 1,
      operation: 'upsert',
      type,
      time,
      arrivedAt: time,
      team: playerId.split('-')[0],
      teamName: fixtureTeams(scenario, seed)[playerId.split('-')[0]],
      playerId,
      player: name(playerId),
      result: false,
      ...extra,
    };
    events.push(row);
    return row;
  };
  const interval = (end, kind, extra = {}) => {
    if (end < cursor) throw new Error('Authored ball intervals must be chronological.');
    if (end > cursor) segments.push({ start: cursor, end, kind, ...extra });
    cursor = end;
  };
  const hold = (until) => {
    // A longer spell of outfield control includes a small authored carry rather
    // than freezing the carrier between passes. Explicit contact waypoints win.
    if (
      !dead &&
      owner &&
      !owner.endsWith('-1') &&
      until - cursor >= 4 &&
      !routes.get(owner).some((p) => p.time === until)
    ) {
      const start = point(owner, cursor),
        direction = owner.startsWith('home') ? 1 : -1;
      waypoint(owner, cursor, start);
      waypoint(owner, until, {
        x: clamp(start.x + direction * Math.min(2, (until - cursor) * 0.22), 4, 101),
        y: clamp(start.y + (Number(owner.split('-')[1]) % 2 ? 0.6 : -0.6), 4, 64),
      });
    }
    interval(
      until,
      dead ? 'dead-ball' : 'control',
      dead
        ? { at: { ...dead }, cause: 'ball-out-of-play' }
        : { ownerId: owner, cause: 'retained-control' },
    );
  };
  const carry = (until, id, to) => {
    if (owner !== id || dead) throw new Error('Carry needs live control.');
    waypoint(id, until, to);
    hold(until);
  };
  function pass(
    start,
    end,
    from,
    to,
    {
      fromPoint,
      toPoint,
      interceptor,
      pending = false,
      restart = false,
      bodyPart = 'right-foot',
      passType,
      technique = 'standard',
    } = {},
  ) {
    if (owner !== from || dead)
      throw new Error('Pass needs the current controller and a live ball.');
    pending = pending || end > 120;
    hold(start);
    if (fromPoint) waypoint(from, start, fromPoint);
    waypoint(from, start, point(from, start));
    // A receiving forward checks toward the ball, then runs into the pass.
    if (!interceptor && to.endsWith('-10')) {
      const current = point(to, start),
        check = position(to.startsWith('home') ? 74 : 31, 34),
        previous = routes
          .get(to)
          .filter((p) => p.time <= start)
          .at(-1);
      // A quick rebound cannot send the shooter ten metres backwards in two
      // seconds merely to reach the default checking position for another pass.
      const distance = Math.hypot(check.x - current.x, check.y - current.y),
        available = Math.max(0, start - previous.time) * 2;
      waypoint(to, start, mix(current, check, distance ? Math.min(1, available / distance) : 0));
    }
    const receiver = interceptor || to;
    if (toPoint) waypoint(receiver, end, toPoint);
    // Contact attributes are authored fixture facts, never estimated from the
    // schematic player's position or preferred foot.
    const origin = point(from, start),
      target = point(receiver, end),
      distance = Math.hypot(target.x - origin.x, target.y - origin.y);
    passType = passType || (distance >= 25 ? 'long' : distance <= 15 ? 'short' : 'medium');
    const control = !restart
      ? events
          .filter(
            (e) =>
              e.playerId === from && ['receive', 'recovery'].includes(e.type) && e.time <= start,
          )
          .at(-1)
      : null;
    const row = event('pass', start, from, {
      ...(control ? { cause: control.id } : {}),
      passType,
      technique,
      receiverId: to,
      result: null,
      endX: null,
      endY: null,
      bodyPart,
      ...(restart ? { restart: 'goal-kick' } : {}),
    });
    lastCompletedPass = null;
    interval(end, 'pass-flight', {
      fromId: from,
      toId: receiver,
      passType,
      technique,
      cause: row.id,
    });
    owner = receiver;
    if (!pending) {
      event(interceptor ? 'recovery' : 'receive', end, receiver, {
        passId: row.id,
        cause: row.id,
        ...(interceptor ? { recoveryKind: 'interception' } : {}),
      });
      events.push({
        ...row,
        revision: 2,
        arrivedAt: end,
        result: !interceptor,
        endpointTime: end,
        reason: interceptor
          ? 'Authored interception confirms the failed pass.'
          : 'Authored reception confirms the pass.',
      });
      if (!interceptor) lastCompletedPass = row;
    }
    return row;
  }
  function shot(
    time,
    team,
    outcome,
    { corrected = false, rebound = true, bodyPart = 'right-foot' } = {},
  ) {
    const forward = `${team}-10`,
      opponent = team === 'home' ? 'away' : 'home',
      keeper = `${opponent}-1`,
      blocker = `${opponent}-3`;
    if (owner !== forward || dead) throw new Error('Shot needs forward control.');
    carry(time, forward, position(team === 'home' ? 84 : 21, 34));
    const row = event('shot', time, forward, {
      ...(lastCompletedPass?.receiverId === forward ? { passId: lastCompletedPass.id } : {}),
      bodyPart,
      ...(outcome === 'goal'
        ? { result: null }
        : { result: false, outcome: corrected ? 'off-target' : outcome }),
    });
    // This authored provider credit appears only with confirmed scoring. A prior
    // shot or interception clears the eligible direct pass; rebounds do not
    // manufacture an assist from an earlier attack.
    const assist =
      outcome === 'goal' &&
      lastCompletedPass?.receiverId === forward &&
      lastCompletedPass.team === team
        ? {
            playerId: lastCompletedPass.playerId,
            player: lastCompletedPass.player,
            passId: lastCompletedPass.id,
          }
        : null;
    lastCompletedPass = null;
    if (corrected || outcome === 'goal')
      events.push({
        ...row,
        revision: 2,
        arrivedAt: time + 2,
        result: outcome === 'goal',
        outcome,
        ...(assist ? { assist } : {}),
        reason:
          outcome === 'goal'
            ? 'Synthetic provider confirms the goal after the endpoint arrives.'
            : 'Synthetic provider corrects the non-goal shot outcome.',
      });
    let endpoint;
    if (outcome === 'saved') {
      endpoint = position(team === 'home' ? 100 : 5, 34);
      waypoint(keeper, time, point(keeper, time));
      waypoint(keeper, time + 1, endpoint);
    } else if (outcome === 'blocked') {
      endpoint = position(team === 'home' ? 88 : 17, 34);
      waypoint(blocker, time, point(blocker, time));
      waypoint(blocker, time + 1, endpoint);
    } else endpoint = { x: team === 'home' ? 105 : 0, y: outcome === 'goal' ? 34 : 20 };
    const end = normalized(endpoint);
    event('flight', time + 1, forward, { shotId: row.id, endX: end.x, endY: end.y });
    interval(time + 1, 'shot-flight', { fromId: forward, to: { ...endpoint }, cause: row.id });
    if (outcome === 'goal' || outcome === 'off-target') {
      owner = null;
      dead = endpoint;
      return;
    }
    if (outcome === 'saved') {
      owner = keeper;
      hold(time + 2);
      event('recovery', time + 2, keeper, { cause: row.id, recoveryKind: 'goalkeeper-hold' });
    } else if (rebound) {
      const collector = `${team}-7`;
      waypoint(collector, time + 2, position(team === 'home' ? 78 : 29, 35));
      interval(time + 2, 'rebound-flight', {
        from: { ...endpoint },
        toId: collector,
        cause: row.id,
      });
      owner = collector;
      event('recovery', time + 2, collector, { cause: row.id, recoveryKind: 'loose-ball' });
    } else {
      owner = blocker;
      hold(time + 2);
      event('recovery', time + 2, blocker, { cause: row.id, recoveryKind: 'defensive-block' });
    }
  }
  function goalKick(
    collectionTime,
    restartTime,
    keeper,
    to,
    end,
    toPoint,
    { pending = false } = {},
  ) {
    if (!dead) throw new Error('Goal kick requires an authored out-of-play shot.');
    waypoint(keeper, cursor, point(keeper, cursor));
    hold(collectionTime);
    waypoint(keeper, collectionTime, { ...dead });
    const start = { ...dead },
      finish = position(keeper === 'home-1' ? 5 : 100, 30);
    waypoint(keeper, restartTime, finish);
    interval(restartTime, 'dead-ball-collection', {
      from: start,
      to: finish,
      collectorId: keeper,
      cause: 'goal-kick-preparation',
    });
    dead = null;
    owner = keeper;
    pass(restartTime, end, keeper, to, { toPoint, pending, restart: true });
  }
  event('recovery', 0, 'home-7', { recoveryKind: 'segment-start', cause: 'initial-control' });
  if (scenario === 'sustained') {
    pass(at(10), at(14), 'home-7', 'home-10', { toPoint: position(81, 34) });
    shot(at(16), 'home', 'off-target');
    goalKick(at(24), at(30), 'away-1', 'away-2', at(34), position(84, 23));
    pass(at(38), at(42), 'away-2', 'away-7', { toPoint: position(61, 30) });
    carry(at(46), 'away-7', position(57, 35));
    pass(at(48), at(52), 'away-7', 'away-8', { toPoint: position(62, 44) });
    pass(at(56), at(60), 'away-8', 'away-7', { toPoint: position(62, 35) });
    pass(at(62), at(66), 'away-7', 'away-2', { interceptor: 'home-7', toPoint: position(70, 35) });
    waypoint('away-2', at(66), position(89, 23));
    pass(at(68), at(72), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(74), 'home', 'blocked');
    pass(at(80), at(84), 'home-7', 'home-8', { toPoint: position(73, 44) });
    pass(at(90), at(94), 'home-8', 'home-10', { toPoint: position(82, 34), bodyPart: 'left-foot' });
    shot(at(96), 'home', 'saved', { corrected: true, bodyPart: 'left-foot' });
    pass(at(100), at(102), 'away-1', 'away-7', {
      interceptor: 'home-7',
      toPoint: position(78, 35),
    });
    pass(at(102), at(104), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(106), 'home', 'blocked');
    pass(at(110), at(114), 'home-7', 'home-10', {
      toPoint: position(82, 34),
      bodyPart: 'left-foot',
    });
    shot(at(116), 'home', 'goal');
  } else if (scenario === 'interrupted') {
    pass(at(6), at(10), 'home-7', 'home-6', { toPoint: position(55, 27) });
    pass(at(16), at(20), 'home-6', 'home-8', { toPoint: position(63, 44) });
    pass(at(28), at(32), 'home-8', 'home-7', { toPoint: position(67, 34) });
    pass(at(38), at(42), 'home-7', 'home-8', { toPoint: position(66, 44) });
    pass(at(48), at(52), 'home-8', 'home-7', { toPoint: position(72, 35) });
    pass(at(58), at(62), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(64), 'home', 'saved');
    pass(at(68), at(70), 'away-1', 'away-7', { interceptor: 'home-7', toPoint: position(77, 35) });
    pass(at(70), at(72), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(74), 'home', 'blocked');
    pass(at(78), at(82), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(84), 'home', 'blocked', { rebound: false });
    pass(at(88), at(92), 'away-3', 'away-7', { toPoint: position(40, 33) });
    pass(at(94), at(96), 'away-7', 'away-10', { toPoint: position(24, 34) });
    shot(at(98), 'away', 'blocked');
    pass(at(100), at(104), 'away-7', 'away-10', { toPoint: position(23, 34) });
    shot(at(106), 'away', 'off-target');
    goalKick(at(114), at(118), 'home-1', 'home-7', at(122), position(53, 34), { pending: true });
  } else if (scenario === 'counter') {
    pass(at(4), at(6), 'home-7', 'home-6', { toPoint: position(50, 27) });
    pass(at(10), at(12), 'home-6', 'home-8', { toPoint: position(64, 44) });
    pass(at(18), at(20), 'home-8', 'home-7', { interceptor: 'away-7', toPoint: position(57, 35) });
    pass(at(22), at(24), 'away-7', 'away-10', { toPoint: position(24, 34) });
    shot(at(26), 'away', 'saved');
    pass(at(30), at(32), 'home-1', 'home-7', { toPoint: position(55, 34) });
    pass(at(40), at(42), 'home-7', 'home-8', { toPoint: position(66, 44) });
    pass(at(48), at(50), 'home-8', 'home-10', { toPoint: position(82, 34) });
    shot(at(52), 'home', 'off-target');
    goalKick(at(60), at(66), 'away-1', 'away-2', at(70), position(84, 23));
    pass(at(76), at(78), 'away-2', 'away-7', { toPoint: position(52, 35) });
    pass(at(82), at(84), 'away-7', 'away-10', { toPoint: position(24, 34) });
    shot(at(86), 'away', 'saved');
    pass(at(90), at(92), 'home-1', 'home-7', { toPoint: position(64, 34) });
    pass(at(98), at(100), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(102), 'home', 'blocked');
    pass(at(108), at(110), 'home-7', 'home-8', { toPoint: position(72, 44) });
    pass(at(112), at(114), 'home-8', 'home-10', { toPoint: position(82, 34) });
    shot(at(116), 'home', 'goal');
  } else if (scenario === 'duel') {
    pass(at(4), at(6), 'home-7', 'home-11', { toPoint: position(68, 12), technique: 'trivela' });
    pass(at(8), at(12), 'home-11', 'home-10', { toPoint: position(82, 34), passType: 'cross' });
    shot(at(20), 'home', 'saved');
    pass(at(24), at(26), 'away-1', 'away-8', { toPoint: position(48, 44) });
    pass(at(32), at(34), 'away-8', 'away-7', { toPoint: position(42, 35) });
    pass(at(38), at(40), 'away-7', 'away-10', { toPoint: position(24, 34) });
    shot(at(42), 'away', 'blocked');
    pass(at(48), at(50), 'away-7', 'away-6', { toPoint: position(36, 27) });
    pass(at(54), at(56), 'away-6', 'away-10', { toPoint: position(24, 34) });
    shot(at(58), 'away', 'off-target');
    goalKick(at(66), at(72), 'home-1', 'home-2', at(76), position(21, 23));
    pass(at(80), at(82), 'home-2', 'home-7', { toPoint: position(64, 34) });
    pass(at(86), at(88), 'home-7', 'home-10', { toPoint: position(82, 34) });
    shot(at(90), 'home', 'saved');
    pass(at(94), at(96), 'away-1', 'away-7', { toPoint: position(52, 35) });
    pass(at(100), at(102), 'away-7', 'away-10', { toPoint: position(24, 34) });
    shot(at(104), 'away', 'saved');
    pass(at(110), at(112), 'home-1', 'home-7', { toPoint: position(63, 34) });
    pass(at(116), at(120), 'home-7', 'home-8', { toPoint: position(70, 44) });
  } else {
    pass(at(8), at(12), 'home-7', 'home-6', { toPoint: position(53, 27) });
    carry(at(18), 'home-6', position(58, 25));
    pass(at(20), at(24), 'home-6', 'home-8', { toPoint: position(62, 44) });
    carry(at(32), 'home-8', position(65, 45));
    pass(at(36), at(40), 'home-8', 'home-7', { toPoint: position(69, 35) });
    pass(at(48), at(52), 'home-7', 'home-10', { toPoint: position(79, 34) });
    pass(at(58), at(62), 'home-10', 'home-7', { toPoint: position(69, 35) });
    pass(at(72), at(76), 'home-7', 'home-6', { toPoint: position(58, 27) });
    pass(at(86), at(90), 'home-6', 'home-8', { toPoint: position(64, 44) });
    pass(at(100), at(104), 'home-8', 'home-7', { toPoint: position(69, 35) });
    pass(at(118), at(122), 'home-7', 'home-10', { toPoint: position(81, 34), pending: true });
  }
  if (cursor < 120) hold(120);
  const endpoint = (segment, which) =>
    segment[which] || point(segment[`${which}Id`], which === 'from' ? segment.start : segment.end);
  const supporting = new Map(
    roster.filter((p) => routes.get(p.id).length === 1).map((p) => [p.id, point(p.id, 0)]),
  );
  const supportRoster = roster.filter((p) => supporting.has(p.id)),
    velocities = new Map(supportRoster.map((p) => [p.id, { x: 0, y: 0 }]));
  let presser = null,
    pressTeam = null;
  for (let time = 0; time <= 120; time++) {
    const segment = segments.find((s) => s.start <= time && s.end > time) || segments.at(-1);
    let ball;
    if (segment.kind === 'control') ball = point(segment.ownerId, time);
    else if (segment.kind === 'dead-ball') ball = { ...segment.at };
    else if (segment.kind === 'dead-ball-collection') ball = point(segment.collectorId, time);
    else if (segment.kind === 'pass-flight')
      ball = passFlight(
        endpoint(segment, 'from'),
        endpoint(segment, 'to'),
        (time - segment.start) / (segment.end - segment.start),
        segment,
      );
    else
      ball = mix(
        endpoint(segment, 'from'),
        endpoint(segment, 'to'),
        (time - segment.start) / (segment.end - segment.start),
      );
    // Only players without authored contacts use this support model. One defender
    // closes the ball while teammates retain their lines; possession widens the
    // attacking shape. This visual behaviour does not create pressure events or
    // claim that a tactical inference has been independently validated.
    const live = !segment.kind.startsWith('dead-ball');
    const controllingTeam = (
      segment.ownerId ||
      segment.fromId ||
      events.find((row) => row.id === segment.cause)?.playerId ||
      ''
    ).split('-')[0];
    const defendingTeam =
      live && controllingTeam ? (controllingTeam === 'home' ? 'away' : 'home') : null;
    if (pressTeam !== defendingTeam) {
      pressTeam = defendingTeam;
      presser =
        supportRoster
          .filter((p) => p.team === defendingTeam && p.number >= 5 && p.number <= 9)
          .sort(
            (a, b) =>
              Math.hypot(supporting.get(a.id).x - ball.x, supporting.get(a.id).y - ball.y) -
              Math.hypot(supporting.get(b.id).x - ball.x, supporting.get(b.id).y - ball.y),
          )[0]?.id || null;
    }
    const positions = roster.map((player) => ({
      ...player,
      ...(supporting.get(player.id) || point(player.id, time)),
    }));
    for (const player of supportRoster) {
      if (!time) continue;
      const base = routes.get(player.id)[0],
        previous = supporting.get(player.id),
        direction = player.team === 'home' ? 1 : -1;
      const inPossession = live && controllingTeam === player.team,
        backLine = player.number <= 4;
      const target = {
        x: base.x + clamp((ball.x - 65) * (backLine ? 0.12 : 0.24), -8, 8),
        y: base.y + (ball.y - 34) * 0.22,
      };
      if (inPossession && !backLine) {
        target.x += direction * 2.5;
        target.y += (base.y - 34) * 0.1;
      }
      if (player.number === 1) {
        // Keep the spare goalkeeper in the goal area, shading toward the ball.
        const depth = clamp((player.team === 'home' ? ball.x : 105 - ball.x) * 0.035, 1, 3.5);
        target.x = player.team === 'home' ? 2 + depth : 103 - depth;
        target.y = clamp(34 + (ball.y - 34) * 0.25, 28, 40);
      } else if (player.id === presser) {
        target.x = ball.x - direction * 3.2;
        target.y = ball.y + (base.y < 34 ? -1 : 1) * 1.2;
      }
      // Local spacing prevents the supporting shape bunching onto an authored
      // teammate. Contact actors stay authoritative and are never displaced.
      for (const other of positions.filter((p) => p.team === player.team && p.id !== player.id)) {
        const dx = previous.x - other.x,
          dy = previous.y - other.y,
          gap = Math.hypot(dx, dy);
        if (gap > 0 && gap < 3) {
          target.x += (dx / gap) * (3 - gap);
          target.y += (dy / gap) * (3 - gap);
        }
      }
      target.x = clamp(target.x, 2, 103);
      target.y = clamp(target.y, 3, 65);
      const dx = target.x - previous.x,
        dy = target.y - previous.y,
        distance = Math.hypot(dx, dy),
        speed = Math.min(player.number === 1 ? 0.8 : 2.2, distance * 0.3);
      const desired = distance
          ? { x: (dx / distance) * speed, y: (dy / distance) * speed }
          : { x: 0, y: 0 },
        velocity = velocities.get(player.id);
      const ax = desired.x - velocity.x,
        ay = desired.y - velocity.y,
        acceleration = Math.hypot(ax, ay),
        fraction = acceleration ? Math.min(1, 0.45 / acceleration) : 0;
      velocity.x += ax * fraction;
      velocity.y += ay * fraction;
      supporting.set(player.id, {
        x: clamp(previous.x + velocity.x, 2, 103),
        y: clamp(previous.y + velocity.y, 3, 65),
      });
    }
    const save = events.find(
      (e) =>
        e.type === 'shot' &&
        (e.outcome === 'saved' || events.some((r) => r.id === e.id && r.outcome === 'saved')) &&
        time >= e.time + 1 &&
        time < e.time + 3,
    );
    // Display-only keeper pose: dive after the strike, then recover smoothly.
    const dive = events.find(
      (e) =>
        e.type === 'shot' &&
        (e.outcome === 'saved' || events.some((r) => r.id === e.id && r.outcome === 'saved')) &&
        time >= e.time &&
        time <= e.time + 3,
    );
    const diveKeeper = dive ? `${dive.team === 'home' ? 'away' : 'home'}-1` : null;
    const diveAge = dive ? time - dive.time : 0;
    const diveAngle =
      diveAge <= 1
        ? -55 * diveAge
        : diveAge <= 2
          ? -55 + 25 * (diveAge - 1)
          : -30 + 30 * (diveAge - 2);
    frames.push({
      id: `${prefix}-frame-${time}`,
      revision: 1,
      operation: 'upsert',
      time,
      arrivedAt: time,
      phase: 'continuous',
      players: roster.map((player) => ({
        ...player,
        ...(supporting.get(player.id) || point(player.id, time)),
        ...(player.id === diveKeeper ? { displayDiveAngle: diveAngle } : {}),
      })),
      ball,
      ballState: {
        kind: segment.kind,
        ...(save ? { saveKeeperId: `${save.team === 'home' ? 'away' : 'home'}-1` } : {}),
        ...(segment.ownerId ? { ownerId: segment.ownerId } : {}),
        cause: segment.cause,
      },
    });
  }
  for (const row of events) {
    const p = normalized(point(row.playerId, row.time));
    row.x = p.x;
    row.y = p.y;
    if (row.type === 'pass') {
      if (row.result === null) {
        row.endX = null;
        row.endY = null;
      } else {
        const end = normalized(frames[row.endpointTime].ball);
        row.endX = end.x;
        row.endY = end.y;
        delete row.endpointTime;
      }
    } else if (row.endX === undefined) {
      row.endX = p.x;
      row.endY = p.y;
    }
  }
  events.sort(
    (a, b) =>
      a.arrivedAt - b.arrivedAt ||
      a.time - b.time ||
      a.id.localeCompare(b.id) ||
      a.revision - b.revision,
  );
  // The generated two-minute segment never publishes actions beyond its sample horizon.
  return {
    events: generated ? events.filter((e) => e.time <= 120 && e.arrivedAt <= 120) : events,
    frames,
    metadata: {
      id: prefix,
      seed,
      scenario,
      synthetic: true,
      segmentDuration: 120,
      observationHorizon: 120,
      continuousSamples: true,
      resets: false,
      pitch: { length: 105, width: 68, unit: 'metres' },
      authoredBallIntervals: segments,
      contactAttributes:
        'Pass type (cross explicitly authored; short <=15m, long >=25m, otherwise medium from authored endpoints), technique (trivela means outside-foot), pass and shot bodyPart values and confirmed-goal assist credits are explicitly authored synthetic provider facts, not inferred from animation, geometry or player preference. Assist credit names the completed direct pass to the scorer.',
      limitation:
        'Fictional authored possession, eased onside runs, supporting shape, defensive closing, shot aftermath and goal-kick preparation sampled once per second. Supporting movement has bounded acceleration and does not generate inferred pressure events. Player routes and ball flights are schematic, not validated football physics or a tactical simulation. The ball-out boundary is retained during dead play. Independent football plausibility review remains pending.',
    },
  };
}
