/**
 * The waterfall — how a total was arrived at, rather than what it is.
 *
 * A bar chart answers "how big is each of these". A waterfall answers a different question: you
 * started at one number, a sequence of things happened, and you ended at another — show me the
 * things. Opening revenue, minus cost of sales, minus overheads, plus other income, closing profit.
 * Nothing else says that: a stacked bar loses the order and the sign, a line implies the steps are
 * a continuum, and a table makes the reader do the running arithmetic themselves.
 *
 * It is the one chart in the "infographic" family that earns its place, and the reason is that it
 * still encodes by LENGTH. Each bar's height is its own contribution, read against the same axis as
 * every other bar. Compare that with a funnel, where the eye reads area while the data is in the
 * width, or a radar, where the same values give a different-shaped blob depending on which axis you
 * happened to put first.
 *
 * The arithmetic lives here, apart from the component, because it is the part that can be wrong
 * without looking wrong — a running total that drifts still draws a perfectly plausible chart.
 */

/** One step: what it contributes, and where it sits on the way to the total. */
export interface WaterfallStep {
  index: number;
  label: string;
  /** The step's own contribution. For a total step, the total itself. */
  value: number;
  /** Running total before this step. 0 for a total step, which is measured from the axis. */
  from: number;
  /** Running total after it. For a total step, the total. */
  to: number;
  /** Measured from the axis rather than from the step before — an opening or closing balance. */
  total: boolean;
  /** Which way it moved. A total is neither. */
  direction: 'up' | 'down' | 'total';
}

export interface WaterfallInput {
  label: string;
  value: number;
  /** Treat as an absolute balance rather than as a change. */
  total?: boolean;
}

/**
 * Steps into bars, carrying the running total.
 *
 * A **total** step is the reason this is not a one-line `reduce`. Marked steps are drawn from the
 * axis rather than from the step before, and — the part that is easy to get wrong — the running
 * total is RESET to them rather than added to them. Without that, a closing balance that agrees
 * with the arithmetic double-counts, and one that disagrees is silently averaged into the next
 * section instead of being visible as the discrepancy it is.
 *
 * Non-finite values are dropped rather than propagated: one NaN in a running total poisons every
 * bar after it, so a single bad row would empty the right-hand half of the chart.
 */
export function layoutWaterfall(steps: readonly WaterfallInput[]): WaterfallStep[] {
  const out: WaterfallStep[] = [];
  let running = 0;
  steps.forEach((step, index) => {
    const value: number = Number.isFinite(step.value) ? step.value : 0;
    if (step.total) {
      // The stated balance wins, and the running total continues from it. A statement that does not
      // add up is a fact about the data, and the chart's job is to show it, not to smooth it.
      out.push({ index, label: step.label, value, from: 0, to: value, total: true, direction: 'total' });
      running = value;
      return;
    }
    const from: number = running;
    const to: number = running + value;
    out.push({
      index,
      label: step.label,
      value,
      from,
      to,
      total: false,
      direction: value < 0 ? 'down' : 'up',
    });
    running = to;
  });
  return out;
}

/**
 * The extent the axis has to cover.
 *
 * Every edge of every bar, not just the values: a step of -400 from a running total of 1000 reaches
 * down to 600, and an axis built from the values alone would put it off the bottom of the plot.
 * Zero is always included, because the bars are read as lengths from it.
 */
export function waterfallExtent(steps: readonly WaterfallStep[]): [number, number] {
  let min = 0;
  let max = 0;
  for (const step of steps) {
    min = Math.min(min, step.from, step.to);
    max = Math.max(max, step.from, step.to);
  }
  return [min, max];
}
