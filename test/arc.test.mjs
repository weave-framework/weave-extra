/**
 * Pie and donut geometry.
 *
 * A pie fails by lying about proportion or by drifting out of its box, and both are arithmetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAU, arcCentroid, arcPath, fitArc, groupTail, layoutArcs, polar, toRadians } from '../dist/components/chart/arc.js';

const entries = (...values) => values.map((value, index) => ({ label: `s${index}`, value, index }));

test('slices cover the full turn exactly, and each is its own share of it', () => {
  // The one thing a pie must not get wrong. A gap or an overlap is a chart that does not add up.
  const slices = layoutArcs(entries(50, 30, 20));
  assert.equal(slices.length, 3);
  assert.ok(Math.abs(slices[2].to - slices[0].from - TAU) < 1e-9, 'ring does not close');
  for (let i = 1; i < slices.length; i++) {
    assert.equal(slices[i].from, slices[i - 1].to, 'slices do not meet');
  }
  assert.ok(Math.abs((slices[0].to - slices[0].from) / TAU - 0.5) < 1e-9);
  assert.ok(Math.abs(slices[0].share - 0.5) < 1e-9);
});

test('negative and non-finite values are dropped, not drawn as negative sweeps', () => {
  // A pie of a quantity that can go below zero is not a pie, and drawing one silently is worse
  // than drawing nothing.
  const slices = layoutArcs(entries(50, -30, NaN, 50));
  const swept = slices.filter((s) => s.to > s.from);
  assert.equal(swept.length, 2);
  assert.ok(swept.every((s) => s.to >= s.from), 'a slice swept backwards');
  assert.ok(Math.abs(swept.reduce((n, s) => n + s.share, 0) - 1) < 1e-9, 'shares do not total 1');
});

test('a zero-valued entry produces no slice, and does not dilute the others', () => {
  // It has no arc to draw, so it is not in the geometry at all. Keeping it in the LEGEND is the
  // component's job — a category that exists and measured zero is worth naming.
  const slices = layoutArcs(entries(10, 0, 10));
  assert.equal(slices.length, 2);
  assert.ok(Math.abs(slices.reduce((n, s) => n + s.share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(slices[1].to - slices[0].from - TAU) < 1e-9, 'the ring did not close without it');
});

test('a half turn stays a half turn', () => {
  const slices = layoutArcs(entries(1, 1), { start: toRadians(-90), end: toRadians(90) });
  const swept = slices[slices.length - 1].to - slices[0].from;
  assert.ok(Math.abs(swept - Math.PI) < 1e-9, `swept ${swept}`);
});

test('padding can never eat the slices it separates', () => {
  // Twenty slivers and a generous gap is how a padded pie turns into a ring of gaps. The pad has to
  // yield to the slice, not the other way round.
  const slices = layoutArcs(entries(...Array.from({ length: 20 }, () => 1)), { pad: 0.5 });
  for (const slice of slices) assert.ok(slice.to >= slice.from, 'a slice was consumed by padding');
  assert.ok(slices.some((s) => s.to > s.from), 'every slice vanished');
});

test('groupTail keeps the largest and folds the rest, keeping the total honest', () => {
  // Dropping the tail would quietly change what 100% means.
  const source = entries(50, 25, 12, 8, 3, 2);
  const total = source.reduce((n, e) => n + e.value, 0);
  const grouped = groupTail(source, 3, 'Other');
  assert.equal(grouped.length, 3);
  assert.equal(grouped.reduce((n, e) => n + e.value, 0), total);
  assert.equal(grouped[grouped.length - 1].label, 'Other');
  assert.equal(grouped[grouped.length - 1].index, -1, 'the synthesised slice must not claim a row');
  assert.deepEqual(grouped.slice(0, 2).map((e) => e.value), [50, 25]);
});

test('groupTail leaves a short list alone rather than inventing an empty Other', () => {
  const source = entries(3, 2, 1);
  assert.deepEqual(groupTail(source, 6), source);
  assert.deepEqual(groupTail(source, 3), source);
});

/** The box the drawn arc actually occupies — its ends plus any compass point it sweeps through. */
const arcBox = (fit, from, to) => {
  const angles = [from, to];
  for (let k = -4; k <= 8; k++) {
    const cardinal = (k * Math.PI) / 2;
    if (cardinal > from && cardinal < to) angles.push(cardinal);
  }
  const points = angles.map((a) => polar(fit.cx, fit.cy, fit.radius, a));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
};

