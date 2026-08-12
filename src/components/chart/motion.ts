/**
 * The chart's clock — one animation driver per chart, not one per mark.
 *
 * A chart with 300 bars has 300 numbers that want to move. Giving each its own effect and its own
 * `requestAnimationFrame` is how a chart library becomes the slowest thing on a page. So there is
 * ONE clock: it runs a single rAF loop, exposes `progress()` from 0 to 1, and every mark reads that
 * signal and interpolates itself between where it was and where it is going. 300 marks, one loop,
 * one signal read per frame.
 *
 * Reduced motion is honoured by NOT animating — `progress()` is 1 from the first frame. Shortening
 * the duration is the common half-measure and it misses the point: someone who asked for less motion
 * asked for none, not for the same motion delivered faster.
 */

import { onCleanup, signal, type Signal } from '@weave-framework/runtime';

/** Easing functions. Two, because a third would be a preference rather than a decision. */
export const easings = {
  /** Entry: fast out of the gate, settling. What a bar growing from its baseline should do. */
  cubicOut: (t: number): number => 1 - (1 - t) ** 3,
  /** Change: eases at both ends, so a value moving to a new position reads as one motion. */
  cubicInOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} as const;

export interface ClockOptions {
  /** Milliseconds for one run. Default 600 — long enough to read, short enough not to wait. */
  duration?: number;
  easing?: (t: number) => number;
  /** Force animation off. `prefers-reduced-motion` does this on its own. */
  disabled?: boolean;
}

export interface Clock {
  /** Eased progress, 0 → 1. Reactive: read it inside a computed and marks re-derive per frame. */
  progress: () => number;
  /** Start again from 0. Called when the data changes. */
  restart: () => void;
  /** Jump to the end without animating — what a data change during a hidden tab should do. */
  finish: () => void;
}

/** Whether the machine asked for less motion. Read once per clock; it changes about never. */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One rAF loop, driving one signal.
 *
 * Cleans itself up through `onCleanup`, so a chart that unmounts mid-animation does not leave a
 * frame callback writing into a disposed signal — which is silent, and accumulates one leaked loop
 * per chart the user scrolls past.
 */
export function clock(options: ClockOptions = {}): Clock {
  const duration: number = options.duration ?? 600;
  const easing: (t: number) => number = options.easing ?? easings.cubicOut;
  const off: boolean = options.disabled === true || prefersReducedMotion() || duration <= 0;

  const raw: Signal<number> = signal<number>(off ? 1 : 0);
  let frame: number = 0;
  let watchdog: ReturnType<typeof setTimeout> | 0 = 0;
  let startedAt: number = 0;

  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame);
    if (watchdog) clearTimeout(watchdog);
    frame = 0;
    watchdog = 0;
  };

  const step = (now: number): void => {
    const t: number = Math.min(1, (now - startedAt) / duration);
    raw.set(t);
    if (t < 1) frame = requestAnimationFrame(step);
    else {
      frame = 0;
      if (watchdog) clearTimeout(watchdog);
      watchdog = 0;
    }
  };

  const finish = (): void => {
    stop();
    raw.set(1);
  };

  /**
   * `requestAnimationFrame` does not fire in a hidden tab — not throttled, not at all.
   *
   * A chart that starts its marks at zero and grows them therefore renders as an EMPTY PLOT for as
   * long as the tab stays in the background, and a reader switching to it sees nothing until the
   * first frame lands. The same happens in a collapsed panel and in an off-screen route.
   *
   * So: when there is nobody to watch the animation, skip it. Correctness beats spectacle, and an
   * animation nobody saw is not worth a chart that was blank. The watchdog covers the rest — any
   * case where frames stop arriving mid-run, which would otherwise freeze the marks part-grown.
   */
  const restart = (): void => {
    if (off || (typeof document !== 'undefined' && document.hidden)) {
      finish();
      return;
    }
    stop();
    raw.set(0);
    // `performance.now()` rather than the frame timestamp for the start: the first callback can be
    // a frame late, and measuring from it makes short animations lose their opening.
    startedAt = performance.now();
    frame = requestAnimationFrame(step);
    watchdog = setTimeout(finish, duration + 200);
  };

  onCleanup(stop);

  if (!off) restart();

  return {
    progress: (): number => easing(raw()),
    restart,
    finish: (): void => {
      stop();
      raw.set(1);
    },
  };
}

/** Linear interpolation. The one arithmetic every mark does. */
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Interpolate against a remembered previous value, keyed by identity.
 *
 * The reason a chart's update animation looks right or looks like a redraw: a bar whose value went
 * from 40 to 90 should travel, and a bar that is new should grow from the baseline. That difference
 * is only knowable by remembering what was there before, per key.
 */
export class Memory {
  private previous: Map<string, number> = new Map<string, number>();
  private next: Map<string, number> = new Map<string, number>();

  /** Where `key` should be drawn at progress `t`, given it is heading to `value`. */
  at(key: string, value: number, t: number, fallback: number): number {
    const from: number = this.previous.get(key) ?? fallback;
    this.next.set(key, value);
    return lerp(from, value, t);
  }

  /** Call once a run has finished: what was drawn becomes what to travel from next time. */
  commit(): void {
    this.previous = this.next;
    this.next = new Map<string, number>();
  }
}
