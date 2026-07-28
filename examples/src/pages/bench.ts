/**
 * How heavy is a real table?
 *
 * Written because the question "20 columns × 200 rows with mixed types and actions — what does that
 * cost?" deserves a number rather than an estimate. It renders exactly that shape, with the cell mix
 * a production grid actually has, and reports what it took.
 *
 * The mix matters more than the count. A grid of text nodes says nothing about a grid where one
 * column in ten is a component: a component cell allocates an owner, runs a setup, and composes a
 * child of its own, so it costs a multiple of a text node — and the plugin's whole premise is that
 * consumers write those. So the cycle below is deliberately the shape of `documents.columns.json`:
 * mostly strings and numbers, a few dates and enums, two component columns, one action column.
 *
 * Timing: Weave flushes effects synchronously, and `batch` flushes on the way out, so the mutation
 * RETURNS with the DOM already built — that call IS the build. Layout is the browser's separate cost,
 * forced afterwards by reading `offsetHeight`.
 *
 * KNOWN LIMIT — it takes THREE things together, and dropping any one of them makes it go away:
 *
 *   1. the row chrome is on (selection checkboxes, expand toggles, resize grips) — these are child
 *      components that write a `ref` signal DURING render;
 *   2. the column set changes on an already-rendered grid;
 *   3. there are enough rows — bisected on this machine to between 150 (clean) and 200 (overflows)
 *      when the rows keep their identity, which is what a columns menu does; 500 when they are
 *      replaced at the same time. The threshold is a stack budget, so it moves with the browser and
 *      with how many frames each row costs — treat ~150 as the observed order of magnitude, not a
 *      constant to design against.
 *
 * Then the stack overflows (`RangeError`) and the grid is left half-rendered. Row COUNT alone is not
 * the problem: with the chrome off, 1,000 rows plus a column change is clean, and a fresh render of
 * 1,000 rows with the chrome on is clean too.
 *
 * `batch` does not prevent it — it decrements its depth BEFORE flushing, so the render still runs with
 * the queue open. The runtime's `flush()` guards only on `batchDepth` and has no re-entrancy guard, so
 * a write made while rendering drains the queue on top of the render still running rather than
 * appending to it. Reproduces with plain `<Table>`; this page uses no plugin.
 */

