/**
 * One feature, one grid, one snippet — the table plugin taken apart.
 *
 * The `table` page is the plugin ASSEMBLED: everything at once, the way a real screen uses it. That
 * is the right shape for judging whether the parts belong together, and the wrong shape for learning
 * any one of them, because every line on it is entangled with nine others.
 *
 * So this page is the opposite. Each section below configures its own `tablePlugin` for exactly one
 * feature and nothing else, over the same eight rows, and each snippet is complete: no shared
 * helper to go and look up, no "…as above". A reader should be able to copy one block and have it
 * run. That costs some repetition between the sections, and the repetition is the point.
 *
 * Every block is lifted from this file by `tools/gen-snippets.mjs`, so what is shown is what runs.
 */

import { computed, effect, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Button from '@weave-framework/ui/button';
import Checkbox from '@weave-framework/ui/checkbox';
import Icon from '@weave-framework/ui/icon';
import Paginator from '@weave-framework/ui/paginator';
import {
  tablePlugin,
  tableRows,
  columnsPanel,
  FILTER_ACTION,
  type ActionPlacement,
  type CellProps,
  type CellRenderer,
  type ColumnConfig,
  type EnumTables,
  type GlobalAction,
  type ResolvedColumn,
  type TableActionEvent,
  type TablePluginApi,
  type TablePreferences,
} from '@weave-framework/extra/plugins/table';
import Demo from '../lib/demo/demo.js';
import CodeTabs from '../lib/code-tabs/code-tabs.js';

/** The eight rows every section on this page renders. Small on purpose: the code is the subject. */
export interface Item extends Record<string, unknown> {
  id: number;
  name: string;
  owner: string;
  state: number;
  ready: boolean;
  amount: number;
  created: number;
  secret: string;
}

const OWNERS: string[] = ['Ana', 'Bram', 'Cleo', 'Dov'];

const ITEMS: Item[] = Array.from({ length: 8 }, (_, i) => ({
  id: 100 + i,
  name: `Item ${String.fromCharCode(65 + i)}`,
  owner: OWNERS[i % OWNERS.length],
  state: i % 3,
  ready: i % 2 === 0,
  amount: (i + 1) * 12.5,
  created: 1750000000000 + i * 86_400_000,
  secret: 'internal',
}));

const trackItem = (row: Item): number => row.id;

export interface RecipesContext {
  Table: typeof Table;
  Paginator: typeof Paginator;
  Button: typeof Button;
  Checkbox: typeof Checkbox;
  Icon: typeof Icon;
  Demo: typeof Demo;
  CodeTabs: typeof CodeTabs;
  items: Item[];
  trackItem: typeof trackItem;
  tableRows: typeof tableRows;
  columnsPanel: typeof columnsPanel;

  minimal: TablePluginApi<Item>;

  cells: TablePluginApi<Item>;

  actions: TablePluginApi<Item>;
  actionsLast: () => string;
  actionsPlacement: () => ActionPlacement;
  toggleActionsPlacement: () => void;

  global: TablePluginApi<Item>;
  globalLast: () => string;
  globalBusy: () => boolean;
  toggleGlobalBusy: () => void;
  globalExtra: () => boolean;
  toggleGlobalExtra: () => void;

  filters: TablePluginApi<Item>;
  filterRows: Computed<Item[]>;
  filterQuery: () => string;

  selection: TablePluginApi<Item>;
  selectionNames: () => string;

  paging: TablePluginApi<Item>;
  pageRows: Computed<Item[]>;

  columns: TablePluginApi<Item>;
  columnsPrefs: () => string;
  columnsPanelStyle: () => string;
  columnsIsOn: (column: ResolvedColumn) => boolean;

  roles: TablePluginApi<Item>;
  roleName: () => string;
  toggleRole: () => void;

  enums: TablePluginApi<Item>;
  enumsLoaded: () => boolean;
  loadEnums: () => void;
}

export function setup(): RecipesContext {
  /* ─────────────────────────── 1. the smallest grid ─────────────────────────── */
  // #region recipe-minimal
  const minimal: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'id', type: 'integer', title: 'Id', width: 70 },
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'amount', type: 'number', title: 'Amount' },
      { name: 'created', type: 'timestamp', title: 'Created' },
    ],
    formatDate: (value: unknown): string => new Date(value as number).toISOString().slice(0, 10),
  });
  // #endregion

  /* ─────────────────────────── 2. a cell type of your own ─────────────────────────── */
  // #region recipe-cells
  /** A cell as a plain function — cheapest when there is nothing to compose. */
  const money: CellRenderer<Item> = ({ value, column }): string => {
    const currency: string = (column.options.currency as string) ?? 'EUR';
    return value == null ? '' : `${Number(value).toFixed(2)} ${currency}`;
  };

  /** A cell as an element, for anything that needs markup. */
  const chip: CellRenderer<Item> = ({ value }: CellProps<Item>): Node => {
    const span: HTMLElement = document.createElement('span');
    span.className = value === true ? 'pill pill--on' : 'pill';
    span.textContent = value === true ? 'ready' : 'waiting';
    return span;
  };

  const cells: TablePluginApi<Item> = tablePlugin<Item>({
    // The type names below are what a column's `"type"` refers to.
    cells: { money, chip },
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      // Anything the entry carries beyond the base keys arrives as `column.options`.
      { name: 'amount', type: 'money', title: 'Amount', currency: 'USD' },
      { name: 'ready', type: 'chip', title: 'State' },
    ],
  });
  // #endregion

  /* ─────────────────────────── 3. row actions ─────────────────────────── */
  // #region recipe-actions
  const actionsLast: Signal<string> = signal<string>('nothing yet');
  const actionsPlacement: Signal<ActionPlacement> = signal<ActionPlacement>('both');

  const actions: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
    ],
    // The listener the context menu lives on. Without it there is no menu.
    rowEvents: true,
    // 'both' (the default), 'row', or 'menu' — a getter, so it can change while the grid runs.
    actionsIn: (): ActionPlacement => actionsPlacement(),
    actions: [
      { action: 'open', icon: 'eye', title: 'Open' },
      // Only offered for the rows that qualify.
      { action: 'send', icon: 'send', title: 'Send', visible: (row: Item): boolean => row.ready },
      // Rendered, but inert.
      { action: 'lock', icon: 'lock', title: 'Lock', disabled: (row: Item): boolean => !row.ready },
      // Menu-only whatever `actionsIn` says.
      { action: 'delete', icon: 'trash-2', title: 'Delete', showIn: 'menu' },
    ],
    onAction: (event: TableActionEvent<Item>): void => {
      if (event.kind === 'item') actionsLast.set(`${event.action} · ${event.row.name}`);
    },
  });
  // #endregion

  /* ─────────────────────────── 4. global actions ─────────────────────────── */
  // #region recipe-global
  const globalLast: Signal<string> = signal<string>('nothing yet');
  const globalBusy: Signal<boolean> = signal<boolean>(false);
  const globalCount: Computed<number> = computed<number>(() => ITEMS.filter((row) => row.ready).length);

  const global: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
    ],
    // A getter, so the list itself is live. Every predicate is a getter too.
    globalActions: (): GlobalAction[] => [
      { action: 'reload', title: 'Reload', disabled: (): boolean => globalBusy() },
      { action: 'export', icon: 'cloud-download', title: 'Export', disabled: (): boolean => globalBusy() },
      {
        // A control that is not a button. Built ONCE, so it has to be a live node.
        action: 'ready-count',
        render: (): Node => {
          const box: HTMLElement = document.createElement('span');
          box.className = 'grid__badge';
          const text: Text = document.createTextNode('');
          effect(() => {
            text.nodeValue = `${globalCount()} ready`;
          });
          box.append(text);
          return box;
        },
      },
    ],
    actionsColumnWidth: 190,
    onAction: (event: TableActionEvent<Item>): void => {
      if (event.kind === 'global') globalLast.set(event.action);
    },
  });

  /**
   * Added after construction — the door for a caller with no signal to hang it on.
   *
   * The disposer is what you hold, not the name: an action that belongs to a mode or a loaded record
   * has somewhere to put a teardown and nowhere sensible to keep a string. `before` anchors it in
   * front of another action rather than appending.
   */
  const globalExtra: Signal<boolean> = signal<boolean>(false);
  let dropArchive: (() => void) | null = null;

  const toggleGlobalExtra = (): void => {
    if (dropArchive) {
      dropArchive();
      dropArchive = null;
      globalExtra.set(false);
      return;
    }
    dropArchive = global.addGlobalAction(
      { action: 'archive', icon: 'package', title: 'Archive', disabled: (): boolean => globalBusy() },
      { before: 'export' }
    );
    globalExtra.set(true);
  };
  // #endregion

  /* ─────────────────────────── 5. filters ─────────────────────────── */
  // #region recipe-filters
  const filters: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
      // No filter control for this one.
      { name: 'amount', type: 'number', title: 'Amount', searchDisabled: true },
    ],
    filters: true,
    // Start with the row open. Without this it opens from the toggle in the header.
    filtersVisible: true,
    onAction: (event: TableActionEvent<Item>): void => {
      // The plugin filters NOTHING itself — it reports the query, and this is where a fetch goes.
      if (event.kind === 'filter') console.log('query:', event.query);
    },
  });

  /** Standing in for the server: apply the committed values to the rows this page holds. */
  const filterRows: Computed<Item[]> = computed<Item[]>(() => {
    const committed: [string, unknown][] = Object.entries(filters.filters()).filter(
      ([, value]) => value !== undefined && value !== ''
    );
    if (committed.length === 0) return ITEMS;
    return ITEMS.filter((row) =>
      committed.every(([name, wanted]) =>
        String(row[name] ?? '')
          .toLowerCase()
          .includes(String(wanted).toLowerCase())
      )
    );
  });
  // #endregion

  /* ─────────────────────────── 6. selection ─────────────────────────── */
  // #region recipe-selection
  const selectionRows: Computed<Item[]> = computed<Item[]>(() => ITEMS);

  const selection: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
    ],
    // Clicks arrive on this listener, so selecting by click needs it.
    rowEvents: true,
    selection: {
      // The rows AS DISPLAYED — a Shift range is a slice of what the reader can see.
      rows: (): readonly Item[] => selectionRows(),
      compareWith: (a: Item, b: Item): boolean => a.id === b.id,
      // Defaults, spelled out: click replaces, Ctrl adds, Shift extends.
      click: 'replace',
      additive: true,
      range: true,
    },
  });
  // #endregion

  /* ─────────────────────────── 7. pagination ─────────────────────────── */
  // #region recipe-paging
  const paging: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'id', type: 'integer', title: 'Id', width: 70 },
      { name: 'name', type: 'string', title: 'Name' },
    ],
    pagination: true,
    pageMode: 'offset',
    pageSize: 3,
    pageSizeOptions: [3, 5, 8],
    total: (): number => ITEMS.length,
    onAction: (event: TableActionEvent<Item>): void => {
      // event.query is { $top, $skip } here, or { pageNumber, itemsOnPage } in cursor mode.
      if (event.kind === 'page') console.log(event.reason, event.query);
    },
  });

  const pageRows: Computed<Item[]> = computed<Item[]>(() => {
    const size: number = paging.pageSize();
    const start: number = paging.page() * size;
    return ITEMS.slice(start, start + size);
  });
  // #endregion

  /* ─────────────────────────── 8. the columns menu ─────────────────────────── */
  // #region recipe-columns
  const columnsPrefs: Signal<string> = signal<string>('{}');

  const columns: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
      { name: 'amount', type: 'number', title: 'Amount' },
      // In the grid, but not offered in the menu — the reader cannot switch it off.
      { name: 'ready', type: 'boolean', title: 'Ready', hideInMenu: true },
      // Never rendered. Still in the row, for other columns to read.
      { name: 'secret', type: 'string', title: 'Secret', hidden: true },
    ],
    // Right-click the header. This is where that listener lives.
    rowEvents: true,
    resizableColumns: true,
    onPreferencesChange: (preferences: TablePreferences): void => {
      // Where a `localStorage.setItem` or a settings-service call goes.
      columnsPrefs.set(JSON.stringify(preferences, null, 1));
    },
  });
  // #endregion

  /* ─────────────────────────── 9. roles ─────────────────────────── */
  // #region recipe-roles
  const roleName: Signal<string> = signal<string>('Viewer');

  const roles: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'owner', type: 'string', title: 'Owner' },
      // Dropped entirely — not hidden — for a viewer without the role, so it cannot be
      // switched back on from the columns menu.
      { name: 'secret', type: 'string', title: 'Secret', roles: ['Admin'] },
    ],
    rowEvents: true,
    actions: [
      { action: 'open', icon: 'eye', title: 'Open' },
      { action: 'purge', icon: 'flame', title: 'Purge', roles: ['Admin'] },
    ],
    checkRole: (wanted: string[]): boolean => wanted.includes(roleName()),
  });
  // #endregion

  /* ─────────────────────────── 10. enums that arrive late ─────────────────────────── */
  // #region recipe-enums
  const enumTables: Signal<EnumTables> = signal<EnumTables>({});

  const enums: TablePluginApi<Item> = tablePlugin<Item>({
    columns: [
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'state', type: 'enum', title: 'State', enum: 'ItemState' },
    ],
    // A GETTER. Read once, a table that arrives later would leave the column blank for good.
    enums: (): EnumTables => enumTables(),
    filters: true,
    filtersVisible: true,
  });

  const loadEnums = (): void => {
    enumTables.set({
      ItemState: [
        { value: 0, displayName: 'Draft' },
        { value: 1, displayName: 'Sent' },
        { value: 2, displayName: 'Done' },
      ],
    });
  };
  // #endregion

  // The `roles` grid resolves its columns against `checkRole`, which reads a signal — nothing else
  // to do, the column and the action come and go with it.
  const toggleRole = (): void => {
    roleName.set(roleName() === 'Viewer' ? 'Admin' : 'Viewer');
  };

  return {
    Table,
    Paginator,
    Button,
    Checkbox,
    Icon,
    Demo,
    CodeTabs,
    items: ITEMS,
    trackItem,
    tableRows,
    columnsPanel,

    minimal,

    cells,

    actions,
    actionsLast,
    actionsPlacement,
    toggleActionsPlacement: (): void => {
      actionsPlacement.set(actionsPlacement() === 'both' ? 'menu' : 'both');
    },

    global,
    globalLast,
    globalBusy,
    toggleGlobalBusy: (): void => {
      globalBusy.set(!globalBusy());
    },
    globalExtra,
    toggleGlobalExtra,

    filters,
    filterRows,
    filterQuery: (): string => String(filters.filterQuery() || '(nothing committed)'),

    selection,
    selectionNames: (): string =>
      selection.selected().length === 0
        ? 'nothing selected'
        : selection
            .selected()
            .map((row) => row.name)
            .join(', '),

    paging,
    pageRows,

    columns,
    columnsPrefs,
    columnsPanelStyle: (): string => {
      const at: { x: number; y: number } = columns.columnsMenuAt();
      const top: number = Math.min(at.y, Math.max(8, window.innerHeight - 320));
      return `left:${at.x}px; top:${top}px`;
    },
    columnsIsOn: (column: ResolvedColumn): boolean =>
      !(columns.preferences().hidden ?? []).includes(column.name),

    roles,
    roleName,
    toggleRole,

    enums,
    enumsLoaded: (): boolean => Object.keys(enumTables()).length > 0,
    loadEnums,
  };
}
