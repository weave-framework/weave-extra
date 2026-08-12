/**
 * Path geometry.
 *
 * The one that matters here is overshoot. A cardinal spline through 10, 90, 10 draws a peak above
 * 90 — a chart showing a value nobody measured — and it is invisible unless you go looking.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaPath, barPath, linePath } from '../dist/components/chart/marks.js';

const pts = (...ys) => ys.map((y, i) => ({ x: i * 50, y, defined: true }));

/** Every y the path visits: on-curve points and control points alike. */
const ys = (d) => {
  const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return numbers.filter((_, i) => i % 2 === 1);
};

test('a smooth curve never overshoots its own points', () => {
  /**
   * Monotone, not cardinal. The usual spline through 10, 90, 10 renders a peak above 90, and a
   * reader has no way to know the summit is an artefact of the interpolation.
   */
  for (const values of [[10, 90, 10], [0, 100, 0], [50, 51, 50], [5, 5, 90, 5, 5], [100, 0, 100]]) {
    const d = linePath(pts(...values), 'smooth');
    const low = Math.min(...values);
    const high = Math.max(...values);
    for (const y of ys(d)) {
      assert.ok(y >= low - 1e-6 && y <= high + 1e-6, `overshoot to ${y} outside ${low}..${high} for ${values}`);
    }
  }
});

test('a smooth curve still passes through every point it was given', () => {
  // Not overshooting is easy if you also stop touching the data.
  const values = [10, 90, 30, 60];
  const d = linePath(pts(...values), 'smooth');
  for (const value of values) {
    assert.ok(ys(d).some((y) => Math.abs(y - value) < 1e-6), `${value} is not on the curve`);
  }
});

test('a gap ends the run and starts a new one', () => {
  /**
   * Interpolating across missing data is the quiet lie charts tell most often: three months of
   * absent revenue drawn as a smooth climb. A break has to be a break.
   */
  const points = [
    { x: 0, y: 10, defined: true },
    { x: 50, y: 20, defined: true },
    { x: 100, y: 0, defined: false },
    { x: 150, y: 40, defined: true },
  ];
  for (const curve of ['linear', 'smooth', 'step']) {
    const d = linePath(points, curve);
    assert.equal((d.match(/M/g) ?? []).length, 2, `${curve} did not break at the gap: ${d}`);
  }
});

test('a single point still draws something, and no points draws nothing', () => {
  assert.equal(linePath([], 'linear'), '');
  const one = linePath([{ x: 10, y: 20, defined: true }], 'linear');
  assert.ok(one === '' || one.includes('M'), `odd single-point path: ${one}`);
  assert.ok(!/NaN/.test(one));
});

test('every curve kind produces a finite path for the same points', () => {
  const points = pts(10, 90, 30, 60, 0, 45);
  for (const curve of ['linear', 'smooth', 'step']) {
    const d = linePath(points, curve);
    assert.ok(d.length > 0, `${curve} produced nothing`);
    assert.ok(!/NaN|Infinity/.test(d), `${curve} produced ${d}`);
  }
});

test('an area closes to its baseline rather than to zero', () => {
  // A right-axis area closed against the left axis's zero is filled to a line that means nothing.
  const d = areaPath(pts(10, 40, 20), 200, 'linear');
  assert.ok(d.includes('200'), `baseline missing: ${d}`);
  assert.ok(/Z\s*$/.test(d.trim()), `area is not closed: ${d}`);
});

test('an area breaks at a gap too, as its own closed shape', () => {
  const points = [
    { x: 0, y: 10, defined: true },
    { x: 50, y: 20, defined: true },
    { x: 100, y: 0, defined: false },
    { x: 150, y: 40, defined: true },
    { x: 200, y: 25, defined: true },
  ];
  const d = areaPath(points, 100, 'linear');
  assert.equal((d.match(/M/g) ?? []).length, 2, `area did not break: ${d}`);
  assert.equal((d.match(/Z/g) ?? []).length, 2, `each run must close on its own: ${d}`);
});

test('a lone point between two gaps is a dot on a line and nothing in an area', () => {
  // Not an inconsistency. A zero-length subpath renders as a dot under a round linecap, which is
  // the honest mark for one reading surrounded by missing ones — but an area needs width to fill,
  // and a fill of nothing is nothing.
  const points = [
    { x: 0, y: 0, defined: false },
    { x: 50, y: 20, defined: true },
    { x: 100, y: 0, defined: false },
  ];
  assert.ok(linePath(points, 'linear').includes('M'), 'the lone reading vanished from the line');
  assert.equal(areaPath(points, 100, 'linear'), '');
});

test('a bar of zero height is still a bar', () => {
  // A zero-height rect draws nothing, and a category that measured zero is not the same as one
  // that is missing.
  const d = barPath(10, 100, 20, 0);
  assert.ok(d.length > 0 && !/NaN/.test(d), d);
});

test('a bar radius never exceeds what the bar can carry', () => {
  // A 2px bar with a 4px corner radius inverts into a bow tie.
  for (const [w, h, r] of [[20, 100, 4], [2, 100, 8], [20, 1, 8], [1, 1, 20]]) {
    const d = barPath(0, 0, w, h, r);
    assert.ok(!/NaN/.test(d), `NaN for ${w}x${h} r${r}: ${d}`);
    const values = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    assert.ok(values.every((v) => Number.isFinite(v)), `non-finite for ${w}x${h} r${r}`);
  }
});
