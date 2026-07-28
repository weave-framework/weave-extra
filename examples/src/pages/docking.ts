/**
 * Driving a `<Split>` from a layout CONFIGURATION, the way a docking menu does.
 *
 * The question this answers: can an existing split be re-rendered from a given configuration —
 * dock the panel left, right, top, bottom, or remove it — without rewriting the markup each time?
 *
 * It can, and it needs nothing new from the component. The configuration drives a keyed `@for`, so
 * the panes genuinely reorder in the DOM rather than only being moved visually by the grid. That
 * matters: tab order follows DOM order, so a purely visual reorder would put the separator in the
 * wrong place for a keyboard user — the exact defect this component was already fixed for once.
 *
 * The other half is that the panel's size must follow the PANEL, not its position. Docking a 28%
 * panel from the right to the left should leave it 28%, not hand it the 72% that used to be on the
 * left. Keeping one number and deriving the array from the current order is all that takes.
 */

import { computed, signal, type Signal } from '@weave-framework/runtime';
import Split from '@weave-framework/extra/components/split';
import SplitPane from '@weave-framework/extra/components/split-pane';
import type { SplitChangeReason, SplitDirection, SplitSize } from '@weave-framework/extra/components/split';
import Button from '@weave-framework/ui/button';
import Demo from '../lib/demo.js';

export type Dock = 'left' | 'right' | 'top' | 'bottom' | 'undocked';

export interface DockOption {
  value: Dock;
  label: string;
}

interface Layout {
  direction: SplitDirection;
  /** Pane ids in visual order. The panel is absent entirely when undocked. */
  panes: string[];
  /** Whether the panel comes first — the one fact the sizes derivation needs. */
  panelFirst: boolean;
}

export interface DockingPageContext {
  dock: Signal<Dock>;
  panelSize: Signal<number>;
  options: DockOption[];
  layout: () => Layout;
  sizes: () => SplitSize[];
  onSizesChange: (sizes: SplitSize[], reason: SplitChangeReason) => void;
  setDock: (value: Dock) => void;
  minFor: (id: string) => number;
  summary: () => string;
}

export function setup(): DockingPageContext {
  const dock: Signal<Dock> = signal<Dock>('right');
  /** ONE number — the panel's share. Everything else is derived from it and the current order. */
  const panelSize: Signal<number> = signal<number>(28);

  const options: DockOption[] = [
    { value: 'left', label: 'Dock to left' },
    { value: 'right', label: 'Dock to right' },
    { value: 'top', label: 'Dock to top' },
    { value: 'bottom', label: 'Dock to bottom' },
    { value: 'undocked', label: 'Undock' },
  ];

  // #region docking
  // One signal decides everything: the axis, the pane order, and whether the panel exists at all.
  const layout = computed<Layout>(() => {
    const value: Dock = dock();
    const panelFirst: boolean = value === 'left' || value === 'top';
    const vertical: boolean = value === 'top' || value === 'bottom';
    const panes: string[] =
      value === 'undocked' ? ['main'] : panelFirst ? ['panel', 'main'] : ['main', 'panel'];
    return { direction: vertical ? 'vertical' : 'horizontal', panes, panelFirst };
  });

  // Sizes are derived from ONE number, so the panel's share travels with the panel instead of
  // staying with whichever position it happened to occupy.
  const sizes = computed<SplitSize[]>(() => {
    const { panes, panelFirst } = layout();
    if (panes.length < 2) return ['*'];
    return panelFirst ? [panelSize(), '*'] : ['*', panelSize()];
  });

  // Read the panel's own entry back, wherever it currently sits.
  const onSizesChange = (next: SplitSize[], reason: SplitChangeReason): void => {
    if (reason.type === 'load' || reason.type === 'panes') return;
    const { panes, panelFirst } = layout();
    if (panes.length < 2) return;
    const value: SplitSize = next[panelFirst ? 0 : 1];
    if (value !== '*') panelSize.set(Math.round(value));
  };
  // #endregion

  return {
    dock,
    panelSize,
    options,
    layout,
    sizes,
    onSizesChange,
    setDock: (value: Dock): void => {
      dock.set(value);
    },
    minFor: (id: string): number => (id === 'panel' ? 12 : 20),
    summary: (): string => {
      const { direction, panes } = layout();
      return `${direction} · ${panes.join(' | ')} · panel ${panelSize()}%`;
    },
  };
}

export { Split, SplitPane, Demo, Button };
