/**
 * One feature, one chart, one snippet — `<Chart>` taken apart.
 *
 * The `chart` page is the surface in order, which is right for seeing what exists and wrong for
 * learning any one thing: every demo on it shares a dataset and a set of formatters, so a reader
 * copying one block gets a fragment.
 *
 * Here each section stands alone. The same rows throughout, and every snippet is complete — copy a
 * block and it runs. That costs repetition between the sections, and the repetition is the point.
 *
 * Every block is lifted from this file by `tools/gen-snippets.mjs`, so what is shown is what runs.
 */

import { computed, onCleanup, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import Chart, {
  swapChart,
  type ChartPoint,
  type SeriesConfig,
  type SwapHandle,
} from '@weave-framework/extra/components/chart';
import Metric from '@weave-framework/extra/components/metric';
import Demo from '../lib/demo/demo.js';
import CodeTabs from '../lib/code-tabs/code-tabs.js';

// #region cr-rows
/** The twelve rows most sections below draw. Small on purpose: the code is the subject. */
export interface Row extends Record<string, unknown> {
  month: string;
  revenue: number;
  cost: number;
  users: number;
}

const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ROWS: Row[] = MONTHS.map((month, i) => {
  const revenue: number = Math.round(38_000 + Math.sin(i / 1.9) * 12_000 + i * 1_500);
  return {
    month,
    revenue,
    cost: Math.round(revenue * (0.55 + Math.cos(i / 2.6) * 0.08)),
    users: Math.round(1_200 + i * 140 + Math.sin(i) * 90),
  };
});
// #endregion

// #region cr-long
/** A long series, for the sections about showing only part of one. */
export interface Reading extends Record<string, unknown> {
  at: number;
  load: number;
  queue: number;
}

const READINGS: Reading[] = Array.from({ length: 240 }, (_, i) => ({
  at: Date.UTC(2026, 6, 1) + i * 900_000,
  // A deliberate hole: a line drawn across missing data is the quiet lie charts tell most often.
  load: i >= 96 && i <= 107 ? NaN : Math.round(48 + Math.sin(i / 11) * 26 + Math.sin(i / 2.3) * 6),
  queue: Math.round(14 + Math.cos(i / 9) * 9),
}));
// #endregion

// #region cr-pie
/** One row per slice: `x` is its label and `y` its value, exactly as for a bar chart. */
export interface Slice extends Record<string, unknown> {
  product: string;
  revenue: number;
}

const SHARE: Slice[] = [
  { product: 'Platform', revenue: 82_000 },
  { product: 'Support', revenue: 41_000 },
  { product: 'Training', revenue: 27_000 },
  { product: 'Add-ons', revenue: 14_000 },
  { product: 'Consulting', revenue: 9_000 },
  { product: 'Hosting', revenue: 4_200 },
  { product: 'Certification', revenue: 2_800 },
  { product: 'Merch', revenue: 1_400 },
];
// #endregion

// #region cr-candles
/** Four prices and a volume per row — the shape `candlestick` and `ohlc` read. */
export interface Session extends Record<string, unknown> {
  day: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function makeSessions(count: number): Session[] {
  const out: Session[] = [];
  let price: number = 124;
  for (let i: number = 0; i < count; i++) {
    // Deterministic, so the page looks the same on every load.
    const open: number = price;
    const close: number = Math.max(1, open + Math.sin(i / 8) * 1.7 + Math.cos(i * 2.3) * 1.1);
    out.push({
      day: new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(5, 10),
      o: Math.round(open * 100) / 100,
      h: Math.round((Math.max(open, close) + Math.abs(Math.cos(i * 1.9)) * 1.3) * 100) / 100,
      l: Math.round((Math.min(open, close) - Math.abs(Math.sin(i * 1.3)) * 1.3) * 100) / 100,
      c: Math.round(close * 100) / 100,
      v: Math.round(400_000 + Math.abs(Math.sin(i / 2.1)) * 900_000),
    });
    price = close;
  }
  return out;
}

const SESSIONS: Session[] = makeSessions(90);
// #endregion

// #region cr-metric
/** Short series for the tiles — a sparkline is read as a shape, so 24 points is plenty. */
export interface Point extends Record<string, unknown> {
  t: number;
  v: number;
}

function trend(from: number, drift: number): Point[] {
  return Array.from({ length: 24 }, (_, i) => ({
    t: i,
    v: Math.round((from + drift * i + Math.sin(i / 2.4) * from * 0.06) * 100) / 100,
  }));
}
// #endregion

export type GridMode = 'y' | 'x' | 'both' | false;

// #region cr-swap-picks
/**
 * Four charts with nothing in common — the point of the exercise.
 *
 * Different rows, different counts, different units, different marks, and one of them has no axes
 * at all. There is no correspondence between a month of revenue and a trading session, so there is
 * nothing to interpolate BETWEEN them.
 */
export type PickId = 'revenue' | 'load' | 'share' | 'market';

export interface PickEntry {
  id: PickId;
  title: string;
  note: string;
}

const PICKS: PickEntry[] = [
  { id: 'revenue', title: 'Revenue', note: '12 months · bars · € · category axis' },
  { id: 'load', title: 'Load', note: '240 readings · area and step · % · time axis, with a gap' },
  { id: 'share', title: 'Share', note: '8 products · donut · € · no axes at all' },
  { id: 'market', title: 'Market', note: '90 sessions · candles and volume · price · ordinal axis' },
];
// #endregion

export interface RecipesContext {
  Chart: typeof Chart;
  Metric: typeof Metric;
  Button: typeof Button;
  Demo: typeof Demo;
  CodeTabs: typeof CodeTabs;

  rows: Row[];
  readings: Reading[];
  share: Slice[];
  sessions: Session[];
  revenueTrend: Point[];
  churnTrend: Point[];
  latencyTrend: Point[];
  seatsTrend: Point[];

  money: (value: number) => string;
  plain: (value: number) => string;
  price: (value: number) => string;

  twoSeries: SeriesConfig<Row>[];
  stacked: SeriesConfig<Row>[];
  combo: SeriesConfig<Row>[];
  dual: SeriesConfig<Row>[];
  curves: SeriesConfig<Row>[];
  loadSeries: SeriesConfig<Reading>[];
  ohlc: readonly ['o', 'h', 'l', 'c'];

  gridMode: () => GridMode;
  gridText: () => string;
  cycleGrid: () => void;

  rotate: () => number | 'auto';
  rotateText: () => string;
  cycleRotate: () => void;

  shown: () => readonly [number, number];
  shownText: () => string;
  onShown: (range: readonly [number, number]) => void;
  resetShown: () => void;

  briefly: (points: ChartPoint<Row>[]) => string;

  picked: () => string;
  pick: (point: ChartPoint<Row>) => void;

  live: Computed<Row[]>;
  shuffle: () => void;
  animated: () => boolean;
  animatedText: () => string;
  toggleAnimation: () => void;

  picks: PickEntry[];
  chosen: () => PickId;
  choose: (id: PickId) => void;
  pickVariant: (id: PickId) => string;
  chosenNote: () => string;
  swapSeries: SeriesConfig<Reading>[];
  staggered: () => boolean;
  staggerText: () => string;
  toggleStagger: () => void;
  setStage: (node: HTMLElement) => void;
  morphing: () => boolean;
  modeText: () => string;
  toggleMode: () => void;
  chartAnimates: () => boolean;
}

export function setup(): RecipesContext {
  const seed: Signal<number> = signal<number>(0);
  const animated: Signal<boolean> = signal<boolean>(true);
  const grid: Signal<GridMode> = signal<GridMode>('y');
  const rotate: Signal<number | 'auto'> = signal<number | 'auto'>(-45);
  const range: Signal<readonly [number, number]> = signal<readonly [number, number]>([0, 59]);
  const picked: Signal<string> = signal<string>('nothing yet');

  const chosen: Signal<PickId> = signal<PickId>('revenue');
  /**
   * What the stage is fading OUT towards, or null when it is settled.
   *
   * One source of truth rather than a separate `leaving` flag: mid-fade, the answer to "what is
   * selected" is the pending pick, not the one still on screen, and two variables holding half of
   * that each is how a picker ends up highlighting one chart while showing another.
   */
  const pending: Signal<PickId | null> = signal<PickId | null>(null);
  const staggered: Signal<boolean> = signal<boolean>(true);
  const morphing: Signal<boolean> = signal<boolean>(true);
  let stage: HTMLElement | null = null;
  let running: SwapHandle | null = null;
  // A swap in flight when the page goes away would set a signal on a component that no longer
  // exists — cheap to prevent, and the kind of thing that only shows up as a console error later.
  onCleanup(() => running?.finish());

  const GRIDS: GridMode[] = ['y', 'x', 'both', false];
  const ROTATIONS: (number | 'auto')[] = [-45, -90, 30, 'auto', 0];

  return {
    Chart,
    Metric,
    Button,
    Demo,
    CodeTabs,

    rows: ROWS,
    readings: READINGS,
    share: SHARE,
    sessions: SESSIONS,
    revenueTrend: trend(140_000, 2_400),
    churnTrend: trend(3.1, 0.06),
    latencyTrend: trend(240, -3.2),
    seatsTrend: trend(610, 7),

    // #region cr-format
    // `valueFormat` writes the axis AND the tooltip, so a unit is declared once.
    money: (value: number): string =>
      value >= 1000 ? `€${(value / 1000).toFixed(0)}k` : `€${value.toFixed(0)}`,
    plain: (value: number): string => value.toLocaleString(),
    price: (value: number): string => value.toFixed(2),
    // #endregion

    // #region cr-series
    twoSeries: [
      { y: 'revenue', label: 'Revenue' },
      { y: 'cost', label: 'Cost' },
    ],
    // #endregion

    // #region cr-stacked
    stacked: [
      // One stack name shared: two series, one column each month.
      { y: 'cost', label: 'Cost', type: 'bar', stack: 'p&l' },
      { y: (row: Row): number => row.revenue - row.cost, label: 'Margin', type: 'bar', stack: 'p&l' },
    ],
    // #endregion

    // #region cr-combo
    combo: [
      { y: 'revenue', label: 'Revenue', type: 'bar' },
      { y: 'cost', label: 'Cost', type: 'line', curve: 'smooth', width: 2 },
    ],
    // #endregion

    // #region cr-dual
    dual: [
      { y: 'revenue', label: 'Revenue', type: 'bar' },
      // Users are in the thousands and revenue in the tens of thousands — one axis would squash
      // the smaller series against the floor.
      { y: 'users', label: 'Users', type: 'line', curve: 'smooth', axis: 'right' },
    ],
    // #endregion

    // #region cr-curves
    curves: [
      { y: 'revenue', label: 'linear', curve: 'linear' },
      { y: 'cost', label: 'smooth', curve: 'smooth' },
      { y: 'users', label: 'step', curve: 'step', axis: 'right' },
    ],
    // #endregion

    // #region cr-brush
    loadSeries: [{ y: 'load', label: 'Load %', type: 'area', curve: 'smooth' }],
    // #endregion

    // #region cr-ohlc
    ohlc: ['o', 'h', 'l', 'c'] as const,
    // #endregion

    // #region cr-grid
    gridMode: (): GridMode => grid(),
    cycleGrid: (): void => {
      grid.set(GRIDS[(GRIDS.indexOf(grid()) + 1) % GRIDS.length] ?? 'y');
    },
    // #endregion
    gridText: (): string => (grid() === false ? 'false' : `'${String(grid())}'`),

    // #region cr-rotate
    rotate: (): number | 'auto' => rotate(),
    cycleRotate: (): void => {
      rotate.set(ROTATIONS[(ROTATIONS.indexOf(rotate()) + 1) % ROTATIONS.length] ?? 0);
    },
    // #endregion
    rotateText: (): string => (typeof rotate() === 'number' ? String(rotate()) : `'auto'`),

    // #region cr-range
    // A controlled window: the chart asks, the caller decides. Omit both props and the chart owns
    // its own window instead — which is what `brush` on its own does.
    shown: (): readonly [number, number] => range(),
    onShown: (next: readonly [number, number]): void => {
      range.set(next);
    },
    resetShown: (): void => {
      range.set([0, 59]);
    },
    // #endregion
    shownText: (): string => `${range()[0]}–${range()[1]}`,

    // #region cr-tooltip
    // Return a string, not markup: a tooltip that can render HTML is an injection waiting for the
    // first chart drawn from data someone else wrote.
    briefly: (points: ChartPoint<Row>[]): string =>
      points.map((point) => `${point.label} ${Math.round(point.y / 1000)}k`).join(' · '),
    // #endregion

    // #region cr-click
    picked: (): string => picked(),
    pick: (point: ChartPoint<Row>): void => {
      picked.set(`${point.row.month}: ${point.label} = ${point.y.toLocaleString()}`);
    },
    // #endregion

    // #region cr-animation
    live: computed<Row[]>(() => {
      const n: number = seed();
      return ROWS.map((row, i) => ({
        ...row,
        revenue: Math.round(row.revenue * (1 + Math.sin(i + n) * 0.22)),
      }));
    }),
    shuffle: (): void => {
      seed.set(seed() + 1);
    },
    // #endregion

    animated: (): boolean => animated(),
    // `{{ false }}` interpolates as an empty string, which reads as a missing value rather than as
    // the value `false` — so the note prints the word.
    animatedText: (): string => String(animated()),
    toggleAnimation: (): void => {
      animated.set(!animated());
    },

    picks: PICKS,
    swapSeries: [
      { y: 'load', label: 'Load %', type: 'area', curve: 'smooth' },
      { y: 'queue', label: 'Queue', type: 'line', curve: 'step' },
    ],
    // #region cr-swap
    chosen: (): PickId => chosen(),
    /**
     * One call, either transition.
     *
     * `swapChart` takes a callback rather than a rendered chart because the outgoing one has to be
     * measured while it still exists — a moment after `chosen.set` the old component is gone and
     * its geometry with it. Handing over the swap is also what lets it choose the moment: a morph
     * commits immediately and interpolates the marks, a fade commits halfway through.
     */
    choose: (id: PickId): void => {
      // Against what is COMING, not what is showing. Pick a chart, then change your mind before the
      // transition lands, and comparing with the visible one lets the first pick arrive anyway —
      // the stage ends up on a chart whose button you un-clicked.
      if (id === (pending() ?? chosen())) return;
      running?.finish();
      running = null;
      if (id === chosen() || !stage) {
        // Back to what is already on the stage: cancel rather than transition to it.
        pending.set(null);
        chosen.set(id);
        return;
      }
      const back: boolean = PICKS.findIndex((p) => p.id === id) < PICKS.findIndex((p) => p.id === chosen());
      pending.set(id);
      running = swapChart(
        stage,
        () => {
          chosen.set(id);
          pending.set(null);
        },
        { morph: morphing(), direction: back ? 'back' : 'forward' }
      );
    },
    // #endregion
    // The button follows the pending pick, so the picker answers the click rather than the timer.
    pickVariant: (id: PickId): string => (id === (pending() ?? chosen()) ? 'primary' : 'ghost'),
    staggered: (): boolean => staggered(),
    staggerText: (): string => (staggered() ? 'on' : 'off'),
    toggleStagger: (): void => {
      staggered.set(!staggered());
    },

    setStage: (node: HTMLElement): void => {
      stage = node;
    },
    morphing: (): boolean => morphing(),
    modeText: (): string => (morphing() ? 'morph' : 'swap'),
    toggleMode: (): void => {
      running?.finish();
      running = null;
      pending.set(null);
      morphing.set(!morphing());
    },
    // In morph mode the chart must arrive at its FINAL shape immediately: the overlay is the
    // animation, and a chart still growing underneath would be measured mid-entrance and morphed
    // into a plot that never existed.
    chartAnimates: (): boolean => !morphing(),
    chosenNote: (): string => {
      const id: PickId = pending() ?? chosen();
      return PICKS.find((pick) => pick.id === id)?.note ?? '';
    },
  };
}
