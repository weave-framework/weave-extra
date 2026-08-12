/**
 * Turning one chart into another — the marks themselves, not a crossfade over the top.
 *
 * The problem with swapping charts is that the two have nothing in common: twelve bars against
 * ninety candles, a filled ring against a stroked line, four colours against two. Nothing pairs up,
 * so nothing can be interpolated — which is the usual reason libraries settle for a fade.
 *
 * There is one thing every mark shares, and it is enough: they are all geometry. `path`, `rect`,
 * `circle` and `line` all descend from `SVGGeometryElement`, which means the browser will walk any
 * of them and hand back a point at any distance along their outline. Sample two shapes into the
 * same number of points and they become two lists of the same length — and two lists of the same
 * length interpolate.
 *
 * So a bar really does become a slice: not a bar fading out under a slice fading in, but one outline
 * bending into the other, in real time, for as long as the run lasts.
 *
 * What this deliberately does NOT do is imply a correspondence. Marks are paired by position along
 * the axis, not by identity, because between two unrelated datasets there is no identity to pair by.
 * The motion says "this display is becoming that one". It does not say "this number became that
 * number" — that claim belongs to the update animation inside a single chart, where it is true.
 *
 * {@link swapChart} is the way in for callers who just want a transition and do not want to think
 * about any of this. The morph is the good one and the default; a cross-fade is one option away,
 * and is the honest choice when the marks are too dense for the eye to follow anyway.
 */

import { prefersReducedMotion } from './motion.js';

/** Everything drawn as data. Deliberately not the axes, grid, labels or crosshair. */
const MARKS =
  '.weave-chart__bar, .weave-chart__slice, .weave-chart__candle, .weave-chart__ohlc,' +
  '.weave-chart__wick, .weave-chart__volume, .weave-chart__line, .weave-chart__dot, path[fill-opacity]';

/** Straight RGBA, 0–255 with a 0–1 alpha. `none` is a colour here: transparent. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** One mark, reduced to the only things that can be interpolated. */
export interface MarkShape {
  /** `samples` points as a flat x, y, x, y… list. Always the same length across a capture. */
  points: Float64Array;
  fill: Rgba;
  stroke: Rgba;
  width: number;
  /** Centre of the sampled ring, used to order marks along the axis before pairing. */
  cx: number;
  cy: number;
}

export interface MorphOptions {
  /** Length of the run in ms. Default 620 — longer than an update, because more is changing. */
  duration?: number;
  easing?: (t: number) => number;
  /** Points per outline. Default 48: enough for a candle's notch, cheap enough for 300 of them. */
  samples?: number;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Parse what `getComputedStyle` returns for a paint: `rgb(…)`, `rgba(…)` or `none`.
 *
 * Computed rather than the attribute, because a mark's colour is usually
 * `var(--weave-chart-1, …)` — a string that cannot be interpolated and does not survive being
 * copied into an element outside the chart, where the custom property is not in scope.
 */
export function parseColor(value: string): Rgba {
  const parts: RegExpMatchArray | null = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return TRANSPARENT;
  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts.length > 3 ? Number(parts[3]) : 1,
  };
}

/**
 * Interpolate two paints, holding the hue when one side is invisible.
 *
 * Interpolating straight RGBA takes a mark that is fading out through BLACK on its way to
 * transparent, because "no colour" is stored as rgba(0,0,0,0) and the channels have to travel there
 * too. Every fade darkens on the way out, which reads as a shadow passing over the chart. Taking
 * the visible side's channels and moving only the alpha is the whole fix.
 */
const mixColor = (from: Rgba, to: Rgba, t: number): string => {
  const source: Rgba = to.a === 0 ? from : from.a === 0 ? to : from;
  const target: Rgba = to.a === 0 ? from : from.a === 0 ? to : to;
  const r: number = Math.round(source.r + (target.r - source.r) * t);
  const g: number = Math.round(source.g + (target.g - source.g) * t);
  const b: number = Math.round(source.b + (target.b - source.b) * t);
  const a: number = from.a + (to.a - from.a) * t;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
};

/**
 * Walk an element's outline and return an evenly spaced ring of points.
 *
 * Even spacing by ARC LENGTH rather than by the path's own commands. Sampling per command would
 * give a bar four points and a candle's wick two, and interpolating those lists against each other
 * moves corners into the middle of edges — which is what makes a naive shape tween writhe.
 */
