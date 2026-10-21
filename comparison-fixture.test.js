import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonFixture } from './comparison-fixture.js';
import { validateFixture } from './fixture-validation.js';
import { matchChange } from './match-change.js';
import { matchPicture } from './match-picture.js';

test('supporting players reposition during play with bounded steps and named rosters', () => {
  for (const scenario of ['sustained', 'interrupted', 'quiet']) {
    const { frames } = comparisonFixture(17, { scenario });
    assert.equal(new Set(frames[0].players.map((p) => p.name)).size, 22);
    for (const id of ['home-2', 'home-5', 'away-4', 'away-11']) {
      const positions = frames.map((f) => f.players.find((p) => p.id === id));
      assert.ok(
        positions.some((p) => Math.hypot(p.x - positions[0].x, p.y - positions[0].y) > 1),
        id + ' should move with the passage',
      );
      const velocities = positions
        .slice(1)
        .map((p, i) => ({ x: p.x - positions[i].x, y: p.y - positions[i].y }));
      assert.ok(
        velocities.every((v) => Math.hypot(v.x, v.y) <= 2.200001),
        id + ' must retain the supporting movement bound',
      );
      assert.ok(
        velocities
          .slice(1)
          .every((v, i) => Math.hypot(v.x - velocities[i].x, v.y - velocities[i].y) <= 0.450001),
        id + ' cannot change velocity abruptly between samples',
      );
    }
  }
});

test('defending support closes the opening controller while the spare goalkeeper keeps a goal-area position', () => {
  const { frames, events } = comparisonFixture();
  assert.ok(
    distance(frames[0].ball, frames[8].ball) > 1,
    'Opening possession includes a controlled carry rather than a frozen ball',
  );
  const gap = (time) =>
    distance(
      frames[time].players.find((p) => p.id === 'away-6'),
      frames[time].ball,
    );
  assert.ok(gap(0) > 8);
  assert.ok(
    gap(8) < 4,
    'The nearest supporting midfielder closes the ball instead of translating with every teammate',
  );
  for (const frame of frames) {
    const keeper = frame.players.find((p) => p.id === 'home-1');
    assert.ok(keeper.x >= 2 && keeper.x <= 5.6);
    assert.ok(keeper.y >= 28 && keeper.y <= 40);
  }
  assert.equal(
    events.some((row) => row.type === 'pressure'),
    false,
    'Visual closing does not manufacture a recorded pressure event',
  );
});

test('authored receiving runs ease into their contacts and goal-kick collection keeps ball and collector together', () => {
  const { frames } = comparisonFixture();
  const forward = (time) => frames[time].players.find((p) => p.id === 'home-10');
  const openingStep = distance(forward(10), forward(11)),
    middleStep = distance(forward(11), forward(12)),
    arrivalStep = distance(forward(13), forward(14));
  assert.ok(openingStep < middleStep);
  assert.ok(arrivalStep < middleStep);
  assert.equal(forward(10).x, 74);
  assert.equal(forward(14).x, 81, 'Easing does not move the authored reception');
  for (let time = 24; time < 30; time++)
    assert.ok(
      distance(
        frames[time].ball,
        frames[time].players.find((p) => p.id === 'away-1'),
      ) < 1e-8,
      'Goalkeeper carries the collected ball toward the restart',
    );
});

test('a quick rebound limits the forward check-back instead of snapping to a default position', () => {
  const { frames } = comparisonFixture(17, { scenario: 'interrupted' });
  const forward = (time) => frames[time].players.find((p) => p.id === 'away-10');
  assert.ok(
    distance(forward(98), forward(100)) <= 4.000001,
    'Two-second check-back is bounded to four metres',
  );
  assert.ok(distance(forward(98), forward(99)) <= 2.000001);
  assert.equal(forward(98).x, 21, 'Original shot location remains authoritative');
  assert.equal(forward(104).x, 23, 'The next reception remains at its authored endpoint');
});

