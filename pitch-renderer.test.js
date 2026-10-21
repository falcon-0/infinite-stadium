import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPitchPlayers } from './pitch-renderer.js';
import { once } from 'node:events';
import { createServer } from './server.js';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => null);
if (process.env.REQUIRE_BROWSER_TESTS === '1' && !playwright)
  throw new Error('Browser tests required but Playwright is unavailable.');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  append(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
    this.children.push(node);
    node.parent = this;
  }
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
  dispatch(name, event = {}) {
    this.listeners[name]?.(event);
  }
  focus() {
    globalThis.document.activeElement?.dispatch('blur');
    globalThis.document.activeElement = this;
    this.dispatch('focus');
  }
}
function fixture() {
  return {
    players: [{ id: 'home-1', name: 'A. Reed', number: 12, team: 'home', x: 52.5, y: 34 }],
    ball: { x: 51, y: 33, height: 0 },
    ballState: { ownerId: 'home-1' },
  };
}
function withDocument(t) {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (_, tag) => new Element(tag) };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
}
const child = (layer, key, value) => layer.children.find((node) => node.attributes[key] === value);
const scale = (node) => Number(node.attributes.transform.match(/scale\(([^)]+)\)/)[1]);
const position = (node) =>
  node.attributes.transform
    .match(/translate\(([^)]+)\)/)[1]
    .split(' ')
    .map(Number);

test('shirt numbers and ball stay readable at desktop and phone widths without changing match positions', (t) => {
  withDocument(t);
  for (const width of [650, 300]) {
    const layer = new Element('g');
    layer.ownerSVGElement = {
      getBoundingClientRect: () => ({ width }),
      viewBox: { baseVal: { width: 1110 } },
    };
    const frame = fixture(),
      original = structuredClone(frame);
    drawPitchPlayers(layer, frame, { tracker: true });
    const marker = child(layer, 'data-player-marker', 'home-1'),
      number = marker.children.find((node) => node.tagName === 'text');
    const pixels = width / 1110,
      shirtWidth = 34 * scale(marker) * pixels;
    assert.ok(shirtWidth >= 22 && shirtWidth <= 30, `shirt is ${shirtWidth}px at ${width}px`);
    assert.ok(Number(number.attributes['font-size']) * scale(marker) * pixels >= 9);
    assert.deepEqual(position(marker), [525, 340]);
    const ball = child(layer, 'data-ball-marker', '');
    assert.ok(18 * scale(ball) * pixels >= 9);
    assert.deepEqual(position(ball), [510, 330]);
    assert.deepEqual(frame, original);
  }
});

test('resizing updates presentation while a new pose retains exact translations, dive and flight height', (t) => {
  withDocument(t);
  let width = 650;
  const layer = new Element('g');
  layer.ownerSVGElement = { getBoundingClientRect: () => ({ width }) };
  const paint = drawPitchPlayers(layer, fixture(), { tracker: true }),
    marker = child(layer, 'data-player-marker', 'home-1');
  const initialScale = scale(marker);
  width = 300;
  const pose = fixture();
  Object.assign(pose.players[0], { x: 31.25, y: 5.75, displayDiveAngle: 42 });
  pose.ball = { x: 42.4, y: 12.3, height: 3 };
  const original = structuredClone(pose);
  paint(pose);
  assert.ok(scale(marker) > initialScale);
  assert.deepEqual(position(marker), [312.5, 57.5]);
  assert.match(marker.attributes.transform, /rotate\(42\)/);
  assert.deepEqual(position(child(layer, 'data-ball-marker', '')), [424, 99]);
  assert.deepEqual(pose, original);
});

test('scaled ball-carrier labels remain inside field edges and long names fit their box', (t) => {
  withDocument(t);
  const layer = new Element('g');
  layer.ownerSVGElement = { getBoundingClientRect: () => ({ width: 300 }) };
  const frame = fixture();
  frame.players[0].name = 'Alexanderson Montgomery';
  const paint = drawPitchPlayers(layer, frame),
    label = child(layer, 'data-player-label', 'home-1');
  for (const [x, y] of [
    [0, 0],
    [105, 0],
    [0, 68],
    [105, 68],
  ]) {
    Object.assign(frame.players[0], { x, y });
    paint(frame);
    const [labelX, labelY] = position(label),
      s = scale(label),
      box = label.children[0];
    const left = labelX + Number(box.attributes.x) * s,
      right = left + Number(box.attributes.width) * s;
    assert.ok(left >= 0 && right <= 1050);
    assert.ok(labelY - 13 * s >= 0 && labelY + 10 * s <= 680);
    assert.equal(label.children[1].attributes.textLength, '182');
  }
});

