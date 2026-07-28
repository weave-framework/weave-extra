/**
 * `<Split>` — shared types.
 *
 * Kept in their own module so the pure layout math (`layout.ts`) can be tested without pulling in a
 * component, and so a consumer can type a persistence callback without importing either component.
 */

/** Axis the panes are laid out along. */
export type SplitDirection = 'horizontal' | 'vertical';

/** Writing direction. Only the horizontal axis flips; vertical is unambiguous. */
export type SplitDir = 'ltr' | 'rtl';

/**
 * How a pane's `size` is interpreted.
 *
 * `'percent'` — sizes are percentages of the space left after the gutters are subtracted, so they
 * sum to 100 regardless of how many gutters there are.
 * `'pixel'` — sizes are CSS pixels.
 */
export type SplitUnit = 'percent' | 'pixel';

/** A pane size: a number in the container's `unit`, or `'*'` for "take whatever is left". */
export type SplitSize = number | '*';

/** Payload for every gutter interaction. `sizes` is the full array, not just the touched pair. */
export interface SplitGutterEvent {
  /** Zero-based index of the gutter — gutter `n` sits between pane `n` and pane `n + 1`. */
  gutter: number;
  /** Sizes of all panes at the moment the event fired. */
  sizes: SplitSize[];
}

/**
 * Why the sizes changed.
 *
 * A discriminated union rather than a bare string, because a consumer persisting to a remote store
 * needs to tell a cheap local echo (`drag`/`move`) from a commit worth a network round-trip
 * (`drag`/`end`), and needs to NOT write back the sizes it just loaded (`load`).
 */
export type SplitChangeReason =
  /** A pointer drag. `phase` distinguishes the first move, each move, and the release. */
  | { readonly type: 'drag'; readonly gutter: number; readonly phase: 'start' | 'move' | 'end' }
  /** A keyboard resize on a focused gutter. `key` is the `KeyboardEvent.key` that caused it. */
  | { readonly type: 'keyboard'; readonly gutter: number; readonly key: string }
  /** A drag was abandoned with Escape and the sizes were restored to their pre-drag values. */
  | { readonly type: 'cancel'; readonly gutter: number }
  /** A pane collapsed to its minimum. */
  | { readonly type: 'collapse'; readonly pane: number }
  /** A pane expanded back to the size it had before it collapsed. */
  | { readonly type: 'expand'; readonly pane: number }
  /** `loadSizes` resolved and its result was applied. Do not persist this one back. */
  | { readonly type: 'load' }
  /** A pane was added or removed, so the sizes array was re-normalised. */
  | { readonly type: 'panes' };

/** What `loadSizes` may return: sizes to apply, or nothing to keep the declared defaults. */
export type SplitSizesSource =
  | SplitSize[]
  | null
  | undefined
  | Promise<SplitSize[] | null | undefined>;
