/**
 * Arc geometry — the annular sector every pie, donut and gauge is made of.
 *
 * Separate from the cartesian marks because the arithmetic has nothing in common with them, and
 * because arcs have two edge cases that are easy to get wrong and impossible to notice until they
 * bite: a sector spanning more than half a turn needs the large-arc flag, and a sector spanning a
 * FULL turn cannot be drawn as one arc at all — its start and end points are the same, and SVG has
 * no way to tell "no sweep" from "all of it".
 */

/** Angles are radians, measured clockwise from twelve o'clock — the direction a pie is read. */
export const TAU = Math.PI * 2;

/** Degrees in, radians from twelve o'clock out. */
export const toRadians = (degrees: number): number => ((degrees - 90) * Math.PI) / 180;

export interface Point {
  x: number;
  y: number;
}

export function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

const round = (value: number): number => Math.round(value * 100) / 100;
const fmt = (p: Point): string => `${round(p.x)} ${round(p.y)}`;

/**
 * One slice: the ring between `inner` and `outer`, from `from` to `to`.
 *
 * `inner === 0` gives a pie wedge; anything above gives a donut segment. A full turn is emitted as
 * two half-turns, because a single `A` command back to its own start point draws nothing — the
 * commonest way a one-category pie renders as an empty page.
 */
export function arcPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number
): string {
  const sweep: number = to - from;
  if (sweep <= 0 || outer <= 0) return '';

  if (sweep >= TAU - 1e-6) {
    const half: number = from + Math.PI;
    const ring = (r: number, dir: 0 | 1): string =>
      `M ${fmt(polar(cx, cy, r, from))} A ${r} ${r} 0 0 ${dir} ${fmt(polar(cx, cy, r, half))}` +
      ` A ${r} ${r} 0 0 ${dir} ${fmt(polar(cx, cy, r, from + TAU - 1e-9))}`;
    return inner > 0 ? `${ring(outer, 1)} ${ring(inner, 0)} Z` : `${ring(outer, 1)} Z`;
  }

  const large: 0 | 1 = sweep > Math.PI ? 1 : 0;
  const o0: Point = polar(cx, cy, outer, from);
  const o1: Point = polar(cx, cy, outer, to);

  if (inner <= 0) {
    return `M ${round(cx)} ${round(cy)} L ${fmt(o0)} A ${outer} ${outer} 0 ${large} 1 ${fmt(o1)} Z`;
  }

  const i1: Point = polar(cx, cy, inner, to);
  const i0: Point = polar(cx, cy, inner, from);
  return (
    `M ${fmt(o0)} A ${outer} ${outer} 0 ${large} 1 ${fmt(o1)}` +
    ` L ${fmt(i1)} A ${inner} ${inner} 0 ${large} 0 ${fmt(i0)} Z`
  );
}

/**
 * Where a slice's own label goes — the centroid of the ring band, not of the wedge.
 *
 * Using the wedge's centroid puts the text of a thin slice almost at the centre, where it collides
 * with its neighbours. Halfway along the band is where a reader looks.
 */
export function arcCentroid(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number
): Point {
  return polar(cx, cy, (inner + outer) / 2, (from + to) / 2);
}

/**
 * Centre and radius for an arc that may not be a full circle.
 *
 * Placing every ring at the middle of its box is right for a full turn and wrong for everything
 * else: a semicircle gauge drawn that way sits in the top half with the bottom half left empty,
 * looking like a layout bug rather than a choice. So the arc's actual bounding box is measured —
 * its two ends plus whichever compass points it sweeps through — and the ring is fitted to that.
 *
 * The centre is included in the box because a pie's slices meet there. For a partial donut that
 * over-estimates slightly, which costs a few pixels of radius and never clips anything.
 */
export function fitArc(
  width: number,
  height: number,
  from: number,
  to: number,
  padding: number = 12
): { cx: number; cy: number; radius: number } {
  const angles: number[] = [from, to];
  // The compass points inside the sweep are where an arc reaches furthest — a quarter turn from
  // 11 o'clock to 1 o'clock is widest at 12, which is neither of its ends.
  for (let k: number = -4; k <= 8; k++) {
    const cardinal: number = (k * Math.PI) / 2;
    if (cardinal > from && cardinal < to) angles.push(cardinal);
  }
  let minX: number = 0;
  let maxX: number = 0;
  let minY: number = 0;
  let maxY: number = 0;
  for (const angle of angles) {
    const x: number = Math.cos(angle);
    const y: number = Math.sin(angle);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX: number = maxX - minX || 1;
  const spanY: number = maxY - minY || 1;
  const radius: number = Math.max(
    0,
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  );
  return {
    // Centre the arc's box, then place the ring's origin relative to it.
    cx: (width - (minX + maxX) * radius) / 2,
    cy: (height - (minY + maxY) * radius) / 2,
    radius,
  };
}

export interface Slice {
  /** Index into the original data, before any grouping. -1 for a synthesised "Other". */
  index: number;
  label: string;
  value: number;
  /** Share of the total, 0..1. */
  share: number;
  from: number;
  to: number;
}

export interface LayoutArcsOptions {
  /** First edge, radians. Default: twelve o'clock. */
  start?: number;
  /** Last edge. Default: a full turn from `start`. A half turn gives a semicircle gauge. */
  end?: number;
  /** Gap between slices, radians. Suppressed when a slice would vanish into it. */
  pad?: number;
}

/**
 * Values into slices.
 *
 * Negative and non-finite values are dropped rather than mapped to a negative sweep: a pie of a
 * quantity that can go below zero is not a pie, and drawing one silently is worse than drawing
 * nothing. Zero-valued entries keep their place in the legend but get no arc.
 */
export function layoutArcs(
  entries: readonly { label: string; value: number; index: number }[],
  options: LayoutArcsOptions = {}
): Slice[] {
  const start: number = options.start ?? toRadians(0);
  const end: number = options.end ?? start + TAU;
  const span: number = end - start;

  const usable = entries.filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
  const total: number = usable.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) return [];

  // A pad that would swallow the slices themselves is no pad at all — with twenty categories a
  // 2° gap each eats 40° of the circle and every slice shrinks to a sliver.
  const pad: number = Math.min(options.pad ?? 0, span / (usable.length * 4));

  const out: Slice[] = [];
  let cursor: number = start;
  for (const entry of usable) {
    const share: number = entry.value / total;
    const sweep: number = share * (span - pad * usable.length);
    out.push({
      index: entry.index,
      label: entry.label,
      value: entry.value,
      share,
      from: cursor + pad / 2,
      to: cursor + pad / 2 + sweep,
    });
    cursor += sweep + pad;
  }
  return out;
}

/**
 * Fold the smallest categories into one "Other".
 *
 * The single most common way a pie chart fails is twenty slices, fifteen of which are slivers with
 * unreadable labels. Grouping the tail is what a person would do by hand, so it is the default
 * behaviour worth offering — and it keeps the total honest, which dropping them would not.
 */
export function groupTail(
  entries: readonly { label: string; value: number; index: number }[],
  max: number,
  otherLabel: string = 'Other'
): { label: string; value: number; index: number }[] {
  if (max <= 0 || entries.length <= max) return [...entries];
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  const rest: number = tail.reduce((sum, entry) => sum + entry.value, 0);
  return rest > 0 ? [...head, { label: otherLabel, value: rest, index: -1 }] : head;
}
