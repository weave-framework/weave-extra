/**
 * The table plugin, driven by a column file fetched at runtime.
 *
 * There are two ways to get a `*.columns.json` into a grid, and this page is the second one on
 * purpose, because it is the one with a question in it:
 *
 *   import columns from './documents.columns.json' with { type: 'json' };   // build time
 *   const columns = await fetch('/json/documents.columns.json').then(…);    // runtime
 *
 * The build-time import is bundled and type-checked against `ColumnConfig`, and changing a column
 * means a rebuild. The runtime fetch is what an application with dozens of screens wants — a
 * deployment can change what a grid shows without shipping new code — and it costs the type check,
 * which is why the plugin validates the config itself and throws with everything wrong at once.
 *
 * The plugin takes a GETTER for `columns`, so this page can build it before the file has arrived and
 * simply let the signal fill in. Nothing here waits.
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';
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

function rows(): DocumentRow[] {
  const out: DocumentRow[] = [];
  for (let i: number = 0; i < 24; i++) {
    out.push({
      id: 4200 + i,
      documentFormat: i % 3 === 0 ? 'EDIFACT' : 'X12',
      documentType: ['ORDERS', 'INVOIC', 'DESADV'][i % 3],
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
  data: Signal<DocumentRow[]>;
  status: () => string;
  log: () => LogEntry[];
  clearLog: () => void;
  menuColumns: () => ResolvedColumn[];
  isOn: (column: ResolvedColumn) => boolean;
  toggle: (column: ResolvedColumn) => void;
  reset: () => void;
  format: (value: unknown) => string;
  /**
   * Returned from `setup()`, not merely exported: a `use:` action resolves from the setup context,
   * where a capitalised component tag resolves from the module's exports. Exporting it compiles
   * cleanly and silently attaches nothing.
   */
  tableRows: typeof tableRows;
  columnsPanel: typeof columnsPanel;
  canToggle: (column: ResolvedColumn) => boolean;
}

export function setup(): TablePageContext {
  const configs: Signal<ColumnConfig[]> = signal<ColumnConfig[]>([]);
  const status: Signal<string> = signal<string>('loading…');
  const data: Signal<DocumentRow[]> = signal<DocumentRow[]>(rows());
  const log: Signal<LogEntry[]> = signal<LogEntry[]>([]);
  // Stands in for what a server would report alongside a page.
  const total: Signal<number> = signal<number>(248);
  // Empty at first, on purpose: this is the race a real application has, where the enums come over
  // the network and can land after the first page of rows.
  const enums: Signal<EnumTables> = signal<EnumTables>({});
  let seq: number = 0;

  const record = (kind: string, detail: string): void => {
    seq += 1;
    log.set([{ id: seq, kind, detail }, ...log()].slice(0, 12));
  };

  const grid: TablePluginApi<DocumentRow> = tablePlugin<DocumentRow>({
    // A getter, not an array: the file has not arrived yet, and this page does not wait for it.
    columns: configs,

    // The consumer's own cell types. A Weave component needs no wrapper — it is already the shape a
    // cell renderer has to be.
    cells: { 'status-chip': StatusChip },

    // A getter, so the tables can arrive late and still fill the cells and the filters.
    enums: enums,
    // Only an Admin sees the `internalNote` column. Denied here, so the column is DROPPED rather than
    // hidden — a column nobody may see must not be switchable back on from the columns menu.
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

    // Only the rows in view get rendered. Configuration, not a default: it fixes the row height and
    // rules out an expandable detail row, so it is a choice a grid makes rather than one made for it.
    virtual: true,
    rowHeight: 34,
    maxHeight: 360,

    // Click, double-click and a right-click menu on rows. `<Table>` has none of these; the plugin
    // marks one cell per row and delegates from the wrapper.
    rowEvents: true,

    // A filter control per column, in a second header row. The grid filters nothing itself: the rows
    // it holds are a page from a server, so a commit reports the query and the page is reloaded.
    filters: true,

    // A page at a time. `total` is read reactively because it arrives WITH the rows -- a server
    // reports how many matched only once it has run the query.
    pagination: true,
    pageSize: 25,
    pageSizeOptions: [10, 25, 50],
    total: (): number => total(),

    // A class from the row's own data. Failed documents are tinted; test documents are marked.
    rowClass: (row: DocumentRow): string[] => {
      const names: string[] = [];
      if (row.processingState === 'failed' || row.processingState === 'rejected') names.push('row--bad');
      if (row.testIndicator) names.push('row--test');
      return names;
    },

    // One handler. Everything the grid can report arrives here, with the row in its original shape —
    // no transform step on the way out.
    onAction: (event: TableActionEvent<DocumentRow>): void => {
      if (event.kind === 'cell') record('cell', `${event.action} · ${event.column} = ${String(event.value)}`);
      else if (event.kind === 'item') record('item', `${event.action} · row ${event.row.id}`);
      else if (event.kind === 'row') record('row', `${event.gesture} · row ${event.row.id}`);
      else if (event.kind === 'global') record('global', event.action);
      else if (event.kind === 'filter') record('filter', String(event.query) || '(cleared)');
      else if (event.kind === 'page') record('page', `${event.reason} \u00b7 ${JSON.stringify(event.query)}`);
      else record('columns', `${event.reason} · ${(event.preferences.hidden ?? []).length} hidden`);
    },
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
        status.set(`${loaded.length} column(s) from ${COLUMNS_URL}`);
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
      status.set(`${status()} \u00b7 enums loaded`);
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
    data,
    status,
    log,
    clearLog: (): void => {
      log.set([]);
    },
    // Every rendered column, not only the switchable ones: a pinned column can still be MOVED, and
    // leaving it out of the list would make the order shown here disagree with the grid.
    menuColumns: (): ResolvedColumn[] => grid.allColumns(),
    canToggle: (column: ResolvedColumn): boolean => column.availability === 'toggleable',
    isOn: (column: ResolvedColumn): boolean => !(grid.preferences().hidden ?? []).includes(column.name),
    toggle: (column: ResolvedColumn): void => grid.toggleColumn(column.name),
    reset: (): void => grid.resetColumns(),
    format: (value: unknown): string => JSON.stringify(value),
    tableRows,
    columnsPanel,
  };
}

export { Button, Checkbox, Icon, Demo, CodeTabs };