test('three structurally distinct continuous passages pass the actual fixture validator across seeds', () => {
  for (const scenario of ['sustained', 'interrupted', 'quiet'])
    for (const seed of [0, 17, 902, 100000]) {
      const feed = comparisonFixture(seed, { scenario }),
        report = validateFixture(feed, { observedAt: 120 });
      assert.equal(report.valid, true, JSON.stringify(report.errors));
      assert.deepEqual(report.warnings, []);
      assert.equal(feed.frames.length, 121);
      assert.equal(report.stats.rateIntervalsChecked, 120);
      assert.equal(report.stats.rateIntervalsSkipped, 0);
      assert.ok(report.stats.maxPlayerSampleRate < 12);
      assert.ok(report.stats.maxBallSampleRate < 50);
      assert.equal(feed.metadata.resets, false);
      assert.equal(feed.metadata.continuousSamples, true);
      assert.ok(
        feed.frames.every((frame) => frame.phase === 'continuous' && frame.players.length === 22),
      );
    }
});

test('sustained, interrupted and quiet passages have independently expected comparative outcomes', () => {
  const sustained = comparisonFixture(17, { scenario: 'sustained' }),
    interrupted = comparisonFixture(17, { scenario: 'interrupted' }),
    quiet = comparisonFixture(17, { scenario: 'quiet' });
  const a = matchChange(sustained.events, 120),
    b = matchChange(interrupted.events, 120),
    c = matchChange(quiet.events, 120);
  assert.deepEqual([a.teams[0].previousShots, a.teams[0].recentShots], [1, 3]);
  assert.equal(a.signal.direction, 'increase');
  assert.deepEqual([b.teams[0].previousShots, b.teams[0].recentShots], [3, 0]);
  assert.equal(b.signal.direction, 'decrease');
  assert.deepEqual([b.teams[1].previousShots, b.teams[1].recentShots], [0, 2]);
  assert.equal(c.status, 'abstain');
  assert.equal(matchChange(sustained.events, 96).status, 'insight');
  assert.equal(
    sustained.events.filter((row) => row.type === 'shot' && row.revision === 1).length,
    5,
  );
  assert.equal(
    interrupted.events.filter((row) => row.type === 'shot' && row.revision === 1).length,
    5,
  );
  assert.equal(quiet.events.filter((row) => row.type === 'shot').length, 0);
});

test('confirmed passes use received endpoints; pending final pass retains null endpoints', () => {
  for (const scenario of ['sustained', 'interrupted', 'quiet']) {
    const feed = comparisonFixture(17, { scenario }),
      pending = feed.events.filter((row) => row.type === 'pass' && row.revision === 1);
    assert.ok(
      pending.every((row) => row.result === null && row.endX === null && row.endY === null),
    );
    const final = pending.find((row) => row.time === 118);
    if (scenario === 'sustained')
      assert.equal(final, undefined, 'No distribution after the goal without a kickoff');
    else {
      assert.ok(final);
      assert.equal(
        feed.events.some((row) => row.id === final.id && row.revision > 1),
        false,
      );
    }
    for (const pass of feed.events.filter((row) => row.type === 'pass' && row.revision === 2)) {
      assert.equal(typeof pass.result, 'boolean');
      assert.ok([2, 4].includes(pass.arrivedAt - pass.time));
      assert.ok(Number.isFinite(pass.endX) && Number.isFinite(pass.endY));
    }
    assert.equal(validateFixture(feed, { observedAt: 11 }).valid, true);
  }
  const failed = comparisonFixture(17, { scenario: 'interrupted' }).events.find(
    (row) => row.type === 'pass' && row.result === false && row.time === 68,
  );
  assert.equal(failed.time, 68);
  assert.equal(failed.arrivedAt, 70);
});

test('shot corrections are explicit non-goal outcome updates with distinct real received revisions', () => {
  const feed = comparisonFixture();
  const initial = feed.events.find(
      (row) => row.type === 'shot' && row.time === 96 && row.revision === 1,
    ),
    corrected = feed.events.find((row) => row.id === initial.id && row.revision === 2);
  assert.equal(initial.outcome, 'off-target');
  assert.equal(corrected.outcome, 'saved');
  assert.equal(initial.result, false);
  assert.equal(corrected.result, false);
  assert.equal(corrected.arrivedAt, 98);
  assert.equal(initial.x, corrected.x);
  assert.equal(initial.y, corrected.y);
  assert.equal(initial.bodyPart, 'left-foot');
  assert.equal(corrected.bodyPart, initial.bodyPart);
  assert.equal(Object.hasOwn(initial, 'assist'), false);
  assert.equal(Object.hasOwn(corrected, 'assist'), false);
  assert.ok(
    matchChange(feed.events, 96).evidence.some(
      (ref) => ref.id === initial.id && ref.revision === 1,
    ),
  );
  assert.ok(
    matchChange(feed.events, 98).evidence.some(
      (ref) => ref.id === initial.id && ref.revision === 2,
    ),
  );
});