export function sampleShape(element: SVGGeometryElement, samples: number): Float64Array {
  const points = new Float64Array(samples * 2);
  const length: number = element.getTotalLength();
  // A zero-length mark — an empty bar, a doji's body — collapses to its own origin rather than
  // being skipped, so it still has somewhere to morph from.
  if (!Number.isFinite(length) || length <= 0) {
    const box: DOMRect = element.getBBox();
    for (let i = 0; i < samples; i++) {
      points[i * 2] = box.x + box.width / 2;
      points[i * 2 + 1] = box.y + box.height / 2;
    }
    return points;
  }
  for (let i = 0; i < samples; i++) {
    const point: DOMPoint = element.getPointAtLength((i / samples) * length);
    points[i * 2] = point.x;
    points[i * 2 + 1] = point.y;
  }
  return points;
}

/** Every data mark in a rendered chart, in axis order, ready to be interpolated. */
export function captureChart(svg: SVGSVGElement, samples: number = 48): MarkShape[] {
  const out: MarkShape[] = [];
  for (const node of Array.from(svg.querySelectorAll<SVGGeometryElement>(MARKS))) {
    const points: Float64Array = sampleShape(node, samples);
    const style: CSSStyleDeclaration = getComputedStyle(node);
    /**
     * A `<line>` computes a fill of opaque black — the CSS initial value — even though a line
     * renders no fill at all. Believing it paints every wick in a candlestick chart solid black the
     * moment it acquires any area, which is exactly what happens in the middle of a morph.
     */
    const fill: Rgba = node.tagName === 'line' || node.tagName === 'polyline' ? TRANSPARENT : parseColor(style.fill);
    const fillOpacity: number = Number(style.fillOpacity);
    const nodeOpacity: number = Number(style.opacity);
    const alpha: number = (Number.isFinite(fillOpacity) ? fillOpacity : 1) * (Number.isFinite(nodeOpacity) ? nodeOpacity : 1);
    const stroke: Rgba = parseColor(style.stroke);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < samples; i++) {
      cx += points[i * 2];
      cy += points[i * 2 + 1];
    }
    out.push({
      points,
      fill: { ...fill, a: fill.a * alpha },
      stroke: { ...stroke, a: stroke.a * (Number.isFinite(nodeOpacity) ? nodeOpacity : 1) },
      width: Number(style.strokeWidth) || 0,
      cx: cx / samples,
      cy: cy / samples,
    });
  }
  // Left to right, so a morph runs along the axis instead of jumping about the plot. Document order
  // would group by kind — every volume bar, then every wick — and read as an explosion.
  return out.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
}

/**
 * Rotate `from`'s ring to the offset that lands nearest `to`.
 *
 * Two outlines sampled independently start wherever their own geometry starts — a bar at its top
 * left, an arc at its inner edge. Interpolating those directly makes the shape turn inside out on
 * its way across, the single ugliest artefact in shape morphing, and the fix is to try every offset
 * and keep the cheapest.
 */
