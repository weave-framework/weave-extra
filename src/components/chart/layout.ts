/**
 * Where the plot goes — margins derived from what the labels actually measure, not guessed.
 *
 * A fixed left margin is why so many charts either clip "1,250,000" or leave a finger of white space
 * next to "0–5". Both are avoidable: measure the widest label that will be drawn and give the axis
 * exactly that.
 *
 * Measured through a canvas 2d context rather than by putting text in the DOM and reading it back.
 * A DOM measurement forces a synchronous layout for every label on every resize; `measureText` costs
 * nothing, needs no element, and is accurate for the one thing asked of it.
 */

/** The rectangle the marks are drawn inside, plus where the axes sit. */
export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Right edge of the plot — `left + width`, precomputed because everything needs it. */
  right: number;
  /** Bottom edge — `top + height`. */
  bottom: number;
}

export interface LayoutInput {
  width: number;
  height: number;
  /** Every y-axis label that will be drawn, left side. */
  leftLabels: readonly string[];
  /** Right-axis labels, when a series asked for a second axis. */
  rightLabels?: readonly string[];
  /** Every x-axis label. Only the tallest matters unless they are rotated. */
  bottomLabels: readonly string[];
  xTitle?: string;
  yTitle?: string;
  fontSize?: number;
}

let measurer: CanvasRenderingContext2D | null = null;

/** One shared 2d context for the life of the page — creating one per measurement is the slow way. */
function context(fontSize: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measurer) {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    measurer = canvas.getContext('2d');
  }
  if (measurer) {
    // Matching the stylesheet's axis font. Wrong here means margins that are slightly off, which
    // reads as sloppy alignment rather than as a bug — worth keeping in step.
    measurer.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  return measurer;
}

/** Width of the widest string, in px. Falls back to a per-character estimate with no DOM. */
export function widestLabel(labels: readonly string[], fontSize: number = 11): number {
  if (labels.length === 0) return 0;
  const ctx: CanvasRenderingContext2D | null = context(fontSize);
  let widest: number = 0;
  for (const label of labels) {
    const width: number = ctx ? ctx.measureText(label).width : label.length * fontSize * 0.6;
    if (width > widest) widest = width;
  }
  return Math.ceil(widest);
}

/** Gap between an axis label and the plot it labels. */
const GAP = 8;
/** Room for an axis title, when there is one. */
const TITLE = 16;
/** Half a label's height, so the topmost y tick is not clipped by the plot's own top edge. */
const HALF_LINE = 7;

export function layout(input: LayoutInput): PlotBox {
  const fontSize: number = input.fontSize ?? 11;

  const left: number =
    widestLabel(input.leftLabels, fontSize) + GAP + (input.yTitle ? TITLE : 0);
  const right: number =
    input.rightLabels && input.rightLabels.length > 0
      ? widestLabel(input.rightLabels, fontSize) + GAP
      // Not zero: the last x label is centred on the plot's right edge and would otherwise spill
      // out of the SVG. Half the widest x label is what it needs.
      : Math.ceil(widestLabel(input.bottomLabels.slice(-1), fontSize) / 2);
  const bottom: number = fontSize + GAP + (input.xTitle ? TITLE : 0);

  const width: number = Math.max(1, input.width - left - right);
  const height: number = Math.max(1, input.height - HALF_LINE - bottom);

  return {
    left,
    top: HALF_LINE,
    width,
    height,
    right: left + width,
    bottom: HALF_LINE + height,
  };
}
