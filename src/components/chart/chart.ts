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
import { bandScale, extent, linearScale, logScale, timeScale, type BandScale, type Scale } from './scale.js';
import { layout, type PlotBox } from './layout.js';
import { areaPath, barPath, linePath, type Pt } from './marks.js';
import { arcCentroid, arcPath, fitArc, groupTail, layoutArcs, toRadians, type Slice } from './arc.js';
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
export { layout, widestLabel } from './layout.js';
export type { LayoutInput, PlotBox } from './layout.js';

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
  axisLines: () => GridLine[];
  areas: () => PathMark[];
  lines: () => PathMark[];
  bars: () => BarMark[];
  dots: () => DotMark[];

  isRadial: () => boolean;
  radial: () => RadialView;
  onSliceEnter: (index: number) => void;

  legend: () => LegendEntry[];
  showLegend: () => boolean;
  toggleSeries: (index: number) => void;

  tooltip: () => TooltipView | null;
  crosshair: () => number | null;
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
  const height = (): number => props.height ?? 260;

  /* ── data ── */
  const rows: Computed<readonly TRow[]> = computed<readonly TRow[]>(() =>
    typeof props.data === 'function' ? props.data() : props.data ?? []
  );

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
    const defaultType: SeriesType = declared === 'pie' || declared === 'donut' ? 'bar' : declared;
    return configs.map((config, index) => ({
      label: config.label ?? nameOf(config.y, `Series ${index + 1}`),
      type: config.type ?? defaultType,
      color: seriesColor(index, config.color),
      width: config.width ?? 2,
      dash: config.dash ?? seriesDash(index),
      curve: (config.curve ?? 'linear') as Curve,
      // Dots stop helping once they touch: at more than ~60 points they are a texture, not marks.
      points: config.points ?? rows().length <= 60,
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

  /* ── value domain ── */
  const yDomain: Computed<[number, number]> = computed<[number, number]>(() => {
    const values: number[] = [];
    visible().forEach((s, index) => {
      rows().forEach((_, i) => {
        const top: number = topOf(index, i);
        if (Number.isFinite(top)) values.push(top);
        if (s.stack) values.push(baseOf(index, i));
      });
    });
    const [min, max]: [number, number] = extent(values);
    // Bars encode by length, so their axis starts at zero unless the caller insists otherwise.
    const zero: boolean = props.zero ?? hasBars();
    return [props.yMin ?? (zero ? Math.min(0, min) : min), props.yMax ?? Math.max(max, zero ? 0 : max)];
  });

  /* ── labels first, then the box, then the scales ──
   * The margins depend on the tick text, and the tick text depends only on the domain — not on the
   * box. So the domain is resolved, its labels are measured, and only then is the plot sized. */
  const probe: Computed<Scale<number>> = computed(() => makeY([0, 1]));

  const makeY = (range: [number, number]): Scale<number> => {
    const [min, max]: [number, number] = yDomain();
    return props.yType === 'log'
      ? logScale([min, max], range)
      : linearScale([min, max], range, { tickCount: 5 });
  };

  const yLabels: Computed<string[]> = computed<string[]>(() => {
    const scale: Scale<number> = probe();
    const format: (value: number) => string = props.valueFormat ?? scale.format;
    return scale.ticks().map(format);
  });

  const xLabels: Computed<string[]> = computed<string[]>(() => {
    const kind: 'time' | 'category' | 'linear' = xKind();
    const values: unknown[] = xValues();
    if (kind === 'category') return values.map((value) => String(value ?? ''));
    const numbers: number[] = values.map((value) => (kind === 'time' ? toTime(value) : asNumber(value)));
    const [min, max]: [number, number] = extent(numbers);
    const scale: Scale<number> = kind === 'time' ? timeScale([min, max], [0, 1]) : linearScale([min, max], [0, 1]);
    return scale.ticks().map(scale.format);
  });

  const plot: Computed<PlotBox> = computed<PlotBox>(() =>
    layout({
      width: width(),
      height: height(),
      leftLabels: yLabels(),
      bottomLabels: xLabels(),
      xTitle: props.xLabel,
      yTitle: props.yLabel,
    })
  );

  const yScale: Computed<Scale<number>> = computed(() => {
    const box: PlotBox = plot();
    return makeY([box.bottom, box.top]);
  });

  /** Category axis, or null when x is continuous. Bars need the band; lines do not. */
  const xBand: Computed<BandScale | null> = computed<BandScale | null>(() => {
    if (xKind() !== 'category') return null;
    const box: PlotBox = plot();
    return bandScale(xValues().map((value) => String(value ?? '')), [box.left, box.right], {
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
    const scale: Scale<number> = yScale();
    const box: PlotBox = plot();
    const t: number = motion.progress();
    const zeroY: number = Math.min(box.bottom, Math.max(box.top, scale.to(0)));
    return rows().map((_, i) => {
      const top: number = topOf(seriesIndex, i);
      const defined: boolean = Number.isFinite(top);
      const target: number = defined ? scale.to(top) : zeroY;
      const y: number = memory.at(`${seriesIndex}:${i}`, target, t, zeroY);
      return { x: xAt(i), y, defined };
    });
  };

  const areas: Computed<PathMark[]> = computed<PathMark[]>(() => {
    const box: PlotBox = plot();
    const scale: Scale<number> = yScale();
    const baseline: number = Math.min(box.bottom, Math.max(box.top, scale.to(0)));
    return visible()
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.type === 'area')
      .map(({ s, index }) => ({
        key: `area-${index}`,
        d: areaPath(pointsFor(index), baseline, s.curve),
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
    const scale: Scale<number> = yScale();
    const box: PlotBox = plot();
    const t: number = motion.progress();
    const list: ResolvedSeries<TRow>[] = visible();
    const barSeries: number[] = list.map((s, i) => (s.type === 'bar' ? i : -1)).filter((i) => i >= 0);
    if (barSeries.length === 0) return [];

    // Series in the same stack share one slot; unstacked ones sit side by side in it.
    const groups: string[] = [];
    for (const index of barSeries) {
      const key: string = list[index].stack ?? `solo-${index}`;
      if (!groups.includes(key)) groups.push(key);
    }
    const slot: number = band ? band.bandwidth : Math.max(4, box.width / Math.max(1, rows().length) * 0.8);
    const each: number = slot / Math.max(1, groups.length);
    const zeroY: number = Math.min(box.bottom, Math.max(box.top, scale.to(0)));
    const format: (value: number) => string = props.valueFormat ?? scale.format;

    const out: BarMark[] = [];
    for (const index of barSeries) {
      const s: ResolvedSeries<TRow> = list[index];
      const group: number = groups.indexOf(s.stack ?? `solo-${index}`);
      rows().forEach((row, i) => {
        const top: number = topOf(index, i);
        if (!Number.isFinite(top)) return;
        const bottom: number = s.stack ? scale.to(baseOf(index, i)) : zeroY;
        const target: number = scale.to(top);
        const y: number = memory.at(`bar-${index}:${i}`, target, t, bottom);
        const left: number = (band ? band.start(String(xValues()[i] ?? '')) : xAt(i) - slot / 2) + group * each;
        out.push({
          key: `bar-${index}-${i}`,
          d: barPath(left + 1, Math.min(y, bottom), Math.max(1, each - 2), Math.abs(bottom - y)),
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
    return scale.ticks().map((value) => ({
      key: `y-${value}`,
      x: box.left - 8,
      y: scale.to(value),
      label: format(value),
      anchor: 'end' as const,
    }));
  });

  const xTicks: Computed<AxisTick[]> = computed<AxisTick[]>(() => {
    const box: PlotBox = plot();
    const band: BandScale | null = xBand();
    const label: (value: unknown) => string = props.labelFormat ?? ((value: unknown) => String(value ?? ''));
    if (band) {
      // How many labels fit, from the width the widest one needs — not a fixed stride.
      const fit: number = Math.max(1, Math.floor(box.width / 64));
      return band.ticks(fit).map((value) => ({
        key: `x-${value}`,
        x: band.to(value),
        y: box.bottom + 14,
        label: props.labelFormat ? label(value) : value,
        anchor: 'middle' as const,
      }));
    }
    const scale: Scale<number> | null = xContinuous();
    if (!scale) return [];
    return scale.ticks(Math.max(2, Math.floor(box.width / 80))).map((value) => ({
      key: `x-${value}`,
      x: scale.to(value),
      y: box.bottom + 14,
      label: props.labelFormat ? label(value) : scale.format(value),
      anchor: 'middle' as const,
    }));
  });

  const grid: Computed<GridLine[]> = computed<GridLine[]>(() => {
    const which = props.grid ?? 'y';
    if (which === false) return [];
    const box: PlotBox = plot();
    const out: GridLine[] = [];
    if (which === true || which === 'y' || which === 'both') {
      for (const tick of yTicks()) {
        out.push({ key: `gy-${tick.key}`, x1: box.left, y1: tick.y, x2: box.right, y2: tick.y });
      }
    }
    if (which === 'x' || which === 'both') {
      for (const tick of xTicks()) {
        out.push({ key: `gx-${tick.key}`, x1: tick.x, y1: box.top, x2: tick.x, y2: box.bottom });
      }
    }
    return out;
  });

  const axisLines: Computed<GridLine[]> = computed<GridLine[]>(() => {
    const box: PlotBox = plot();
    return [{ key: 'x-axis', x1: box.left, y1: box.bottom, x2: box.right, y2: box.bottom }];
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
    const t: number = motion.progress();
    const list: Slice[] = slices();
    const format: (value: number) => string = props.valueFormat ?? ((value: number) => String(value));
    const hovered: number | null = hoverIndex();

    const arcs: ArcMark[] = list.map((slice, i) => {
      // Both edges travel, so the whole ring unrolls from the start angle on mount and every edge
      // slides to its new place on an update. Interpolating only the end would drag the slices
      // across each other.
      const from: number = memory.at(`arc-from:${slice.label}`, slice.from, t, start);
      const to: number = memory.at(`arc-to:${slice.label}`, slice.to, t, start);
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
    hasData: (): boolean => rows().length > 0 && series().length > 0,
    emptyText: (): string => props.emptyText ?? 'No data',

    ariaLabel: (): string => {
      if (props.ariaLabel) return props.ariaLabel;
      if (props.title) return props.title;
      const names: string = series().map((s) => s.label).join(', ');
      return `${props.type ?? 'line'} chart of ${names || 'no series'}`;
    },
    // The accessible fallback is a real table, not a paragraph describing one. Capped, because a
    // 5,000-row table read aloud is not access either.
    showTable: (): boolean => rows().length > 0 && rows().length <= 100,
    describedRows: (): { x: string; values: { label: string; value: string }[] }[] => {
      const scale: Scale<number> = probe();
      const format: (value: number) => string = props.valueFormat ?? scale.format;
      return rows().map((row, i) => ({
        x: String(xValues()[i] ?? ''),
        values: series().map((s) => ({ label: s.label, value: format(s.value(row)) })),
      }));
    },

    grid: (): GridLine[] => grid(),
    xTicks: (): AxisTick[] => xTicks(),
    yTicks: (): AxisTick[] => yTicks(),
    axisLines: (): GridLine[] => axisLines(),
    areas: (): PathMark[] => areas(),
    lines: (): PathMark[] => lines(),
    bars: (): BarMark[] => bars(),
    dots: (): DotMark[] => dots(),

    isRadial: (): boolean => isRadial(),
    radial: (): RadialView => radial(),
    onSliceEnter: (index: number): void => {
      hoverIndex.set(index);
    },

    // A radial chart legends its SLICES; a cartesian one legends its series. Same control, same
    // toggle, different list — which is why the legend never had to know which chart it is in.
    showLegend: (): boolean =>
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

    tooltip: (): TooltipView | null => (isRadial() ? radialTooltip() : tooltip()),
    crosshair: (): number | null => (isRadial() ? null : crosshair()),
    onMove: (event: PointerEvent): void => {
      const element: HTMLElement | null = host();
      if (!element) return;
      const box: DOMRect = element.getBoundingClientRect();
      const x: number = event.clientX - box.left;
      const y: number = event.clientY - box.top;
      pointer.set({ x, y });
      // On a circle the slice under the pointer is decided by the slice's own `pointerenter`, not
      // by distance along an axis — a wedge is a shape, not a position.
      if (!isRadial()) hoverIndex.set(nearest(x));
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
