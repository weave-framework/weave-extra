/**
 * Candlesticks, OHLC bars, and the visible window over them.
 *
 * Two decisions here are the whole difference between a financial chart and a line chart with
 * fancier marks, and both are worth stating because they look like details and are not.
 *
 * **The x axis is ordinal, not time.** Markets are closed at night and at weekends. On a continuous
 * time axis those hours are real distance, so a daily chart spends two sevenths of its width drawing
 * nothing and every candle is separated by a gap it did not earn. Every serious financial chart
 * indexes by BAR and formats the labels as time — which is what makes "the last 60 sessions" a
 * window of 60 candles rather than of 60 days containing 43 of them.
 *
 * **Candles do not animate into place.** A price chart is read by shape, and marks growing out of
 * the axis change the shape while it is being read. Fading in is the most a candle should do, and
 * even that only on first paint.
 */

/** The four prices, already read off a row. */
export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A window over the rows: `[first, last]` inclusive, in index space. */
export type Range = readonly [number, number];

/** Fewer than this and the marks are wider than the data is informative. */
const MIN_BARS = 5;

/**
 * Keep a window inside the data and above the minimum width.
 *
 * Both ends come back as WHOLE bars. The start was already rounded and the width was not, so a
 * zoom returned things like `[50, 149.5]` — and a range is documented as inclusive row indices,
 * handed to the caller through `onRangeChange` and, for a controlled chart, likely to end up in a
 * URL. Half a row is not an index. It also quietly cost a bar on every other zoom step, because
 * slicing with a fractional bound truncates.
 */
export function clampRange(range: Range, count: number): Range {
  if (count <= 0) return [0, 0];
  const width: number = Math.round(Math.max(MIN_BARS - 1, Math.min(count - 1, range[1] - range[0])));
  let start: number = Math.max(0, Math.min(count - 1 - width, Math.round(range[0])));
  if (start < 0) start = 0;
  return [start, Math.min(count - 1, start + width)];
}

/**
 * Zoom about a point, so the bar under the pointer stays under it.
 *
 * Zooming about the centre is the lazy version and it fights the reader: they point at the spike
 * they care about, and it slides away from the cursor as the window narrows.
 *
 * `factor` below 1 zooms in.
 */
export function zoomRange(range: Range, count: number, factor: number, at: number): Range {
  const width: number = range[1] - range[0];
  const anchor: number = range[0] + width * Math.min(1, Math.max(0, at));
  const next: number = Math.max(MIN_BARS - 1, Math.min(count - 1, width * factor));
  const start: number = anchor - (anchor - range[0]) * (next / (width || 1));
  return clampRange([start, start + next], count);
}

/** Slide the window by whole bars, keeping its width. */
export function panRange(range: Range, count: number, bars: number): Range {
  const width: number = range[1] - range[0];
  const start: number = range[0] + bars;
  return clampRange([start, start + width], count);
}

/**
 * A candle's body.
 *
 * A doji — open equal to close — has no height, and a zero-height rect draws nothing at all. It is
 * given one pixel instead, because "opened and closed at the same price" is a real and meaningful
 * bar, not missing data.
 */
export function candleBody(
  x: number,
  width: number,
  openY: number,
  closeY: number
): { x: number; y: number; width: number; height: number } {
  const top: number = Math.min(openY, closeY);
  const height: number = Math.max(1, Math.abs(closeY - openY));
  return { x, y: top, width, height };
}

/**
 * An OHLC bar as one path: the high–low stroke, a tick left for the open and right for the close.
 *
 * One path rather than three elements per bar. At 500 bars that is 500 nodes instead of 1,500, and
 * the difference is visible in a chart people scroll through.
 */
export function ohlcPath(
  cx: number,
  tick: number,
  highY: number,
  lowY: number,
  openY: number,
  closeY: number
): string {
  const r = (value: number): number => Math.round(value * 100) / 100;
  return (
    `M ${r(cx)} ${r(highY)} L ${r(cx)} ${r(lowY)}` +
    ` M ${r(cx - tick)} ${r(openY)} L ${r(cx)} ${r(openY)}` +
    ` M ${r(cx)} ${r(closeY)} L ${r(cx + tick)} ${r(closeY)}`
  );
}

/**
 * Up or down.
 *
 * Against the PREVIOUS close when there is one, not against this bar's own open. A bar that opened
 * below yesterday's close and recovered to just above its own open is a down day, and colouring it
 * green is how a chart tells its reader the opposite of what happened. Falls back to open-vs-close
 * for the first bar, which has nothing to compare against.
 */
export function isUp(bar: Bar, previousClose: number | undefined): boolean {
  const reference: number = previousClose ?? bar.open;
  return bar.close >= reference;
}
