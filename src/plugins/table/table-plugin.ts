/**
 * The plugin itself: column configuration in, `<Table>` props out.
 *
 * It deliberately does not wrap or replace `<Table>`. Weave's table already owns sorting, selection,
 * expansion, sticky columns and keyboard-accessible column resizing; a wrapper would have to
 * re-expose all of it and would rot the first time any of it changed. So this is a props factory —
 * you keep rendering `<Table>`, and the plugin decides what its `columns` are.
 *
 * Two things it centralises that were previously scattered:
 *
 * **One way out.** Every action — a control inside a cell, a row action, a header action, a column
 * being switched off — arrives at a single `onAction` with a discriminated payload, carrying the row
 * in its ORIGINAL shape. There is no second mechanism: an action item does not also get called
 * directly, because two parallel paths for the same event is how they drift apart.
 *
 * **One list of actions.** Row actions and the row's context menu are the same array with a
 * `showIn`, not two inputs a caller has to keep in step by hand.
 */

import { computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import type { TableColumn, SortState } from '@weave-framework/ui/table';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';
import type { CellApi, CellRenderer, CellSource, ResolvedColumn } from './contract.js';
import { BUILT_IN_TYPES, resolveColumns, validateColumns, type ColumnConfig } from './columns.js';
import { BUILT_IN_RENDERERS, NUMERIC_TYPES } from './renderers.js';

/** A row action. The same entry renders in the row and in the row's context menu. */
export interface TableAction<TRow> {
  /** Identifier reported back through `onAction`. */
  action: string;
  icon?: string;
  /** Label, or a translation key when `translate` is set. */
  title?: string;
  translate?: boolean;
  /** Where it appears. Default `'both'` — one list, two renderings. */
  showIn?: 'row' | 'menu' | 'both';
  /** Hide entirely for rows that do not qualify. */
  visible?: (row: TRow) => boolean;
  /** Render, but inert. */
  disabled?: (row: TRow) => boolean;
  /** Checked through the configured `checkRole`. */
  roles?: string[];
}

/** Everything a table can report. One handler, one switch. */
export type TableActionEvent<TRow> =
  | { kind: 'cell'; action: string; row: TRow; column: string; value: unknown; data?: unknown }
  | { kind: 'item'; action: string; row: TRow }
  | { kind: 'global'; action: string }
  | { kind: 'columns'; reason: ColumnChangeReason; preferences: TablePreferences };

export type ColumnChangeReason = 'visibility' | 'order' | 'reset' | 'load';

/**
 * Persisted column state. Transport-neutral by design: the plugin never names a storage, it asks for
 * this shape on start and hands it back on change, so localStorage, a settings service and a remote
 * profile are all the same amount of work.
 */
export interface TablePreferences {
  /** Column names in display order. Names absent from the config are ignored on load. */
  order?: string[];
  /** Column names switched off. */
  hidden?: string[];
  sort?: SortState;
}

export interface TablePluginOptions<TRow> {
  /** The authored column configuration — typically a `*.columns.json` loaded as-is. */
  columns: readonly ColumnConfig[];
  /** Cell renderers by type name. A Weave component satisfies the type with no wrapper. */
  cells?: Record<string, CellSource<TRow>>;
  /** Row actions and context-menu entries — one list. */
  actions?: readonly TableAction<TRow>[];
  /** Header actions. */
  globalActions?: readonly Omit<TableAction<TRow>, 'showIn' | 'visible' | 'disabled'>[];

  onAction?: (event: TableActionEvent<TRow>) => void;

  translate?: (key: string, params?: Record<string, unknown>) => string;
  formatDate?: (value: unknown, format?: string) => string;
  /** Enum tables by name, each a list of `{ value, name }` (a `displayName` wins when present). */
  enums?: Record<string, readonly { value: unknown; name?: string; displayName?: string }[]>;
  checkRole?: (roles: string[]) => boolean;

  /** Applied once at construction. Async loading is the caller's business — call `setPreferences`. */
  preferences?: TablePreferences;
  onPreferencesChange?: (preferences: TablePreferences, reason: ColumnChangeReason) => void;

  /** Make every column resizable unless its config says otherwise. */
  resizableColumns?: boolean;
}

export interface TablePluginApi<TRow> {
  /** Visible columns, in the user's order — feed straight to `<Table columns={{ … }} />`. */
  columns: Computed<TableColumn<TRow>[]>;
  /** Every rendered column, for a columns menu. `pinned` entries cannot be switched off. */
  allColumns: Computed<ResolvedColumn[]>;
  sort: Signal<SortState>;
  onSort: (next: SortState) => void;
  toggleColumn: (name: string) => void;
  reorderColumns: (names: string[]) => void;
  resetColumns: () => void;
  /** Replace the whole preference set — the landing point for an async load. */
  setPreferences: (preferences: TablePreferences) => void;
  preferences: Computed<TablePreferences>;
  /** Header actions, resolved against roles. */
  globalActions: Computed<{ action: string; icon?: string; title: string }[]>;
  /** The actions that belong in a row's context menu, for the given row. */
  menuActions: (row: TRow) => { action: string; icon?: string; title: string; disabled: boolean }[];
  fire: (event: TableActionEvent<TRow>) => void;
  api: CellApi;
}

export function tablePlugin<TRow extends Record<string, unknown> = Record<string, unknown>>(
  options: TablePluginOptions<TRow>
): TablePluginApi<TRow> {
  const translate = (key: string, params?: Record<string, unknown>): string =>
    options.translate ? options.translate(key, params) : key;

  // Two casts, both at this one seam: the built-ins are written against a generic row shape, and a
  // registered Weave component is declared as returning `unknown` (see `CellComponent`). Neither is a
  // real uncertainty, and keeping them here means no consumer has to write one.
  const renderers: Record<string, CellRenderer<TRow>> = {
    ...(BUILT_IN_RENDERERS as unknown as Record<string, CellRenderer<TRow>>),
    ...((options.cells ?? {}) as Record<string, CellRenderer<TRow>>),
  };

  // One check, at construction, listing everything wrong at once.
  const knownTypes: string[] = [...new Set([...BUILT_IN_TYPES, ...Object.keys(options.cells ?? {})])];
  validateColumns(options.columns, knownTypes);

  const base: ResolvedColumn[] = resolveColumns(options.columns, translate);
  const defaults: TablePreferences = {
    order: base.map((column) => column.name),
    hidden: base.filter((column) => !column.visible).map((column) => column.name),
  };

  const order: Signal<string[]> = signal<string[]>(options.preferences?.order ?? defaults.order!);
  const hidden: Signal<string[]> = signal<string[]>(options.preferences?.hidden ?? defaults.hidden!);
  const sort: Signal<SortState> = signal<SortState>(options.preferences?.sort ?? { active: null, direction: null });

  const fire = (event: TableActionEvent<TRow>): void => {
    options.onAction?.(event);
  };

  const preferences = computed<TablePreferences>(() => ({
    order: order(),
    hidden: hidden(),
    sort: sort(),
  }));

  const report = (reason: ColumnChangeReason): void => {
    const next: TablePreferences = preferences();
    options.onPreferencesChange?.(next, reason);
    fire({ kind: 'columns', reason, preferences: next });
  };

  // The shared api has no row to speak of, so its `action` is the HEADER's channel. A cell never
  // sees this one: `apiFor` below rebinds `action` to the row and column it was built for, which is
  // what lets a cell say `api.action('open')` and have the consumer receive both.
  const api: CellApi = {
    action: (name: string, _data?: unknown, event?: Event): void => {
      event?.stopPropagation();
      fire({ kind: 'global', action: name });
    },
    t: translate,
    formatDate: (value: unknown, format?: string): string =>
      options.formatDate ? options.formatDate(value, format) : String(value ?? ''),
    enumValue: (enumName: string, value: unknown): string => {
      const table = options.enums?.[enumName];
      const found = table?.find((entry) => entry.value === value);
      return found?.displayName ?? found?.name ?? '';
    },
  };

  /** A per-cell api, so `action()` reports which row and column it came from. */
  const apiFor = (row: TRow, column: ResolvedColumn, value: unknown): CellApi => ({
    ...api,
    action: (name: string, data?: unknown, event?: Event): void => {
      event?.stopPropagation();
      fire({ kind: 'cell', action: name, row, column: column.name, value, data });
    },
  });

  const ordered = computed<ResolvedColumn[]>(() => {
    const index: Map<string, number> = new Map(order().map((name, i) => [name, i]));
    return [...base].sort((a, b) => (index.get(a.name) ?? 1e6) - (index.get(b.name) ?? 1e6));
  });

  const roleOk = (roles?: string[]): boolean => !roles || !options.checkRole || options.checkRole(roles);

  const titleOf = (item: { title?: string; translate?: boolean; action: string }): string =>
    item.translate && item.title ? translate(item.title) : (item.title ?? item.action);

  const columns = computed<TableColumn<TRow>[]>(() => {
    const off: Set<string> = new Set(hidden());
    const out: TableColumn<TRow>[] = [];

    for (const column of ordered()) {
      if (off.has(column.name)) continue;
      const render: CellRenderer<TRow> = renderers[column.type];
      out.push({
        key: column.name,
        header: column.title,
        width: column.width,
        align: column.align,
        numeric: NUMERIC_TYPES.includes(column.type),
        sortable: column.sortable,
        resizable: (column.options.resizable as boolean | undefined) ?? options.resizableColumns,
        cell: (row: TRow): Node | string => {
          const value: unknown = row[column.name];
          return render({ value, row, column, api: apiFor(row, column, value) });
        },
      });
    }

    const rowActions: readonly TableAction<TRow>[] = (options.actions ?? []).filter(
      (item) => item.showIn !== 'menu' && roleOk(item.roles)
    );
    if (rowActions.length > 0) {
      out.push({
        key: '__actions',
        header: '',
        width: Math.max(48, rowActions.length * 40),
        sticky: 'end',
        cell: (row: TRow): Node => {
          const box: HTMLElement = document.createElement('div');
          box.className = 'weave-extra-table__actions';
          for (const item of rowActions) {
            if (item.visible && !item.visible(row)) continue;
            const disabled: boolean = item.disabled ? item.disabled(row) : false;
            const button: Node = Button(
              { variant: 'icon', label: titleOf(item), disabled },
              { default: (): unknown => (item.icon ? Icon({ name: item.icon }) : document.createTextNode(titleOf(item))) }
            ) as Node;
            if (!disabled) {
              button.addEventListener('click', (event: Event) => {
                event.stopPropagation();
                fire({ kind: 'item', action: item.action, row });
              });
            }
            box.appendChild(button);
          }
          return box;
        },
      });
    }

    return out;
  });

  return {
    columns,
    allColumns: ordered,
    sort,
    onSort: (next: SortState): void => {
      sort.set(next);
      report('order');
    },
    toggleColumn: (name: string): void => {
      const column: ResolvedColumn | undefined = base.find((entry) => entry.name === name);
      if (!column || column.availability === 'pinned') return;
      const off: string[] = hidden();
      hidden.set(off.includes(name) ? off.filter((entry) => entry !== name) : [...off, name]);
      report('visibility');
    },
    reorderColumns: (names: string[]): void => {
      order.set(names);
      report('order');
    },
    resetColumns: (): void => {
      order.set(defaults.order!);
      hidden.set(defaults.hidden!);
      sort.set({ active: null, direction: null });
      report('reset');
    },
    setPreferences: (next: TablePreferences): void => {
      if (next.order) order.set(next.order);
      if (next.hidden) hidden.set(next.hidden);
      if (next.sort) sort.set(next.sort);
      report('load');
    },
    preferences,
    globalActions: computed(() =>
      (options.globalActions ?? [])
        .filter((item) => roleOk(item.roles))
        .map((item) => ({ action: item.action, icon: item.icon, title: titleOf(item) }))
    ),
    menuActions: (row: TRow) =>
      (options.actions ?? [])
        .filter((item) => item.showIn !== 'row' && roleOk(item.roles))
        .filter((item) => !item.visible || item.visible(row))
        .map((item) => ({
          action: item.action,
          icon: item.icon,
          title: titleOf(item),
          disabled: item.disabled ? item.disabled(row) : false,
        })),
    fire,
    api,
  };
}
