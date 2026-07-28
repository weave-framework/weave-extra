/**
 * What survives inside a `<Split>` pane — native HTML and `@weave-framework/ui` alike.
 *
 * The question this page exists to answer: a splitter binds Arrow, Home, End, PageUp, PageDown and
 * Enter on its gutters, and pane content binds the same keys for its own purposes. Does one steal
 * from the other?
 *
 * It does not, and the reason is structural rather than a per-component allowance: the gutter's
 * listener is on the gutter, and pane content is its SIBLING, not its descendant. Events from the
 * content never travel through it. The key log below makes that visible instead of asserted.
 */

import { signal, type Signal } from '@weave-framework/runtime';
import Split from '@weave-framework/extra/components/split';
import SplitPane from '@weave-framework/extra/components/split-pane';
import type { SplitSize } from '@weave-framework/extra/components/split';
import Button from '@weave-framework/ui/button';
import Input from '@weave-framework/ui/input';
import Checkbox from '@weave-framework/ui/checkbox';
import Select, { type SelectValue } from '@weave-framework/ui/select';
import Demo from '../lib/demo.js';

interface Option {
  value: string;
  label: string;
}

interface KeyEntry {
  id: number;
  key: string;
  where: string;
  target: string;
}

/** Keys the splitter binds on a gutter — the ones a collision would show up in. */
const WATCHED: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter',
  'Escape',
]);

export interface InsidePageContext {
  nativeSizes: Signal<SplitSize[]>;
  weaveSizes: Signal<SplitSize[]>;
  proofSizes: Signal<SplitSize[]>;
  options: Option[];
  rows: string[];
  text: Signal<string>;
  agreed: Signal<boolean>;
  picked: Signal<SelectValue<Option>>;
  submits: () => number;
  onSubmit: (event: Event) => void;
  keys: () => KeyEntry[];
  onAreaKeydown: (event: KeyboardEvent) => void;
  clearKeys: () => void;
  format: (sizes: SplitSize[]) => string;
}

export function setup(): InsidePageContext {
  const nativeSizes: Signal<SplitSize[]> = signal<SplitSize[]>([46, 54]);
  const weaveSizes: Signal<SplitSize[]> = signal<SplitSize[]>([46, 54]);
  const proofSizes: Signal<SplitSize[]> = signal<SplitSize[]>([50, 50]);

  const text: Signal<string> = signal<string>('');
  const agreed: Signal<boolean> = signal<boolean>(false);
  const picked: Signal<SelectValue<Option>> = signal<SelectValue<Option>>('beta');
  const submits: Signal<number> = signal<number>(0);

  const keys: Signal<KeyEntry[]> = signal<KeyEntry[]>([]);
  let nextId: number = 1;

  const options: Option[] = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
    { value: 'gamma', label: 'Gamma' },
    { value: 'delta', label: 'Delta' },
  ];

  const rows: string[] = Array.from({ length: 40 }, (_, i) => `row ${i + 1}`);

  /**
   * Listens on a wrapper AROUND the splitter, so it sees every watched key from both the gutters and
   * the pane content — and reports which of the two it came from. That is the claim under test.
   */
  const onAreaKeydown = (event: KeyboardEvent): void => {
    if (!WATCHED.has(event.key)) return;
    const target: HTMLElement | null = event.target as HTMLElement | null;
    if (!target) return;

    const isGutter: boolean = target.getAttribute('role') === 'separator';
    const where: string = isGutter
      ? 'splitter gutter'
      : target.closest('.weave-split__pane')
        ? 'pane content'
        : 'outside';

    const type: string = target instanceof HTMLInputElement ? `[${target.type}]` : '';

    keys.set((list) =>
      [
        { id: nextId++, key: event.key, where, target: target.tagName.toLowerCase() + type },
        ...list,
      ].slice(0, 12)
    );
  };

  return {
    nativeSizes,
    weaveSizes,
    proofSizes,
    options,
    rows,
    text,
    agreed,
    picked,
    submits,
    onSubmit: (event: Event): void => {
      event.preventDefault();
      submits.set((n) => n + 1);
    },
    keys,
    onAreaKeydown,
    clearKeys: (): void => {
      keys.set([]);
    },
    format: (sizes: SplitSize[]): string =>
      sizes.map((size) => (size === '*' ? '*' : `${Math.round(size)}%`)).join(' · '),
  };
}

export { Split, SplitPane, Demo, Button, Input, Checkbox, Select };
