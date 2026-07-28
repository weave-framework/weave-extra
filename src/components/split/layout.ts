/**
 * `<Split>` — the pure layout math.
 *
 * Deliberately free of DOM, signals and component wiring: every function here is a plain
 * input → output transform, so the parts that are easy to get wrong (wildcard resolution, the
 * shrink/expand cascade, grid track placement around hidden panes) can be tested directly instead
 * of only through a rendered component.
 */

import type { SplitSize, SplitUnit } from './models.js';

/** Per-pane constraints, resolved to pixels, in declaration order. */
export interface PaneBounds {
  min: number;
  max: number;
  visible: boolean;
  /** A locked pane never gives up or takes on pixels, whatever its min/max say. */
  locked: boolean;
}

/** Indices of the panes that are currently visible, in order. */
export function visibleIndices(bounds: readonly PaneBounds[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bounds.length; i++) if (bounds[i].visible) out.push(i);
  return out;
}

/**
 * Gutters sit between CONSECUTIVE VISIBLE panes, so hiding a middle pane collapses its two gutters
 * into one rather than leaving a dead double-thick bar. The returned value is the pane index each
 * gutter is anchored after — gutter `k` is drawn in the slot immediately following pane
 * `gutterAnchors[k]`, and every other slot gets a zero-width track.
 */
export function gutterAnchors(bounds: readonly PaneBounds[]): number[] {
  const vis: number[] = visibleIndices(bounds);
  return vis.slice(0, -1);
}

/**
 * Resolve declared sizes to pixels.
 *
 * `totalPanePx` is the container size MINUS the gutters, so percentages always sum to 100 no matter
 * how many gutters there are. Any leftover is split EQUALLY among the visible `'*'` panes; giving
 * each wildcard the whole remainder (as some implementations do) overshoots the container as soon as
 * there are two of them, which silently corrupts every drag boundary derived from it.
 */
export function resolvePixels(
  sizes: readonly SplitSize[],
  bounds: readonly PaneBounds[],
  unit: SplitUnit,
  totalPanePx: number
): number[] {
  const px: number[] = sizes.map((size, i) => {
    if (!bounds[i]?.visible) return 0;
    if (size === '*') return Number.NaN; // placeholder — filled in below
    return unit === 'pixel' ? size : (size / 100) * totalPanePx;
  });

  const wildcards: number[] = [];
  let used: number = 0;
  for (let i = 0; i < px.length; i++) {
    if (Number.isNaN(px[i])) wildcards.push(i);
    else used += px[i];
  }
  if (wildcards.length > 0) {
    const share: number = Math.max(0, totalPanePx - used) / wildcards.length;
    for (const i of wildcards) px[i] = share;
  }
  return px;
}

/** Convert pixel sizes back to the container's unit, keeping `'*'` panes wild. */
export function toSizes(
  px: readonly number[],
  previous: readonly SplitSize[],
  unit: SplitUnit,
  totalPanePx: number
): SplitSize[] {
  return px.map((value, i) => {
    if (previous[i] === '*') return '*';
    if (unit === 'pixel') return round(value);
    return totalPanePx > 0 ? round((value / totalPanePx) * 100) : 0;
  });
}

/** Two decimals — enough for sub-pixel percentages, short enough to persist and diff cleanly. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Move a gutter by `offsetPx` and return the new pixel sizes.
 *
 * Pixels are transferred one pane at a time: the pane on the shrinking side gives up as much as its
 * `min` allows, the pane on the expanding side takes as much as its `max` allows, and whichever runs
 * out first is replaced by the next candidate in that direction.
 *
 * With `restrictMove` the candidate lists are just the two panes flanking the gutter, so the drag
 * stops dead at their bounds. Without it the drag cascades outward through every visible pane, which
 * is what makes a gutter feel like it pushes its neighbours along.
 *
 * `locked` panes are excluded from both lists — a lock means "this pane keeps its size", which is
 * stronger than a min/max window that merely happens to be wide.
 */