export function alignRing(from: Float64Array, to: Float64Array): Float64Array {
  const samples: number = from.length / 2;
  let bestOffset = 0;
  let bestCost = Infinity;
  for (let offset = 0; offset < samples; offset++) {
    let cost = 0;
    for (let i = 0; i < samples; i++) {
      const j: number = (i + offset) % samples;
      const dx: number = from[j * 2] - to[i * 2];
      const dy: number = from[j * 2 + 1] - to[i * 2 + 1];
      cost += dx * dx + dy * dy;
      if (cost >= bestCost) break;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  if (bestOffset === 0) return from;
  const out = new Float64Array(from.length);
  for (let i = 0; i < samples; i++) {
    const j: number = (i + bestOffset) % samples;
    out[i * 2] = from[j * 2];
    out[i * 2 + 1] = from[j * 2 + 1];
  }
  return out;
}

const ringToPath = (points: Float64Array): string => {
  const samples: number = points.length / 2;
  let d = `M${points[0].toFixed(2)} ${points[1].toFixed(2)}`;
  for (let i = 1; i < samples; i++) d += `L${points[i * 2].toFixed(2)} ${points[i * 2 + 1].toFixed(2)}`;
  return `${d}Z`;
};

export interface MorphHandle {
  /** Land on the target immediately and clean up. Safe to call twice. */
  finish: () => void;
}

/**
 * Morph a captured chart into a rendered one, over an overlay laid across `host`.
 *
 * `host` must be a positioned element containing `to`. The target is hidden for most of the run and
 * faded in at the end, by which point the overlay is already sitting on its shape — so the handover
 * is a crossfade between two nearly identical pictures, and what the reader sees is the axes
 * arriving under marks that never stopped moving.
 */
export function morph(
  host: HTMLElement,
  from: MarkShape[],
  to: SVGSVGElement,
  options: MorphOptions = {}
): MorphHandle {
  const duration: number = options.duration ?? 620;
  const easing: (t: number) => number = options.easing ?? ((t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2));
  const samples: number = options.samples ?? 48;
  const target: MarkShape[] = captureChart(to, samples);

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    if (watchdog) clearTimeout(watchdog);
    to.style.opacity = '';
    overlay.remove();
  };

  if (from.length === 0 || target.length === 0) {
    return { finish: (): void => undefined };
  }

  const hostBox: DOMRect = host.getBoundingClientRect();
  const targetBox: DOMRect = to.getBoundingClientRect();
  const overlay: SVGSVGElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('width', String(targetBox.width));
  overlay.setAttribute('height', String(targetBox.height));
  overlay.style.cssText =
    `position:absolute;pointer-events:none;z-index:1;` +
    `left:${targetBox.left - hostBox.left}px;top:${targetBox.top - hostBox.top}px;`;

  /**
   * One overlay path per PAIR, and the pair count is the larger of the two sides.
   *
   * Proportional pairing rather than enter-and-exit: twelve bars becoming four slices means groups
   * of three converging on one slice, ending exactly on top of each other and therefore invisible.
   * Nothing has to appear from nowhere or vanish into it, which is what makes the run read as one
   * shape changing rather than as two sets of shapes trading places.
   */
  const count: number = Math.max(from.length, target.length);
  const pairs: { node: SVGPathElement; from: MarkShape; to: MarkShape; ring: Float64Array }[] = [];
  for (let i = 0; i < count; i++) {
    const a: MarkShape = from[Math.floor((i * from.length) / count)];
    const b: MarkShape = target[Math.floor((i * target.length) / count)];
    const node: SVGPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    overlay.appendChild(node);
    pairs.push({ node, from: a, to: b, ring: alignRing(a.points, b.points) });
  }

  host.appendChild(overlay);
  to.style.opacity = '0';

  const ring = new Float64Array(samples * 2);
  const draw = (t: number): void => {
    const eased: number = easing(t);
    for (const pair of pairs) {
      for (let i = 0; i < samples * 2; i++) {
        ring[i] = pair.ring[i] + (pair.to.points[i] - pair.ring[i]) * eased;
      }
      pair.node.setAttribute('d', ringToPath(ring));
      pair.node.setAttribute('fill', mixColor(pair.from.fill, pair.to.fill, eased));
      pair.node.setAttribute('stroke', mixColor(pair.from.stroke, pair.to.stroke, eased));
      pair.node.setAttribute('stroke-width', String(pair.from.width + (pair.to.width - pair.from.width) * eased));
    }
    // The real chart arrives under the last quarter of the run, bringing its axes with it.
    to.style.opacity = String(Math.max(0, Math.min(1, (t - 0.75) * 4)));
  };

  let frame = 0;
  let watchdog: ReturnType<typeof setTimeout> | 0 = 0;
  const startedAt: number = performance.now();
  const step = (now: number): void => {
    const t: number = Math.min(1, (now - startedAt) / duration);
    draw(t);
    if (t < 1) frame = requestAnimationFrame(step);
    else finish();
  };

  draw(0);
  frame = requestAnimationFrame(step);
  // Frames stop in a hidden tab. Without this the target would be left at opacity 0 — an empty
  // chart, which is very much worse than a morph nobody watched.
  watchdog = setTimeout(finish, duration + 400);

  return { finish };
}

/* ────────────────────────── swapping one chart for another ────────────────────────── */

export interface SwapOptions {
  /**
   * Interpolate the marks into their replacements. Default true.
   *
   * `false` cross-fades the plot instead — which is not merely the cheap option. A morph is read by
   * following individual shapes, so it earns its keep at twelve bars and stops meaning anything at
   * three thousand, where the eye has nothing to track and the run is just a shimmer. Dense marks,
   * a slow machine, or a house style that dislikes movement are all reasons to turn it off, and the
   * fade is a perfectly good transition.
   */
  morph?: boolean;
  /** Whole run in ms. Default 620 morphing, 400 fading. */
  duration?: number;
  /**
   * Which way a fade travels. `'forward'` sends the old chart left and brings the new one in from
   * the right; `'none'` fades in place. Ignored by the morph, which has its own direction — the
   * shapes go where the data goes.
   */
  direction?: 'forward' | 'back' | 'none';
  /** Points per outline, for the morph. */
  samples?: number;
}

export interface SwapHandle {
  /** Land immediately: commit if that has not happened yet, then clean up. Safe to call twice. */
  finish: () => void;
}

const DONE: SwapHandle = { finish: (): void => undefined };

/**
 * Transition the chart inside `host` into whatever `commit` renders.
 *
 * `commit` is a callback rather than a rendered element because the outgoing chart has to be
 * measured while it still exists — a moment after the signal is set, the old component is gone and
 * its geometry with it. Handing over the swap itself is what lets this function choose when it
 * happens: immediately for a morph, and after the fade-out for a cross-fade.
 *
 *   swapChart(stage, () => selected.set(next), { morph: useMorph() });
 *
 * `host` must be a positioned element containing the chart. Every failure mode degrades to an
 * instant swap rather than to a chart that is missing: no outgoing chart, a hidden tab, reduced
 * motion, or frames that stop arriving mid-run.
 */
export function swapChart(host: HTMLElement, commit: () => void, options: SwapOptions = {}): SwapHandle {
  const wantsMorph: boolean = options.morph !== false;
  const svg: SVGSVGElement | null = host.querySelector<SVGSVGElement>('.weave-chart__svg');

  // Nobody watching, nothing to transition from, or motion turned down. A transition in a hidden
  // tab is worse than none: it would hold the incoming chart invisible waiting for frames.
  if (!svg || (typeof document !== 'undefined' && document.hidden) || prefersReducedMotion()) {
    commit();
    return DONE;
  }

  const duration: number = options.duration ?? (wantsMorph ? 620 : 400);

  if (wantsMorph) {
    const from: MarkShape[] = captureChart(svg, options.samples ?? 48);
    commit();
    let handle: MorphHandle | null = null;
    let cancelled = false;
    /**
     * One microtask, not one frame.
     *
     * The new chart's marks are in the DOM the instant `commit` returns, but it renders at
     * `width="0"` until it has measured its container on mount — one microtask away. Sampling on
     * the same tick captures a chart squashed into a 1px column and morphs the plot into the left
     * margin. A frame would also work and would be worse: frames never arrive in a background tab,
     * microtasks always run.
     */
    queueMicrotask(() => {
      if (cancelled) return;
      const next: SVGSVGElement | null = host.querySelector<SVGSVGElement>('.weave-chart__svg');
      if (next && next.getBoundingClientRect().width > 1) {
        handle = morph(host, from, next, { duration, samples: options.samples });
      }
    });
    return {
      finish: (): void => {
        cancelled = true;
        handle?.finish();
      },
    };
  }

  /**
   * The cross-fade, driven by the Web Animations API rather than by CSS classes.
   *
   * Classes would mean shipping a stylesheet for an element this package does not own, and the
   * caller remembering to import it. `animate()` needs neither, and it hands back an object that
   * can be cancelled — which is what makes an interrupted swap recoverable.
   *
   * Nothing waits on `finished` and nothing is left filling forwards. Both are traps in a tab that
   * stops compositing: the promise never resolves, and a forwards-filled fade-out pins the chart at
   * zero opacity for good. Timers keep running, so the phases are sequenced on those.
   *
   * A running animation applies its CURRENT value, and an animation that never advances stays on
   * its first keyframe — so the fade-in, whose first keyframe is `opacity: 0`, would render the
   * chart invisible for as long as frames stayed away. Omitting `fill` does not help: that only
   * decides what happens once it has finished, and it never does. Hence the watchdog, which forces
   * it to the end. Every failure mode has to land on "no animation", never on "no chart".
   */
  const shift: number = options.direction === 'none' ? 0 : options.direction === 'back' ? -24 : 24;
  const outMs: number = Math.round(duration * 0.4);
  const inMs: number = duration - outMs;
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  const leaving: Animation = host.animate(
    [
      { opacity: 1, transform: 'translateX(0px)' },
      { opacity: 0, transform: `translateX(${-shift}px)` },
    ],
    { duration: outMs, easing, fill: 'forwards' }
  );

  let done = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let settle: ReturnType<typeof setTimeout> | 0 = 0;
  let arriving: Animation | null = null;

  const swap = (): void => {
    if (done) return;
    done = true;
    timer = 0;
    leaving.cancel();
    commit();
    arriving = host.animate(
      [
        { opacity: 0, transform: `translateX(${shift}px)` },
        { opacity: 1, transform: 'translateX(0px)' },
      ],
      { duration: inMs, easing }
    );
    settle = setTimeout(() => {
      settle = 0;
      arriving?.finish();
    }, inMs + 200);
  };

  timer = setTimeout(swap, outMs);

  return {
    finish: (): void => {
      if (timer) clearTimeout(timer);
      swap();
      if (settle) clearTimeout(settle);
      settle = 0;
      arriving?.finish();
    },
  };
}
