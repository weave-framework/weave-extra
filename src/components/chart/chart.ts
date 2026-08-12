/**
 * `<Chart>` — one component, every cartesian chart.
 *
 *   <Chart type="bar" data={{ sales }} x="month" y="revenue" />
 *
 * That line is the design. It is responsive, animated, themed, keyboard-reachable and has a tooltip,
 * because those are not features to opt into — they are what "a chart" means, and a library that
 * makes you ask for them has moved its own work onto its caller.
 *
 * Everything beyond it is an override. `series` for more than one line, `type` per series for a
 * combo, `stack` for stacking, `axis: 'right'` for a second unit. There is no options tree and no
 * plugin registry: the surface is `ChartProps` and that is the whole of it.
 *
 * SVG rather than canvas, deliberately. Elements inherit the page's theme through CSS custom
 * properties, carry their own pointer targets so there is no hit-test arithmetic, print at any
 * resolution, and can be reached by a screen reader. The cost is DOM nodes, and it stops being the
 * right trade somewhere past a couple of thousand marks — which is the point at which a caller
 * should be aggregating rather than drawing.
 */

import { computed, effect, onMount, signal, type Computed, type Signal } from '@weave-framework/runtime';
import { resizeSignal, type Size } from '@weave-framework/ui/cdk';
import { bandScale, compactNumber, extent, linearScale, logScale, timeScale, type BandScale, type Scale } from './scale.js';
import { layout, widestLabel, type PlotBox } from './layout.js';
import { areaPath, barPath, linePath, type Pt } from './marks.js';
import { arcCentroid, arcPath, fitArc, groupTail, layoutArcs, toRadians, type Slice } from './arc.js';
import { candleBody, clampRange, isUp, ohlcPath, panRange, zoomRange, type Bar, type Range } from './financial.js';
import { clock, Memory, type Clock } from './motion.js';
import { chartInk, seriesColor, seriesDash } from './palette.js';
import type { Accessor, ChartPoint, ChartProps, Curve, ResolvedSeries, SeriesConfig, SeriesType } from './types.js';

/**
 * The whole public surface, from one subpath — the component as the default export, everything it is
 * built from as named ones. A caller drawing something this component does not cover should not have
 * to rebuild scales, easing or path geometry to do it.
 */
export type {
  Accessor,
  ChartPoint,
  ChartProps,
  Curve,
  ResolvedSeries,
  SeriesConfig,
  SeriesType,
  ChartType,
  OhlcAccessors,
  XScaleType,
  YScaleType,
} from './types.js';
export { bandScale, compactNumber, extent, formatTime, linearScale, logScale, niceDomain, timeScale } from './scale.js';
export type { BandScale, LinearScale, Scale, TimeScale } from './scale.js';
export { clock, easings, lerp, Memory, prefersReducedMotion } from './motion.js';
export type { Clock, ClockOptions } from './motion.js';
export { PALETTE_SIZE, chartInk, paletteDefault, seriesColor, seriesDash } from './palette.js';
export { areaPath, barPath, linePath } from './marks.js';
export type { CurveKind, Pt } from './marks.js';
export { arcCentroid, arcPath, fitArc, groupTail, layoutArcs, polar, toRadians, TAU } from './arc.js';
export type { LayoutArcsOptions, Point, Slice } from './arc.js';
export { candleBody, clampRange, isUp, ohlcPath, panRange, zoomRange } from './financial.js';
export type { Bar, Range } from './financial.js';
export { layout, widestLabel } from './layout.js';
export type { LayoutInput, PlotBox } from './layout.js';
export { alignRing, captureChart, morph, parseColor, sampleShape, swapChart } from './morph.js';
export type { MarkShape, MorphHandle, MorphOptions, Rgba, SwapHandle, SwapOptions } from './morph.js';

/* ────────────────────────────── template shapes ────────────────────────────── */

export interface GridLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AxisTick {
  key: string;
  x: number;
  y: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
  /** An SVG transform when the label is turned, or `undefined` when it sits flat. */
  transform?: string;
}

export interface PathMark {
  key: string;
  d: string;
  color: string;
  width: number;
  dash: string | undefined;
  fill: string;
  opacity: number;
}

export interface BarMark {
  key: string;
  d: string;
  color: string;
  label: string;
  value: string;
}

export interface DotMark {
  key: string;
  cx: number;
  cy: number;
  color: string;
}

export interface ArcMark {
  key: string;
  d: string;
  color: string;
  label: string;
  value: string;
  percent: string;
  /** Centre of the ring band — where a slice's own label goes. */
  lx: number;
  ly: number;
  /** Whether the slice has room for a label inside it. */
  roomy: boolean;
  index: number;
}

export interface RadialView {
  cx: number;
  cy: number;
  arcs: ArcMark[];
  center: string;
  centerSub: string;
}

export interface CandleMark {
  key: string;
  /** The high–low wick, as `x1/y1/x2/y2`. */
  wx: number;
  wy1: number;
  wy2: number;
  /** The body, absent on an OHLC chart. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The whole bar as one path, used by the OHLC form. */
  d: string;
  color: string;
  up: boolean;
  index: number;
}

export interface VolumeMark {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface FinancialView {
  candles: CandleMark[];
  volumes: VolumeMark[];
  priceTicks: AxisTick[];
  timeTicks: AxisTick[];
  grid: GridLine[];
  /** Bottom edge of the price pane — where its axis line goes. */
  priceBottom: number;
  volumeTop: number;
  hasVolume: boolean;
}

export interface BrushView {
  height: number;
  /** The whole series, drawn small — one path, no axes. */
  d: string;
  /** The selected window, in px. */
  x: number;
  width: number;
  /** Handle centres, for the two grips. */
  leftX: number;
  rightX: number;
  /** `1 of 12` — so the control says what it is doing without a tooltip. */
  caption: string;
}

export interface LegendEntry {
  label: string;
  color: string;
  hidden: boolean;
  index: number;
}

export interface TooltipView {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color: string }[];
  text: string | undefined;
}

/* ────────────────────────────── helpers ────────────────────────────── */

const read = <TRow, TValue>(accessor: Accessor<TRow, TValue>, row: TRow): TValue =>
  typeof accessor === 'function' ? accessor(row) : (row as Record<string, unknown>)[accessor] as TValue;

const nameOf = <TRow, TValue>(accessor: Accessor<TRow, TValue>, fallback: string): string =>
  typeof accessor === 'string' ? accessor : fallback;

/** A number, or NaN for anything that is not one — NaN is what breaks the line at a gap. */
const asNumber = (value: unknown): number => {
  const n: number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Is this x axis time, categories or numbers?
 *
 * `Date` and a number past 1971 in milliseconds are treated as time. The threshold is a heuristic
 * and it is stated rather than hidden: a series of raw counts above 3.15e10 would be misread, which
 * is what `xType` exists to override.
 */
function detectX(values: readonly unknown[]): 'time' | 'category' | 'linear' {
  const first: unknown = values.find((value) => value != null);
  if (first instanceof Date) return 'time';
  if (typeof first === 'number') return first > 3.15e10 ? 'time' : 'linear';
  if (typeof first === 'string') {
    const parsed: number = Date.parse(first);
    return Number.isFinite(parsed) && /\d{4}-\d{2}/.test(first) ? 'time' : 'category';
  }
  return 'category';
}

const toTime = (value: unknown): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));

export interface ChartContext<TRow> {
  host: Signal<HTMLElement | null>;
  props: ChartProps<TRow>;

  width: () => number;
  height: () => number;
  hasData: () => boolean;
  emptyText: () => string;

  ariaLabel: () => string;
  describedRows: () => { x: string; values: { label: string; value: string }[] }[];
  showTable: () => boolean;

  grid: () => GridLine[];
  xTicks: () => AxisTick[];
  yTicks: () => AxisTick[];
  rightTicks: () => AxisTick[];
  axisLines: () => GridLine[];
  areas: () => PathMark[];
  lines: () => PathMark[];
  bars: () => BarMark[];
  dots: () => DotMark[];

