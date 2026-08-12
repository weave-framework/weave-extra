/**
 * Scales — the map from a datum to a pixel, and the ticks that explain it.
 *
 * Every chart type in this package goes through here, which is the point: an axis that reads well is
 * the difference between a chart and a picture of one, and getting it right once is cheaper than
 * getting it slightly wrong per chart type.
 *
 * Deliberately four kinds and no plugin seam. `linear` and `band` cover almost everything; `time`
 * exists because date ticks are their own problem and faking them with `linear` produces the
 * "Mar 3, Mar 8, Mar 13" ladder nobody wants to read; `log` exists because the alternative is a
 * flat line at the bottom of the plot. Anything beyond those is a chart the caller should be drawing
 * themselves.
 */

/** What every scale can do: place a value, and describe itself. */
export interface Scale<T> {
  /** Value → pixel, along the axis's own direction. */
  to: (value: T) => number;
  /** The pixel range, `[from, to]`. For a y-axis `from > to` — screen y grows downward. */
  range: readonly [number, number];
  /** Tick values, already chosen to be readable at this size. */
  ticks: (count?: number) => T[];
  /** How a tick value is written by default. */
  format: (value: T) => string;
}

/** A scale that also owns a slot width — bars need to know how wide they may be. */
export interface BandScale extends Scale<string> {
  /** Width of one category's slot, padding excluded. */
  bandwidth: number;
  /** Left edge of a category's slot. `to()` returns its CENTRE. */
  start: (value: string) => number;
  domain: readonly string[];
}

export interface LinearScale extends Scale<number> {
  domain: readonly [number, number];
  /** Pixel → value. Needed by anything that reads a pointer position back. */
  invert: (pixel: number) => number;
}

export interface TimeScale extends Scale<number> {
  domain: readonly [number, number];
  invert: (pixel: number) => number;
}

/* ────────────────────────────── nice numbers ────────────────────────────── */

/**
 * The 1 / 2 / 5 / 10 ladder.
 *
 * A tick step a reader can do arithmetic on in their head. Every charting library converges on this
 * because the alternative — dividing the extent by the tick count — produces steps like 3.7, and an
 * axis labelled 0, 3.7, 7.4 is an axis nobody reads.
 */
function niceStep(rough: number): number {
  if (rough <= 0 || !Number.isFinite(rough)) return 1;
  const magnitude: number = 10 ** Math.floor(Math.log10(rough));
  const scaled: number = rough / magnitude;
  const step: number = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Round a domain outward to the nearest nice step, so the axis ends on a round number. */
export function niceDomain(min: number, max: number, count: number = 5): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    // A flat series still needs a plot to sit in. Centre it rather than collapsing to a zero-height
    // band, which would put the line on the axis and look like missing data.
    const pad: number = Math.abs(min) || 1;
    return [min - pad, max + pad];
  }
  const step: number = niceStep((max - min) / Math.max(1, count));
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** Decimals needed to write `step` without lying about precision. */
function decimalsFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const exponent: number = Math.floor(Math.log10(step));
  return exponent >= 0 ? 0 : -exponent;
}

/**
 * Compact notation for an axis: 1.2k, 3.4M.
 *
 * Axis labels are read at a glance and sit in a narrow gutter; `1200000` there costs width and
 * reads slower than `1.2M`. A tooltip shows the exact number, which is where exactness belongs.
 */