test('fitArc centres what is actually drawn — the floating semicircle bug', () => {
  /**
   * The defect: a semicircle was laid out as if it were a full circle, so it filled the top half of
   * its box and left the bottom half empty. The fix is not a bigger radius — it is measuring the
   * arc's OWN extent and centring that, which is what this asserts for several sweeps at once.
   */
  for (const [name, from, to] of [
    ['full turn', toRadians(0), toRadians(0) + TAU],
    ['top half', toRadians(-90), toRadians(90)],
    ['bottom half', toRadians(90), toRadians(270)],
    ['right quarter', toRadians(0), toRadians(90)],
  ]) {
    const fit = fitArc(400, 300, from, to);
    const box = arcBox(fit, from, to);
    // Centred: the space left over is the same on both sides, and on top and bottom.
    assert.ok(Math.abs(box.minX - (400 - box.maxX)) < 1e-6, `${name} is off-centre horizontally`);
    assert.ok(Math.abs(box.minY - (300 - box.maxY)) < 1e-6, `${name} is off-centre vertically`);
    // And inside its box, whatever it chose.
    assert.ok(box.minX >= -1e-6 && box.maxX <= 400 + 1e-6, `${name} overflows horizontally`);
    assert.ok(box.minY >= -1e-6 && box.maxY <= 300 + 1e-6, `${name} overflows vertically`);
  }
});

test('a half arc fills its box rather than leaving the other half empty', () => {
  // The visible symptom of the same bug: laid out as a full circle, a semicircle uses half the box.
  const from = toRadians(-90);
  const to = toRadians(90);
  const box = arcBox(fitArc(400, 400, from, to), from, to);
  assert.ok(box.maxX - box.minX > 300, `a half arc only spanned ${box.maxX - box.minX}px of 400`);
});

test('a full-turn arc is emitted as two half turns', () => {
  // One SVG arc command cannot express 360°: start and end coincide and the browser draws nothing.
  const d = arcPath(100, 100, 0, 50, 0, TAU);
  assert.ok(d.length > 0);
  assert.ok((d.match(/A/g) ?? []).length >= 2, `a full turn needs two arcs: ${d}`);
  assert.ok(!/NaN/.test(d));
});

test('arc paths never contain NaN, for any angle or radius pair', () => {
  // A single NaN silently removes the slice from the page.
  for (const [inner, outer] of [[0, 50], [30, 50], [0, 1]]) {
    for (const [from, to] of [[0, 0.1], [0, Math.PI], [Math.PI, TAU], [0, TAU], [-1, 1]]) {
      assert.ok(!/NaN/.test(arcPath(60, 60, inner, outer, from, to)), `NaN at ${inner}-${outer} ${from}..${to}`);
    }
  }
});

test('a centroid sits inside its own band, where a label can be read', () => {
  const inner = 30;
  const outer = 60;
  const centre = arcCentroid(100, 100, inner, outer, 0, Math.PI / 2);
  const distance = Math.hypot(centre.x - 100, centre.y - 100);
  assert.ok(distance > inner && distance < outer, `centroid at ${distance}, outside ${inner}..${outer}`);
});

test('zero degrees is twelve o clock, and degrees run clockwise', () => {
  // The convention the whole radial layout assumes, and it lives in `toRadians` rather than in
  // `polar` — which takes plain maths angles. Getting the pairing wrong rotates every pie by 90°.
  const at = (degrees) => polar(0, 0, 10, toRadians(degrees));
  const close = (p, x, y) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
  assert.ok(close(at(0), 0, -10), `0° is not up: ${JSON.stringify(at(0))}`);
  assert.ok(close(at(90), 10, 0), `90° is not right: ${JSON.stringify(at(90))}`);
  assert.ok(close(at(180), 0, 10), `180° is not down: ${JSON.stringify(at(180))}`);
  assert.ok(close(at(270), -10, 0), `270° is not left: ${JSON.stringify(at(270))}`);
});
