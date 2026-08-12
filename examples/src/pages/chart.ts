/**
 * `<Chart>` — the first stage: the engine, and the three cartesian marks that ride on it.
 *
 * Every demo below is the same component with different props. That is the claim being tested on
 * this page: one tag, and the difference between a bar chart and a stacked combo is what you type,
 * not which component you reach for.
 */

import { computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import Chart, { type ChartProps, type SeriesConfig } from '@weave-framework/extra/components/chart';
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

export interface ChartPageContext {
  Chart: typeof Chart;
  Button: typeof Button;
  Demo: typeof Demo;
  CodeTabs: typeof CodeTabs;
  months: Computed<Month[]>;
  readings: Reading[];
  share: Share[];
  reshuffle: () => void;
  money: (value: number) => string;
  twoSeries: SeriesConfig<Month>[];
  stacked: SeriesConfig<Month>[];
  combo: SeriesConfig<Month>[];
  loadSeries: SeriesConfig<Reading>[];
}

export function setup(): ChartPageContext {
  const seed: Signal<number> = signal<number>(0);
  const months: Computed<Month[]> = computed<Month[]>(() => makeMonths(seed()));

  return {
    Chart,
    Button,
    Demo,
    CodeTabs,
    months,
    readings: READINGS,
    share: SHARE,
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

    // #region chart-time
    loadSeries: [
      { y: 'load', label: 'Load %', type: 'area', curve: 'smooth' },
      { y: 'queue', label: 'Queue', type: 'line', curve: 'step' },
    ],
    // #endregion
  };
}
