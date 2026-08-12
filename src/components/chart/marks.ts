/**
 * Path geometry — turning points into the `d` of an SVG path.
 *
 * Kept apart from the component because it is pure arithmetic with no reactivity and no DOM, which
 * makes it the one part of a chart that can be reasoned about by reading it.
 */

/** A point already in pixel space. `defined: false` breaks the line — a gap in the data. */
export interface Pt {
  x: number;
  y: number;
  defined: boolean;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Split at gaps, so a missing value leaves a hole rather than a straight line across it.
 *
 * Interpolating over a gap is the quiet lie a chart tells most often: three months of missing
 * revenue drawn as a smooth climb. The break is the honest rendering.
 */
function segments(points: readonly Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  for (const point of points) {
    if (point.defined) run.push(point);
    else if (run.length > 0) {
      out.push(run);
      run = [];
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * Monotone cubic tangents — a smooth curve that cannot overshoot.
 *
 * The usual cardinal/Catmull-Rom spline bulges past its own data: three points at 10, 90, 10 render
 * with a peak above 90 and dips below 10, so the chart shows values that were never in the data.
 * Monotone interpolation clamps the tangents to the local slope, so a smooth line stays inside the
 * numbers it was given. This is the whole reason `curve: 'smooth'` is safe to offer at all.
 */
function monotoneTangents(points: readonly Pt[]): number[] {
  const n: number = points.length;
  const slopes: number[] = [];
  for (let i: number = 0; i < n - 1; i++) {
    const dx: number = points[i + 1].x - points[i].x;
    slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }
  const tangents: number[] = new Array<number>(n);
  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;
  for (let i: number = 1; i < n - 1; i++) {
    const a: number = slopes[i - 1];
    const b: number = slopes[i];
    // A sign change is a local extremum: flatten to zero so the curve turns there instead of
    // sailing past it.
    tangents[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  return tangents;
}

function smoothRun(run: readonly Pt[]): string {
  if (run.length < 3) return polyline(run);
  const tangents: number[] = monotoneTangents(run);
  let d: string = `M ${round(run[0].x)} ${round(run[0].y)}`;
  for (let i: number = 0; i < run.length - 1; i++) {
    const dx: number = (run[i + 1].x - run[i].x) / 3;
    d += ` C ${round(run[i].x + dx)} ${round(run[i].y + tangents[i] * dx)}`;
    d += ` ${round(run[i + 1].x - dx)} ${round(run[i + 1].y - tangents[i + 1] * dx)}`;
    d += ` ${round(run[i + 1].x)} ${round(run[i + 1].y)}`;
  }
  return d;
}

function polyline(run: readonly Pt[]): string {
  return run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

/** A staircase — the honest shape for a value that holds until it changes. */
function stepRun(run: readonly Pt[]): string {
  let d: string = `M ${round(run[0].x)} ${round(run[0].y)}`;
  for (let i: number = 1; i < run.length; i++) {
    const mid: number = round((run[i - 1].x + run[i].x) / 2);
    d += ` L ${mid} ${round(run[i - 1].y)} L ${mid} ${round(run[i].y)} L ${round(run[i].x)} ${round(run[i].y)}`;
  }
  return d;
}

export type CurveKind = 'linear' | 'smooth' | 'step';

/** The stroked path for a line series. */
export function linePath(points: readonly Pt[], curve: CurveKind = 'linear'): string {
  const runs: Pt[][] = segments(points);
  if (runs.length === 0) return '';
  const build = curve === 'smooth' ? smoothRun : curve === 'step' ? stepRun : polyline;
  return runs.map((run) => (run.length === 1 ? dot(run[0]) : build(run))).join(' ');
}

/** A one-point run still deserves a mark, or an isolated reading vanishes. */
const dot = (p: Pt): string => `M ${round(p.x - 0.01)} ${round(p.y)} L ${round(p.x + 0.01)} ${round(p.y)}`;

/**
 * The filled path for an area series, closed against `baseline`.
 *
 * Each gap-free run is closed on its own, so a series with holes fills only where it has data
 * instead of one shape spanning the gaps.
 */
export function areaPath(points: readonly Pt[], baseline: number, curve: CurveKind = 'linear'): string {
  const runs: Pt[][] = segments(points);
  if (runs.length === 0) return '';
  const build = curve === 'smooth' ? smoothRun : curve === 'step' ? stepRun : polyline;
  return runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const top: string = build(run);
      const back: Pt[] = [...run].reverse().map((p) => ({ ...p, y: baseline }));
      const bottom: string = back.map((p) => `L ${round(p.x)} ${round(p.y)}`).join(' ');
      return `${top} ${bottom} Z`;
    })
    .join(' ');
}

/** A rounded-top rectangle, for bars. Radius is clamped so a short bar does not turn into a pill. */
export function barPath(x: number, y: number, width: number, height: number, radius: number = 3): string {
  const r: number = Math.max(0, Math.min(radius, width / 2, Math.abs(height)));
  if (height <= 0 || r === 0) {
    return `M ${round(x)} ${round(y)} h ${round(width)} v ${round(height)} h ${round(-width)} Z`;
  }
  return (
    `M ${round(x)} ${round(y + height)}` +
    ` V ${round(y + r)}` +
    ` Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)}` +
    ` H ${round(x + width - r)}` +
    ` Q ${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)}` +
    ` V ${round(y + height)} Z`
  );
}
