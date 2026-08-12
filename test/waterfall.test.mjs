/**
 * The running total.
 *
 * This is the part of a waterfall that can be wrong without looking wrong: a total that drifts still
 * draws a perfectly plausible chart, with every bar the right shape and the wrong height.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWaterfall, waterfallExtent } from '../dist/components/chart/waterfall.js';

const steps = (...pairs) => pairs.map(([label, value, total]) => ({ label, value, total }));

test('each step starts where the one before it ended', () => {
  const out = layoutWaterfall(steps(['a', 100], ['b', -30], ['c', 50]));
  assert.deepEqual(out.map((s) => [s.from, s.to]), [[0, 100], [100, 70], [70, 120]]);
  for (let i = 1; i < out.length; i++) assert.equal(out[i].from, out[i - 1].to, 'the chain broke');
});

test('a total is measured from the axis, and the running total resets to it', () => {
  /**
   * The case that makes this more than a `reduce`. A stated closing balance wins: if it disagrees
   * with the arithmetic, that disagreement is a fact about the data, and folding it into the next
   * section would hide exactly the thing worth seeing.
   */
  const out = layoutWaterfall(steps(['open', 1000, true], ['sales', 400], ['costs', -250], ['close', 1200, true], ['tax', -200]));
  assert.deepEqual(out[0], { index: 0, label: 'open', value: 1000, from: 0, to: 1000, total: true, direction: 'total' });
  assert.deepEqual([out[1].from, out[1].to], [1000, 1400]);
  assert.deepEqual([out[2].from, out[2].to], [1400, 1150]);
  // The stated close is 1200 though the arithmetic says 1150 — and it is drawn from the axis at 1200.
  assert.deepEqual([out[3].from, out[3].to], [0, 1200]);
  // …and the next step continues from the STATED figure, not from the computed one.
  assert.deepEqual([out[4].from, out[4].to], [1200, 1000], 'the run did not reset to the stated total');
});

test('direction follows the sign, and a total is neither up nor down', () => {
  const out = layoutWaterfall(steps(['a', 5], ['b', -5], ['c', 0], ['t', 10, true]));
  assert.deepEqual(out.map((s) => s.direction), ['up', 'down', 'up', 'total']);
});

test('one bad value cannot poison every bar after it', () => {
  // A running total is a chain: propagate a NaN and the whole right-hand half of the chart empties.
  const out = layoutWaterfall(steps(['a', 100], ['b', NaN], ['c', 50], ['d', Infinity], ['e', 25]));
  assert.ok(out.every((s) => Number.isFinite(s.from) && Number.isFinite(s.to)), JSON.stringify(out));
  assert.equal(out[out.length - 1].to, 175, 'the bad rows were not skipped cleanly');
});

test('the extent covers every edge, not every value', () => {
  /**
   * A step of -400 from a running total of 1000 reaches down to 600. An axis built from the values
   * alone would run 0..1000 and put that bar's foot off the bottom of the plot.
   */
  const out = layoutWaterfall(steps(['a', 1000], ['b', -400], ['c', 200]));
  assert.deepEqual(waterfallExtent(out), [0, 1000]);

  // And a sequence that goes negative has to bring the axis down with it.
  const negative = layoutWaterfall(steps(['a', 100], ['b', -300], ['c', 50]));
  const [min, max] = waterfallExtent(negative);
  assert.ok(min <= -200, `axis floor ${min} does not reach the lowest edge`);
  assert.ok(max >= 100, `axis ceiling ${max} does not reach the highest edge`);
});

test('the extent always includes zero, because the bars are read from it', () => {
  const out = layoutWaterfall(steps(['a', 500, true], ['b', 100]));
  const [min, max] = waterfallExtent(out);
  assert.ok(min <= 0 && max >= 0, `zero is outside ${min}..${max}`);
});

test('no steps is an empty chart, not a crash', () => {
  assert.deepEqual(layoutWaterfall([]), []);
  assert.deepEqual(waterfallExtent([]), [0, 0]);
});