test('contact attributes are explicit fixture data and goal assist credits reference a completed direct pass', () => {
  for (const scenario of ['sustained', 'interrupted', 'quiet']) {
    const { events, metadata } = comparisonFixture(17, { scenario });
    assert.match(metadata.contactAttributes, /explicitly authored synthetic provider facts/);
    for (const row of events) {
      if (['pass', 'shot'].includes(row.type))
        assert.ok(['left-foot', 'right-foot', 'head'].includes(row.bodyPart));
      else
        assert.equal(
          Object.hasOwn(row, 'bodyPart'),
          false,
          'A reception/recovery sample does not establish kick contact',
        );
      if (row.type !== 'shot' || row.result !== true)
        assert.equal(
          Object.hasOwn(row, 'assist'),
          false,
          'No assist credited before a goal is confirmed',
        );
      if (!row.assist) continue;
      const pass = events.find(
        (candidate) => candidate.id === row.assist.passId && candidate.revision === 2,
      );
      assert.ok(pass);
      assert.equal(pass.result, true);
      assert.equal(pass.type, 'pass');
      assert.equal(pass.playerId, row.assist.playerId);
      assert.equal(pass.player, row.assist.player);
      assert.equal(pass.team, row.team);
      assert.equal(pass.receiverId, row.playerId);
      assert.ok(pass.arrivedAt < row.time);
      assert.equal(
        events.some(
          (candidate) =>
            candidate.time > pass.time &&
            candidate.time < row.time &&
            (candidate.type === 'shot' || candidate.type === 'recovery'),
        ),
        false,
      );
    }
  }
  const { events } = comparisonFixture();
  const goal = events.find((row) => row.type === 'shot' && row.result === true);
  assert.deepEqual(goal.assist, {
    playerId: 'home-7',
    player: 'J. Cole',
    passId: 'comparison-sustained-17-pass-110',
  });
  assert.equal(goal.arrivedAt, 118);
  assert.equal(goal.bodyPart, 'right-foot');
  assert.equal(
    events
      .filter((row) => row.type === 'pass' && row.time === 90)
      .every((row) => row.bodyPart === 'left-foot'),
    true,
  );
});

test('deterministic seeded fixtures are detached and reject unsupported scenarios or seed bounds', () => {
  const feed = comparisonFixture(17),
    again = comparisonFixture(17);
  assert.deepEqual(feed, again);
  assert.notDeepEqual(feed.frames, comparisonFixture(18).frames);
  feed.frames[0].players[0].x = -99;
  feed.events[0].team = 'changed';
  assert.deepEqual(comparisonFixture(17), again);
  for (const seed of [-1, 1.5, '17', 100001]) assert.throws(() => comparisonFixture(seed));
  assert.throws(() => comparisonFixture(17, { scenario: 'real-match' }));
});

test('shots come from forward positions and explicit one-second flight samples reach authored endpoints', () => {
  const feed = comparisonFixture();
  const shots = feed.events.filter((row) => row.type === 'shot' && row.revision === 1);
  const outcomes = new Set(
    feed.events
      .filter((row) => row.type === 'shot')
      .map((row) => row.outcome)
      .filter(Boolean),
  );
  assert.deepEqual([...outcomes].sort(), ['blocked', 'goal', 'off-target', 'saved']);
  for (const shot of shots) {
    assert.ok(shot.x > 75 && shot.x < 85, 'Authored home forward shoots from attacking third');
    const flight = feed.events.find((row) => row.type === 'flight' && row.shotId === shot.id),
      start = feed.frames.find((frame) => frame.time === shot.time),
      end = feed.frames.find((frame) => frame.time === shot.time + 1);
    assert.ok(flight);
    assert.equal(flight.time, shot.time + 1);
    assert.ok(Math.abs(end.ball.x - (flight.endX / 100) * 105) < 1e-9);
    assert.ok(Math.abs(end.ball.y - (flight.endY / 100) * 68) < 1e-9);
    const rate = Math.hypot(end.ball.x - start.ball.x, end.ball.y - start.ball.y);
    assert.ok(rate > 0 && rate < 50);
  }
  const saved = feed.frames.find((frame) => frame.time === 97),
    keeper = saved.players.find((player) => player.id === 'away-1');
  assert.deepEqual(saved.ball, { x: keeper.x, y: keeper.y });
  const goal = feed.frames.find((frame) => frame.time === 117);
  assert.deepEqual(goal.ball, { x: 105, y: 34 });
  assert.ok(
    feed.events.some(
      (row) => row.type === 'recovery' && row.playerId === 'away-1' && row.time === 98,
    ),
  );
  assert.ok(
    feed.events.some(
      (row) =>
        row.type === 'pass' &&
        row.playerId === 'away-1' &&
        row.time === 100 &&
        row.result === false,
    ),
  );
  assert.ok(
    feed.events.some(
      (row) => row.type === 'recovery' && row.playerId === 'home-7' && row.time === 102,
    ),
  );
});

