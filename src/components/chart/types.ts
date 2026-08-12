/**
 * The public shape of a chart — what a caller writes, and nothing else.
 *
 * The whole design goal is in the first line of the reference example: a useful, animated, themed,
 * responsive chart should be one tag with four attributes. Every option below is optional, and every
 * default was chosen so that leaving it out is the right answer for the common case.
 *
 *   <Chart type="bar" data={{ sales }} x="month" y="revenue" />
 *
 * What is deliberately NOT here: a plugin registry, per-element style objects, an `options` tree
 * mirroring the DOM. Those are how the big libraries grow a thousand-line type and a config nobody
 * writes without the docs open.
 */

/** How a value is pulled out of a row: a field name, or a function for anything else. */
export type Accessor<TRow, TValue> = string | ((row: TRow) => TValue);

/** The mark a series is drawn as. Per series, so one chart can mix bars and a trend line. */
export type SeriesType = 'line' | 'area' | 'bar';

/**
 * What the chart is. The radial two take the same `data`, `x` and `y` as everything else —
 * one row per slice, `x` its label, `y` its value — so moving between a bar chart and a donut is
 * one word.
 */
export type ChartType = SeriesType | 'pie' | 'donut' | 'candlestick' | 'ohlc';

/** Where the four prices live on a row. An array reads as O, H, L, C in that order. */
export type OhlcAccessors<TRow> =
  | readonly [Accessor<TRow, number>, Accessor<TRow, number>, Accessor<TRow, number>, Accessor<TRow, number>]
  | { open: Accessor<TRow, number>; high: Accessor<TRow, number>; low: Accessor<TRow, number>; close: Accessor<TRow, number> };

/** How the points of a line are joined. */
export type Curve = 'linear' | 'smooth' | 'step';

/** What the x values are. `auto` looks at the first value: a number that smells like a date is time. */
export type XScaleType = 'auto' | 'category' | 'time' | 'linear';

export type YScaleType = 'linear' | 'log';

export interface SeriesConfig<TRow = Record<string, unknown>> {
  /** Where this series' value comes from. */
  y: Accessor<TRow, number>;
  /** Legend and tooltip name. Defaults to the field name when `y` is one. */
  label?: string;
  /** Overrides the chart's `type` for this series alone — the whole of combo-chart support. */
  type?: SeriesType;
  /** An explicit colour, passed through untouched. Otherwise the palette cycle. */
  color?: string;
  /** Line width in px. Default 2. */
  width?: number;
  /** Dash pattern. Set automatically past the first palette cycle. */
  dash?: string;
  curve?: Curve;
  /** Draw a dot at each point. Default: on when the series is short enough to read. */
  points?: boolean;
  /** Fill opacity for `area`. Default 0.15. */
  fillOpacity?: number;
  /**
   * Stack group. Series sharing a name stack together; series without one never stack.
   *
   * A name rather than a boolean because a chart with two stacked pairs is a real thing, and the
   * boolean version of this ends up needing the name anyway.
   */
  stack?: string;
  /** Put this series on the right-hand axis, for a second unit. */
  axis?: 'left' | 'right';
}

/** One value under the pointer, as handed to a tooltip formatter or a click handler. */
export interface ChartPoint<TRow = Record<string, unknown>> {
  /** Index into the data. */
  index: number;
  row: TRow;
  /** The series' resolved label. */
  label: string;
  /** Index of the series among the resolved series. */
  series: number;
  x: unknown;
  y: number;
  color: string;
}

export interface ChartProps<TRow = Record<string, unknown>> {
  /** The rows. A getter when they arrive later or change. */
  data: readonly TRow[] | (() => readonly TRow[]);

  /** Default mark for series that do not name their own. Default `'line'`. */
  type?: ChartType;

  /** The category / time / numeric axis. */
  x: Accessor<TRow, unknown>;
  /** One series, the short way. Ignored when {@link series} is given. */
  y?: Accessor<TRow, number>;
  /** Several series. Each may override the chart's type, colour and curve. */
  series?: readonly SeriesConfig<TRow>[];

  /** Turn a vertical bar chart on its side. Ignored by line and area. */
  horizontal?: boolean;

