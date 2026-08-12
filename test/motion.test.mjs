/**
 * The clock, the memory, and the choreography arithmetic.
 *
 * `clock` needs frames, so the frame source is faked: same shipped code, a controlled timeline.
 * That is the only way to assert the stagger's shape at all — in a real tab it is 900ms of motion
 * nobody can measure by looking.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** A frame loop and a clock we drive by hand. Installed before the module under test reads them. */
let now = 0;
let queue = [];
globalThis.requestAnimationFrame = (fn) => queue.push(fn);
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => now };
globalThis.document = { hidden: false };
globalThis.matchMedia = () => ({ matches: false });

const { Memory, clock, easings, lerp } = await import('../dist/components/chart/motion.js');

/** Advance to `ms` and run exactly the frames that were waiting. */
const flush = (ms) => {
  now = ms;
  for (const fn of queue.splice(0, queue.length)) fn(ms);
};

beforeEach(() => {
  now = 0;
  queue = [];
  globalThis.document.hidden = false;
});

test('lerp and the easings agree on their endpoints', () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
  assert.equal(lerp(10, 20, 0.5), 15);
  for (const [name, ease] of Object.entries(easings)) {
    assert.equal(ease(0), 0, `${name} does not start at 0`);
    assert.equal(ease(1), 1, `${name} does not end at 1`);
    // Monotone: an easing that goes backwards makes a mark visibly retreat mid-run.
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = ease(Math.min(1, t));
      assert.ok(value >= previous - 1e-9, `${name} is not monotone at ${t}`);
      previous = value;
    }
  }
});

test('a run reaches exactly 1 and stops there', () => {
  const c = clock({ duration: 600 });
  flush(0);
  assert.equal(c.progress(), 0);
  flush(600);
  assert.equal(c.progress(), 1);
  flush(10_000);
  assert.equal(c.progress(), 1, 'progress went past the end');
});

test('a hidden tab finishes immediately instead of rendering an empty plot', () => {
  /**
   * `requestAnimationFrame` does not fire in a background tab — not throttled, not at all. A chart
   * that grows its marks from zero would therefore render as an EMPTY PLOT until the tab was shown.
   */
  globalThis.document.hidden = true;
  const c = clock({ duration: 600 });
  c.restart();
  assert.equal(c.progress(), 1, 'a hidden chart was left mid-animation');
});

test('animation off means off, not merely faster', () => {
  // Someone who asked for less motion asked for none. Shortening the duration is the common
  // half-measure and it misses the point.
  const c = clock({ duration: 600, disabled: true });
  assert.equal(c.progress(), 1);
  c.restart();
  assert.equal(c.progress(), 1);
});

test('stagger spreads the starts without shortening any mark`s own motion', () => {
  /**
   * The arithmetic that had to be got right: the run LENGTHENS by the spread rather than being
   * divided by it. Fitting the same 600ms inside a staggered run would make each mark move for
   * less than 600ms — so asking for choreography would make every individual mark snappier, which
   * is the opposite of what was asked for.
   */
  const plain = clock({ duration: 600 });
  const spread = clock({ duration: 600, stagger: 0.55 });
  const count = 12;

  const sample = (c, index, ms) => {
    flush(ms);
    return Math.round(c.at(index, count) * 1000) / 1000;
  };

  // The first mark's curve is identical to the unstaggered one — it starts at once and takes 600ms.
  for (const ms of [150, 300, 600]) {
    now = 0;
    queue = [];
    const a = clock({ duration: 600 });
    const b = clock({ duration: 600, stagger: 0.55 });
    flush(ms);
    assert.equal(
      Math.round(a.at(0, count) * 1000),
      Math.round(b.at(0, count) * 1000),
      `first mark differs at ${ms}ms`
    );
  }

  // The last mark has not begun while the first is still moving, and lands exactly at the end.
  now = 0;
  queue = [];
  const c = clock({ duration: 600, stagger: 0.55 });
  assert.equal(sample(c, count - 1, 150), 0, 'the last mark started too early');
  assert.ok(sample(c, count - 1, 600) < 1, 'the last mark finished before the run did');
  assert.equal(sample(c, count - 1, 930), 1, 'the run did not end at duration * (1 + spread)');
  assert.equal(c.progress(), 1);
});

test('choreography costs the same at twelve marks and at three hundred', () => {
  /**
   * A SHARE of the run, not a delay per mark. `delay: 30` reads well against twelve bars and turns
   * three hundred candles into a nine-second wait, which is how this feature usually ships.
   */
  for (const count of [12, 300, 3000]) {
    now = 0;
    queue = [];
    const c = clock({ duration: 600, stagger: 0.55 });
    flush(929);
    assert.ok(c.at(count - 1, count) < 1, `finished early at ${count} marks`);
    flush(930);
    assert.equal(c.at(count - 1, count), 1, `not finished at ${count} marks`);
  }
});

test('every mark is between 0 and 1 throughout, whatever it is asked', () => {
  const c = clock({ duration: 600, stagger: 0.55 });
  for (const ms of [0, 100, 400, 800, 930, 2000]) {
    flush(ms);
    for (const [index, count] of [[0, 1], [0, 10], [5, 10], [9, 10], [-3, 10], [99, 10]]) {
      const t = c.at(index, count);
      assert.ok(t >= 0 && t <= 1, `at(${index}, ${count}) = ${t} at ${ms}ms`);
    }
  }
});

test('a stagger of zero is exactly the simultaneous run', () => {
  now = 0;
  queue = [];
  const plain = clock({ duration: 600 });
  const zero = clock({ duration: 600, stagger: 0 });
  for (const ms of [100, 300, 600]) {
    flush(ms);
    assert.equal(zero.at(7, 12), plain.at(7, 12), `differs at ${ms}ms`);
    assert.equal(zero.at(7, 12), plain.progress(), 'at() and progress() disagree without a stagger');
  }
});

test('Memory travels from where a mark was, and grows a new one from its baseline', () => {
  /**
   * The difference between an update that looks right and one that looks like a redraw. A bar going
   * 40 to 90 travels; a bar that is new grows from the baseline. Only remembering the previous
   * state per key can tell those apart.
   */
  const memory = new Memory();
  // First run: nothing remembered, so everything starts at its fallback.
  assert.equal(memory.at('a', 90, 0, 0), 0);
  assert.equal(memory.at('a', 90, 1, 0), 90);
  memory.commit();

  // Second run: 'a' travels from 90, 'b' is new and grows from the baseline.
  assert.equal(memory.at('a', 40, 0, 0), 90, 'a known mark did not start where it was');
  assert.equal(memory.at('a', 40, 0.5, 0), 65);
  assert.equal(memory.at('b', 50, 0, 0), 0, 'a new mark did not start at its baseline');
});

test('Memory forgets marks that stopped being drawn', () => {
  // Or a chart that has been through a hundred datasets carries a hundred datasets' worth of keys.
  const memory = new Memory();
  memory.at('gone', 10, 1, 0);
  memory.commit();
  memory.at('kept', 20, 1, 0);
  memory.commit();
  // 'gone' was not drawn in the second run, so the third must treat it as new.
  assert.equal(memory.at('gone', 99, 0, 5), 5, 'a mark that stopped being drawn was remembered');
  assert.equal(memory.at('kept', 99, 0, 5), 20, 'a mark that was drawn was forgotten');
});
