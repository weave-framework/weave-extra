/**
 * The `<Split>` ↔ `<SplitPane>` seam.
 *
 * A pane cannot size itself: its track belongs to the container's grid, and its bounds only mean
 * something next to its siblings'. So a pane declares what it wants, hands that to the container
 * through context, and reads its placement back from the handle it gets in return.
 */

import { createContext, type Signal } from '@weave-framework/runtime';
import type { SplitDirection, SplitSize } from './models.js';

/** What a pane declares to its container. Every field is a getter, so props stay reactive. */
export interface SplitPaneDeclaration {
  /** The pane's root element, once mounted — the container orders panes by document position. */
  el: Signal<Element | null>;
  /** Initial size. `undefined` means `'*'` — take whatever is left. */
  size: () => SplitSize | undefined;
  /** Lower bound in the container's unit; `'*'` means "no minimum". */
  min: () => SplitSize;
  /** Upper bound in the container's unit; `'*'` means "no maximum". */
  max: () => SplitSize;
  /** A locked pane keeps its size — no drag gives it pixels or takes them away. */
  lock: () => boolean;
  /** A hidden pane keeps its slot but takes no space, and its two gutters become one. */
  visible: () => boolean;
  /** Whether this pane can collapse to `collapsedSize`. */
  collapsible: () => boolean;
  /** Size to collapse to, in the container's unit. Default 0. */
  collapsedSize: () => number;
  /** Controlled collapsed state. `undefined` leaves the container in charge. */
  collapsed: () => boolean | undefined;
  /** Called whenever this pane collapses or expands. */
  onCollapsedChange?: (collapsed: boolean) => void;
}

/** What a pane gets back — everything it needs to render itself and nothing more. */
export interface SplitPaneHandle {
  /** Position among the container's panes, in document order. `-1` before the first layout. */
  index: () => number;
  /** Inline grid placement for the pane's root element. */
  style: () => string;
  /** Whether this pane is currently collapsed. */
  collapsed: () => boolean;
  /** Collapse if expanded, expand if collapsed. A no-op when the pane is not `collapsible`. */
  toggle: () => void;
  /** Drop this pane's registration. Call from `onDispose`. */
  dispose: () => void;
}

export interface SplitContextValue {
  register: (declaration: SplitPaneDeclaration) => SplitPaneHandle;
  direction: () => SplitDirection;
}

/**
 * No fallback value: a `<SplitPane>` outside a `<Split>` has no grid to place itself in, and
 * rendering it as a bare unsized `<div>` would look like a styling bug rather than a misuse. The
 * pane throws with a message naming the fix instead.
 */
export const SplitContext = createContext<SplitContextValue>();
