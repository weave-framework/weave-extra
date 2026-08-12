/**
 * Series colour — the one thing a chart library gets asked about before anything else.
 *
 * Every colour is emitted as `var(--weave-chart-N, <default>)`. Three things fall out of that and
 * they are the whole design:
 *
 *   - **Themeable without touching this file.** A consumer sets `--weave-chart-1` on any ancestor —
 *     `:root`, a section, one chart — and it wins, because the custom property is only ever read,
 *     never written by the component.
 *   - **Follows the app's light/dark switch for free**, since the defaults live in a stylesheet the
 *     theme already controls rather than in a JavaScript object the theme cannot reach.
 *   - **No colour arithmetic at render time.** Palette resolution is a string lookup.
 *
 * Eight hues, then it repeats. That is not a limitation to apologise for: past about eight, adjacent
 * categories stop being distinguishable — for anyone, and much sooner for the ~8% of men with a
 * colour vision deficiency. A tenth series wants a different chart, not a tenth colour.
 */

/** How many distinct hues before the cycle repeats. */
export const PALETTE_SIZE = 8;

/**
 * Light-theme defaults, in cycle order.
 *
 * Ordered so the first two are the most separable pair (the two-series case is the common one), and
 * chosen against the design system's own tokens rather than invented: series 1 IS `accent`, 3 is
 * `paid`, 5 is `error`. A chart therefore looks like the rest of the application by construction.
 */
const LIGHT: readonly string[] = [
  '#4c6286', // accent
  '#c2703a', // ochre
  '#3e8e5a', // paid
  '#8a5ba8', // violet
  '#c2403a', // error
  '#2f8a8a', // teal
  '#97733a', // olive
  '#6b7280', // slate
];

/**
 * Dark-theme defaults — the same hues, lifted and desaturated.
 *
 * Not the light values reused: a saturated colour that reads as solid on white glows on near-black,
 * and a chart of glowing lines is unreadable at any length. Not the light values merely lightened
 * either, since that keeps the saturation that causes the glow.
 */
const DARK: readonly string[] = [
  '#7b96c4',
  '#e0996a',
  '#62b585',
  '#b18ccc',
  '#e0736c',
  '#55b3b3',
  '#c2a065',
  '#9aa0aa',
];

/** The default for slot `index`, for the stylesheet to emit. Not read at render time. */
export function paletteDefault(index: number, theme: 'light' | 'dark'): string {
  const list: readonly string[] = theme === 'dark' ? DARK : LIGHT;
  return list[index % list.length];
}

/**
 * The colour a series should be drawn in.
 *
 * An explicit colour wins and is passed through untouched — a caller naming brand red means that
 * red, not the nearest palette slot. Otherwise the cycle, as a custom property with its light
 * default inline, so the value works even if the stylesheet never loaded.
 */
export function seriesColor(index: number, explicit?: string): string {
  if (explicit) return explicit;
  const slot: number = index % PALETTE_SIZE;
  return `var(--weave-chart-${slot + 1}, ${LIGHT[slot]})`;
}

/**
 * A dashed pattern for series past the first cycle.
 *
 * The ninth series repeats colour 1, and two identically-coloured lines is a chart that lies. A
 * stroke pattern is the redundant channel: it survives greyscale printing and colour blindness,
 * which is why it beats simply adding more hues.
 */
export function seriesDash(index: number): string | undefined {
  const cycle: number = Math.floor(index / PALETTE_SIZE);
  if (cycle === 0) return undefined;
  return cycle === 1 ? '6 4' : cycle === 2 ? '2 3' : '10 4 2 4';
}

/** The ink and hairline colours the axes, grid and labels use. Same custom-property contract. */
export const chartInk = {
  axis: 'var(--weave-chart-axis, var(--fg-soft, #71727a))',
  grid: 'var(--weave-chart-grid, var(--border, rgba(20, 22, 28, 0.12)))',
  label: 'var(--weave-chart-label, var(--fg-soft, #71727a))',
  surface: 'var(--weave-chart-surface, var(--surface, #ffffff))',
} as const;