test('last goal is pending until confirmation, with no match action restart after scoring', () => {
  const feed = comparisonFixture(),
    id = 'comparison-sustained-17-shot-116';
  const pending = feed.events.find((row) => row.id === id && row.revision === 1),
    confirmed = feed.events.find((row) => row.id === id && row.revision === 2);
  assert.equal(pending.result, null);
  assert.equal(Object.hasOwn(pending, 'outcome'), false);
  assert.equal(confirmed.result, true);
  assert.equal(confirmed.outcome, 'goal');
  assert.equal(confirmed.arrivedAt, 118);
  assert.equal(matchPicture(feed.events, 117).teams[0].cells.goals.value, 0);
  assert.equal(matchPicture(feed.events, 118).teams[0].cells.goals.value, 1);
  assert.equal(matchPicture(feed.events, 117).teams[0].cells.onTarget.unknownCount, 1);
  assert.equal(
    feed.events.some((row) => row.time > 117),
    false,
    'Collection after goal is a frame waypoint, not invented possession or kickoff',
  );
  for (const frame of feed.frames.filter((frame) => frame.time >= 117)) {
    assert.equal(frame.ballState.kind, 'dead-ball');
    assert.deepEqual(frame.ball, { x: 105, y: 34 });
  }
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// These checks express bounded authored-passage semantics, separately from the
// generic schema/rate validator. They do not establish realistic physics.
function auditPassage(feed) {
  const events = feed.events.filter((row) => row.revision === 1),
    intervals = feed.metadata.authoredBallIntervals;
  assert.equal(intervals[0].start, 0);
  assert.ok(intervals.at(-1).end >= 120);
  const eventById = new Map(events.map((row) => [row.id, row]));
  const player = (id, time) => feed.frames[time].players.find((row) => row.id === id);
  const startOwner = (s) =>
    s.kind === 'control' ? s.ownerId : s.kind === 'pass-flight' ? s.fromId : null;
  const endOwner = (s) =>
    s.kind === 'control'
      ? s.ownerId
      : ['pass-flight', 'rebound-flight'].includes(s.kind)
        ? s.toId
        : null;
  for (let i = 0; i < intervals.length; i++) {
    const segment = intervals[i],
      previous = intervals[i - 1];
    assert.ok(
      [
        'control',
        'pass-flight',
        'shot-flight',
        'rebound-flight',
        'dead-ball',
        'dead-ball-collection',
      ].includes(segment.kind),
    );
    assert.ok(segment.end > segment.start);
    if (previous) {
      assert.equal(segment.start, previous.end, 'No unexplained timeline gaps or overlaps');
      if (endOwner(previous) && startOwner(segment))
        assert.equal(
          startOwner(segment),
          endOwner(previous),
          'Control cannot silently change player',
        );
    }
    if (segment.kind.endsWith('flight')) {
      const cause = eventById.get(segment.cause);
      assert.ok(cause, 'Every flight needs an actual authored cause');
      assert.equal(cause.type, segment.kind === 'pass-flight' ? 'pass' : 'shot');
      if (segment.kind === 'pass-flight') {
        assert.equal(cause.time, segment.start);
        assert.equal(cause.playerId, segment.fromId);
        if (segment.end <= 120) {
          const ending = events.find((row) => row.time === segment.end && row.passId === cause.id);
          assert.ok(ending, 'Received/intercepted pass has an explicit ending');
          assert.equal(ending.playerId, segment.toId);
        }
      }
    }
    if (segment.kind === 'dead-ball-collection') {
      assert.equal(previous.kind, 'dead-ball');
      const restart = intervals[i + 1],
        pass = eventById.get(restart.cause);
      assert.equal(restart.kind, 'pass-flight');
      assert.equal(pass.restart, 'goal-kick');
      assert.equal(pass.playerId, segment.collectorId);
      const at = player(pass.playerId, restart.start);
      assert.ok(at.x <= 5.5 || at.x >= 99.5);
      assert.ok(at.y >= 24.84 && at.y <= 43.16, 'Goal kick is taken in the goal area');
    }
  }
  for (const frame of feed.frames) {
    const segment =
      intervals.find((s) => s.start <= frame.time && s.end > frame.time) || intervals.at(-1);
    assert.equal(frame.ballState.kind, segment.kind);
    if (segment.kind === 'control')
      assert.ok(
        distance(frame.ball, player(segment.ownerId, frame.time)) < 1e-8,
        'Every controlled-ball sample remains with its owner',
      );
    if (segment.kind === 'dead-ball')
      assert.ok(
        distance(frame.ball, segment.at) < 1e-8,
        'Out-of-play ball does not drift toward the next action',
      );
  }
  for (const pass of feed.events.filter(
    (row) => row.type === 'pass' && row.result === true && row.restart !== 'goal-kick',
  )) {
    const frame = feed.frames[pass.time],
      receiver = player(pass.receiverId, pass.time),
      direction = pass.team === 'home' ? 1 : -1;
    const opponents = frame.players
      .filter((row) => row.team !== pass.team)
      .sort((a, b) => direction * (b.x - a.x));
    const inOpponentHalf = direction * (receiver.x - 52.5) > 0;
    assert.ok(
      !inOpponentHalf ||
        direction * (receiver.x - frame.ball.x) <= 0 ||
        direction * (receiver.x - opponents[1].x) <= 0,
      'Successful pass begins with its receiver onside in the point-position model',
    );
  }
  for (const recovery of events.filter((row) => row.type === 'recovery' && row.time > 0)) {
    const cause = eventById.get(recovery.cause);
    assert.ok(cause, 'Every recovery has an authored pass or shot cause');
    assert.ok(['pass', 'shot'].includes(cause.type));
    assert.ok(cause.time < recovery.time);
  }
}

test('all twelve passage/seed combinations account for control, flights, onside receptions and handoff causes', () => {
  for (const scenario of ['sustained', 'interrupted', 'quiet'])
    for (const seed of [0, 17, 902, 100000]) {
      const feed = comparisonFixture(seed, { scenario });
      auditPassage(feed);
      // A future endpoint or final goal confirmation cannot leak into earlier ticks.
      for (const observedAt of [0, 11, 17, 24, 30, 66, 70, 96, 97, 98, 117, 118, 120])
        assert.equal(
          validateFixture(feed, { observedAt }).valid,
          true,
          `${scenario}/${seed}/${observedAt}`,
        );
    }
});

test('semantic checks reject orphan flights, silent custody changes and offside receptions', () => {
  const missingCause = comparisonFixture();
  missingCause.metadata.authoredBallIntervals.find((row) => row.kind === 'pass-flight').cause =
    'missing';
  assert.throws(() => auditPassage(missingCause), /authored cause/);
  const changedOwner = comparisonFixture();
  changedOwner.metadata.authoredBallIntervals.find(
    (row) => row.kind === 'control' && row.start === 14,
  ).ownerId = 'away-7';
  assert.throws(() => auditPassage(changedOwner), /silently change/);
  const offside = comparisonFixture();
  offside.frames[90].players.find((row) => row.id === 'home-10').x = 95;
  assert.throws(() => auditPassage(offside), /onside/);
  const drifting = comparisonFixture();
  drifting.frames[44].ball.x += 12;
  assert.throws(() => auditPassage(drifting), /owner/);
});

test('misses have a dead-ball collection and legal restart; saves have a keeper hold before distribution', () => {
  const sustained = comparisonFixture(),
    interrupted = comparisonFixture(17, { scenario: 'interrupted' });
  assert.equal(sustained.frames[17].ballState.kind, 'dead-ball');
  assert.equal(sustained.frames[24].ballState.kind, 'dead-ball-collection');
  assert.ok(
    sustained.events.some(
      (row) => row.type === 'pass' && row.time === 30 && row.restart === 'goal-kick',
    ),
  );
  for (const time of [97, 98, 99]) assert.equal(sustained.frames[time].ballState.ownerId, 'away-1');
  assert.ok(
    interrupted.events.some(
      (row) =>
        row.type === 'recovery' &&
        row.time === 86 &&
        row.playerId === 'away-3' &&
        row.recoveryKind === 'defensive-block',
    ),
  );
  assert.equal(interrupted.frames[107].ballState.kind, 'dead-ball');
  assert.ok(
    interrupted.events.some(
      (row) =>
        row.type === 'pass' &&
        row.time === 118 &&
        row.restart === 'goal-kick' &&
        row.result === null,
    ),
  );
  const run = sustained.frames[104].players.find((row) => row.id === 'home-10'),
    start = sustained.frames[102].players.find((row) => row.id === 'home-10');
  assert.ok(
    distance(run, start) >= 8,
    'Forward makes an authored receiving run rather than a stationary oscillation',
  );
});

test('keeper stays set before the shot and shows a save reaction only at contact', () => {
  const { frames } = comparisonFixture(17, { scenario: 'sustained' });
  const keeper = (t) => frames[t].players.find((p) => p.id === 'away-1');
  assert.deepEqual({ x: keeper(80).x, y: keeper(80).y }, { x: keeper(96).x, y: keeper(96).y });
  assert.ok(distance(keeper(96), keeper(97)) > 0);
  assert.equal(frames[96].ballState.saveKeeperId, undefined);
  assert.equal(frames[97].ballState.saveKeeperId, 'away-1');
  assert.ok(distance(frames[97].ball, keeper(97)) < 1e-8);
  assert.equal(frames[98].ballState.saveKeeperId, 'away-1');
  assert.equal(frames[99].ballState.saveKeeperId, undefined);
});

test('catalogue matches keep distinct clubs throughout metadata, events and recaps', async () => {
  const { matchCatalogue } = await import('./fixture-settings.js');
  const { integratedMatch } = await import('./match-stream.js');
  const ids = new Set(),
    rosters = new Set();
  for (const match of matchCatalogue) {
    const output = integratedMatch({ kind: match.kind, seed: match.seed, time: 120 });
    assert.deepEqual(output.state.metadata.teams, { home: match.home, away: match.away });
    const roster = output.state.frames
      .at(-1)
      .players.map((p) => p.name)
      .join('|');
    assert.ok(!rosters.has(roster));
    rosters.add(roster);
    assert.ok(output.recap.summary.includes(match.home));
    assert.ok(output.recap.summary.includes(match.away));
    for (const event of output.state.events)
      assert.equal(event.teamName, event.team === 'home' ? match.home : match.away);
    assert.ok(!ids.has(output.state.metadata.id));
    ids.add(output.state.metadata.id);
  }
});

test('catalogue entries have distinct action timelines and ball routes, not just changed badges', async () => {
  const { matchCatalogue } = await import('./fixture-settings.js');
  const feeds = matchCatalogue.map((m) => comparisonFixture(m.seed, { scenario: m.kind }));
  for (let i = 0; i < feeds.length; i++)
    for (let j = i + 1; j < feeds.length; j++) {
      const signature = (feed) =>
        feed.events
          .filter((e) => e.revision === 1)
          .map((e) => [e.type, e.time, e.team, e.playerId, e.receiverId || null]);
      assert.notDeepEqual(signature(feeds[i]), signature(feeds[j]));
      assert.notDeepEqual(
        feeds[i].frames.map((f) => f.ball),
        feeds[j].frames.map((f) => f.ball),
      );
    }
});

test('twenty selectable fixtures satisfy received-data contracts without future leakage', async () => {
  const { matchCatalogue } = await import('./fixture-settings.js');
  const { validateFixture } = await import('./fixture-validation.js');
  assert.equal(matchCatalogue.length, 20);
  assert.equal(new Set(matchCatalogue.map((m) => m.kind)).size, 5);
  for (const m of matchCatalogue) {
    const feed = comparisonFixture(m.seed, { scenario: m.kind });
    const report = validateFixture(feed, { observedAt: 120 });
    assert.deepEqual(report.errors, [], m.id);
    assert.deepEqual(report.warnings, [], m.id);
  }
});
