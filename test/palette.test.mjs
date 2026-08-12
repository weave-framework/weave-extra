/**
 * Colour: the cycle, and the parsing the morph does before it can interpolate anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_SIZE, chartInk, paletteDefault, seriesColor, seriesDash } from '../dist/components/chart/palette.js';
import { alignRing, parseColor } from '../dist/components/chart/morph.js';

test('a series colour is a custom property with a literal fallback', () => {
  /**
   * Both halves matter. The custom property is what lets a consumer restyle a chart from an
   * ancestor without touching the component; the fallback is what makes it work when they have not.
   */
  const colour = seriesColor(0);
  assert.match(colour, /^var\(--weave-chart-1,\s*#[0-9a-f]{6}\)$/i, colour);
  assert.match(seriesColor(7), /--weave-chart-8/);
});

test('the palette cycles, and past the first cycle the dash changes', () => {
  // Nine series on eight colours means two share a hue. A dash is what keeps them apart, and it is
  // the channel that survives greyscale and colour blindness.
  assert.equal(seriesColor(PALETTE_SIZE), seriesColor(0), 'the cycle does not wrap');
  assert.equal(seriesDash(0), undefined, 'the first cycle should be solid');
  assert.ok(seriesDash(PALETTE_SIZE), 'the second cycle is not dashed');
  assert.notEqual(seriesDash(PALETTE_SIZE), seriesDash(PALETTE_SIZE * 2), 'cycles two and three look alike');
});

test('an explicit colour is passed through untouched', () => {
  assert.equal(seriesColor(3, 'rebeccapurple'), 'rebeccapurple');
  assert.equal(seriesColor(3, 'var(--brand)'), 'var(--brand)');
});

test('the dark palette is lifted, not the same hues repeated', () => {
  // A saturated colour that reads as solid on white glows on near-black, and a chart of glowing
  // lines is unreadable at any length.
  for (let i = 0; i < PALETTE_SIZE; i++) {
    assert.notEqual(paletteDefault(i, 'light'), paletteDefault(i, 'dark'), `slot ${i} is identical in both themes`);
  }
});

test('chartInk names its roles rather than its colours', () => {
  for (const key of ['grid', 'axis', 'label']) {
    assert.ok(key in chartInk, `missing ${key}`);
    assert.ok(String(chartInk[key]).length > 0);
  }
});

test('parseColor treats absence as transparent, not as black', () => {
  /**
   * The bug this encodes: `none` parsed as opaque black, so a mark fading out dragged every
   * interpolation through black on its way to invisible. A `<line>` computes a fill of black too,
   * which painted every candle wick solid mid-morph.
   */
  assert.deepEqual(parseColor('none'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor(''), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor('rgb(76, 98, 134)'), { r: 76, g: 98, b: 134, a: 1 });
  assert.deepEqual(parseColor('rgba(76, 98, 134, 0.35)'), { r: 76, g: 98, b: 134, a: 0.35 });
});

test('alignRing rotates a ring to the offset that lands nearest its target', () => {
  /**
   * Two outlines sampled independently start wherever their own geometry starts. Interpolating
   * those directly turns the shape inside out on the way across — the ugliest artefact in shape
   * morphing, and the reason this function exists.
   */
  const square = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
  // The same square, sampled starting from a different corner.
  const rotated = new Float64Array([10, 10, 0, 10, 0, 0, 10, 0]);
  const aligned = alignRing(rotated, square);
  assert.deepEqual([...aligned], [...square], 'the ring was not rotated back into step');
});

test('alignRing leaves an already-aligned ring alone', () => {
  const ring = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
  assert.deepEqual([...alignRing(ring, ring)], [...ring]);
});

test('alignRing never loses or invents a point', () => {
  const from = new Float64Array([0, 0, 5, 1, 9, 4, 4, 9]);
  const to = new Float64Array([9, 4, 4, 9, 0, 0, 5, 1]);
  const aligned = alignRing(from, to);
  assert.equal(aligned.length, from.length);
  // Same multiset of points, only the starting offset differs.
  const pairs = (r) => Array.from({ length: r.length / 2 }, (_, i) => `${r[i * 2]},${r[i * 2 + 1]}`).sort();
  assert.deepEqual(pairs(aligned), pairs(from));
});