export function compactNumber(value: number, decimals: number = 0): string {
  const abs: number = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}k`;
  return value.toFixed(decimals);
}

const trim = (value: number): string =>
  (Math.round(value * 10) / 10).toFixed(Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);

/* ────────────────────────────── linear ────────────────────────────── */

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
  options: { nice?: boolean; tickCount?: number } = {}
): LinearScale {
  const [d0, d1]: [number, number] = options.nice === false
    ? [domain[0], domain[1]]
    : niceDomain(domain[0], domain[1], options.tickCount ?? 5);
  const span: number = d1 - d0 || 1;
  const [r0, r1]: readonly [number, number] = range;

  const ticks = (count: number = options.tickCount ?? 5): number[] => {
    const step: number = niceStep(span / Math.max(1, count));
    const out: number[] = [];
    // Multiplying the index rather than accumulating: adding 0.1 forty times lands on
    // 4.000000000000001 and the axis prints it.
    const first: number = Math.ceil(d0 / step);
    for (let i: number = first; i * step <= d1 + step / 1e6; i++) out.push(i * step);
    return out;
  };

  const step: number = niceStep(span / Math.max(1, options.tickCount ?? 5));
  const decimals: number = decimalsFor(step);

  return {
    domain: [d0, d1],
    range,
    to: (value: number): number => r0 + ((value - d0) / span) * (r1 - r0),
    invert: (pixel: number): number => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span,
    ticks,
    format: (value: number): string => compactNumber(value, decimals),
  };
}

/* ────────────────────────────── band ────────────────────────────── */

/**
 * Categories laid side by side — the x-axis of every bar chart.
 *
 * `padding` is the share of each slot left empty, so bars have air between them without the caller
 * doing arithmetic. 0.2 is the value every library converged on and it is right.
 */
export function bandScale(
  domain: readonly string[],
  range: readonly [number, number],
  options: { padding?: number } = {}
): BandScale {
  const padding: number = options.padding ?? 0.2;
  const n: number = Math.max(1, domain.length);
  const [r0, r1]: readonly [number, number] = range;
  const slot: number = (r1 - r0) / n;
  const bandwidth: number = Math.max(1, slot * (1 - padding));
  const index: Map<string, number> = new Map(domain.map((value, i) => [value, i]));

  const start = (value: string): number => r0 + (index.get(value) ?? 0) * slot + (slot - bandwidth) / 2;

  return {
    domain,
    range,
    bandwidth,
    start,
    to: (value: string): number => start(value) + bandwidth / 2,
    /**
     * Thinning, not sampling: with more categories than fit, every nth label is kept. Dropping the
     * tail instead would silently truncate the axis, and rotating them all is a worse answer than
     * showing fewer.
     */
    ticks: (count: number = domain.length): string[] => {
      if (domain.length <= count) return [...domain];
      const stride: number = Math.ceil(domain.length / Math.max(1, count));
      return domain.filter((_, i) => i % stride === 0);
    },
    format: (value: string): string => value,
  };
}

/* ────────────────────────────── time ────────────────────────────── */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * The steps a date axis is allowed to use.
 *
 * A fixed ladder rather than nice-numbers on milliseconds, because time is not decimal: the useful
 * steps are 1/5/15/30 minutes, hours, days, weeks, months, years — and a "nice" 8.64e7 ms step is
 * a day only by accident.
 */
const TIME_STEPS: readonly number[] = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, WEEK, 2 * WEEK,
  MONTH, 3 * MONTH, 6 * MONTH,
  YEAR, 2 * YEAR, 5 * YEAR, 10 * YEAR,
];

/** The step closest to what `count` ticks over `span` would want. */
function timeStep(span: number, count: number): number {
  const rough: number = span / Math.max(1, count);
  for (const step of TIME_STEPS) if (step >= rough) return step;
  return TIME_STEPS[TIME_STEPS.length - 1];
}

/** Label a timestamp at the resolution the step implies — no year on an hourly axis. */
export function formatTime(value: number, step: number): string {
  const date: Date = new Date(value);
  if (step < MINUTE) return date.toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' });
  if (step < DAY) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (step < MONTH) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (step < YEAR) return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  return String(date.getFullYear());
}

export function timeScale(
  domain: readonly [number, number],
  range: readonly [number, number],
  options: { tickCount?: number } = {}
): TimeScale {
  const [d0, d1]: readonly [number, number] = domain;
  const span: number = d1 - d0 || DAY;
  const [r0, r1]: readonly [number, number] = range;
  /**
   * The step the labels are written at, remembered from the last `ticks()` call.
   *
   * `format` and `ticks` have to agree or the axis lies: asked for two ticks over two days, `ticks`
   * chose a 24-hour step while `format` still held the 12-hour one it was built with, and both
   * labels came out as "02:00 AM" — the same clock time, a day apart, indistinguishable.
   */
  let labelStep: number = timeStep(span, options.tickCount ?? 6);

  return {
    domain,
    range,
    to: (value: number): number => r0 + ((value - d0) / span) * (r1 - r0),
    invert: (pixel: number): number => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span,
    ticks: (count: number = options.tickCount ?? 6): number[] => {
      const chosen: number = timeStep(span, count);
      labelStep = chosen;
      const out: number[] = [];
      // Aligned to the step, so ticks land on the hour/day/month rather than on the data's start.
      for (let t: number = Math.ceil(d0 / chosen) * chosen; t <= d1; t += chosen) out.push(t);
      return out;
    },
    format: (value: number): string => formatTime(value, labelStep),
  };
}

/* ────────────────────────────── log ────────────────────────────── */

/**
 * A log scale, for a series whose interesting part is at the bottom.
 *
 * Non-positive values are dropped rather than clamped: log(0) is not a number, and clamping to a
 * tiny epsilon draws a line plunging off the plot, which reads as data rather than as the absence
 * of it.
 */
export function logScale(
  domain: readonly [number, number],
  range: readonly [number, number]
): LinearScale {
  const d0: number = Math.max(domain[0], Number.MIN_VALUE);
  const d1: number = Math.max(domain[1], d0 * 10);
  const l0: number = Math.log10(d0);
  const l1: number = Math.log10(d1);
  const span: number = l1 - l0 || 1;
  const [r0, r1]: readonly [number, number] = range;

  return {
    domain: [d0, d1],
    range,
    to: (value: number): number =>
      value <= 0 ? r0 : r0 + ((Math.log10(value) - l0) / span) * (r1 - r0),
    invert: (pixel: number): number => 10 ** (l0 + ((pixel - r0) / (r1 - r0 || 1)) * span),
    ticks: (): number[] => {
      const out: number[] = [];
      for (let e: number = Math.floor(l0); e <= Math.ceil(l1); e++) {
        const decade: number = 10 ** e;
        if (decade >= d0 && decade <= d1) out.push(decade);
      }
      return out;
    },
    format: (value: number): string => compactNumber(value),
  };
}

/** Min and max of the finite numbers in `values`. `[0, 1]` when there are none. */
export function extent(values: readonly number[]): [number, number] {
  let min: number = Infinity;
  let max: number = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? [0, 1] : [min, max];
}