  xType?: XScaleType;
  yType?: YScaleType;
  /** Pin the value axis. By default it is chosen from the data and rounded outward. */
  yMin?: number;
  yMax?: number;
  /**
   * Start the value axis at zero. Default: true for bars, false for lines.
   *
   * Bars encode value by LENGTH, so a truncated axis makes a 3% difference look like 300% — the
   * single most common way a chart misleads. A line encodes by position, where a zoomed axis is
   * legitimate and often the only way to see anything.
   */
  zero?: boolean;

  /** Height in px. Width always follows the container. Default 260. */
  height?: number;
  /** Grid lines. Default `'y'` — value gridlines help, category ones are noise. */
  grid?: boolean | 'x' | 'y' | 'both';

  legend?: boolean;
  /** Tooltip. `'shared'` (default) shows every series at that x; `'item'` shows only the one hit. */
  tooltip?: boolean | 'shared' | 'item';
  /** Replace the tooltip's text. Return a string; markup is deliberately not accepted. */
  tooltipFormat?: (points: ChartPoint<TRow>[]) => string;

  /** Animate on mount and on data change. Default true, and always off under reduced motion. */
  animate?: boolean;
  /** Animation length in ms. Default 600. */
  duration?: number;

  /** Accessible name. Falls back to `title`, then to a description of the series. */
  ariaLabel?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;

  /** How a value is written on the axis and in the tooltip. */
  valueFormat?: (value: number) => string;
  /** How an x value is written. Defaults to the scale's own formatting. */
  labelFormat?: (value: unknown) => string;

  /* ── financial only: candlestick and ohlc ── */

  /**
   * The four prices. Required by `candlestick` and `ohlc`, ignored by everything else.
   *
   *   ohlc={{ ['o', 'h', 'l', 'c'] }}
   */
  ohlc?: OhlcAccessors<TRow>;
  /** Volume, drawn as a subplot under the price pane. Omit for no subplot. */
  volume?: Accessor<TRow, number>;
  /** Share of the height the volume pane takes. Default 0.22. */
  volumeHeight?: number;

  /**
   * The visible window, as inclusive row indices. Uncontrolled when omitted — the chart owns it.
   *
   * A window over BARS, not over time: markets close, and a continuous time axis spends two
   * sevenths of a daily chart drawing the weekends.
   */
  range?: readonly [number, number];
  onRangeChange?: (range: readonly [number, number]) => void;
  /** Wheel to zoom, drag to pan. Default true for financial charts. */
  zoom?: boolean;

  /** Rising and falling colours. Defaults follow `--weave-chart-up` / `--weave-chart-down`. */
  upColor?: string;
  downColor?: string;

  /* ── radial only: pie and donut ── */

  /**
   * Hole size as a fraction of the outer radius. Default 0 for `pie`, 0.62 for `donut`.
   *
   * A hole is not decoration: it removes the wedge apex, which is the part of a pie a reader is
   * worst at comparing, and it buys a place to put the total.
   */
  innerRadius?: number;
  /** First edge in degrees, clockwise from twelve o'clock. Default 0. */
  startAngle?: number;
  /** Last edge. Default a full turn. `startAngle={{ -90 }} endAngle={{ 90 }}` is a semicircle. */
  endAngle?: number;
  /** Gap between slices in degrees. Clamped so it can never eat the slices themselves. */
  padAngle?: number;
  /**
   * Keep the largest N and fold the rest into one slice.
   *
   * The commonest way a pie fails is twenty categories, fifteen of them unreadable slivers.
   * Grouping the tail is what a person would do by hand.
   */
  maxSlices?: number;
  otherLabel?: string;
  /** Text in a donut's hole. Defaults to the total. `false` leaves it empty. */
  centerLabel?: string | false;
  /** Write a percentage on slices with room for one. Default true. */
  sliceLabels?: boolean;

  /** Text when there is nothing to draw. */
  emptyText?: string;

  onPointClick?: (point: ChartPoint<TRow>) => void;
}

/** A series after defaults, palette and stacking have been resolved. */
export interface ResolvedSeries<TRow = Record<string, unknown>> {
  label: string;
  type: SeriesType;
  color: string;
  width: number;
  dash?: string;
  curve: Curve;
  points: boolean;
  fillOpacity: number;
  stack?: string;
  axis: 'left' | 'right';
  value: (row: TRow) => number;
}
