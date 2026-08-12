/**
 * `<Metric>` — one number, said properly.
 *
 *   <Metric label="Revenue" value={{ 182_400 }} delta={{ 12.4 }} data={{ trend }} y="value" />
 *
 * The tile every dashboard rebuilds by hand, and rebuilds slightly differently each time: a label, a
 * big number, how it moved, and the shape it moved in. It is not a chart, which is why it is not a
 * `<Chart>` type — but it composes one, so the sparkline is the same engine as everything else.
 *
 * The judgement worth having here is `invert`. A delta's COLOUR should follow its meaning, not its
 * sign: churn up 12% is bad, latency down 30ms is good, and a tile that paints every rise green is
 * telling the reader the opposite of the truth on half a dashboard. Most libraries leave this to
 * the caller and most callers forget.
 */

import { computed, type Computed } from '@weave-framework/runtime';
import * as ChartModule from '../chart/chart.js';
import type { Accessor, SeriesType } from '../chart/types.js';

/**
 * A namespace import and one cast, because a sibling component's default export does not exist as
 * far as plain `tsc` is concerned — the compiler synthesizes it from `chart.html` at build time.
 *
 * `weave check` sees it correctly; `tsc` is what actually checks this package (see the README), so
 * the import has to be written in a form both understand. The cast asserts what the compiler will
 * emit, and nothing more: a component is `(props, slots?) => Node`.
 */
const Chart = (ChartModule as unknown as { default: (props: Record<string, unknown>) => Node }).default;

/** What the delta means, once its sign has been read against `invert`. */
export type MetricTone = 'good' | 'bad' | 'flat';

export interface MetricProps<TRow = Record<string, unknown>> {
  /** What the number is. */
  label: string;
  /** The number itself. A string is printed as given; a number goes through {@link format}. */
  value: string | number;
  format?: (value: number) => string;
  /** A unit or qualifier printed after the value, small. */
  unit?: string;

  /**
   * Change since the comparison period, as a percentage. Omit for a tile with no movement to show.
   */
  delta?: number;
  /** What the delta is measured against — "vs last month". Printed next to it. */
  deltaLabel?: string;
  /**
   * Down is good: cost, churn, latency, error rate.
   *
   * Without this a tile paints every rise green, which is wrong for about half the numbers on a
   * real dashboard.
   */
  invert?: boolean;
  /** Force the tone instead of deriving it from the delta. */
  tone?: MetricTone;
  /** How the delta is written. Default: one decimal and a sign. */
  deltaFormat?: (value: number) => string;

  /** Rows for the sparkline. Omit for a tile with no chart. */
  data?: readonly TRow[] | (() => readonly TRow[]);
  x?: Accessor<TRow, unknown>;
  y?: Accessor<TRow, number>;
  /** Mark for the sparkline. Default `'area'` — a shape reads faster at 40px than a line. */
  sparkType?: SeriesType;
  /** Sparkline height in px. Default 40. */
  sparkHeight?: number;
  /** Colour for the sparkline. Defaults to the tone, so the tile reads as one thing. */
  sparkColor?: string;

  /** A progress bar under the value: how far `value` is along to `target`. */
  target?: number;
  targetLabel?: string;
}

export interface MetricContext<TRow> {
  props: MetricProps<TRow>;
  Chart: typeof Chart;
  text: () => string;
  tone: () => MetricTone;
  toneClass: () => string;
  /** `▲`, `▼` or `→` — a redundant channel, so the direction survives greyscale and colour blindness. */
  arrow: () => string;
  deltaText: () => string;
  hasDelta: () => boolean;
  hasSpark: () => boolean;
  sparkSeries: () => { y: Accessor<TRow, number>; type: SeriesType; color: string }[];
  progress: () => number | null;
  /** The same fraction as a whole percent — kept out of the template so `77.10000000000001%` cannot reach a style attribute. */
  percent: () => number;
  progressText: () => string;
}

const defaultFormat = (value: number): string => {
  const abs: number = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value * 100) / 100);
};

export function setup<TRow extends Record<string, unknown> = Record<string, unknown>>(
  props: MetricProps<TRow>
): MetricContext<TRow> {
  const tone: Computed<MetricTone> = computed<MetricTone>(() => {
    if (props.tone) return props.tone;
    const delta: number | undefined = props.delta;
    if (delta === undefined || !Number.isFinite(delta) || delta === 0) return 'flat';
    const rising: boolean = delta > 0;
    // The sign says which way; `invert` says what that means. Keeping them apart is the whole point.
    return rising === !props.invert ? 'good' : 'bad';
  });

  return {
    props,
    Chart,
    text: (): string =>
      typeof props.value === 'string' ? props.value : (props.format ?? defaultFormat)(props.value),
    tone: (): MetricTone => tone(),
    toneClass: (): string => `weave-metric__delta weave-metric__delta--${tone()}`,
    arrow: (): string => {
      const delta: number | undefined = props.delta;
      if (delta === undefined || !Number.isFinite(delta) || delta === 0) return '→';
      return delta > 0 ? '▲' : '▼';
    },
    deltaText: (): string => {
      const delta: number | undefined = props.delta;
      if (delta === undefined || !Number.isFinite(delta)) return '';
      if (props.deltaFormat) return props.deltaFormat(delta);
      return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
    },
    hasDelta: (): boolean => props.delta !== undefined && Number.isFinite(props.delta),
    hasSpark: (): boolean => props.data !== undefined && props.y !== undefined,
    sparkSeries: (): { y: Accessor<TRow, number>; type: SeriesType; color: string }[] => {
      if (!props.y) return [];
      const colors: Record<MetricTone, string> = {
        good: 'var(--weave-chart-up, #2f9e6a)',
        bad: 'var(--weave-chart-down, #d1483f)',
        flat: 'var(--weave-chart-1, #4c6286)',
      };
      return [
        {
          y: props.y,
          type: props.sparkType ?? 'area',
          color: props.sparkColor ?? colors[tone()],
        },
      ];
    },
    /** Fraction of the target reached, clamped — a bar past 100% would run out of its own track. */
    progress: (): number | null => {
      if (props.target === undefined || typeof props.value !== 'number') return null;
      if (!Number.isFinite(props.target) || props.target === 0) return null;
      return Math.max(0, Math.min(1, props.value / props.target));
    },
    percent: (): number => {
      const done: number | null =
        props.target === undefined || typeof props.value !== 'number' || !Number.isFinite(props.target) || props.target === 0
          ? null
          : Math.max(0, Math.min(1, props.value / props.target));
      return done === null ? 0 : Math.round(done * 1000) / 10;
    },
    progressText: (): string => {
      if (props.target === undefined) return '';
      const format: (value: number) => string = props.format ?? defaultFormat;
      return `${props.targetLabel ?? 'of'} ${format(props.target)}`;
    },
  };
}

export { Chart };
