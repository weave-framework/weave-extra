/**
 * `<SplitPane>` — one pane inside a `<Split>`.
 *
 * The pane owns nothing about its own geometry: it declares what it wants (initial size, bounds,
 * whether it locks or collapses) and reads its grid placement back from the container. That keeps
 * one component in charge of the arithmetic, which is what makes bounds hold across a cascade
 * through several panes at once.
 *
 *   <SplitPane size={{ 30 }} min={{ 15 }} max={{ 60 }} collapsible>…</SplitPane>
 */

import { inject, onDispose, signal, type Signal } from '@weave-framework/runtime';
import {
  SplitContext,
  type SplitContextValue,
  type SplitGutterBinding,
  type SplitPaneHandle,
} from './context.js';
import type { SplitSize } from './models.js';

export interface SplitPaneProps {
  /** Initial size in the container's unit. Omitted means `'*'` — take whatever is left. */
  size?: SplitSize;
  /** Lower bound in the container's unit. `'*'` (the default) means no minimum. */
  min?: SplitSize;
  /** Upper bound in the container's unit. `'*'` (the default) means no maximum. */
  max?: SplitSize;
  /** Keep this pane's size fixed — no drag gives it pixels or takes them away. */
  lock?: boolean;
  /** Hide the pane. Its slot stays in the grid at zero width and its two gutters become one. */
  visible?: boolean;
  /** Allow collapsing to `collapsedSize` (gutter Enter, gutter double-click, or the `collapsed` prop). */
  collapsible?: boolean;
  /** Size to collapse to, in the container's unit. Default 0. */
  collapsedSize?: number;
  /** Controlled collapsed state. Leave unset to let the container track it. */
  collapsed?: boolean;
  /** Fires whenever this pane collapses or expands. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Extra classes, forwarded onto the pane element. */
  class?: string;
}

export const propDefaults = {
  min: '*',
  max: '*',
  lock: false,
  visible: true,
  collapsible: false,
  collapsedSize: 0,
} as const;

export interface SplitPaneRenderContext {
  el: Signal<Element | null>;
  rootClass: () => string;
  rootStyle: () => string;
  /** The gutter this pane draws after itself — see `SplitGutterBinding` for why it lives here. */
  gutter: SplitGutterBinding;
}

export function setup(props: SplitPaneProps): SplitPaneRenderContext {
  const container: SplitContextValue | undefined = inject(SplitContext);
  if (!container) {
    throw new Error(
      'weave: <SplitPane> must be rendered inside a <Split>. ' +
        'Import Split from `@weave-framework/extra/components/split` and wrap the panes in it.'
    );
  }

  const el: Signal<Element | null> = signal<Element | null>(null);

  const handle: SplitPaneHandle = container.register({
    el,
    size: (): SplitSize | undefined => props.size,
    min: (): SplitSize => props.min ?? '*',
    max: (): SplitSize => props.max ?? '*',
    lock: (): boolean => !!props.lock,
    visible: (): boolean => props.visible !== false,
    collapsible: (): boolean => !!props.collapsible,
    collapsedSize: (): number => props.collapsedSize ?? 0,
    collapsed: (): boolean | undefined => props.collapsed,
    onCollapsedChange: (collapsed: boolean): void => props.onCollapsedChange?.(collapsed),
  });

  onDispose(handle.dispose);

  return {
    el,
    gutter: handle.gutter,
    rootClass: (): string => {
      const parts: string[] = ['weave-split__pane'];
      if (handle.collapsed()) parts.push('weave-split__pane--collapsed');
      if (props.lock) parts.push('weave-split__pane--locked');
      if (props.visible === false) parts.push('weave-split__pane--hidden');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    rootStyle: (): string => {
      const placement: string = handle.style();
      // A hidden pane keeps its (zero-width) grid slot so the panes after it do not shift; display
      // none on top of that stops its content from forcing the track open.
      return props.visible === false ? `${placement}; display: none` : placement;
    },
  };
}