test('missing, zero or unavailable SVG layout preserves authored scale without crashing', (t) => {
  withDocument(t);
  for (const svg of [
    undefined,
    {},
    { getBoundingClientRect: () => ({ width: 0 }) },
    { getBoundingClientRect: () => undefined },
    {
      getBoundingClientRect: () => {
        throw new Error('No layout');
      },
    },
  ]) {
    const layer = new Element('g');
    layer.ownerSVGElement = svg;
    drawPitchPlayers(layer, fixture());
    assert.equal(scale(child(layer, 'data-player-marker', 'home-1')), 1);
    assert.equal(scale(child(layer, 'data-player-label', 'home-1')), 1);
    assert.equal(scale(child(layer, 'data-ball-marker', '')), 1);
  }
});

test('paused resize refresh keeps the pose and uses the letterboxed field scale', (t) => {
  withDocument(t);
  let bounds = { width: 800, height: 520 };
  const layer = new Element('g');
  layer.ownerSVGElement = {
    getBoundingClientRect: () => bounds,
    viewBox: { baseVal: { width: 1110, height: 720 } },
  };
  const pose = fixture(),
    original = structuredClone(pose),
    paint = drawPitchPlayers(layer, pose, { tracker: true });
  const marker = child(layer, 'data-player-marker', 'home-1'),
    before = scale(marker);
  bounds = { width: 800, height: 300 };
  paint.refresh();
  assert.ok(scale(marker) > before);
  assert.deepEqual(position(marker), [525, 340]);
  assert.deepEqual(pose, original);
  const displayedShirt = 34 * scale(marker) * (300 / 720);
  assert.ok(displayedShirt >= 25 && displayedShirt <= 27);
});

test('player identities paint above overlapping shirts and remain available to keyboard and pointer inspection', (t) => {
  withDocument(t);
  const layer = new Element('g'),
    pose = fixture();
  pose.players.push({ id: 'away-2', name: 'B. Ward', number: 2, team: 'away', x: 52.5, y: 31 });
  const original = structuredClone(pose);
  const paint = drawPitchPlayers(layer, pose, { selected: true, participants: ['home-1'] });
  const player = child(layer, 'data-player-marker', 'away-2'),
    label = child(layer, 'data-player-label', 'away-2');
  const shirtIndexes = layer.children.map((node, index) =>
    node.attributes['data-player-marker'] ? index : -1,
  );
  for (const node of layer.children.filter((node) => node.attributes['data-player-label']))
    assert.ok(layer.children.indexOf(node) > Math.max(...shirtIndexes));
  assert.equal(player.attributes.tabindex, '-1');
  assert.equal(player.attributes['aria-label'], 'B. Ward, away team, number 2');
  assert.equal(label.attributes['pointer-events'], 'none');
  assert.equal(label.attributes.visibility, 'hidden');
  assert.equal(player.attributes.opacity, '0.28');
  player.dispatch('pointerenter');
  assert.equal(label.attributes.visibility, 'visible');
  assert.equal(label.children[1].textContent, 'B. Ward · Away #2');
  assert.equal(player.attributes.opacity, '1');
  assert.equal(layer.children.at(-1), label);
  player.dispatch('focus');
  player.dispatch('pointerleave');
  paint.refresh();
  assert.equal(
    label.attributes.visibility,
    'visible',
    'keyboard focus survives pointer departure and repaint',
  );
  player.dispatch('blur');
  assert.equal(label.attributes.visibility, 'hidden');
  assert.equal(player.attributes.opacity, '0.28');
  assert.deepEqual(position(player), [525, 310]);
  assert.deepEqual(pose, original);
});

test('ball-carrier identity follows the received owner without retaining an old carrier announcement', (t) => {
  withDocument(t);
  const layer = new Element('g'),
    pose = fixture();
  const paint = drawPitchPlayers(layer, pose),
    player = child(layer, 'data-player-marker', 'home-1');
  assert.match(player.attributes['aria-label'], /with the ball$/);
  player.dispatch('focus');
  assert.equal(
    child(layer, 'data-player-label', 'home-1').children[1].textContent,
    'Ball: A. Reed · Home #12',
  );
  pose.ballState = { kind: 'pass-flight' };
  paint(pose);
  assert.equal(player.attributes['aria-label'], 'A. Reed, home team, number 12');
  assert.equal(
    child(layer, 'data-player-label', 'home-1').children[1].textContent,
    'A. Reed · Home #12',
  );
});

