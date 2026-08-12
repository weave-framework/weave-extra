/**
 * The window over a long series, and the shapes a session is drawn as.
 *
 * `zoomRange` and `isUp` are the two here that are easy to get subtly wrong and impossible to
 * notice by eye: one is about where the pointer stays, the other about which day was a down day.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candleBody, clampRange, isUp, ohlcPath, panRange, zoomRange } from '../dist/components/chart/financial.js';

const valid = (range, count) =>
  Number.isInteger(range[0]) && Number.isInteger(range[1]) &&
  range[0] >= 0 && range[1] <= count - 1 && range[0] <= range[1];

test('clampRange keeps a window inside the data, whatever it is handed', () => {
  const count = 100;
  for (const input of [[-50, 50], [50, 500], [-10, -5], [200, 300], [80, 20], [0, 0], [99, 99]]) {
    const out = clampRange(input, count);
    assert.ok(valid(out, count), `${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
  }
});

test('clampRange never returns an empty window', () => {
  // An empty window renders an empty plot, which reads as "no data" rather than as "zoomed too far".
  for (const count of [1, 2, 5, 500]) {
    const out = clampRange([50, 50], count);
    assert.ok(out[1] >= out[0], `empty at count ${count}`);
    assert.ok(valid(out, count));
  }
});

test('zoom is about the pointer: the bar under the cursor stays under it', () => {
  /**
   * The property that makes wheel-zoom feel right. You point at a spike, the window narrows, and
   * the spike does not slide away — because zooming about the CENTRE moves everything you were
   * looking at.
   */
  const count = 500;
  let range = [0, 499];
  for (const at of [0, 0.25, 0.5, 0.75, 1]) {
    const before = range[0] + (range[1] - range[0]) * at;
    const zoomed = zoomRange(range, count, 0.5, at);
    const after = zoomed[0] + (zoomed[1] - zoomed[0]) * at;
    // Within a bar: the range is integers, so exact fixity is not available.
    assert.ok(Math.abs(after - before) <= 1.5, `pointer at ${at} moved from ${before} to ${after}`);
    assert.ok(zoomed[1] - zoomed[0] < range[1] - range[0], 'zooming in did not narrow the window');
  }
});

test('zoom stops rather than inverting or emptying the window', () => {
  const count = 200;
  let range = [0, 199];
  // Twenty zoom-ins in a row is a real gesture on a trackpad.
  for (let i = 0; i < 20; i++) {
    range = zoomRange(range, count, 0.5, 0.5);
    assert.ok(valid(range, count), `invalid after ${i + 1} steps: ${JSON.stringify(range)}`);
  }
  // And back out again, past the full extent.
  for (let i = 0; i < 40; i++) {
    range = zoomRange(range, count, 2, 0.5);
    assert.ok(valid(range, count), `invalid zooming out at step ${i + 1}`);
  }
  assert.deepEqual([...range], [0, count - 1], 'zooming out did not settle on the whole series');
});

test('panning keeps the window the same width until it hits an end', () => {
  const count = 300;
  const start = [100, 159];
  const width = start[1] - start[0];
  for (const bars of [-40, -1, 1, 40]) {
    const moved = panRange(start, count, bars);
    assert.equal(moved[1] - moved[0], width, `width changed panning ${bars}`);
    assert.ok(valid(moved, count));
  }
  // At the edge it stops rather than sliding past and shrinking.
  const far = panRange(start, count, 10_000);
  assert.equal(far[1], count - 1);
  assert.equal(far[1] - far[0], width, 'the window shrank at the edge');
});

test('a session is up or down against the PREVIOUS CLOSE, not against its own open', () => {
  /**
   * The bug this encodes: a session that opened below yesterday's close and recovered to just above
   * its own open is a DOWN day. Colouring it green tells the reader the opposite of what happened.
   */
  const bar = { open: 100, high: 106, low: 99, close: 105 };
  assert.equal(isUp(bar, 110), false, 'closed below the previous close but was painted up');
  assert.equal(isUp(bar, 100), true);
  // With nothing before it, its own open is the only reference there is.
  assert.equal(isUp(bar, undefined), true);
  assert.equal(isUp({ open: 100, high: 101, low: 90, close: 95 }, undefined), false);
});

test('a candle body is never invisible, however small the move', () => {
  // A doji — open and close equal — has zero height and would vanish. It is a real and meaningful
  // session, so it renders as a line rather than as nothing.
  const flat = candleBody(10, 8, 50, 50);
  assert.ok(flat.height >= 1, `doji collapsed to ${flat.height}`);
  assert.equal(flat.width, 8);
  const normal = candleBody(10, 8, 80, 50);
  assert.equal(normal.y, 50, 'the body must start at the higher of the two prices');
  assert.equal(normal.height, 30);
});

test('an OHLC bar is one path, and never contains NaN', () => {
  // One path per session rather than three: 500 sessions cost 500 nodes instead of 1,500.
  const d = ohlcPath(50, 4, 10, 90, 30, 70);
  assert.ok(!/NaN/.test(d), d);
  assert.ok((d.match(/M/g) ?? []).length >= 1);
  // The high–low stroke plus a tick each side, in one string.
  assert.ok(d.includes('10') && d.includes('90'), `wick prices missing: ${d}`);
});
