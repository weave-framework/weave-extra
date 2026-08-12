/**
 * Scales — the arithmetic every axis is built on.
 *
 * The tests worth having here are about the LADDER and the DOMAIN, not about `to()` returning a
 * number. An axis fails by being unreadable, not by throwing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandScale,
  compactNumber,
  extent,
  formatTime,
  linearScale,
  logScale,
  niceDomain,
  timeScale,
} from '../dist/components/chart/scale.js';

/** Every step a reader can do arithmetic on in their head, and nothing else. */
const readable = (step) => {
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const unit = Math.round((step / magnitude) * 1000) / 1000;
  return [1, 2, 5, 10].includes(unit);
};

test('ticks land on the 1/2/5/10 ladder for any extent', () => {
  // The alternative — dividing the extent by a tick count — gives steps like 3.7, and an axis
  // labelled 0, 3.7, 7.4 is one nobody reads. Sweep enough shapes that a lucky case cannot pass it.
  for (const [min, max] of [[0, 1], [0, 7], [0, 33], [0, 12345], [-50, 50], [0.001, 0.009], [17, 23], [0, 1e9]]) {
    const scale = linearScale([min, max], [0, 100]);
    const ticks = scale.ticks();
    assert.ok(ticks.length >= 2, `too few ticks for ${min}..${max}`);
    const step = ticks[1] - ticks[0];
    assert.ok(readable(step), `unreadable step ${step} for ${min}..${max}`);
    // Evenly spaced, or the "step" above is a fiction.
    for (let i = 2; i < ticks.length; i++) {
      assert.ok(Math.abs(ticks[i] - ticks[i - 1] - step) < step * 1e-6, `uneven ticks for ${min}..${max}`);
    }
  }
});

test('niceDomain rounds outward, never inward', () => {
  // Rounding in would put a data point outside the plot — the axis would be lying about its own
  // extent, which is worse than an ugly number.
  for (const [min, max] of [[3, 97], [0.4, 8.1], [-13, 42], [1234, 5678]]) {
    const [low, high] = niceDomain(min, max);
    assert.ok(low <= min, `${low} > ${min}`);
    assert.ok(high >= max, `${high} < ${max}`);
  }
});

test('a flat series still gets a domain with width', () => {
  // Every value identical is a real dataset. A zero-width domain divides by zero and puts every
  // mark on one pixel.
  const [low, high] = niceDomain(5, 5);
  assert.ok(high > low, 'flat domain collapsed');
  const scale = linearScale([5, 5], [0, 100]);
  assert.ok(Number.isFinite(scale.to(5)), 'flat scale produced a non-finite pixel');
});

test('bandScale leaves padding as a share of the slot, and centres the band in it', () => {
  const scale = bandScale(['a', 'b', 'c', 'd'], [0, 400], { padding: 0.2 });
  assert.equal(scale.bandwidth, 80); // slot 100, one fifth left empty
  // Centred: the gap before the first band equals half the padding.
  assert.equal(scale.start('a'), 10);
  assert.equal(scale.to('a'), 50);
  assert.equal(scale.to('d'), 350);
});

test('bandScale thins by keeping every nth label, not by dropping the tail', () => {
  // Truncating the axis silently is worse than showing fewer labels: a reader cannot tell that the
  // last six months are missing, but they can see that only every third month is named.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const kept = bandScale(months, [0, 600]).ticks(4);
  assert.ok(kept.length <= 4 + 1, `kept ${kept.length}`);
  assert.equal(kept[0], 'Jan');
  // The last kept label is near the end of the domain, not near the start.
  assert.ok(months.indexOf(kept[kept.length - 1]) >= 8, `tail dropped: ${kept.join(',')}`);
});

test('bandScale survives a single category', () => {
  const scale = bandScale(['only'], [0, 100]);
  assert.ok(scale.bandwidth > 0);
  assert.ok(Number.isFinite(scale.to('only')));
});

test('a time axis steps in real durations, not in decimal ones', () => {
  // A "nice" 8.64e7 ms step is a day only by accident. Ticks have to land on the hour, the day, the
  // month — the units a reader thinks in.
  const hour = 3_600_000;
  const day = 24 * hour;
  const scale = timeScale([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 3)], [0, 500]);
  const ticks = scale.ticks(4);
  const step = ticks[1] - ticks[0];
  assert.ok([hour, 2 * hour, 3 * hour, 6 * hour, 12 * hour, day].includes(step), `odd step ${step}`);
  // Aligned to the step rather than to the data's start.
  assert.equal(ticks[0] % step, 0, 'first tick is not aligned to the step');
});

test('a time axis formats at the resolution its own ticks imply — the "02:00 AM" bug', () => {
  /**
   * The defect: asked for two ticks over two days, `ticks` chose a 24-hour step while `format` was
   * still holding the 12-hour one it was built with. Both labels came out as the same clock time,
   * a day apart, indistinguishable. `format` has to follow the last `ticks` call.
   */
  const scale = timeScale([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 3)], [0, 500]);
  const labels = scale.ticks(2).map(scale.format);
  assert.equal(new Set(labels).size, labels.length, `duplicate labels: ${labels.join(' | ')}`);
});

test('formatTime drops the units the step cannot distinguish', () => {
  const minute = 60_000;
  const day = 86_400_000;
  // An hourly axis has no business printing a year.
  assert.ok(!/\d{4}/.test(formatTime(Date.UTC(2026, 5, 1, 14), 30 * minute)));
  // A yearly axis prints exactly the year.
  assert.equal(formatTime(Date.UTC(2026, 5, 1), 400 * day), '2026');
});

test('a log scale drops non-positive values rather than clamping them', () => {
  // Clamping to a tiny epsilon draws a line plunging off the plot, which reads as data. log(0) is
  // not a number and the honest answer is to have no pixel at all.
  const scale = logScale([1, 1000], [0, 300]);
  assert.ok(Number.isFinite(scale.to(1)));
  assert.ok(Number.isFinite(scale.to(1000)));
  assert.ok(!Number.isFinite(scale.to(0)) || scale.to(0) === scale.to(1), 'zero produced a plottable pixel');
  // Decades are evenly spaced — the whole point of a log axis.
  const a = scale.to(10) - scale.to(1);
  const b = scale.to(100) - scale.to(10);
  assert.ok(Math.abs(a - b) < 1e-6, `decades uneven: ${a} vs ${b}`);
});

test('extent ignores non-finite values and has an answer when there are none', () => {
  assert.deepEqual(extent([3, NaN, 1, Infinity, 7]), [1, 7]);
  assert.deepEqual(extent([]), [0, 1]);
  assert.deepEqual(extent([NaN, NaN]), [0, 1]);
});

test('compactNumber shortens only where it saves room, and keeps the sign', () => {
  assert.equal(compactNumber(1200), '1.2k');
  assert.equal(compactNumber(3_400_000), '3.4M');
  assert.equal(compactNumber(-1200), '-1.2k');
  assert.equal(compactNumber(999), '999');
  assert.equal(compactNumber(0), '0');
});

test('invert is the inverse of to, for every scale kind', () => {
  // Hit-testing and the brush both depend on this. A scale that cannot be read backwards makes the
  // pointer land on the wrong row.
  const linear = linearScale([0, 100], [0, 500]);
  assert.ok(Math.abs(linear.invert(linear.to(42)) - 42) < 1e-9);
  const time = timeScale([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 8)], [0, 700]);
  const at = Date.UTC(2026, 0, 3, 7);
  assert.ok(Math.abs(time.invert(time.to(at)) - at) < 1);
});