import { batch, computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Table, { type TableColumn } from '@weave-framework/ui/table';
import Button from '@weave-framework/ui/button';
import StatusCell from './bench-cells/status-cell.js';

type CellKind = 'text' | 'number' | 'timestamp' | 'enum' | 'component' | 'action';

/**
 * The per-column cell kinds, in order. Twenty entries so a 20-column run uses each exactly once:
 * 10 text, 3 number, 2 timestamp, 2 enum, 2 component, 1 action. Other column counts cycle it.
 */
const KIND_CYCLE: CellKind[] = [
  'text', 'text', 'number', 'text', 'timestamp',
  'text', 'enum', 'component', 'text', 'number',
  'text', 'timestamp', 'text', 'component', 'text',
  'enum', 'number', 'text', 'text', 'action',
];

const STATUSES: string[] = ['ok', 'warn', 'fail'];
const STAGES: string[] = ['Received', 'Translated', 'Delivered', 'Acknowledged', 'Failed'];
const WORDS: string[] = ['ORDERS', 'INVOIC', 'DESADV', 'ORDRSP', 'APERAK', 'CONTRL'];

export interface BenchRow {
  id: number;
  [key: string]: unknown;
}

export interface BenchResult {
  label: string;
  build: number;
  paint: number;
  nodes: number;
  cells: number;
}

export interface BenchPageContext {
  Table: typeof Table;
  rowChoices: number[];
  colChoices: number[];
  rowCount: () => number;
  colCount: () => number;
  setRows: (value: number) => void;
  setCols: (value: number) => void;
  rows: () => BenchRow[];
  columns: () => TableColumn<BenchRow>[];
  results: () => BenchResult[];
  host: Signal<HTMLElement | null>;
  rebuild: () => void;
  resort: () => void;
  clear: () => void;
  actionCount: () => number;
  mixSummary: () => string;
  rowVariant: (value: number) => string;
  colVariant: (value: number) => string;
  chrome: () => boolean;
  rich: () => boolean;
  chromeLabel: () => string;
  richLabel: () => string;
  chromeVariant: () => string;
  richVariant: () => string;
  toggleChrome: () => void;
  toggleRich: () => void;
}

/** Deterministic pseudo-random so two runs of the same size are comparable. */
function seeded(seed: number): () => number {
  let state: number = seed;
  return (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function makeRows(rowCount: number, colCount: number): BenchRow[] {
  const rand: () => number = seeded(rowCount * 1000 + colCount);
  const out: BenchRow[] = [];
  for (let r: number = 0; r < rowCount; r++) {
    const row: BenchRow = { id: r + 1 };
    for (let c: number = 0; c < colCount; c++) {
      const kind: CellKind = KIND_CYCLE[c % KIND_CYCLE.length];
      const key: string = `c${c}`;
      if (kind === 'number') row[key] = Math.round(rand() * 100000);
      else if (kind === 'timestamp') row[key] = 1750000000000 + Math.round(rand() * 5e9);
      else if (kind === 'enum') row[key] = Math.floor(rand() * STAGES.length);
      else if (kind === 'component') row[key] = STATUSES[Math.floor(rand() * STATUSES.length)];
      else if (kind === 'action') row[key] = r;
      else row[key] = `${WORDS[Math.floor(rand() * WORDS.length)]}-${Math.round(rand() * 999999)}`;
    }
    out.push(row);
  }
  return out;
}

export function setup(): BenchPageContext {
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const rowCount: Signal<number> = signal<number>(200);
  const colCount: Signal<number> = signal<number>(20);
  const rows: Signal<BenchRow[]> = signal<BenchRow[]>(makeRows(200, 20));
  const results: Signal<BenchResult[]> = signal<BenchResult[]>([]);
  const actions: Signal<number> = signal<number>(0);
  const sortDir: Signal<'asc' | 'desc'> = signal<'asc' | 'desc'>('asc');
  const rebuilds: Signal<number> = signal<number>(0);
  /** Table chrome: selection checkboxes, expand toggles, resize grips — a component per row, each. */
  const chrome: Signal<boolean> = signal<boolean>(true);
  /** Component-backed cells vs the same columns rendered as plain text. */
  const rich: Signal<boolean> = signal<boolean>(true);

  const columns: Computed<TableColumn<BenchRow>[]> = computed<TableColumn<BenchRow>[]>(() => {
    const out: TableColumn<BenchRow>[] = [
      { key: 'id', header: 'id', width: 70, numeric: true, sortable: true },
    ];
    for (let c: number = 0; c < colCount(); c++) {
      const kind: CellKind = KIND_CYCLE[c % KIND_CYCLE.length];
      const key: string = `c${c}`;
      if (kind === 'number') {
        out.push({ key, header: `num ${c}`, numeric: true, sortable: true, width: 110 });
      } else if (kind === 'timestamp') {
        out.push({
          key,
          header: `date ${c}`,
          width: 170,
          cell: (row: BenchRow): string => new Date(row[key] as number).toISOString().slice(0, 16).replace('T', ' '),
        });
      } else if (kind === 'enum') {
        out.push({ key, header: `enum ${c}`, width: 130, cell: (row: BenchRow): string => STAGES[row[key] as number] });
      } else if (kind === 'component') {
        // The case the plugin is for: the cell IS a component, instantiated per row.
        out.push({
          key,
          header: `status ${c}`,
          width: 130,
          cell: rich()
            ? (row: BenchRow): Node => StatusCell({ value: row[key] })
            : (row: BenchRow): string => String(row[key]),
        });
      } else if (kind === 'action' && !rich()) {
        out.push({ key, header: 'actions', width: 96, cell: (): string => 'Open' });
      } else if (kind === 'action') {
        out.push({
          key,
          header: 'actions',
          width: 96,
          // A component built imperatively has no `on:click` to auto-forward, so the handler goes on
          // the node it returns. Worth knowing for the plugin: a cell component takes its callback
          // as a DATA prop (`api.action`), not as an event — that path works either way.
          cell: (row: BenchRow): Node => {
            const node: Node = Button(
              { variant: 'ghost', label: `Row ${row.id}` },
              { default: (): Node => document.createTextNode('Open') }
            );
            node.addEventListener('click', () => {
              actions.set(actions() + 1);
            });
            return node;
          },
        });
      } else {
        out.push({ key, header: `text ${c}`, sortable: true, width: 150 });
      }
    }
    return out;
  });

  /**
   * Time one render: the synchronous DOM build, then the same again after forcing the browser to
   * settle style and layout.
   *
   * Deliberately NOT `requestAnimationFrame`: rAF is throttled to zero in a pane the compositor is
   * not driving, so a rAF-based probe reports nothing at all rather than reporting slowly — which is
   * exactly what the first version of this did. Reading `offsetHeight` forces style recalculation and
   * layout synchronously, which is the browser-side cost that actually scales with the grid.
   */
  const measure = (label: string, apply: () => void): void => {
    const start: number = performance.now();
    batch(apply);
    const build: number = performance.now() - start;
    const el: HTMLElement | null = host();
    if (el) void el.offsetHeight; // flush style + layout
    const paint: number = performance.now() - start;
    const nodes: number = el ? el.querySelectorAll('*').length : 0;
    results.set(
      [{ label, build, paint, nodes, cells: rows().length * (colCount() + 1) }, ...results()].slice(0, 14)
    );
  };

  return {
    Table,
    host,
    rowChoices: [30, 50, 100, 150, 200, 500, 1000],
    colChoices: [10, 20, 40],
    rowCount,
    colCount,
    rows,
    columns,
    results,
    actionCount: (): number => actions(),
    setRows: (value: number): void => {
      // Built BEFORE the clock starts: generating the data is the app's cost, not the table's.
      const next: BenchRow[] = makeRows(value, colCount());
      measure(`${value} × ${colCount()} — sukurta iš naujo`, () => {
        rowCount.set(value);
        rows.set(next);
      });
    },
    setCols: (value: number): void => {
      const next: BenchRow[] = makeRows(rowCount(), value);
      measure(`${rowCount()} × ${value} — sukurta iš naujo`, () => {
        colCount.set(value);
        rows.set(next);
      });
    },
    rebuild: (): void => {
      // New identities every time, so `trackBy` cannot reuse a single row — this is the full build.
      const next: BenchRow[] = makeRows(rowCount(), colCount()).map((row, i) => ({ ...row, id: row.id + rebuilds() * 1e6 + i * 0 }));
      rebuilds.set(rebuilds() + 1);
      measure(`${rowCount()} × ${colCount()} — sukurta iš naujo`, () => {
        rows.set(next);
      });
    },
    // A reorder of the SAME row objects. Identity is preserved, so this is the keyed-move path
    // rather than a rebuild — the number that matters for sorting a loaded page.
    resort: (): void => {
      const dir: number = sortDir() === 'asc' ? 1 : -1;
      sortDir.set(sortDir() === 'asc' ? 'desc' : 'asc');
      measure(`${rowCount()} × ${colCount()} — perrūšiuota`, () => {
        rows.set([...rows()].sort((a, b) => (a.id - b.id) * dir));
      });
    },
    clear: (): void => {
      results.set([]);
    },
    chrome,
    rich,
    chromeLabel: (): string => (chrome() ? 'Chrome: on' : 'Chrome: off'),
    richLabel: (): string => (rich() ? 'Component cells: on' : 'Component cells: off'),
    chromeVariant: (): string => (chrome() ? 'primary' : 'ghost'),
    richVariant: (): string => (rich() ? 'primary' : 'ghost'),
    toggleChrome: (): void => {
      const nextChrome: boolean = !chrome();
      // The rows are NOT replaced: flipping the chrome is a column change, and keeping the data
      // identical is what makes this measure the chrome rather than a rebuild.
      measure(`${rowCount()} × ${colCount()} — chrome ${nextChrome ? 'on' : 'off'}`, () => {
        chrome.set(nextChrome);
      });
    },
    // Grouped in one mutation so the grid is published once rather than twice — which is what `batch`
    // buys here. It does NOT make the column change safe at scale; see the known limit at the top.
    toggleRich: (): void => {
      const nextRich: boolean = !rich();
      const next: BenchRow[] = makeRows(rowCount(), colCount()).map((row) => ({ ...row, id: row.id + rebuilds() * 1e6 }));
      measure(`${rowCount()} × ${colCount()} — cells ${nextRich ? 'component' : 'text'}`, () => {
        rebuilds.set(rebuilds() + 1);
        rich.set(nextRich);
        rows.set(next);
      });
    },
    mixSummary: (): string => {
      const counts: Record<string, number> = {};
      for (let c: number = 0; c < colCount(); c++) {
        const kind: CellKind = KIND_CYCLE[c % KIND_CYCLE.length];
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
      return Object.entries(counts).map(([kind, n]) => `${n} × ${kind}`).join(' · ');
    },
    rowVariant: (value: number): string => (value === rowCount() ? 'primary' : 'ghost'),
    colVariant: (value: number): string => (value === colCount() ? 'primary' : 'ghost'),
  };
}

export { Button };
