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

/** One gutter, ready to render. */
export interface SplitGutterView {
  /** Zero-based gutter number — gutter `n` separates the `n`th and `n+1`th VISIBLE panes. */
  index: number;
  /** Inline grid placement. */
  style: string;
  label: string | undefined;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  valueText: string;
}

/**
 * The gutter that FOLLOWS a pane — rendered by the pane, driven by the container.
 *
 * It is rendered by the pane for one reason: tab order follows DOM order. With the container
 * emitting every gutter after the whole slot, Tab walked all the panes and only then reached the
 * separators, so the splitter between two panes was not where a keyboard user would look for it. A
 * pane emitting its own trailing gutter puts them in the order they appear on screen.
 *
 * Everything here is derived state and callbacks — the pane holds no resize logic of its own, since
 * bounds only mean something next to its siblings'.
 */
export interface SplitGutterBinding {
  /** The gutter after this pane, or null when no pane follows it. */
  view: () => SplitGutterView | null;
  class: () => string;
  tabindex: () => number;
  disabledAttr: () => string | undefined;
  ariaOrientation: () => 'horizontal' | 'vertical';
  onPointerdown: (event: PointerEvent) => void;
  onPointermove: (event: PointerEvent) => void;
  onPointerup: (event: PointerEvent) => void;
  onKeydown: (event: KeyboardEvent) => void;
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
  /** The gutter this pane renders after itself. */
  gutter: SplitGutterBinding;
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