test('roving player focus follows roster order, wraps, and keeps one Tab stop without changing positions', (t) => {
  withDocument(t);
  const layer = new Element('g'),
    pose = fixture();
  pose.players.push(
    { id: 'home-2', name: 'B. Ward', number: 2, team: 'home', x: 12, y: 20 },
    { id: 'away-1', name: 'C. Carter', number: 1, team: 'away', x: 90, y: 34 },
  );
  const original = structuredClone(pose),
    paint = drawPitchPlayers(layer, pose);
  const markers = pose.players.map((player) => child(layer, 'data-player-marker', player.id));
  const key = (name) => {
    let prevented = false;
    document.activeElement.dispatch('keydown', {
      key: name,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  const active = (index) => {
    assert.equal(document.activeElement, markers[index]);
    assert.deepEqual(
      markers.map((marker) => marker.attributes.tabindex),
      markers.map((_, i) => (i === index ? '0' : '-1')),
    );
  };
  markers[0].focus();
  assert.equal(key('ArrowRight'), true);
  active(1);
  key('End');
  active(2);
  key('ArrowDown');
  active(0);
  key('ArrowUp');
  active(2);
  key('Home');
  active(0);
  assert.equal(key('Tab'), false, 'Tab is never intercepted');
  markers[1].dispatch('pointerdown');
  active(1);
  paint.refresh();
  active(1);
  assert.deepEqual(position(markers[1]), [120, 200]);
  assert.deepEqual(pose, original);
});

test(
  'Chrome exposes player identities on hover and focus without interrupting playback',
  { skip: !playwright },
  async () => {
    const server = createServer({ env: {} });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let browser;
    try {
      browser = await playwright.chromium.launch({
        headless: true,
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      });
      const page = await browser.newPage(),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?view=watch&match=northbridge-harbour`,
      );
      const player = page.locator('[data-player-marker="home-7"]'),
        label = page.locator('[data-player-label="home-7"]');
      for (const viewport of [
        { width: 1366, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await player.focus();
        assert.equal(await player.evaluate((element) => element === document.activeElement), true);
        assert.match(await label.textContent(), /J\. Cole.*Home #7/);
        assert.equal(await page.locator('#unified-pitch').getAttribute('role'), 'group');
        const presentation = await label.evaluate((element) => {
          const bounds = element.getBoundingClientRect(),
            pitch = element.ownerSVGElement.getBoundingClientRect(),
            siblings = [...element.parentElement.children];
          return {
            inside:
              bounds.left >= pitch.left &&
              bounds.right <= pitch.right &&
              bounds.top >= pitch.top &&
              bounds.bottom <= pitch.bottom,
            aboveShirts: siblings.every(
              (node, index) =>
                !node.hasAttribute('data-player-marker') || index < siblings.indexOf(element),
            ),
          };
        });
        assert.ok(presentation.inside);
        assert.ok(presentation.aboveShirts);
        await page.locator('[data-player-marker="home-1"]').hover();
        assert.equal(
          await page.locator('[data-player-label="home-1"]').getAttribute('visibility'),
          'visible',
        );
      }
      assert.equal(await page.locator('[data-player-marker][tabindex="0"]').count(), 1);
      await player.focus();
      await page.keyboard.press('ArrowRight');
      const nextPlayer = page.locator('[data-player-marker="home-8"]');
      assert.equal(
        await nextPlayer.evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        'unified-time',
        'one Tab exits the players to the next control',
      );
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.locator('#unified-play').click();
      await player.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => Number(document.querySelector('#unified-time').value) >= 3);
      assert.equal(
        await nextPlayer.evaluate((element) => element === document.activeElement),
        true,
        'smooth playback retains the arrow-selected player node',
      );
      assert.equal(
        await page.locator('[data-player-label="home-8"]').getAttribute('visibility'),
        'visible',
      );
      assert.equal(await nextPlayer.getAttribute('tabindex'), '0');
      assert.equal(await page.locator('[data-player-marker][tabindex="0"]').count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
