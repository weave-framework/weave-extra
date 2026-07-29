/**
 * The table plugin, assembled the way a screen actually uses it.
 *
 * Two things this page has to get right, and an earlier version of it got both wrong.
 *
 * It is ONE grid, not a gallery of parts. A toolbar above it, a footer under it, the columns panel in
 * a popover off the toolbar. Laid out as separate documented blocks, the pieces read as separate
 * widgets that happen to share a page — precisely the wrong impression, because the whole point of
 * the plugin is that they are one thing driven by one configuration.
 *
 * And it actually filters. The plugin deliberately filters nothing itself — a real grid holds one
 * page fetched from a server that does the work — but a demo that reports a query and then shows the
 * same rows looks broken rather than principled. So this page plays the server: it holds the whole
 * set and applies the query the plugin hands it. That is also the honest illustration, because it
 * puts the work exactly where a caller's own fetch would go.
 *
 * The columns still come from a file at runtime (`fetch`), which is the interesting half of the two
 * ways to load them; the other is `import cols from './x.columns.json' with { type: 'json' }`,
 * bundled and type-checked, at the cost of a rebuild to change a column.
 */

import { computed, signal, onMount, type Computed, type Signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Button from '@weave-framework/ui/button';
import Checkbox from '@weave-framework/ui/checkbox';
import Icon from '@weave-framework/ui/icon';
import Paginator from '@weave-framework/ui/paginator';
import {
  tablePlugin,
  tableRows,
  columnsPanel,
  enumsFromList,
  type ColumnConfig,
  type EnumTables,
  type TableActionEvent,
  type TablePluginApi,
  type ResolvedColumn,
} from '@weave-framework/extra/plugins/table';
import StatusChip from './table-cells/status-chip.js';
import Demo from '../lib/demo/demo.js';
import CodeTabs from '../lib/code-tabs/code-tabs.js';

const COLUMNS_URL = 'json/documents.columns.json';

export interface DocumentRow extends Record<string, unknown> {
  id: number;
  documentFormat: string;
  documentType: string;
  sender: string;
  recipient: string;
  momentCreated: number;
  documentStateType: number;
  processingState: string;
  testIndicator: boolean;
  isReprocessable: boolean;
  correlationId: string;
  priority: number;
  rawState: string;
}

const STATES: string[] = ['succeeded', 'retrying', 'failed', 'warning', 'rejected'];
const FORMATS: string[] = ['EDIFACT', 'X12', 'XML'];
const TYPES: string[] = ['ORDERS', 'INVOIC', 'DESADV', 'ORDRSP'];

/** The whole set. A server would hold this; here the page does, so a query has something to act on. */
function makeRows(count: number): DocumentRow[] {
  const out: DocumentRow[] = [];
  for (let i: number = 0; i < count; i++) {
    out.push({
      id: 4200 + i,
      documentFormat: FORMATS[i % FORMATS.length],
      documentType: TYPES[i % TYPES.length],
      sender: `Sender ${String.fromCharCode(65 + (i % 6))}`,
      recipient: `Recipient ${String.fromCharCode(88 - (i % 5))}`,
      momentCreated: 1750000000000 + i * 3600_000,
      documentStateType: i % 4,
      processingState: STATES[i % STATES.length],
      testIndicator: i % 7 === 0,
      isReprocessable: i % 3 === 0,
      correlationId: `corr-${(i * 7919).toString(16)}`,
      priority: (i % 5) + 1,
      rawState: 'internal',
    });
  }
  return out;
}

export interface LogEntry {
  id: number;
  kind: string;
  detail: string;
}

export interface TablePageContext {
  Table: typeof Table;
  Paginator: typeof Paginator;
  grid: TablePluginApi<DocumentRow>;
  rows: Computed<DocumentRow[]>;
  matched: Computed<number>;
  status: () => string;
  log: () => LogEntry[];
  clearLog: () => void;
  menuColumns: () => ResolvedColumn[];
  isOn: (column: ResolvedColumn) => boolean;
  toggle: (column: ResolvedColumn) => void;
  canToggle: (column: ResolvedColumn) => boolean;
  reset: () => void;
  columnsOpen: () => boolean;
  toggleColumns: () => void;
  /**
   * Returned from `setup()`, not merely exported: a `use:` action resolves from the setup context,
   * where a capitalised component tag resolves from the module's exports. Exporting it compiles
   * cleanly and silently attaches nothing.
   */
  tableRows: typeof tableRows;
  columnsPanel: typeof columnsPanel;
}

export function setup(): TablePageContext {
  const configs: Signal<ColumnConfig[]> = signal<ColumnConfig[]>([]);
  const status: Signal<string> = signal<string>('loading…');
  const log: Signal<LogEntry[]> = signal<LogEntry[]>([]);
  const columnsOpen: Signal<boolean> = signal<boolean>(false);
  // Empty at first, on purpose: this is the race a real application has, where the enums come over
  // the network and can land after the first page of rows.
  const enums: Signal<EnumTables> = signal<EnumTables>({});
  const all: DocumentRow[] = makeRows(248);
  let seq: number = 0;

  const record = (kind: string, detail: string): void => {
    seq += 1;
    log.set([{ id: seq, kind, detail }, ...log()].slice(0, 12));
  };

  const grid: TablePluginApi<DocumentRow> = tablePlugin<DocumentRow>({
    columns: configs,
    cells: { 'status-chip': StatusChip },
    // A getter, so the tables can arrive late and still fill the cells and the filters.
    enums: enums,
    checkRole: (roles: string[]): boolean => roles.includes('Operator'),
    formatDate: (value: unknown): string =>
      new Date(value as number).toISOString().slice(0, 16).replace('T', ' '),

    globalActions: [
      { action: 'reload', icon: 'refresh-cw', title: 'Reload' },
      { action: 'export', icon: 'download', title: 'Export' },
    ],
    actions: [
      { action: 'open', icon: 'external-link', title: 'Open document' },
      { action: 'reprocess', icon: 'refresh-cw', title: 'Reprocess', visible: (row) => row.isReprocessable },
      { action: 'delete', icon: 'trash-2', title: 'Delete', showIn: 'menu' },
    ],

    virtual: true,
    rowHeight: 34,
    maxHeight: 360,
    rowEvents: true,
    filters: true,
    resizableColumns: true,

    pagination: true,
    pageSize: 25,
    pageSizeOptions: [10, 25, 50],
    total: (): number => matched(),

    rowClass: (row: DocumentRow): string[] => {
      const names: string[] = [];
      if (row.processingState === 'failed' || row.processingState === 'rejected') names.push('row--bad');
      if (row.testIndicator) names.push('row--test');
      return names;
    },

    onAction: (event: TableActionEvent<DocumentRow>): void => {
      if (event.kind === 'cell') record('cell', `${event.action} · ${event.column} = ${String(event.value)}`);
      else if (event.kind === 'item') record('item', `${event.action} · row ${event.row.id}`);
      else if (event.kind === 'row') record('row', `${event.gesture} · row ${event.row.id}`);
      else if (event.kind === 'global') record('global', event.action);
      else if (event.kind === 'filter') record('filter', String(event.query) || '(cleared)');
      else if (event.kind === 'page') record('page', `${event.reason} · ${JSON.stringify(event.query)}`);
      else record('columns', `${event.reason} · ${(event.preferences.hidden ?? []).length} hidden`);
    },
  });

  /**
   * Standing in for the server.
   *
   * Reads the plugin's filter VALUES rather than re-parsing the query it built. The query is for a
   * backend; writing an OData parser here to prove the loop works would prove the wrong thing. What a
   * real caller does with `event.query` is send it.
   */
  const filtered: Computed<DocumentRow[]> = computed<DocumentRow[]>(() => {
    const entries: [string, unknown][] = Object.entries(grid.filters()).filter(
      ([, value]) => value !== undefined && value !== ''
    );
    if (entries.length === 0) return all;
    return all.filter((row) =>
      entries.every(([name, wanted]) => {
        const value: unknown = row[name];
        if (typeof value === 'number' || typeof value === 'boolean') return String(value) === String(wanted);
        return String(value ?? '')
          .toLowerCase()
          .includes(String(wanted).toLowerCase());
      })
    );
  });

  const matched: Computed<number> = computed<number>(() => filtered().length);

  const sorted: Computed<DocumentRow[]> = computed<DocumentRow[]>(() => {
    const { active, direction } = grid.sort();
    const base: DocumentRow[] = filtered();
    if (!active || !direction) return base;
    const dir: number = direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const x: unknown = a[active];
      const y: unknown = b[active];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  });

  const rows: Computed<DocumentRow[]> = computed<DocumentRow[]>(() => {
    const size: number = grid.pageSize();
    const start: number = grid.page() * size;
    return sorted().slice(start, start + size);
  });

  onMount(() => {
    let cancelled: boolean = false;
    // #region table-loading
    fetch(COLUMNS_URL)
      .then((response: Response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json() as Promise<ColumnConfig[]>;
      })
      .then((loaded: ColumnConfig[]) => {
        if (cancelled) return;
        // Setting the signal is the whole handover: the plugin re-validates and rebuilds its columns,
        // and a config that is wrong throws here rather than rendering blank columns.
        configs.set(loaded);
        status.set(`${loaded.length} columns from ${COLUMNS_URL}`);
      })
      .catch((error: unknown) => {
        if (!cancelled) status.set(`failed: ${String(error)}`);
      });
    // #endregion

    // The enums arrive a beat after the columns, the way a second request would. Nothing waits for
    // them: the State column renders blank until they land, then fills in.
    const enumTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (cancelled) return;
      enums.set(
        enumsFromList([
          {
            name: 'DocumentStateType',
            values: [
              { value: 0, displayName: 'Received' },
              { value: 1, displayName: 'Translated' },
              { value: 2, displayName: 'Delivered' },
              { value: 3, displayName: 'Acknowledged' },
            ],
          },
        ])
      );
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(enumTimer);
    };
  });

  return {
    Table,
    Paginator,
    grid,
    rows,
    matched,
    status,
    log,
    clearLog: (): void => {
      log.set([]);
    },
    menuColumns: (): ResolvedColumn[] => grid.allColumns(),
    isOn: (column: ResolvedColumn): boolean => !(grid.preferences().hidden ?? []).includes(column.name),
    toggle: (column: ResolvedColumn): void => grid.toggleColumn(column.name),
    canToggle: (column: ResolvedColumn): boolean => column.availability === 'toggleable',
    reset: (): void => grid.resetColumns(),
    columnsOpen: (): boolean => columnsOpen(),
    toggleColumns: (): void => {
      columnsOpen.set(!columnsOpen());
    },
    tableRows,
    columnsPanel,
  };
}

export { Button, Checkbox, Icon, Demo, CodeTabs };
