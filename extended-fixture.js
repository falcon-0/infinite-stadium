import { createScenario } from './scenarios.js';

const blend = (a, b, r) => a + (b - a) * r;
const playerName = (id) =>
  ({
    'home-1': 'M. Vale',
    'home-7': 'J. Cole',
    'home-10': 'A. Reed',
    'away-1': 'S. Noor',
    'away-7': 'L. Park',
    'away-10': 'D. Silva',
  })[id] || `${id.startsWith('home') ? 'Northbridge' : 'Harbour'} #${id.split('-').at(-1)}`;
const transform = (frame, away) => ({
  players: frame.players.map((p) => ({
    ...p,
    id: away
      ? p.id.replace(/^home/, 'TEMP').replace(/^away/, 'home').replace(/^TEMP/, 'away')
      : p.id,
    team: away ? (p.team === 'home' ? 'away' : 'home') : p.team,
    x: away ? 105 - p.x : p.x,
  })),
  ball: { x: away ? 105 - frame.ball.x : frame.ball.x, y: frame.ball.y },
});

// Scripted six-minute data generator. Reset intervals are explicit, not inferred play.
export function extendedFeed(seed = 17) {
  const frames = [],
    events = [];
  let previous = transform(createScenario('central', seed).frames[0], false);
  for (let phase = 0; phase < 12; phase++) {
    const offset = phase * 30,
      away = phase % 2 === 1,
      goal = phase % 5 === 0;
    const scenePhase = [2, 6, 9].includes(phase)
      ? 'intercepted-pass'
      : [4, 8].includes(phase)
        ? 'possession'
        : 'shot';
    const scene = createScenario(phase % 3 === 1 ? 'wide' : 'central', seed + phase * 97);
    const start = transform(scene.frames[0], away),
      side = away ? 'away' : 'home',
      passer = `${side}-7`,
      runner = `${side}-10`;
    const makeFrame = (time, data, revision = 1, arrivedAt = time) => ({
      id: `extended-${seed}-frame-${time}`,
      time,
      arrivedAt,
      revision,
      operation: 'upsert',
      ...structuredClone(data),
      phase: time < offset + 20 ? 'reset' : 'attack',
      scenePhase,
    });
    // Move between scripted sequences over twenty seconds, without teleports.
    for (let local = 0; local < 20; local++) {
      const r = local / 20;
      const data = {
        players: previous.players.map((p) => {
          const to = start.players.find((q) => q.id === p.id);
          return { ...p, x: blend(p.x, to.x, r), y: blend(p.y, to.y, r) };
        }),
        ball: {
          x: blend(previous.ball.x, start.ball.x, r),
          y: blend(previous.ball.y, start.ball.y, r),
        },
      };
      frames.push(makeFrame(offset + local, data));
    }
    const canonical = scene.frames.map((f) => transform(f, away));
    const target = canonical[4].players.find((p) => p.id === runner);
    const interceptor =
      scenePhase === 'intercepted-pass'
        ? canonical[4].players
            .filter((p) => p.team !== side)
            .sort(
              (a, b) =>
                Math.hypot(a.x - target.x, a.y - target.y) -
                  Math.hypot(b.x - target.x, b.y - target.y) || a.id.localeCompare(b.id),
            )[0]
        : null;
    if (interceptor) {
      // Author the failed pass and its receiving opponent from the same samples.
      const origin = canonical[2].ball;
      canonical[3].ball = {
        x: blend(origin.x, interceptor.x, 0.5),
        y: blend(origin.y, interceptor.y, 0.5),
      };
      for (let local = 4; local <= 8; local++) {
        const owner = canonical[local].players.find((p) => p.id === interceptor.id);
        canonical[local].ball = { x: owner.x, y: owner.y };
      }
    }
    for (let local = 0; local <= 8; local++) {
      const frame = makeFrame(offset + 20 + local, canonical[local]);
      if (local === 8 && scenePhase === 'shot') {
        frame.players.find((p) => p.id === runner).x += away ? 3 : -3;
        frame.ball.x += away ? 3 : -3;
      }
      frames.push(frame);
    }
    const final = structuredClone(canonical[8]);
    if (scenePhase === 'shot') final.ball = { x: away ? 0 : 105, y: goal ? 34 : 8 };
    frames.push(makeFrame(offset + 29, final));
    if (scenePhase === 'shot') {
      const corrected = makeFrame(offset + 28, canonical[8], 2, offset + 30);
      corrected.reason = 'Synthetic tracking provider repairs the shot-position sample.';
      frames.push(corrected);
    }
    const event = (type, local, id, extra = {}) => {
      const frame = frames.find((f) => f.time === offset + local && f.revision === 1),
        playerId = extra.playerId || (type === 'recovery' || type === 'pass' ? passer : runner);
      const player = frame.players.find((p) => p.id === playerId);
      return {
        id: `extended-${seed}-${phase}-${id}`,
        type,
        time: offset + local,
        arrivedAt: offset + local,
        revision: 1,
        operation: 'upsert',
        playerId,
        player: playerName(playerId),
        team: player.team,
        x: (player.x / 105) * 100,
        y: (player.y / 68) * 100,
        endX: (player.x / 105) * 100,
        endY: (player.y / 68) * 100,
        result: false,
        scenePhase,
        ...extra,
      };
    };
    events.push(event('recovery', 20, 'recovery'));
    const pass = event('pass', 22, 'pass', {
      receiverId: runner,
      result: null,
      endX: null,
      endY: null,
    });
    events.push(pass);
    const endpoint = canonical[4].ball;
    events.push({
      ...pass,
      result: !interceptor,
      revision: 2,
      arrivedAt: offset + 24,
      endX: (endpoint.x / 105) * 100,
      endY: (endpoint.y / 68) * 100,
      reason: interceptor
        ? 'Opponent recovery confirms the failed pass.'
        : 'Reception confirms completion.',
    });
    if (interceptor)
      events.push(
        event('recovery', 24, 'interception', { playerId: interceptor.id, passId: pass.id }),
      );
    else events.push(event('receive', 24, 'receive'));
    if (scenePhase === 'shot') {
      const shot = event('shot', 28, 'shot', {
        result: goal,
        outcome: goal ? 'goal' : 'off-target',
        arrivedAt: offset + 29,
      });
      events.push(shot);
      const correctedPlayer = canonical[8].players.find((p) => p.id === runner);
      events.push({
        ...shot,
        x: (correctedPlayer.x / 105) * 100,
        y: (correctedPlayer.y / 68) * 100,
        endX: (correctedPlayer.x / 105) * 100,
        endY: (correctedPlayer.y / 68) * 100,
        revision: 2,
        arrivedAt: offset + 30,
        reason: 'Shot location repaired with its tracking sample.',
      });
      events.push(event('flight', 29, 'flight', { shotId: shot.id }));
    }
    previous = final;
  }
  frames.push({
    id: `extended-${seed}-frame-360`,
    time: 360,
    arrivedAt: 360,
    revision: 1,
    operation: 'upsert',
    ...structuredClone(previous),
    phase: 'complete',
  });
  return { events, frames };
}
