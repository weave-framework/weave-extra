# `@weave-framework/extra/components/chart`

One component, every chart. Responsive, animated, themed, keyboard-reachable and accessible without
being asked — those are not features to opt into, they are what "a chart" means, and a library that
makes you ask for them has moved its own work onto its caller.

```html
<Chart type="bar" data={{ sales }} x="month" y="revenue" />
```

That line is the design. Everything below is an override.

> **Running examples.** `pnpm run examples`, then **Chart** (`#chart`) for the whole surface in
> order, or **Chart recipes** (`#chart-recipes`) for one feature at a time with its own source.

---

## Contents

1. [The smallest chart](#1-the-smallest-chart)
2. [Series](#2-series)
3. [Chart types](#3-chart-types)
4. [Axes](#4-axes)
5. [Colour and theming](#5-colour-and-theming)
6. [Animation](#6-animation)
7. [Tooltip, legend, crosshair](#7-tooltip-legend-crosshair)
8. [Accessibility](#8-accessibility)
9. [Financial charts](#9-financial-charts)
10. [Pie and donut](#10-pie-and-donut)
11. [Sparklines and `<Metric>`](#11-sparklines-and-metric)
12. [Options reference](#12-options-reference)
13. [Exports](#13-exports)
14. [Rules and pitfalls](#14-rules-and-pitfalls)

---

## 1. The smallest chart

```ts
import Chart from '@weave-framework/extra/components/chart';

export interface Month extends Record<string, unknown> {
  month: string;
  revenue: number;
}

export function setup(): { Chart: typeof Chart; months: Month[] } {
  return { Chart, months: [{ month: 'Jan', revenue: 41_000 }] };
}
```

```html
<Chart type="bar" data={{ months }} x="month" y="revenue" />
```

Nothing else is required. The value axis chooses its own readable numbers and starts at zero; the
margins are measured from the labels that will actually be drawn; the width follows the container;
the marks animate in; there is a tooltip.

`data` may be an array or a getter — pass a getter when the rows arrive later or change.

---

## 2. Series

`y` is the one-series shorthand. `series` replaces it and takes over:

```ts
const twoSeries: SeriesConfig<Month>[] = [
  { y: 'revenue', label: 'Revenue' },
  { y: 'cost', label: 'Cost', type: 'area', curve: 'smooth' },
];
```

| Key | Effect |
| --- | --- |
| `y` | Field name, or a function for anything computed |
| `label` | Legend and tooltip name. Defaults to the field name |
| `type` | `line` / `area` / `bar` — overrides the chart's `type` for this series |
| `color` | Passed through untouched. Otherwise the palette cycle |
| `width` | Line width in px. Default 2 |
| `dash` | Stroke pattern. Set automatically past the first palette cycle |
| `curve` | `linear` (default) / `smooth` / `step` |
| `points` | Dots at each point. Default: on under 60 rows, off for a sparkline |
| `fillOpacity` | Area fill. Default 0.15 |
| `stack` | Stack group name |
| `axis` | `'left'` (default) or `'right'` |

### 2.1 Combo charts

Per-series `type` is the whole of it — bars with a trend line over them is two entries in one array,
not a different component:

```ts
const combo: SeriesConfig<Month>[] = [
  { y: 'revenue', label: 'Revenue', type: 'bar' },
  { y: 'cost', label: 'Cost', type: 'line', curve: 'smooth' },
];
```

### 2.2 Stacking

Series sharing a `stack` name stack together; a series without one never stacks. A name rather than a
boolean, because a chart with two stacked pairs is a real thing and the boolean version ends up
needing the name anyway:

```ts
const stacked: SeriesConfig<Month>[] = [
  { y: 'cost', label: 'Cost', type: 'bar', stack: 'p&l' },
  { y: 'margin', label: 'Margin', type: 'bar', stack: 'p&l' },
];
```

A trend line over stacked bars keeps its own values — only the stacked series are accumulated.

### 2.3 Two axes

```ts
const dual: SeriesConfig<Month>[] = [
  { y: 'revenue', label: 'Revenue', type: 'bar' },
  { y: (row) => (row.margin / row.revenue) * 100, label: 'Margin %', type: 'line', axis: 'right' },
];
```

```html
<Chart data={{ months }} x="month" series={{ dual }}
       valueFormat={{ money }} rightFormat={{ percent }} />
```

Each side takes its domain from **its own series only**. Sharing the extent would defeat the point: a
percentage plotted against a euro axis is a flat line along the floor, which is exactly the chart a
second axis exists to avoid.

Consequences worth knowing:

- `rightFormat` exists because a second axis means a second unit — euros and per cent cannot both be
  `€{n}k`. It falls back to `valueFormat`, then to the scale's own formatting.
- `yMin` / `yMax` pin the **left** axis only. One pair cannot mean two units.
- The **grid stays on the left axis**. Two sets of gridlines at different intervals is a lattice a
  reader has to decode before they can read anything.

---

## 3. Chart types

| `type` | What it is | Needs |
| --- | --- | --- |
| `line` (default) | A stroked path | `y` or `series` |
| `area` | Filled to the baseline, with its own stroke | `y` or `series` |
| `bar` | Grouped or stacked columns | `y` or `series` |
| `pie` | Wedges | `x` = label, `y` = value |
| `donut` | Wedges with a hole and a total | `x` = label, `y` = value |
| `candlestick` | Body plus high–low wick | `ohlc` |
| `ohlc` | High–low bar with open/close ticks | `ohlc` |

`sparkline` is a modifier rather than a type — see [§11](#11-sparklines-and-metric).

---

## 4. Axes

### 4.1 The x axis chooses itself

`xType: 'auto'` (the default) looks at the first non-null value:

| Value | Read as |
| --- | --- |
| `Date` | time |
| number above `3.15e10` | time (milliseconds past 1971) |
| number below that | linear |
| a string matching `\d{4}-\d{2}` | time |
| any other string | category |

The millisecond threshold is a heuristic, stated rather than hidden: raw counts above 3.15e10 would
be misread, which is what `xType` is for.

### 4.2 Ticks

Ticks are chosen on the 1 / 2 / 5 / 10 ladder — steps a reader can do arithmetic on in their head.
Dividing the extent by a tick count gives steps like 3.7, and an axis labelled 0, 3.7, 7.4 is one
nobody reads.

A time axis picks from a fixed ladder of real durations (1/5/15/30 minutes, hours, days, weeks,
months, years), because time is not decimal and a "nice" 8.64e7 ms step is a day only by accident.
Labels are written at the resolution the step implies — no year on an hourly axis.

A category axis thins its labels to what fits, keeping every *n*th rather than dropping the tail:
truncating the axis silently is worse than showing fewer labels.

### 4.3 The zero rule

```ts
zero?: boolean   // default: true for bars, false for lines
```

Bars encode value by **length**, so a truncated axis makes a 3% difference look like 300% — the
single most common way a chart misleads. A line encodes by position, where a zoomed axis is
legitimate and often the only way to see anything.

### 4.4 Turning the labels

```ts
labelRotate?: number | 'auto'
```

`'auto'` measures, and turns the labels only when the widest one cannot fit its slot. Rotation is a
last resort rather than a default: turned text is measurably slower to read, so the axis thins to
what fits first, and turns only when thinning would drop labels that matter.

With rotation on, thinning stops — turning is what buys the room, so dropping labels afterwards
would throw away exactly what the rotation was for. The bottom margin grows by the label's own
length projected onto the vertical.

The measurement is per **slot**, not per axis: the question is whether one label fits between its
two neighbours. So `'auto'` is a function of the width, and the same chart can turn its labels in a
sidebar and leave them flat across a page. It applies to a category axis only — a time or numeric
axis chooses how many ticks to place, so it can thin instead. An explicit angle always wins.

### 4.5 Formatting

```ts
valueFormat?: (value: number) => string   // the value axis and the tooltip
rightFormat?: (value: number) => string   // the right axis, when there is one
labelFormat?: (value: unknown) => string  // the category / time axis
```

Without one, the axis writes compact numbers (`1.2k`, `3.4M`) — an axis label is read at a glance in
a narrow gutter, and `1200000` there costs width and reads slower. Exactness belongs in the tooltip.

### 4.6 Log scale

```ts
yType: 'log'
```

Non-positive values are dropped rather than clamped: `log(0)` is not a number, and clamping to a tiny
epsilon draws a line plunging off the plot, which reads as data rather than as the absence of it.

---

## 5. Colour and theming

Every colour is emitted as `var(--weave-chart-N, <default>)`. Three things follow:

- **Themeable without touching TypeScript.** Set `--weave-chart-1` on any ancestor and it wins.
- **Follows the page's dark mode for free**, because the defaults live in a stylesheet the theme
  already controls rather than in an object the theme cannot reach.
- **No colour arithmetic at render time.**

```css
.dashboard {
  --weave-chart-1: #0b6bcb;
  --weave-chart-2: #b5651d;
}
```

| Token | Used for |
| --- | --- |
| `--weave-chart-1` … `--weave-chart-8` | The series cycle |
| `--weave-chart-up` / `--weave-chart-down` | Rising and falling, on financial charts |
| `--weave-chart-axis` / `--weave-chart-grid` / `--weave-chart-label` | The furniture |

Eight hues, then the cycle repeats **with a dash pattern**, not with a ninth hue. Past about eight,
adjacent categories stop being distinguishable — for anyone, and much sooner for the ~8% of men with
a colour vision deficiency. Two identically-coloured lines is a chart that lies; a stroke pattern
survives greyscale printing too.

Series 1 **is** the design system's `accent`, 3 is `paid`, 5 is `error` — so a chart looks like the
rest of the application by construction rather than by coincidence.

Up and down are their own tokens rather than palette slots: they are a direction, not a category, and
some markets read the pair the other way round — a theme override, not a fork of the component.

---

## 6. Animation

```ts
animate?: boolean            // default true
duration?: number            // default 600
stagger?: boolean | number   // default false; true is 0.55
```

**One clock per chart, not one per mark.** A chart with 300 bars has 300 numbers that want to move;
giving each its own effect and its own `requestAnimationFrame` is how a chart library becomes the
slowest thing on a page. One rAF loop drives one signal, and every mark reads it.

**Updates interpolate, they do not redraw.** A bar going 40 → 90 travels; a bar that is new grows
from the baseline. Only remembering the previous state per mark can tell those apart.

**Reduced motion turns animation off**, not down. Someone who asked for less motion asked for none,
not for the same motion delivered faster.

**A hidden tab finishes immediately.** `requestAnimationFrame` does not fire in a background tab —
not throttled, *not at all* — so a chart that grows its marks from zero would render as an empty plot
until the tab was shown. The same applies in a collapsed panel and an off-screen route. An animation
nobody saw is not worth a chart that was blank.

**A candle grows out of its own open**, not up from the axis. A session opens at a price and the rest
of it happens afterwards, so the wick and the body extend from the open in both directions. A candle
rising from the floor would be drawing prices that never traded for as long as the animation ran.
Volume is a count, so volume bars *do* grow from zero — the one place on a financial chart where that
is the true picture.

### 6.1 Choreography

```ts
stagger?: boolean | number   // 0 to 0.8
```

Marks arrive one after another instead of together, in reading order — left to right along an axis,
clockwise around a pie. A staggered line unfurls from its left edge; a staggered pie unrolls.

It is a **share of the run, not a delay per mark**. `delay: 30` reads well against twelve bars and
turns three hundred candles into a nine-second wait, which is how this feature usually ships. Here
the choreography costs the same at any length — with 300 marks the gaps are simply finer.

The run *lengthens* by the spread rather than being divided by it. Fitting the same 600ms inside a
staggered run would make each mark move for less than 600ms, so choreographing a chart would make
every individual mark snappier — the opposite of what was asked for. At `stagger: 0.55` and the
default duration, each mark still moves for 600ms and the whole run takes 930.

Capped at 0.8. At 1 the last mark starts as the first one finishes, which is not choreography but a
queue, and the reader has stopped watching before the end.

---

## 7. Tooltip, legend, crosshair

```ts
tooltip?: boolean | 'shared' | 'item'          // default 'shared'
tooltipFormat?: (points: ChartPoint[]) => string
legend?: boolean                               // shown once there is more than one series
```

`'shared'` shows every series at that x — the good default, because comparing series is usually why
there is more than one. `'item'` shows only the one hit.

The legend toggles a series on click. **The last visible series refuses to hide**: an empty plot under
a full legend reads as broken rather than as a choice. On a radial chart the legend lists slices
instead of series — same control, different list.

A crosshair follows the hovered x. On a circle there is nothing to cross, so radial charts have none:
the slice under the pointer is decided by the slice's own shape, not by distance along an axis.

```ts
onPointClick?: (point: ChartPoint<TRow>) => void
```

---

## 8. Accessibility

- The plot is `role="img"` with a generated `aria-label` (`ariaLabel` → `title` → a description of
  the series).
- Under 100 rows the chart is followed by a **real data table**, present for a screen reader and
  visually hidden. A paragraph describing a chart is not access; the numbers are. Capped, because a
  5,000-row table read aloud is not access either.
- Legend entries are real `<button>`s with `aria-pressed`.
- Every mark carries a `<title>`, so a pointer-driven reader gets it too.
- Colour is never the only channel: the palette repeats with dashes, and `<Metric>` puts an arrow
  next to its delta.

---

## 9. Financial charts

```html
<Chart type="candlestick" data={{ sessions }} x="day" ohlc={{ ['o','h','l','c'] }} volume="v" />
```

`ohlc` takes an array read as O, H, L, C, or an object `{ open, high, low, close }`.

### 9.1 The x axis is ordinal, not time

This is the difference between a financial chart and a line chart with fancier marks. Markets close:
on a continuous time axis a daily chart spends two sevenths of its width drawing weekends, and every
candle carries a gap it did not earn. Indexed by bar, "the last 60 sessions" means 60 candles rather
than 60 days containing 43 of them — which is also what makes the zoom window mean something.

### 9.2 Colour is against the previous close

Not against the bar's own open. A session that opened below yesterday's close and recovered to just
above its own open is a **down** day, and painting it green tells the reader the opposite of what
happened. The first bar has nothing to compare against and falls back to open-vs-close.

### 9.3 Zoom and pan

```ts
range?: readonly [number, number]                  // inclusive row indices; uncontrolled when omitted
onRangeChange?: (range: readonly [number, number]) => void
zoom?: boolean                                     // default true
```

Wheel zooms **about the pointer**, not the centre: zooming about the middle fights the reader, who
points at the spike they care about and watches it slide away as the window narrows. Drag pans in
whole bars. A window never narrows below five bars.

### 9.4 Volume

```ts
volume?: Accessor<TRow, number>
volumeHeight?: number   // share of the height, default 0.22
```

A second pane under the price pane, sharing the x axis and the up/down colours.

---

## 9.5 Showing one part of a long series

```html
<Chart data={{ readings }} x="at" series={{ series }} brush />
```

`brush` puts an overview of the whole series under the plot with a window over it. The window is
**resizable from both edges**, draggable in the middle, and a drag on empty track starts a new one.
That combination is what makes it a control rather than a picture: narrow from the right, then nudge
the left edge, without re-selecting from scratch.

| Option | Default | Effect |
| --- | --- | --- |
| `brush` | off | The overview strip |
| `brushHeight` | 48 | Its height in px |
| `range` | — | The window, as inclusive row indices. Controlled when given |
| `onRangeChange` | — | Reports every change |

It works for **every cartesian type**, because the window is what every mark reads: `rows()` inside
the component means "the visible part", so a line, a bar and a candle all respect it without knowing
a brush exists. Financial charts get a window implicitly through `zoom`.

The strip is deliberately bare — one path, no axes, no ticks. It is a control, and furniture on it
competes with the plot it controls.

---

## 10. Pie and donut

```html
<Chart type="donut" data={{ share }} x="product" y="revenue" maxSlices={{ 6 }} />
```

Same `data`, `x` and `y` as everything else — one row per slice. Moving between a bar chart and a
donut is one word.

| Option | Default | Effect |
| --- | --- | --- |
| `innerRadius` | 0 for pie, 0.62 for donut | Hole size, as a fraction of the outer radius |
| `startAngle` / `endAngle` | 0 / 360 | Degrees clockwise from twelve o'clock |
| `padAngle` | 1 | Gap between slices, clamped so it can never eat them |
| `maxSlices` | — | Keep the largest N, fold the rest into one |
| `otherLabel` | `'Other'` | What that one is called |
| `centerLabel` | the total | Donut hole text. `false` for none |
| `sliceLabels` | `true` | Percentages on slices with room for one |

**`maxSlices` is the option worth reaching for.** Twenty categories with fifteen unreadable slivers is
the commonest way a pie fails; grouping the tail is what a person would do by hand, and it keeps the
total honest, which dropping them would not.

Negative values are refused rather than drawn as a negative sweep — a pie of a quantity that can go
below zero is not a pie.

Setting the angles turns the same component into a gauge; the ring is fitted to what the arc actually
covers, so a semicircle fills its box instead of floating in the top half.

---

## 11. Sparklines and `<Metric>`

```html
<Chart sparkline data={{ trend }} x="t" y="v" />
```

Strips the chart to its marks — no axes, grid, legend, tooltip, dots or margins — and drops the
default height to 40. Axes on something that tall are unreadable furniture crowding out the only
thing being said, which is the shape.

### `<Metric>`

```html
<Metric label="Churn" value={{ 4.6 }} unit="%" delta={{ 5.2 }} deltaLabel="vs last month"
        invert data={{ churnTrend }} x="t" y="v" />
```

The tile every dashboard rebuilds by hand. Not a chart, which is why it is not a `<Chart>` type — but
it composes one, so its sparkline is the same engine.

| Option | Effect |
| --- | --- |
| `label`, `value`, `unit`, `format` | The number and what it is |
| `delta`, `deltaLabel`, `deltaFormat` | The change, as a percentage |
| **`invert`** | Down is good: cost, churn, latency, error rate |
| `tone` | Force `good` / `bad` / `flat` instead of deriving it |
| `data`, `x`, `y`, `sparkType`, `sparkHeight`, `sparkColor` | The sparkline |
| `target`, `targetLabel` | A progress bar under the value |

**`invert` is the judgement worth having.** A delta's colour follows its *meaning*, not its sign:
churn up 5% is bad, latency down 8% is good. A tile that paints every rise green tells the reader the
opposite of the truth on about half a real dashboard, and most libraries leave this to the caller.
The arrow carries the direction as a second channel, so the tile survives greyscale.

---

## 12. Options reference

```ts
<Chart
  data                      // rows, or a getter — required
  x                         // field name or function — required
  y                         // one-series shorthand
  series                    // SeriesConfig[]
  type                      // 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'candlestick' | 'ohlc'

  xType yType yMin yMax zero
  valueFormat rightFormat labelFormat

  height grid legend tooltip tooltipFormat
  brush brushHeight labelRotate
  animate duration stagger
  ariaLabel title xLabel yLabel emptyText
  sparkline
  onPointClick

  // financial
  ohlc volume volumeHeight range onRangeChange zoom upColor downColor

  // radial
  innerRadius startAngle endAngle padAngle maxSlices otherLabel centerLabel sliceLabels
/>
```

Defaults: `type` line · `height` 260 (40 for a sparkline) · `grid` `'y'` · `tooltip` `'shared'` ·
`animate` true · `duration` 600 · `stagger` false · `zero` true for bars · `zoom` true · `padAngle` 1 ·
`volumeHeight` 0.22 · `brushHeight` 48.

`horizontal` is declared and **not implemented** — see [§14.6](#146-what-is-not-there).

---

## 13. Exports

The component is the default export; everything it is built from is named, so a caller drawing
something this component does not cover need not rebuild scales, easing or path geometry.

```ts
import Chart, {
  // scales
  linearScale, bandScale, timeScale, logScale, niceDomain, extent, compactNumber, formatTime,
  // animation
  clock, easings, lerp, Memory, prefersReducedMotion,
  // colour
  seriesColor, seriesDash, paletteDefault, chartInk, PALETTE_SIZE,
  // geometry
  linePath, areaPath, barPath, arcPath, arcCentroid, layoutArcs, groupTail, fitArc, polar, toRadians, TAU,
  // financial
  candleBody, ohlcPath, isUp, clampRange, zoomRange, panRange,
  // layout
  layout, widestLabel,
  // morphing one chart into another — see 14.5
  morph, captureChart, sampleShape, alignRing, parseColor,
  type ChartProps, type SeriesConfig, type ChartPoint, type ChartType, type SeriesType, type Curve,
} from '@weave-framework/extra/components/chart';

import Metric, { type MetricProps, type MetricTone } from '@weave-framework/extra/components/metric';
```

---

## 14. Rules and pitfalls

### 14.1 SVG, and where it stops being right

Elements inherit the page's theme through CSS custom properties, carry their own pointer targets so
there is no hit-test arithmetic, print at any resolution, and can be reached by a screen reader. The
cost is DOM nodes, and the trade stops being right somewhere past a couple of thousand marks — which
is the point at which a caller should be aggregating rather than drawing.

### 14.2 `smooth` is monotone

The curve cannot overshoot its own points. A cardinal spline through 10, 90, 10 renders a peak above
90 — a chart showing a value nobody measured. This is why `curve: 'smooth'` is safe to offer at all.

### 14.3 Gaps break the line

A non-finite value ends the run and starts a new one. Interpolating across a gap is the quiet lie
charts tell most often: three months of missing revenue drawn as a smooth climb.

### 14.4 Height is yours, width is not

Width always follows the container through a `ResizeObserver`; only `height` is a prop. A chart in a
container with no width renders nothing until it has one.

### 14.5 Two different transitions, and which claim each makes

Hand a mounted chart a new dataset and every mark travels to its new place. That is the **update**
animation, and its claim is strong: *this* bar is *that* bar, and the value moved. True when the
same series changes — new month, refreshed query, a filter applied — and only then.

Switching to an unrelated chart is a different question, because there is nothing to pair by.
Twelve bars against ninety candles, a filled ring against a stroked line: no correspondence exists,
so none can be interpolated. `morph()` transitions those anyway, on the one thing every mark shares:

```ts
import { captureChart, morph } from '@weave-framework/extra/components/chart';

const from = captureChart(currentSvg);   // sample the outlines BEFORE the swap
choice.set(next);                        // the old chart is gone after this
queueMicrotask(() => morph(stage, from, stage.querySelector('.weave-chart__svg')));
```

`path`, `rect`, `circle` and `line` all descend from `SVGGeometryElement`, so the browser will hand
back a point at any distance along any of them. Sampled into equal-length rings, two shapes
interpolate — a bar really does bend into a slice.

Its claim is the weaker one, deliberately: **this display is becoming that one**. Marks pair by
position along the axis, not by identity, and the motion says nothing about which number became
which — because between two unrelated datasets, nothing did.

Three details decide whether it reads as one shape changing or as shapes trading places. Rings are
**rotated to align** before interpolating, or the shape turns inside out on the way across. Marks
are paired **left to right**, so the change runs along the axis. Pairing is **proportional** rather
than enter-and-exit, so twelve bars becoming four slices is groups of three converging and landing
on top of each other, and nothing appears out of nowhere.

Two traps, both about time rather than geometry:

- Capture the outgoing chart **before** setting the signal. A moment later the component is gone and
  its geometry with it.
- Start the morph on a **microtask**, not a frame. The incoming chart's marks exist synchronously
  but render at `width="0"` until `onMount` measures the container, which is one microtask away;
  capture on the same tick and you morph into a plot squashed against the left margin. A frame would
  also work and would be worse — frames never arrive in a background tab.

Sequence a plain crossfade on a **timer** rather than `transitionend`, for the same reason: a CSS
transition in a hidden tab is created and never advances, so the end event never comes.

### 14.6 What is not there

`horizontal` is declared in `ChartProps` and does nothing yet. Radar, gauge as a type, funnel, 3D and
maps are deliberately absent: they look impressive in a catalogue and are almost never the right
chart.

### 14.7 The type check that counts

`weave check` does not type-check this package's `src`. Use `tsc`:

```bash
npm run typecheck
```
