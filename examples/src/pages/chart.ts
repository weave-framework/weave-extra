/**
 * `<Chart>` — the first stage: the engine, and the three cartesian marks that ride on it.
 *
 * Every demo below is the same component with different props. That is the claim being tested on
 * this page: one tag, and the difference between a bar chart and a stacked combo is what you type,
 * not which component you reach for.
 */

import { computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import Chart, { type SeriesConfig } from '@weave-framework/extra/components/chart';
import Metric from '@weave-framework/extra/components/metric';
import Demo from '../lib/demo/demo.js';
import CodeTabs from '../lib/code-tabs/code-tabs.js';

export interface Month extends Record<string, unknown> {
  month: string;
  revenue: number;
  cost: number;
  margin: number;
}

const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function makeMonths(seed: number): Month[] {
  return MONTHS.map((month, i) => {
    const revenue: number = Math.round(40_000 + Math.sin((i + seed) / 1.7) * 18_000 + i * 1_800);
    const cost: number = Math.round(revenue * (0.52 + Math.cos((i + seed) / 2.3) * 0.1));
    return { month, revenue, cost, margin: revenue - cost };
  });
}

export interface Reading extends Record<string, unknown> {
  at: number;
  load: number;
  queue: number;
}

/** An hourly series, to exercise the time axis and a gap in the data. */
const READINGS: Reading[] = Array.from({ length: 48 }, (_, i) => ({
  at: Date.UTC(2026, 6, 1) + i * 3_600_000,
  // A deliberate hole: a line that spans missing data is the quiet lie charts tell most often.
  load: i >= 20 && i <= 23 ? NaN : Math.round(50 + Math.sin(i / 3) * 30 + (i % 5) * 2),
  queue: Math.round(12 + Math.cos(i / 4) * 9),
}));

export interface Share extends Record<string, unknown> {
  product: string;
  revenue: number;
}

/** Nine categories, five of them slivers — the shape that makes a pie chart fail. */
const SHARE: Share[] = [
  { product: 'Platform', revenue: 82_000 },
  { product: 'Support', revenue: 41_000 },
  { product: 'Training', revenue: 27_000 },
  { product: 'Add-ons', revenue: 14_000 },
  { product: 'Consulting', revenue: 9_000 },
  { product: 'Hosting', revenue: 4_200 },
  { product: 'Certification', revenue: 2_800 },
  { product: 'Merch', revenue: 1_400 },
  { product: 'Misc', revenue: 900 },
];

export interface Session extends Record<string, unknown> {
  day: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** 120 sessions of a plausible random walk — enough that the window has somewhere to go. */
function makeSessions(count: number): Session[] {
  const out: Session[] = [];
  let price: number = 124;
  for (let i: number = 0; i < count; i++) {
    // Deterministic, so the page looks the same on every load and a screenshot means something.
    const drift: number = Math.sin(i / 9) * 1.6 + Math.cos(i / 3.3) * 0.9;
    const open: number = price;
    const close: number = Math.max(1, open + drift + Math.sin(i * 2.7) * 1.2);
    const high: number = Math.max(open, close) + Math.abs(Math.cos(i * 1.9)) * 1.4;
    const low: number = Math.min(open, close) - Math.abs(Math.sin(i * 1.3)) * 1.4;
    const date: Date = new Date(Date.UTC(2026, 0, 5 + Math.floor(i / 5) * 7 + (i % 5)));
    out.push({
      day: date.toISOString().slice(5, 10),
      o: Math.round(open * 100) / 100,
      h: Math.round(high * 100) / 100,
      l: Math.round(low * 100) / 100,
      c: Math.round(close * 100) / 100,
      v: Math.round(400_000 + Math.abs(Math.sin(i / 2.1)) * 900_000),
    });
    price = close;
  }
  return out;
}

const SESSIONS: Session[] = makeSessions(120);

export interface Point extends Record<string, unknown> {
  t: number;
  v: number;
}

/** Short series for the tiles — a sparkline is read as a shape, so 24 points is plenty. */
function trend(from: number, drift: number): Point[] {
  return Array.from({ length: 24 }, (_, i) => ({
    t: i,
    v: Math.round((from + drift * i + Math.sin(i / 2.4) * from * 0.06) * 100) / 100,
  }));
}

export interface ChartPageContext {
  Chart: typeof Chart;
  Metric: typeof Metric;
  Button: typeof Button;
  Demo: typeof Demo;
  CodeTabs: typeof CodeTabs;
  months: Computed<Month[]>;
  readings: Reading[];
  share: Share[];
  sessions: Session[];
  revenueTrend: Point[];
  churnTrend: Point[];
  latencyTrend: Point[];
  seatsTrend: Point[];
  ohlc: readonly ['o', 'h', 'l', 'c'];
  price: (value: number) => string;
  reshuffle: () => void;
  money: (value: number) => string;
  twoSeries: SeriesConfig<Month>[];
  stacked: SeriesConfig<Month>[];
  combo: SeriesConfig<Month>[];
  loadSeries: SeriesConfig<Reading>[];
  dual: SeriesConfig<Month>[];
  percent: (value: number) => string;
}

export function setup(): ChartPageContext {
  const seed: Signal<number> = signal<number>(0);
  const months: Computed<Month[]> = computed<Month[]>(() => makeMonths(seed()));

  return {
    Chart,
    Metric,
    Button,
    Demo,
    CodeTabs,
    months,
    readings: READINGS,
    share: SHARE,
    sessions: SESSIONS,
    revenueTrend: trend(140_000, 2_400),
    churnTrend: trend(3.1, 0.06),
    latencyTrend: trend(240, -3.2),
    seatsTrend: trend(610, 7),
    // #region chart-candles
    ohlc: ['o', 'h', 'l', 'c'] as const,
    price: (value: number): string => value.toFixed(2),
    // #endregion
    // Changing the data is what proves the animation is an interpolation and not a fade-in: bars
    // travel to their new heights from the old ones.
    reshuffle: (): void => {
      seed.set(seed() + 1);
    },

    // #region chart-format
    money: (value: number): string =>
      value >= 1000 ? `€${(value / 1000).toFixed(0)}k` : `€${value.toFixed(0)}`,
    // #endregion

    // #region chart-two-series
    twoSeries: [
      { y: 'revenue', label: 'Revenue' },
      { y: 'cost', label: 'Cost' },
    ],
    // #endregion

    // #region chart-stacked
    stacked: [
      { y: 'cost', label: 'Cost', type: 'bar', stack: 'p&l' },
      { y: 'margin', label: 'Margin', type: 'bar', stack: 'p&l' },
    ],
    // #endregion

    // #region chart-combo
    combo: [
      { y: 'revenue', label: 'Revenue', type: 'bar' },
      { y: 'cost', label: 'Cost', type: 'line', curve: 'smooth', width: 2 },
    ],
    // #endregion

    // #region chart-dual
    // `axis: 'right'` puts a series on its own scale. Revenue is in euros and margin is a
    // percentage — one axis would flatten the percentage onto the floor.
    dual: [
      { y: 'revenue', label: 'Revenue', type: 'bar' },
      { y: (row: Month): number => Math.round((row.margin / row.revenue) * 1000) / 10, label: 'Margin %', type: 'line', curve: 'smooth', axis: 'right' },
    ],
    percent: (value: number): string => `${value.toFixed(0)}%`,
    // #endregion

    // #region chart-time
    loadSeries: [
      { y: 'load', label: 'Load %', type: 'area', curve: 'smooth' },
      { y: 'queue', label: 'Queue', type: 'line', curve: 'step' },
    ],
    // #endregion
  };
}