export function distribute(
  start: readonly number[],
  bounds: readonly PaneBounds[],
  beforeIndex: number,
  afterIndex: number,
  offsetPx: number,
  restrictMove: boolean
): number[] {
  const px: number[] = [...start];
  if (offsetPx === 0) return px;

  const usable = (i: number): boolean => bounds[i]?.visible === true && !bounds[i].locked;

  const before: number[] = restrictMove
    ? usable(beforeIndex)
      ? [beforeIndex]
      : []
    : range(0, beforeIndex + 1).filter(usable).reverse();
  const after: number[] = restrictMove
    ? usable(afterIndex)
      ? [afterIndex]
      : []
    : range(afterIndex, bounds.length).filter(usable);

  const forward: boolean = offsetPx > 0;
  const shrinking: number[] = forward ? after : before;
  const expanding: number[] = forward ? before : after;

  let remaining: number = Math.abs(offsetPx);
  let s: number = 0;
  let e: number = 0;

  while (remaining > 0 && s < shrinking.length && e < expanding.length) {
    const si: number = shrinking[s];
    const ei: number = expanding[e];
    const canGive: number = Math.max(0, px[si] - bounds[si].min);
    const canTake: number = Math.max(0, bounds[ei].max - px[ei]);
    const move: number = Math.min(remaining, canGive, canTake);

    px[si] -= move;
    px[ei] += move;
    remaining -= move;

    // Advance past whichever side is now saturated. At least one always is when `move` was capped by
    // it, and when `move` is 0 the side with no room advances — so the loop cannot spin.
    if (canGive - move <= 0) s++;
    if (canTake - move <= 0) e++;
  }
  return px;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/**
 * Build the `grid-template-columns` / `grid-template-rows` value.
 *
 * Tracks alternate pane, gutter, pane, … so a pane sits at track `2i + 1` and the gutter anchored
 * after pane `i` at track `2i + 2` — positions that stay stable when a pane hides, because the
 * hidden pane keeps its (zero-width) slot instead of shifting everything after it.
 *
 * Pane tracks are `minmax(0, …)`: without the zero floor an overflowing child sets an implicit
 * min-content floor and the pane refuses to shrink below its content, which reads to the user as a
 * gutter that jams for no visible reason.
 */
export function gridTemplate(
  sizes: readonly SplitSize[],
  bounds: readonly PaneBounds[],
  unit: SplitUnit,
  gutterPx: number
): string {
  const anchors: ReadonlySet<number> = new Set(gutterAnchors(bounds));
  const tracks: string[] = [];

  for (let i = 0; i < bounds.length; i++) {
    tracks.push(paneTrack(sizes[i], bounds[i], unit, gutterPx, bounds));
    if (i < bounds.length - 1) tracks.push(anchors.has(i) ? `${gutterPx}px` : '0px');
  }
  return tracks.join(' ');
}

function paneTrack(
  size: SplitSize | undefined,
  bound: PaneBounds | undefined,
  unit: SplitUnit,
  gutterPx: number,
  bounds: readonly PaneBounds[]
): string {
  if (!bound?.visible) return '0px';
  if (size === '*' || size === undefined) return 'minmax(0, 1fr)';
  if (unit === 'pixel') return `minmax(0, ${size}px)`;

  // Percentages are of the space left after the gutters, so subtract them here rather than letting
  // the browser take a percentage of the whole container (which overflows by exactly the gutter
  // total — the classic off-by-a-few-pixels in hand-rolled splitters).
  const gutters: number = gutterAnchors(bounds).length * gutterPx;
  return `minmax(0, calc((100% - ${gutters}px) * ${size / 100}))`;
}

/** Snap a raw pointer offset to the drag step. A step of 0 or less means "no snapping". */
export function snap(offsetPx: number, step: number): number {
  if (!(step > 0)) return offsetPx;
  return Math.round(offsetPx / step) * step;
}

/**
 * Normalise a sizes array to `count` entries.
 *
 * Panes appear and disappear (an `@if` around one, a `@for` that grew), and a sizes array that no
 * longer lines up with them would silently mis-assign every size after the change. Missing entries
 * become `'*'` so a newly added pane takes free space instead of collapsing to nothing.
 */
export function normalizeSizes(sizes: readonly SplitSize[], count: number): SplitSize[] {
  const out: SplitSize[] = sizes.slice(0, count);
  while (out.length < count) out.push('*');
  return out;
}
