/**
 * Live examples for `<Split>`.
 *
 * Imported through the package's own name rather than a relative path, so these pages exercise the
 * `exports` map a real consumer resolves — a missing or misspelled entry fails here instead of in
 * someone else's app.
 */

import { signal, type Signal } from '@weave-framework/runtime';
import Split from '@weave-framework/extra/components/split';
import SplitPane from '@weave-framework/extra/components/split-pane';
import type { SplitChangeReason, SplitSize } from '@weave-framework/extra/components/split';
import Demo from '../lib/demo.js';

const STORAGE_KEY = 'weave-extra:split-example';

interface LogEntry {
  id: number;
  reason: string;
  sizes: string;
  /** Whether this change was actually written to the store. */
  persisted: boolean;
}

export interface SplitPageContext {
  basicSizes: Signal<SplitSize[]>;
  verticalSizes: Signal<SplitSize[]>;
  ideSizes: Signal<SplitSize[]>;
  ideRightSizes: Signal<SplitSize[]>;
  panelSizes: Signal<SplitSize[]>;
  panelCollapsed: Signal<boolean>;
  boundsSizes: Signal<SplitSize[]>;
  savedSizes: Signal<SplitSize[]>;
  events: () => LogEntry[];
  loadSaved: () => Promise<SplitSize[] | null>;
  onSavedChange: (sizes: SplitSize[], reason: SplitChangeReason) => void;
  clearSaved: () => void;
  format: (sizes: SplitSize[]) => string;
  panelLabel: () => string;
  togglePanel: () => void;
}

export function setup(): SplitPageContext {
  const basicSizes: Signal<SplitSize[]> = signal<SplitSize[]>([25, 50, 25]);
  const verticalSizes: Signal<SplitSize[]> = signal<SplitSize[]>([35, 65]);
  const ideSizes: Signal<SplitSize[]> = signal<SplitSize[]>([22, 78]);
  const ideRightSizes: Signal<SplitSize[]> = signal<SplitSize[]>([72, 28]);
  const panelSizes: Signal<SplitSize[]> = signal<SplitSize[]>([26, 74]);
  const panelCollapsed: Signal<boolean> = signal<boolean>(false);
  const boundsSizes: Signal<SplitSize[]> = signal<SplitSize[]>([25, 50, 25]);
  const savedSizes: Signal<SplitSize[]> = signal<SplitSize[]>([40, 60]);
  const events: Signal<LogEntry[]> = signal<LogEntry[]>([]);

  let nextId: number = 1;

  const format = (sizes: SplitSize[]): string =>
    sizes.map((size) => (size === '*' ? '*' : `${Math.round(size)}%`)).join(' · ');

  const describe = (reason: SplitChangeReason): string => {
    switch (reason.type) {
      case 'drag':
        return `drag · gutter ${reason.gutter} · ${reason.phase}`;
      case 'keyboard':
        return `keyboard · gutter ${reason.gutter} · ${reason.key}`;
      case 'cancel':
        return `cancel · gutter ${reason.gutter}`;
      case 'collapse':
        return `collapse · pane ${reason.pane}`;
      case 'expand':
        return `expand · pane ${reason.pane}`;
      case 'load':
        return 'load';
      case 'panes':
        return 'panes';
    }
  };

  /**
   * Deliberately async and deliberately slow. A store behind the network is the case this component
   * has to survive, and a synchronous `localStorage.getItem` would hide every ordering problem that
   * only shows up when the sizes arrive after the first paint.
   */
  const loadSaved = (): Promise<SplitSize[] | null> =>
    new Promise((resolve) => {
      setTimeout(() => {
        const raw: string | null = localStorage.getItem(STORAGE_KEY);
        resolve(raw ? (JSON.parse(raw) as SplitSize[]) : null);
      }, 400);
    });

  const onSavedChange = (sizes: SplitSize[], reason: SplitChangeReason): void => {
    // What a remote store would do: ignore the echo of its own load, and write once per drag rather
    // than once per frame.
    const persisted: boolean =
      reason.type !== 'load' && !(reason.type === 'drag' && reason.phase !== 'end');
    if (persisted) localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));

    events.set((list) =>
      [{ id: nextId++, reason: describe(reason), sizes: format(sizes), persisted }, ...list].slice(0, 14)
    );
  };

  const clearSaved = (): void => {
    localStorage.removeItem(STORAGE_KEY);
    events.set([]);
  };

  return {
    basicSizes,
    verticalSizes,
    ideSizes,
    ideRightSizes,
    panelSizes,
    panelCollapsed,
    boundsSizes,
    savedSizes,
    events,
    loadSaved,
    onSavedChange,
    clearSaved,
    format,
    panelLabel: (): string => (panelCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'),
    togglePanel: (): void => panelCollapsed.set((v) => !v),
  };
}

export { Split, SplitPane, Demo };