  isRadial: () => boolean;
  radial: () => RadialView;
  onSliceEnter: (index: number) => void;

  isSpark: () => boolean;
  hasBrush: () => boolean;
  brush: () => BrushView;
  onBrushDown: (event: PointerEvent, part: 'left' | 'right' | 'body' | 'track') => void;

  isFinancial: () => boolean;
  financial: () => FinancialView;
  onWheel: (event: WheelEvent) => void;
  onDragStart: (event: PointerEvent) => void;

  legend: () => LegendEntry[];
  showLegend: () => boolean;
  toggleSeries: (index: number) => void;

  tooltip: () => TooltipView | null;
  crosshair: () => number | null;
  /** The cartesian crosshair as a line, so it can follow the category axis whichever way it runs. */
  crossLine: () => GridLine | null;
  onMove: (event: PointerEvent) => void;
  onLeave: () => void;
  onClick: () => void;

  ink: typeof chartInk;
}

export function setup<TRow extends Record<string, unknown> = Record<string, unknown>>(
  props: ChartProps<TRow>
): ChartContext<TRow> {
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const hidden: Signal<ReadonlySet<number>> = signal<ReadonlySet<number>>(new Set<number>());
  const hoverIndex: Signal<number | null> = signal<number | null>(null);
  const pointer: Signal<{ x: number; y: number } | null> = signal<{ x: number; y: number } | null>(null);

  /* ── size: width follows the container, height is the caller's ──
   *
   * Observed from `onMount`, not lazily from inside a computed. Creating the observer on first read
   * looked equivalent and was not: the first read happens while the element is still being built, so
   * `getBoundingClientRect()` returns 0, and the observer set up in that moment never reached anyone
   * — every chart rendered into a 1px-wide plot with a single axis label. Mounting first means the
   * element is in the document and has a box before anything measures it. */
  const measured: Signal<number> = signal<number>(0);
  onMount(() => {
    const element: HTMLElement | null = host();
    if (!element) return;
    const size: () => Size = resizeSignal(element);
    effect(() => {
      // The observed width, with the live rect as the fallback: a chart mounted inside a hidden
      // pane reports 0 until it is shown, and the rect is what tells us it has been.
      const observed: number = size().width || element.getBoundingClientRect().width;
      measured.set(Math.max(0, Math.round(observed)));
    });
  });
  const width = (): number => measured();
  const height = (): number => props.height ?? (props.sparkline ? 40 : 260);

  /* ── data, and the window over it ──
   *
   * `allRows` is everything; `rows` is what the plot draws. Making the WINDOW the thing every mark
   * reads — rather than threading a range through each of them — is what lets a brush work for a
   * line, a bar and a candle alike: they were already reading `rows()`, and now that means "the
   * visible part". `rowOffset` carries the absolute index, which the animation memory keys on so
   * that panning moves marks instead of re-growing them. */
  const allRows: Computed<readonly TRow[]> = computed<readonly TRow[]>(() =>
    typeof props.data === 'function' ? props.data() : props.data ?? []
  );

  /** Is there a window at all? Without one, `rows` is `allRows` and nothing pays for the slice. */
  const windowed = (): boolean =>
    props.brush === true || props.range !== undefined || props.type === 'candlestick' || props.type === 'ohlc';

  const ownRange: Signal<Range | null> = signal<Range | null>(null);
  const range: Computed<Range> = computed<Range>(() => {
    const count: number = allRows().length;
    if (props.range) return clampRange(props.range, count);
    return clampRange(ownRange() ?? [0, count - 1], count);
  });

  const setRange = (next: Range): void => {
    const clamped: Range = clampRange(next, allRows().length);
    ownRange.set(clamped);
    props.onRangeChange?.(clamped);
  };

  /** Index of the first visible row, so a mark can key itself by its place in the whole series. */
  const rowOffset = (): number => (windowed() ? range()[0] : 0);

  const rows: Computed<readonly TRow[]> = computed<readonly TRow[]>(() => {
    const all: readonly TRow[] = allRows();
    if (!windowed()) return all;
    const [from, to]: Range = range();
    return all.slice(from, to + 1);
  });

  const xValues: Computed<unknown[]> = computed<unknown[]>(() => rows().map((row) => read(props.x, row)));

  const xKind: Computed<'time' | 'category' | 'linear'> = computed(() => {
    const declared = props.xType ?? 'auto';
    return declared === 'auto' ? detectX(xValues()) : declared === 'category' ? 'category' : declared;
  });

  /* ── series, resolved once with palette, dash and defaults ── */
  const series: Computed<ResolvedSeries<TRow>[]> = computed<ResolvedSeries<TRow>[]>(() => {
    const configs: readonly SeriesConfig<TRow>[] =
      props.series && props.series.length > 0
        ? props.series
        : props.y !== undefined
          ? [{ y: props.y }]
          : [];
    // `pie` and `donut` are chart-level, not per-mark: a slice is not something a series can be.
    // A radial chart still resolves ONE series, because that is where its values come from.
    const declared = props.type ?? 'line';
    // Only the three marks are per-series. `pie`, `donut`, `candlestick` and `ohlc` are what the
    // whole chart IS, and none of them is something one series among others could be.
    const defaultType: SeriesType =
      declared === 'line' || declared === 'area' || declared === 'bar' ? declared : 'bar';
    return configs.map((config, index) => ({
      label: config.label ?? nameOf(config.y, `Series ${index + 1}`),
      type: config.type ?? defaultType,
      color: seriesColor(index, config.color),
      width: config.width ?? 2,
      dash: config.dash ?? seriesDash(index),
      curve: (config.curve ?? 'linear') as Curve,
      // Dots stop helping once they touch: at more than ~60 points they are a texture, not marks.
      // A sparkline is read as a shape; dots on one are texture. Off unless asked for.
      points: config.points ?? (!props.sparkline && rows().length <= 60),
      fillOpacity: config.fillOpacity ?? 0.15,
      stack: config.stack,
      axis: config.axis ?? 'left',
      value: (row: TRow): number => asNumber(read(config.y, row)),
    }));
  });

  const visible: Computed<ResolvedSeries<TRow>[]> = computed(() =>
    series().filter((_, index) => !hidden().has(index))
  );

  const hasBars: Computed<boolean> = computed(() => visible().some((s) => s.type === 'bar'));

  /**
   * Whether the two axes trade places: categories down the side, values along the bottom.
   *
   * The reason to want it is labels. Product names, countries, survey answers — the things a bar
   * chart is usually about — do not fit under a column, and the alternatives are all worse: turning
   * them costs reading speed, thinning them hides categories, and truncating them lies. Down the
   * left they simply fit, flat, at full length, in the order a list is read in.
   *
   * Every condition below is a case where the flip has no meaning rather than a case that was hard.
   * Lines and areas are read left to right along their x axis and there is nothing to turn on its
   * side; a continuous axis has no categories to list; and a second value axis would need somewhere
   * to put its ticks, which on a flipped chart is the top — a place a reader does not look. In all
   * of those `horizontal` is ignored rather than half-applied.
   */
  const flipped: Computed<boolean> = computed<boolean>(() => {
    if (props.horizontal !== true || props.sparkline) return false;
    if (isRadial() || isFinancial()) return false;
    if (xKind() !== 'category') return false;
    const list: ResolvedSeries<TRow>[] = visible();
    return list.length > 0 && list.every((s) => s.type === 'bar' && s.axis !== 'right');
  });

  /* ── stacking ──
   * Per x index, the running top of each stack group. Series without a `stack` are untouched, so a
   * trend line over stacked bars keeps its own values. */
  const stacked: Computed<Map<string, number[]>> = computed<Map<string, number[]>>(() => {
    const out: Map<string, number[]> = new Map<string, number[]>();
    const list: ResolvedSeries<TRow>[] = visible();
    const data: readonly TRow[] = rows();
    const running: Map<string, number[]> = new Map<string, number[]>();
    list.forEach((s, index) => {
      if (!s.stack) return;
      const base: number[] = running.get(s.stack) ?? new Array<number>(data.length).fill(0);
      const tops: number[] = data.map((row, i) => {
        const value: number = s.value(row);
        return base[i] + (Number.isFinite(value) ? value : 0);
      });
      out.set(`${index}`, tops);
      running.set(s.stack, tops);
    });
    return out;
  });

  const baseOf = (seriesIndex: number, i: number): number => {
    const s: ResolvedSeries<TRow> | undefined = visible()[seriesIndex];
    if (!s?.stack) return 0;
    const tops: number[] | undefined = stacked().get(`${seriesIndex}`);
    const value: number = s.value(rows()[i]);
    return (tops?.[i] ?? 0) - (Number.isFinite(value) ? value : 0);
  };

  const topOf = (seriesIndex: number, i: number): number => {
    const s: ResolvedSeries<TRow> | undefined = visible()[seriesIndex];
    if (!s) return NaN;
    if (s.stack) return stacked().get(`${seriesIndex}`)?.[i] ?? NaN;
    return s.value(rows()[i]);
  };

  /* ── value domain, per axis ──
   *
   * Two axes, because two units in one chart is a real thing — revenue in euros and margin in per
   * cent, requests and latency. The alternative is asking the reader to hold one series' scale in
   * their head while looking at the other's, which they will not do.
   *
   * Each side takes its domain from ITS OWN series only. Sharing the extent would defeat the point:
   * a percentage plotted against a euro axis is a flat line along the bottom, which is exactly the
   * chart a second axis exists to avoid. */

  const onAxis = (side: 'left' | 'right'): { s: ResolvedSeries<TRow>; index: number }[] =>
    visible()
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.axis === side);

  const hasRight: Computed<boolean> = computed(() => onAxis('right').length > 0);

  const domainOf = (side: 'left' | 'right'): [number, number] => {
    const values: number[] = [];
    for (const { s, index } of onAxis(side)) {
      rows().forEach((_, i) => {
        const top: number = topOf(index, i);
        if (Number.isFinite(top)) values.push(top);
        if (s.stack) values.push(baseOf(index, i));
      });
    }
    const [min, max]: [number, number] = extent(values);
    // Bars encode by length, so their axis starts at zero unless the caller insists otherwise.
    const zero: boolean = props.zero ?? onAxis(side).some(({ s }) => s.type === 'bar');
    // `yMin`/`yMax` pin the LEFT axis only. A single pair cannot mean two units, and applying it to
    // both would silently clamp the second one to the first one's numbers.
    const low: number = side === 'left' ? (props.yMin ?? (zero ? Math.min(0, min) : min)) : zero ? Math.min(0, min) : min;
    const high: number = side === 'left' ? (props.yMax ?? Math.max(max, zero ? 0 : max)) : Math.max(max, zero ? 0 : max);
    return [low, high];
  };

  /* ── labels first, then the box, then the scales ──
   * The margins depend on the tick text, and the tick text depends only on the domain — not on the
   * box. So the domain is resolved, its labels are measured, and only then is the plot sized. */
  const makeY = (side: 'left' | 'right', range: [number, number]): Scale<number> => {
    const [min, max]: [number, number] = domainOf(side);
    return props.yType === 'log'
      ? logScale([min, max], range)
      : linearScale([min, max], range, { tickCount: 5 });
  };

  const probe: Computed<Scale<number>> = computed(() => makeY('left', [0, 1]));
  const probeRight: Computed<Scale<number>> = computed(() => makeY('right', [0, 1]));

  /** The formatter for a side: the right axis may have its own, since it exists to carry another unit. */
  const formatFor = (side: 'left' | 'right', scale: Scale<number>): ((value: number) => string) =>
    side === 'right' ? (props.rightFormat ?? props.valueFormat ?? scale.format) : (props.valueFormat ?? scale.format);

  const labelsFor = (side: 'left' | 'right', scale: Scale<number>): string[] =>
    scale.ticks().map(formatFor(side, scale));

  const yLabels: Computed<string[]> = computed<string[]>(() => labelsFor('left', probe()));
  const rightLabels: Computed<string[]> = computed<string[]>(() =>
    hasRight() ? labelsFor('right', probeRight()) : []
  );

  const xLabels: Computed<string[]> = computed<string[]>(() => {
    const kind: 'time' | 'category' | 'linear' = xKind();
    const values: unknown[] = xValues();
    if (kind === 'category') return values.map((value) => String(value ?? ''));
    const numbers: number[] = values.map((value) => (kind === 'time' ? toTime(value) : asNumber(value)));
    const [min, max]: [number, number] = extent(numbers);
    const scale: Scale<number> = kind === 'time' ? timeScale([min, max], [0, 1]) : linearScale([min, max], [0, 1]);
    return scale.ticks().map(scale.format);
  });

  /**
   * The box before rotation is taken into account — and the reason there are two of these.
   *
   * `'auto'` has to measure a label against the slot it sits in, which means it needs the box; the
   * box reserves height for turned labels, which means it needs the angle. Asking the same computed
   * for both is a cycle, and one that only bites when the angle can actually flip: the margin grows,
   * the slot changes, the answer changes back, and the graph recurses until the stack gives out.
   *
   * It is a false cycle. Rotation only ever changes the box's HEIGHT, and the slot only depends on
   * its width — so the horizontal half is settled here, before any angle exists.
   */
  const baseBox: Computed<PlotBox> = computed<PlotBox>(() => {
    const w: number = width();
    const h: number = height();
    // A sparkline gives its whole box to the marks. One pixel of inset, so a 2px stroke is not
    // sliced in half by the edge it sits on.
    if (props.sparkline) {
      return { left: 1, top: 1, width: Math.max(1, w - 2), height: Math.max(1, h - 2), right: w - 1, bottom: h - 1 };
    }
    // Flipped, the axes swap their labels as well as their directions — and this is where the flip
    // pays for itself, because the left margin is measured from the category names and grows to fit
    // them however long they are.
    const turned: boolean = flipped();
    return layout({
      width: w,
      height: h,
      leftLabels: turned ? xLabels() : yLabels(),
      rightLabels: turned ? [] : rightLabels(),
      bottomLabels: turned ? yLabels() : xLabels(),
      xTitle: props.xLabel,
      yTitle: props.yLabel,
    });
  });

  const plot: Computed<PlotBox> = computed<PlotBox>(() => {
    const box: PlotBox = baseBox();
    if (props.sparkline) return box;
    const angle: number = labelAngle();
    if (angle === 0) return box;
    // Turned text is as tall as its own length projected onto the vertical — reserve that, or the
    // longest label is cut off by the bottom edge.
    const extra: number = Math.ceil(widestLabel(xLabels()) * Math.abs(Math.sin((angle * Math.PI) / 180)));
    const shorter: number = Math.max(1, box.height - extra);
    return { ...box, height: shorter, bottom: box.top + shorter };
  });

  const yScale: Computed<Scale<number>> = computed(() => {
    const box: PlotBox = plot();
    return flipped() ? makeY('left', [box.left, box.right]) : makeY('left', [box.bottom, box.top]);
  });

  const yScaleRight: Computed<Scale<number>> = computed(() => {
    const box: PlotBox = plot();
    return makeY('right', [box.bottom, box.top]);
  });

  /** The scale a series is drawn against. Every mark asks for it rather than assuming the left one. */
  const scaleFor = (seriesIndex: number): Scale<number> =>
    visible()[seriesIndex]?.axis === 'right' ? yScaleRight() : yScale();

  /** Category axis, or null when x is continuous. Bars need the band; lines do not. */
  const xBand: Computed<BandScale | null> = computed<BandScale | null>(() => {
    if (xKind() !== 'category') return null;
    const box: PlotBox = plot();
    // Down the side when flipped, in reading order — first category at the top, not at the bottom.
    const span: [number, number] = flipped() ? [box.top, box.bottom] : [box.left, box.right];
    return bandScale(xValues().map((value) => String(value ?? '')), span, {
      padding: hasBars() ? 0.2 : 0,
    });
  });

  const xContinuous: Computed<Scale<number> | null> = computed<Scale<number> | null>(() => {
    const kind: 'time' | 'category' | 'linear' = xKind();
    if (kind === 'category') return null;
    const box: PlotBox = plot();
    const numbers: number[] = xValues().map((value) => (kind === 'time' ? toTime(value) : asNumber(value)));
    const [min, max]: [number, number] = extent(numbers);
    return kind === 'time'
      ? timeScale([min, max], [box.left, box.right])
      : linearScale([min, max], [box.left, box.right], { nice: false });
  });

  /** x pixel for row `i`, whichever kind of axis it is. */
  const xAt = (i: number): number => {
    const band: BandScale | null = xBand();
    if (band) return band.to(String(xValues()[i] ?? ''));
    const scale: Scale<number> | null = xContinuous();
    if (!scale) return 0;
    const value: unknown = xValues()[i];
    return scale.to(xKind() === 'time' ? toTime(value) : asNumber(value));
  };

  /* ── animation: one clock, one memory of where things were ── */
  const motion: Clock = clock({
    duration: props.duration,
    disabled: props.animate === false,
    // `true` is 0.55: enough that the sweep is unmistakable, short of the point where the last mark
    // arrives after the reader has finished looking.
    stagger: props.stagger === true ? 0.55 : props.stagger === false ? 0 : props.stagger,
  });
  const memory: Memory = new Memory();

  // Restart when the shape of the data changes. Reading `rows()` and the series count is enough:
  // a new array identity or a different series set is what a viewer perceives as "new data".
  let firstRun: boolean = true;
  effect(() => {
    rows();
    series().length;
    if (firstRun) {
      firstRun = false;
      return;
    }
    motion.restart();
  });

  effect(() => {
    if (motion.progress() >= 1) memory.commit();
  });

  /* ── marks ── */
  const pointsFor = (seriesIndex: number): Pt[] => {
    const scale: Scale<number> = scaleFor(seriesIndex);
    const box: PlotBox = plot();
    const all: readonly TRow[] = rows();
    const zeroY: number = Math.min(box.bottom, Math.max(box.top, scale.to(0)));
    return all.map((_, i) => {
      // Per point, so a staggered line unfurls from its left edge rather than rising as one piece.
      const t: number = motion.at(i, all.length);
      const top: number = topOf(seriesIndex, i);
      const defined: boolean = Number.isFinite(top);
      const target: number = defined ? scale.to(top) : zeroY;
      const y: number = memory.at(`${seriesIndex}:${rowOffset() + i}`, target, t, zeroY);
      return { x: xAt(i), y, defined };
    });
  };

  const areas: Computed<PathMark[]> = computed<PathMark[]>(() => {
    const box: PlotBox = plot();
    return visible()
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.type === 'area')
      .map(({ s, index }) => ({
        key: `area-${index}`,
        // The baseline is this series' OWN zero — a right-axis area closed against the left axis's
        // zero would be filled to a line that means nothing to it.
        d: areaPath(
          pointsFor(index),
          Math.min(box.bottom, Math.max(box.top, scaleFor(index).to(0))),
          s.curve
        ),
        color: s.color,
        width: 0,
        dash: undefined,
        fill: s.color,
        opacity: s.fillOpacity,
      }));
  });

  const lines: Computed<PathMark[]> = computed<PathMark[]>(() =>
    visible()
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.type === 'line' || s.type === 'area')
      .map(({ s, index }) => ({
        key: `line-${index}`,
        d: linePath(pointsFor(index), s.curve),
        color: s.color,
        width: s.width,
        dash: s.dash,
        fill: 'none',
        opacity: 1,
      }))
  );

  const bars: Computed<BarMark[]> = computed<BarMark[]>(() => {
    const band: BandScale | null = xBand();
    const box: PlotBox = plot();
    const list: ResolvedSeries<TRow>[] = visible();
    const barSeries: number[] = list.map((s, i) => (s.type === 'bar' ? i : -1)).filter((i) => i >= 0);
    if (barSeries.length === 0) return [];

    // Series in the same stack share one slot; unstacked ones sit side by side in it.
    const groups: string[] = [];
    for (const index of barSeries) {
      const key: string = list[index].stack ?? `solo-${index}`;
      if (!groups.includes(key)) groups.push(key);
    }
    const turned: boolean = flipped();
    const along: number = turned ? box.height : box.width;
    const slot: number = band ? band.bandwidth : Math.max(4, (along / Math.max(1, rows().length)) * 0.8);
    const each: number = slot / Math.max(1, groups.length);
    // The value axis's limits, whichever direction it now runs in.
    const near: number = turned ? box.left : box.top;
    const far: number = turned ? box.right : box.bottom;
    const out: BarMark[] = [];
    for (const index of barSeries) {
      const s: ResolvedSeries<TRow> = list[index];
      // Each bar series measures against its own axis, so a right-axis bar is drawn to the right
      // axis's zero and formatted with the right axis's own numbers.
      const scale: Scale<number> = scaleFor(index);
      const zeroAt: number = Math.min(far, Math.max(near, scale.to(0)));
      const format: (value: number) => string = formatFor(s.axis, scale);
      const group: number = groups.indexOf(s.stack ?? `solo-${index}`);
      const count: number = rows().length;
      rows().forEach((row, i) => {
        const top: number = topOf(index, i);
        if (!Number.isFinite(top)) return;
        const base: number = s.stack ? scale.to(baseOf(index, i)) : zeroAt;
        const target: number = scale.to(top);
        // By column, not by series: the stack rises together and the sweep runs along the axis.
        const t: number = motion.at(i, count);
        const grown: number = memory.at(`bar-${index}:${rowOffset() + i}`, target, t, base);
        const seat: number = (band ? band.start(String(xValues()[i] ?? '')) : xAt(i) - slot / 2) + group * each;
        const thickness: number = Math.max(1, each - 2);
        const length: number = Math.abs(base - grown);
        out.push({
          key: `bar-${index}-${i}`,
          // Same two numbers either way round: where the bar sits on the category axis, and how far
          // it reaches along the value axis. Only which one is x decides the chart's direction.
          d: turned
            ? barPath(Math.min(grown, base), seat + 1, length, thickness)
            : barPath(seat + 1, Math.min(grown, base), thickness, length),
          color: s.color,
          label: s.label,
          value: format(s.value(row)),
        });
      });
    }
    return out;
  });

  const dots: Computed<DotMark[]> = computed<DotMark[]>(() =>
    visible()
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.points && (s.type === 'line' || s.type === 'area'))
      .flatMap(({ s, index }) =>
        pointsFor(index)
          .filter((point) => point.defined)
          .map((point, i) => ({ key: `dot-${index}-${i}`, cx: point.x, cy: point.y, color: s.color }))
      )
  );

  /* ── axes and grid ── */
  const yTicks: Computed<AxisTick[]> = computed<AxisTick[]>(() => {
    const scale: Scale<number> = yScale();
    const box: PlotBox = plot();
    const format: (value: number) => string = props.valueFormat ?? scale.format;
    // Flipped, the value axis is the one along the bottom, and it is asked for fewer ticks — a
    // horizontal value axis has to fit its numbers side by side rather than stacked.
    if (flipped()) {
      return scale.ticks(Math.max(2, Math.floor(box.width / 80))).map((value) => ({
        key: `y-${value}`,
        x: scale.to(value),
        y: box.bottom + 14,
        label: format(value),
        anchor: 'middle' as const,
      }));
    }
    return scale.ticks().map((value) => ({
      key: `y-${value}`,
      x: box.left - 8,
      y: scale.to(value),
      label: format(value),
      anchor: 'end' as const,
    }));
  });

  /**
   * The right axis's ticks, drawn outside the plot on the other side.
   *
   * The GRID stays on the left axis alone. Two sets of gridlines at different intervals is a lattice
   * a reader has to decode before they can read anything, and the second axis's numbers are legible
   * from its own labels without one.
   */
  const rightTicks: Computed<AxisTick[]> = computed<AxisTick[]>(() => {
    if (!hasRight()) return [];
    const scale: Scale<number> = yScaleRight();
    const box: PlotBox = plot();
    const format: (value: number) => string = formatFor('right', scale);
    return scale.ticks().map((value) => ({
      key: `yr-${value}`,
      x: box.right + 8,
      y: scale.to(value),
      label: format(value),
      anchor: 'start' as const,
    }));
  });

  /**
   * How far the category labels turn.
   *
   * `'auto'` measures: labels turn only when the widest one cannot fit its slot. Rotation is a last
   * resort rather than a default, because turned text is measurably slower to read — the axis thins
   * first, and only turns when thinning would drop labels that matter.
   */
  const labelAngle: Computed<number> = computed<number>(() => {
    const setting = props.labelRotate;
    // Flipped, the labels already lie flat down the side with a slot each. Turning them would undo
    // the only thing the flip was for.
    if (setting === undefined || flipped()) return 0;
    if (typeof setting === 'number') return setting;
    if (xKind() !== 'category') return 0;
    const write: (value: unknown) => string =
      props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    const labels: string[] = xValues().map(write);
    /**
     * Measured against one SLOT, not against the axis.
     *
     * Against the full width a label never fails to fit — twelve months over 700px would each have
     * to be 700px wide to trigger it — so `'auto'` quietly never fired and the option read as
     * broken. The question it is actually asking is whether a label fits between its two
     * neighbours, plus the gap that keeps them from touching.
     */
    const box: PlotBox = baseBox();
    const slot: number = Math.abs(box.right - box.left) / Math.max(1, labels.length);
    return widestLabel(labels) + 8 > slot ? -45 : 0;
  });

  const xTicks: Computed<AxisTick[]> = computed<AxisTick[]>(() => {
    const box: PlotBox = plot();
    const band: BandScale | null = xBand();
    const angle: number = labelAngle();
    // A turned label hangs from its own end rather than being centred on the tick, or it drifts
    // away from the column it names.
    const turn = (x: number, y: number): { anchor: 'middle' | 'end'; transform?: string } =>
      angle === 0 ? { anchor: 'middle' } : { anchor: 'end', transform: `rotate(${angle} ${x} ${y})` };
    const label: (value: unknown) => string = props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    /**
     * Flipped, the categories run down the left, flat, one per bar — and every one of them is
     * drawn. No thinning: a stacked list has a line of its own for each entry, and the whole reason
     * to turn the chart on its side was to stop having to drop labels.
     */
    if (band && flipped()) {
      return band.domain.map((value) => ({
        key: `x-${value}`,
        x: box.left - 8,
        y: band.to(value),
        label: props.labelFormat ? label(value) : value,
        anchor: 'end' as const,
      }));
    }
    if (band) {
      // How many labels fit, from the width the widest one needs — not a fixed stride.
      const fit: number = Math.max(1, Math.floor(box.width / 64));
      // With rotation on, every label fits — turning them is what buys the room, so thinning to
      // what would fit flat would throw away the labels the rotation was for.
      return band.ticks(angle === 0 ? fit : band.domain.length).map((value) => {
        const x: number = band.to(value);
        const y: number = box.bottom + 14;
        return {
          key: `x-${value}`,
          x,
          y,
          label: props.labelFormat ? label(value) : value,
          ...turn(x, y),
        };
      });
    }
    const scale: Scale<number> | null = xContinuous();
    if (!scale) return [];
    return scale.ticks(Math.max(2, Math.floor(box.width / 80))).map((value) => {
      const x: number = scale.to(value);
      const y: number = box.bottom + 14;
      return {
        key: `x-${value}`,
        x,
        y,
        label: props.labelFormat ? label(value) : scale.format(value),
        ...turn(x, y),
      };
    });
  });

  const grid: Computed<GridLine[]> = computed<GridLine[]>(() => {
    const which = props.grid ?? 'y';
    if (which === false) return [];
    const box: PlotBox = plot();
    const turned: boolean = flipped();
    const out: GridLine[] = [];
    // `'y'` names the VALUE axis and `'x'` the category one, whichever way round they are drawn —
    // a gridline crosses its own axis, so each one is perpendicular to the axis that produced it.
    const across = (key: string, at: number, vertical: boolean): GridLine =>
      vertical
        ? { key, x1: at, y1: box.top, x2: at, y2: box.bottom }
        : { key, x1: box.left, y1: at, x2: box.right, y2: at };
    if (which === true || which === 'y' || which === 'both') {
      for (const tick of yTicks()) out.push(across(`gy-${tick.key}`, turned ? tick.x : tick.y, turned));
    }
    if (which === 'x' || which === 'both') {
      for (const tick of xTicks()) out.push(across(`gx-${tick.key}`, turned ? tick.y : tick.x, !turned));
    }
    return out;
  });

  const axisLines: Computed<GridLine[]> = computed<GridLine[]>(() => {
    const box: PlotBox = plot();
    // The line under the categories. Flipped, that is the left edge — bars grow away from it, so it
    // is the one edge a reader measures against.
    return flipped()
      ? [{ key: 'x-axis', x1: box.left, y1: box.top, x2: box.left, y2: box.bottom }]
      : [{ key: 'x-axis', x1: box.left, y1: box.bottom, x2: box.right, y2: box.bottom }];
  });

  /* ── hover ── */
  const nearest = (px: number): number | null => {
    const data: readonly TRow[] = rows();
    if (data.length === 0) return null;
    let best: number = 0;
    let bestDistance: number = Infinity;
    for (let i: number = 0; i < data.length; i++) {
      const distance: number = Math.abs(xAt(i) - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  };

  const pointsAt = (index: number): ChartPoint<TRow>[] =>
    visible().map((s, seriesIndex) => ({
      index,
      row: rows()[index],
      label: s.label,
      series: seriesIndex,
      x: xValues()[index],
      y: s.value(rows()[index]),
      color: s.color,
    }));

  const tooltip: Computed<TooltipView | null> = computed<TooltipView | null>(() => {
    if (props.tooltip === false) return null;
    const index: number | null = hoverIndex();
    const at: { x: number; y: number } | null = pointer();
    if (index === null || at === null) return null;
    const scale: Scale<number> = yScale();
    const format: (value: number) => string = props.valueFormat ?? scale.format;
    const all: ChartPoint<TRow>[] = pointsAt(index);
    const shown: ChartPoint<TRow>[] = props.tooltip === 'item' ? all.slice(0, 1) : all;
    const label: (value: unknown) => string = props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    return {
      x: at.x,
      y: at.y,
      title: label(xValues()[index]),
      rows: shown
        .filter((point) => Number.isFinite(point.y))
        .map((point) => ({ label: point.label, value: format(point.y), color: point.color })),
      text: props.tooltipFormat ? props.tooltipFormat(shown) : undefined,
    };
  });

  const crosshair: Computed<number | null> = computed<number | null>(() => {
    const index: number | null = hoverIndex();
    return index === null ? null : xAt(index);
  });

  /**
   * The crosshair as a line rather than as a coordinate.
   *
   * It follows the CATEGORY axis, so flipping the chart turns it from vertical to horizontal. The
   * financial branch keeps the bare number — it never flips, and a second shape would be two things
   * to keep in step for no gain.
   */
  const crossLine: Computed<GridLine | null> = computed<GridLine | null>(() => {
    const at: number | null = crosshair();
    if (at === null) return null;
    return flipped()
      ? { key: 'cross', x1: 0, y1: at, x2: width(), y2: at }
      : { key: 'cross', x1: at, y1: 0, x2: at, y2: height() };
  });

  /* ────────────────────────── radial: pie and donut ──────────────────────────
   *
   * The same `data`, `x` and `y` as everything else — one row per slice, `x` its label, `y` its
   * value. Nothing about the cartesian machinery above runs for these; the scales and the plot box
   * have no meaning on a circle. What IS shared is everything a reader notices: the palette, the
   * clock, the tooltip, the legend and the accessible table. */

  const isRadial: Computed<boolean> = computed(() => props.type === 'pie' || props.type === 'donut');

  const sliceEntries: Computed<{ label: string; value: number; index: number }[]> = computed(() => {
    const value: ((row: TRow) => number) | undefined = series()[0]?.value;
    if (!value) return [];
    const all = rows().map((row, index) => ({
      label: String(read(props.x, row) ?? ''),
      value: value(row),
      index,
    }));
    return props.maxSlices ? groupTail(all, props.maxSlices, props.otherLabel ?? 'Other') : all;
  });

  const slices: Computed<Slice[]> = computed<Slice[]>(() =>
    layoutArcs(sliceEntries().filter((_, i) => !hidden().has(i)), {
      start: toRadians(props.startAngle ?? 0),
      end: toRadians(props.startAngle ?? 0) + ((props.endAngle ?? 360) - (props.startAngle ?? 0)) * (Math.PI / 180),
      pad: ((props.padAngle ?? 1) * Math.PI) / 180,
    })
  );

  const radial: Computed<RadialView> = computed<RadialView>(() => {
    const w: number = width();
    const h: number = height();
    const start: number = toRadians(props.startAngle ?? 0);
    const finish: number = start + ((props.endAngle ?? 360) - (props.startAngle ?? 0)) * (Math.PI / 180);
    // Fitted to what the arc actually covers, so a semicircle fills its box instead of floating in
    // the top half of one.
    const fitted = fitArc(w, h, start, finish);
    const cx: number = fitted.cx;
    const cy: number = fitted.cy;
    const outer: number = fitted.radius;
    const innerFraction: number = props.innerRadius ?? (props.type === 'donut' ? 0.62 : 0);
    const inner: number = outer * Math.min(0.95, Math.max(0, innerFraction));
    const list: Slice[] = slices();
    const format: (value: number) => string = props.valueFormat ?? ((value: number) => String(value));
    const hovered: number | null = hoverIndex();

    /**
     * One edge, animated once, and read by the two slices that share it.
     *
     * A slice's `from` IS its predecessor's `to`, so deriving them separately lets the same angle
     * hold two values mid-run and opens a gap between neighbours. Harmless while every slice moved
     * on one clock; fatal the moment they move on different ones, which is what a stagger is.
     */
    const edge = (k: number): number =>
      k <= 0 ? start : memory.at(`arc-to:${list[k - 1].label}`, list[k - 1].to, motion.at(k - 1, list.length), start);

    const arcs: ArcMark[] = list.map((slice, i) => {
      // Both edges travel, so the whole ring unrolls from the start angle on mount and every edge
      // slides to its new place on an update. Interpolating only the end would drag the slices
      // across each other.
      const from: number = edge(i);
      const to: number = edge(i + 1);
      // The hovered slice steps outward. Cheaper and steadier than scaling it, which moves its
      // neighbours' apparent size too.
      const lift: number = hovered === i ? 6 : 0;
      const mid: number = (from + to) / 2;
      const ox: number = cx + Math.cos(mid) * lift;
      const oy: number = cy + Math.sin(mid) * lift;
      const centroid = arcCentroid(ox, oy, inner, outer, from, to);
      return {
        key: `arc-${slice.label}`,
        d: arcPath(ox, oy, inner, outer, from, to),
        color: seriesColor(slice.index >= 0 ? slice.index : list.length - 1),
        label: slice.label,
        value: format(slice.value),
        percent: `${Math.round(slice.share * 100)}%`,
        lx: centroid.x,
        ly: centroid.y,
        // A label needs both an arc long enough to sit on and a band deep enough to sit in.
        roomy: props.sliceLabels !== false && slice.share >= 0.06 && outer - inner >= 22,
        index: i,
      };
    });

    const total: number = list.reduce((sum, slice) => sum + slice.value, 0);
    const showCenter: boolean = props.type === 'donut' && props.centerLabel !== false;
    const centerText: string = showCenter
      ? typeof props.centerLabel === 'string'
        ? props.centerLabel
        : format(total)
      : '';
    // A partial ring's origin is on its flat edge, not in the middle of what you see — so the total
    // would sit on the baseline of a gauge rather than inside its opening. Lift it into the arc.
    const partial: boolean = finish - start <= Math.PI + 1e-6;
    return {
      cx,
      cy: partial ? cy - inner * 0.42 : cy,
      arcs,
      center: centerText,
      centerSub: showCenter && props.centerLabel === undefined ? (props.yLabel ?? 'Total') : '',
    };
  });

  /* ────────────────────────── financial: candlestick and OHLC ──────────────────────────
   *
   * An ORDINAL x axis, indexed by bar and labelled with time. Markets close: on a continuous time
   * axis a daily chart spends two sevenths of its width drawing weekends, and every candle carries a
   * gap it did not earn. Indexing by bar is also what makes the window mean "the last 60 sessions"
   * rather than "the last 60 days, 43 of which had trading". */

  const isFinancial: Computed<boolean> = computed(
    () => props.type === 'candlestick' || props.type === 'ohlc'
  );

  const barAt: Computed<(row: TRow) => Bar> = computed(() => {
    const spec = props.ohlc;
    if (!spec) return (): Bar => ({ open: NaN, high: NaN, low: NaN, close: NaN });
    // `'open' in spec` rather than `Array.isArray`: the array side is a readonly tuple, and
    // `Array.isArray` widens it to `any[]` instead of narrowing the union.
    const [o, h, l, c]: readonly Accessor<TRow, number>[] =
      'open' in spec ? [spec.open, spec.high, spec.low, spec.close] : spec;
    return (row: TRow): Bar => ({
      open: asNumber(read(o, row)),
      high: asNumber(read(h, row)),
      low: asNumber(read(l, row)),
      close: asNumber(read(c, row)),
    });
  });

  /** The visible bars, carrying their absolute index — `rows()` is already the window. */
  const windowRows: Computed<{ row: TRow; index: number }[]> = computed(() =>
    rows().map((row, i) => ({ row, index: rowOffset() + i }))
  );

  const financial: Computed<FinancialView> = computed<FinancialView>(() => {
    const w: number = width();
    const h: number = height();
    const toBar: (row: TRow) => Bar = barAt();
    const shown = windowRows();
    const hasVolume: boolean = props.volume !== undefined;

    const prices: number[] = [];
    for (const { row } of shown) {
      const bar: Bar = toBar(row);
      if (Number.isFinite(bar.high)) prices.push(bar.high);
      if (Number.isFinite(bar.low)) prices.push(bar.low);
    }
    const [low, high]: [number, number] = extent(prices);

    const priceLabels: string[] = linearScale([low, high], [0, 1], { tickCount: 5 })
      .ticks()
      .map(props.valueFormat ?? ((value: number) => compactNumber(value, 2)));
    const timeLabels: string[] = shown.map(({ row }) => String(read(props.x, row) ?? ''));

    const box: PlotBox = layout({
      width: w,
      height: h,
      leftLabels: priceLabels,
      bottomLabels: timeLabels.slice(-1),
      xTitle: props.xLabel,
      yTitle: props.yLabel,
    });

    // Two panes sharing one x axis, with a gap so the volume bars do not touch the price pane's
    // axis line and read as part of it.
    const gap: number = hasVolume ? 10 : 0;
    const volumeShare: number = hasVolume ? Math.min(0.5, Math.max(0.1, props.volumeHeight ?? 0.22)) : 0;
    const priceHeight: number = box.height * (1 - volumeShare) - gap;
    const priceBottom: number = box.top + priceHeight;
    const volumeTop: number = priceBottom + gap;

    const price: Scale<number> = linearScale([low, high], [priceBottom, box.top], { tickCount: 5 });
    const band: BandScale = bandScale(
      shown.map(({ index }) => String(index)),
      [box.left, box.right],
      { padding: 0.25 }
    );

    const up: string = props.upColor ?? 'var(--weave-chart-up, #2f9e6a)';
    const down: string = props.downColor ?? 'var(--weave-chart-down, #d1483f)';
    const bodyWidth: number = Math.max(1, band.bandwidth);
    const tick: number = Math.max(1, bodyWidth / 2);

    /**
     * A session opens at a price and the rest of it happens afterwards, so a candle grows OUT of
     * its own open — wick and body both — rather than rising from the floor. A candle sliding up
     * from the axis would be drawing a price it never traded at, for as long as the animation runs.
     *
     * Keyed by absolute index like every other mark, which is what keeps a pan from re-growing the
     * whole chart: a candle already seen travels from where it was drawn.
     */
    const candles: CandleMark[] = shown.map(({ row, index }, i) => {
      const bar: Bar = toBar(row);
      // The bar before this one in the WHOLE series, not in the window — the first visible candle
      // still has a yesterday, and colouring it against its own open would be wrong at the edge.
      const previous: Bar | undefined = index > 0 ? toBar(allRows()[index - 1]) : undefined;
      const rising: boolean = isUp(bar, previous?.close);
      const cx: number = band.to(String(index));
      const t: number = motion.at(i, shown.length);
      const openY: number = price.to(bar.open);
      const closeY: number = memory.at(`c-close:${index}`, price.to(bar.close), t, openY);
      const highY: number = memory.at(`c-high:${index}`, price.to(bar.high), t, openY);
      const lowY: number = memory.at(`c-low:${index}`, price.to(bar.low), t, openY);
      const body = candleBody(cx - bodyWidth / 2, bodyWidth, openY, closeY);
      return {
        key: `candle-${index}`,
        wx: cx,
        wy1: highY,
        wy2: lowY,
        x: body.x,
        y: body.y,
        width: body.width,
        height: body.height,
        d: ohlcPath(cx, tick, highY, lowY, openY, closeY),
        color: rising ? up : down,
        up: rising,
        index,
      };
    });

    const volumes: VolumeMark[] = [];
    if (hasVolume && props.volume) {
      const values: number[] = shown.map(({ row }) => asNumber(read(props.volume as Accessor<TRow, number>, row)));
      const [, maxVolume]: [number, number] = extent(values);
      const scale: Scale<number> = linearScale([0, maxVolume], [box.bottom, volumeTop], { tickCount: 2 });
      shown.forEach(({ index }, i) => {
        const value: number = values[i];
        if (!Number.isFinite(value)) return;
        // Volume is a count, so it grows from zero — the one place on a financial chart where a bar
        // rising from the floor is the true picture.
        const y: number = memory.at(`vol:${index}`, scale.to(value), motion.at(i, shown.length), box.bottom);
        volumes.push({
          key: `vol-${index}`,
          x: band.to(String(index)) - bodyWidth / 2,
          y,
          width: bodyWidth,
          height: Math.max(1, box.bottom - y),
          color: candles[i]?.color ?? up,
        });
      });
    }

    const format: (value: number) => string = props.valueFormat ?? ((value: number) => compactNumber(value, 2));
    const priceTicks: AxisTick[] = price.ticks().map((value) => ({
      key: `p-${value}`,
      x: box.left - 8,
      y: price.to(value),
      label: format(value),
      anchor: 'end' as const,
    }));

    // Labels come off the ROW's own x value, thinned to what fits — the axis is ordinal, so there
    // is nothing to interpolate a tick position from.
    const label: (value: unknown) => string = props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    const fit: number = Math.max(1, Math.floor(box.width / 72));
    const stride: number = Math.max(1, Math.ceil(shown.length / fit));
    const timeTicks: AxisTick[] = shown
      .filter((_, i) => i % stride === 0)
      .map(({ row, index }) => ({
        key: `t-${index}`,
        x: band.to(String(index)),
        y: box.bottom + 14,
        label: label(read(props.x, row)),
        anchor: 'middle' as const,
      }));

    const grid: GridLine[] =
      props.grid === false
        ? []
        : priceTicks.map((t) => ({ key: `g-${t.key}`, x1: box.left, y1: t.y, x2: box.right, y2: t.y }));

    return { candles, volumes, priceTicks, timeTicks, grid, priceBottom, volumeTop, hasVolume };
  });

  /* ────────────────────────── the brush ──────────────────────────
   *
   * An overview of the WHOLE series with the visible window drawn over it. The strip is deliberately
   * bare — one path, no axes, no ticks: it is a control, and furniture on it competes with the plot
   * it controls. */

  const brushHeight = (): number => props.brushHeight ?? 48;

  const brush: Computed<BrushView> = computed<BrushView>(() => {
    const all: readonly TRow[] = allRows();
    const w: number = width();
    const h: number = brushHeight();
    const count: number = all.length;
    const [from, to]: Range = range();

    // The outline is the first visible series over the whole set — enough to recognise the shape
    // you are selecting from, which is all the strip is for.
    const first: ResolvedSeries<TRow> | undefined = visible()[0];
    const values: number[] = first ? all.map((row) => first.value(row)) : [];
    const [min, max]: [number, number] = extent(values);
    const scale: Scale<number> = linearScale([min, max], [h - 2, 2], { nice: false });
    const step: number = count > 1 ? w / (count - 1) : w;
    const points: Pt[] = values.map((value, i) => ({
      x: i * step,
      y: Number.isFinite(value) ? scale.to(value) : 0,
      defined: Number.isFinite(value),
    }));

    const left: number = count > 1 ? (from / (count - 1)) * w : 0;
    const right: number = count > 1 ? (to / (count - 1)) * w : w;
    return {
      height: h,
      d: areaPath(points, h, 'linear'),
      x: left,
      width: Math.max(2, right - left),
      leftX: left,
      rightX: right,
      caption: `${from + 1}–${to + 1} of ${count}`,
    };
  });

  /**
   * One handler for all four grips.
   *
   * Both edges move, the middle pans, and a press on empty track starts a fresh window — the three
   * gestures a reader expects from a control that looks like this. Listeners go on the window so a
   * drag that leaves the strip still tracks and still ends.
   */
  const onBrushDown = (event: PointerEvent, part: 'left' | 'right' | 'body' | 'track'): void => {
    const element: HTMLElement | null = host();
    const count: number = allRows().length;
    if (!element || count < 2) return;
    event.preventDefault();
    // The grips and the window sit INSIDE the strip, which carries the track handler. Without this
    // both fire on one press: the track reads the press as "start a new window here" and the grip
    // then drags from a range that was replaced a moment ago, so an edge drag jumps to the far side
    // before it moves.
    event.stopPropagation();
    const box: DOMRect = element.getBoundingClientRect();
    const w: number = box.width || 1;
    const at = (clientX: number): number =>
      Math.max(0, Math.min(count - 1, Math.round(((clientX - box.left) / w) * (count - 1))));

    const start: Range = range();
    const anchor: number = at(event.clientX);
    if (part === 'track') setRange([anchor, anchor + Math.max(1, start[1] - start[0])]);

    const move = (moved: PointerEvent): void => {
      const here: number = at(moved.clientX);
      if (part === 'left') setRange([Math.min(here, start[1]), start[1]]);
      else if (part === 'right') setRange([start[0], Math.max(here, start[0])]);
      else if (part === 'body') {
        const shift: number = here - anchor;
        setRange([start[0] + shift, start[1] + shift]);
      } else setRange([Math.min(anchor, here), Math.max(anchor, here)]);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const financialTooltip: Computed<TooltipView | null> = computed<TooltipView | null>(() => {
    if (props.tooltip === false) return null;
    const index: number | null = hoverIndex();
    const at: { x: number; y: number } | null = pointer();
    if (index === null || at === null) return null;
    const row: TRow | undefined = rows()[index];
    if (!row) return null;
    const bar: Bar = barAt()(row);
    const format: (value: number) => string = props.valueFormat ?? ((value: number) => compactNumber(value, 2));
    const label: (value: unknown) => string = props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    const color: string = financial().candles.find((candle) => candle.index === index)?.color ?? '';
    return {
      x: at.x,
      y: at.y,
      title: label(read(props.x, row)),
      rows: [
        { label: 'O', value: format(bar.open), color },
        { label: 'H', value: format(bar.high), color },
        { label: 'L', value: format(bar.low), color },
        { label: 'C', value: format(bar.close), color },
      ],
      text: undefined,
    };
  });

  const radialTooltip: Computed<TooltipView | null> = computed<TooltipView | null>(() => {
    if (props.tooltip === false) return null;
    const index: number | null = hoverIndex();
    const at: { x: number; y: number } | null = pointer();
    const list: ArcMark[] = radial().arcs;
    if (index === null || at === null || !list[index]) return null;
    const arc: ArcMark = list[index];
    return {
      x: at.x,
      y: at.y,
      title: arc.label,
      rows: [{ label: arc.percent, value: arc.value, color: arc.color }],
      text: undefined,
    };
  });

  return {
    host,
    props,
    width,
    height,
    // A financial chart declares its values through `ohlc`, not through a series — so requiring one
    // would report a perfectly good candlestick as empty.
    hasData: (): boolean => rows().length > 0 && (series().length > 0 || (isFinancial() && props.ohlc !== undefined)),
    emptyText: (): string => props.emptyText ?? 'No data',

    ariaLabel: (): string => {
      if (props.ariaLabel) return props.ariaLabel;
      if (props.title) return props.title;
      const names: string = series().map((s) => s.label).join(', ');
      return `${props.type ?? 'line'} chart of ${names || 'no series'}`;
    },
    // The accessible fallback is a real table, not a paragraph describing one. Capped, because a
    // 5,000-row table read aloud is not access either.
    // No table under a sparkline: it sits inline in a sentence that already says what it is.
    showTable: (): boolean => props.sparkline !== true && rows().length > 0 && rows().length <= 100,
    describedRows: (): { x: string; values: { label: string; value: string }[] }[] => {
      const scale: Scale<number> = probe();
      const format: (value: number) => string = props.valueFormat ?? scale.format;
      return rows().map((row, i) => ({
        x: String(xValues()[i] ?? ''),
        values: series().map((s) => ({ label: s.label, value: format(s.value(row)) })),
      }));
    },

    grid: (): GridLine[] => (props.sparkline ? [] : grid()),
    xTicks: (): AxisTick[] => (props.sparkline ? [] : xTicks()),
    yTicks: (): AxisTick[] => (props.sparkline ? [] : yTicks()),
    rightTicks: (): AxisTick[] => (props.sparkline ? [] : rightTicks()),
    axisLines: (): GridLine[] => (props.sparkline ? [] : axisLines()),
    areas: (): PathMark[] => areas(),
    lines: (): PathMark[] => lines(),
    bars: (): BarMark[] => bars(),
    dots: (): DotMark[] => dots(),

    isSpark: (): boolean => props.sparkline === true,
    isRadial: (): boolean => isRadial(),
    radial: (): RadialView => radial(),
    onSliceEnter: (index: number): void => {
      hoverIndex.set(index);
    },

    hasBrush: (): boolean => props.brush === true && !isRadial() && allRows().length > 1,
    brush: (): BrushView => brush(),
    onBrushDown,

    isFinancial: (): boolean => isFinancial(),
    financial: (): FinancialView => financial(),
    /**
     * Wheel to zoom, about the pointer.
     *
     * `preventDefault` because a chart that scrolls the page while you are zooming it is unusable —
     * but only when zooming is actually on, so a page of small read-only charts still scrolls.
     */
    onWheel: (event: WheelEvent): void => {
      if (!isFinancial() || props.zoom === false) return;
      const element: HTMLElement | null = host();
      if (!element) return;
      event.preventDefault();
      const box: DOMRect = element.getBoundingClientRect();
      const at: number = (event.clientX - box.left) / (box.width || 1);
      setRange(zoomRange(range(), allRows().length, event.deltaY > 0 ? 1.2 : 1 / 1.2, at));
    },
    /**
     * Drag to pan, in whole bars.
     *
     * Listeners go on the window rather than the chart so a drag that leaves the element still
     * pans and still ends — the pointer does not stay captured by an element it is no longer over.
     */
    onDragStart: (event: PointerEvent): void => {
      if (!isFinancial() || props.zoom === false) return;
      const element: HTMLElement | null = host();
      if (!element) return;
      const startX: number = event.clientX;
      const startRange: Range = range();
      const perBar: number = (element.getBoundingClientRect().width || 1) / Math.max(1, startRange[1] - startRange[0] + 1);
      const move = (moved: PointerEvent): void => {
        const bars: number = Math.round((startX - moved.clientX) / perBar);
        setRange(panRange(startRange, allRows().length, bars));
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },

    // A radial chart legends its SLICES; a cartesian one legends its series. Same control, same
    // toggle, different list — which is why the legend never had to know which chart it is in.
    showLegend: (): boolean =>
      props.sparkline !== true &&
      props.legend !== false && (isRadial() ? sliceEntries().length > 1 : series().length > 1),
    legend: (): LegendEntry[] =>
      isRadial()
        ? sliceEntries().map((entry, index) => ({
            label: entry.label,
            color: seriesColor(entry.index >= 0 ? entry.index : index),
            hidden: hidden().has(index),
            index,
          }))
        : series().map((s, index) => ({
            label: s.label,
            color: s.color,
            hidden: hidden().has(index),
            index,
          })),
    toggleSeries: (index: number): void => {
      const count: number = isRadial() ? sliceEntries().length : series().length;
      const next: Set<number> = new Set<number>(hidden());
      if (next.has(index)) next.delete(index);
      // Never hide the last visible one: an empty plot with a full legend reads as broken.
      else if (next.size < count - 1) next.add(index);
      hidden.set(next);
    },

    tooltip: (): TooltipView | null =>
      props.sparkline
        ? null
        : isRadial() ? radialTooltip() : isFinancial() ? financialTooltip() : tooltip(),
    crosshair: (): number | null => {
      if (isRadial()) return null;
      if (isFinancial()) {
        const index: number | null = hoverIndex();
        return financial().candles.find((candle) => candle.index === index)?.wx ?? null;
      }
      return crosshair();
    },
    crossLine: (): GridLine | null => (props.sparkline || isRadial() || isFinancial() ? null : crossLine()),
    onMove: (event: PointerEvent): void => {
      const element: HTMLElement | null = host();
      if (!element) return;
      const box: DOMRect = element.getBoundingClientRect();
      const x: number = event.clientX - box.left;
      const y: number = event.clientY - box.top;
      pointer.set({ x, y });
      // On a circle the slice under the pointer is decided by the slice's own `pointerenter`, not
      // by distance along an axis — a wedge is a shape, not a position.
      if (isRadial()) return;
      if (isFinancial()) {
        // Nearest by drawn position among the VISIBLE bars: the window means the index under the
        // pointer is not the index in the data.
        let best: number | null = null;
        let bestDistance: number = Infinity;
        for (const candle of financial().candles) {
          const distance: number = Math.abs(candle.wx - x);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candle.index;
          }
        }
        hoverIndex.set(best);
        return;
      }
      // Along the category axis, which is the vertical one once the chart is flipped.
      hoverIndex.set(nearest(flipped() ? y : x));
    },
    onLeave: (): void => {
      hoverIndex.set(null);
      pointer.set(null);
    },
    onClick: (): void => {
      const index: number | null = hoverIndex();
      if (index === null || !props.onPointClick) return;
      const all: ChartPoint<TRow>[] = pointsAt(index);
      if (all.length > 0) props.onPointClick(all[0]);
    },

    ink: chartInk,
  };
}
