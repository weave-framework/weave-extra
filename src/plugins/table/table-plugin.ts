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
import { markRow, type RowEventOptions } from './row-events.js';

/** See `CellComponent`: a compiled component is declared as returning `unknown`. */
const asNode = (value: unknown): Node => value as Node;

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
  | { kind: 'row'; gesture: 'click' | 'doubleclick'; row: TRow }
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
  /**
   * The authored column configuration — typically a `*.columns.json` loaded as-is.
   *
   * Pass a getter (a signal, a `resource`, any reactive read) when the file is fetched at runtime:
   * the plugin re-validates and re-resolves whenever it changes, so it is safe to construct with an
   * empty array and hand over the real set once it lands.
   */
  columns: readonly ColumnConfig[] | (() => readonly ColumnConfig[]);
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

  /**
   * Report clicks, double-clicks and a right-click menu on rows.
   *
   * Off by default because it is not free: to get from a clicked `<tr>` back to the row object, the
   * plugin marks one cell per row, and a cell that renders as plain text needs a wrapper element to
   * carry the mark. Roughly 2% more DOM on a 20-column grid — worth it when a grid is interactive,
   * and pointless when it is a read-only report.
   */
  rowEvents?: boolean;

  /**
   * Render only the rows in view instead of the whole page.
   *
   * Worth having as configuration rather than a default because it is a trade, not a free win. It
   * takes the first render of a 1000-row grid from ~482 ms over 46,414 DOM nodes to ~14 ms over 867,
   * and the cost stops following the row count — but it needs {@link maxHeight}, it fixes the row
   * height, and `<Table>` refuses it together with `expandable`, because mapping a scroll offset to a
   * row index cannot survive a detail row of unknown height. A grid with an expandable detail row
   * has to choose.
   *
   * `<Table>` reads this ONCE, at its own setup. Changing it on a mounted grid does nothing: render
   * the two modes as separate `<Table>` instances if a runtime switch is really wanted.
   */
  virtual?: boolean;
  /** Row height in px for {@link virtual} — must match what a row actually renders at. */
  rowHeight?: number;
  /** Rows rendered above and below the viewport in {@link virtual} mode. */
  overscan?: number;
  /** Cap on the body height. Required by {@link virtual}: without one there is no viewport to window. */
  maxHeight?: number | string;
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

  /**
   * Wiring for the `tableRows` action — attach it to the element wrapping the grid:
   * `<div use:tableRows={{ grid.rowEvents }}><Table … /></div>`.
   */
  rowEvents: RowEventOptions<TRow>;

  /**
   * Pass-throughs for `<Table>`. Getters rather than one object because a Weave template has no prop
   * spread — each one is written out on the tag.
   */
  virtual: () => boolean;
  rowHeight: () => number | undefined;
  overscan: () => number | undefined;
  maxHeight: () => number | string | undefined;
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

  const knownTypes: string[] = [...new Set([...BUILT_IN_TYPES, ...Object.keys(options.cells ?? {})])];

  const roleOk = (roles?: string[]): boolean => !roles || !options.checkRole || options.checkRole(roles);

  // Refused here rather than left to `<Table>`, which raises the same thing from inside its own setup
  // — deep in a render, and phrased in its own vocabulary. This fires while the grid is being
  // configured, where the option was actually written.
  if (options.virtual && options.maxHeight == null) {
    throw new Error(
      '@weave-framework/extra table: `virtual` needs `maxHeight` — without one the body grows to fit ' +
        'its rows and there is no viewport to window.'
    );
  }

  /**
   * The configuration, read reactively.
   *
   * A grid's columns commonly arrive from a file — a `*.columns.json` fetched at runtime, so that a
   * deployment can change what a screen shows without a rebuild. That means the plugin cannot resolve
   * them once at construction: it may be built with nothing and handed the real set a moment later.
   * Passing a getter (a signal, a resource, anything that reads reactively) is how that arrives, and
   * everything below derives from it.
   */
  const configs: () => readonly ColumnConfig[] =
    typeof options.columns === 'function' ? options.columns : (): readonly ColumnConfig[] => options.columns as readonly ColumnConfig[];

  // Validated on every change of the source, not once at construction — a config that arrives late is
  // exactly as capable of being wrong as one that was there from the start.
  const base = computed<ResolvedColumn[]>(() => {
    const raw: readonly ColumnConfig[] = configs();
    validateColumns(raw, knownTypes);
    return resolveColumns(raw, translate, (roles: string[]) => roleOk(roles));
  });

  const defaults = computed<Required<Pick<TablePreferences, 'order' | 'hidden'>>>(() => ({
    order: base().map((column) => column.name),
    hidden: base().filter((column) => !column.visible).map((column) => column.name),
  }));

  /**
   * `null` means "nobody has said otherwise" — so the value follows the configuration.
   *
   * Without this distinction a plugin built before its columns arrived would freeze an empty order and
   * an empty hidden set, and every column the file later declared invisible would come up visible.
   */
  const order: Signal<string[] | null> = signal<string[] | null>(options.preferences?.order ?? null);
  const hidden: Signal<string[] | null> = signal<string[] | null>(options.preferences?.hidden ?? null);
  const sort: Signal<SortState> = signal<SortState>(options.preferences?.sort ?? { active: null, direction: null });

  const effectiveOrder = (): string[] => order() ?? defaults().order;
  const effectiveHidden = (): string[] => hidden() ?? defaults().hidden;

  const fire = (event: TableActionEvent<TRow>): void => {
    options.onAction?.(event);
  };

  const preferences = computed<TablePreferences>(() => ({
    order: effectiveOrder(),
    hidden: effectiveHidden(),
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

  /**
   * Config order, overlaid with the user's.
   *
   * A column the saved order has never seen — one added to the file since the preference was stored —
   * sorts after the known ones but KEEPS its position relative to other newcomers, which is why the
   * fallback is offset by the config index rather than being a single large constant for all of them.
   */
  const ordered = computed<ResolvedColumn[]>(() => {
    const index: Map<string, number> = new Map(effectiveOrder().map((name, i) => [name, i]));
    const columnsNow: ResolvedColumn[] = base();
    const rank = (column: ResolvedColumn, i: number): number => index.get(column.name) ?? 1e6 + i;
    return columnsNow
      .map((column, i) => ({ column, key: rank(column, i) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.column);
  });

  const titleOf = (item: { title?: string; translate?: boolean; action: string }): string =>
    item.translate && item.title ? translate(item.title) : (item.title ?? item.action);

  const columns = computed<TableColumn<TRow>[]>(() => {
    const off: Set<string> = new Set(effectiveHidden());
    const out: TableColumn<TRow>[] = [];

    let marker: boolean = options.rowEvents === true;
    for (const column of ordered()) {
      if (off.has(column.name)) continue;
      // The FIRST rendered column carries the row. An element cell takes the mark as an attribute
      // and costs nothing; only a string cell pays for a wrapper to hang it on.
      const carries: boolean = marker;
      marker = false;
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
          const cellApi: CellApi = apiFor(row, column, value);
          const content: Node | string = render({ value, row, column, api: cellApi });
          if (!column.cellAction) {
            if (!carries) return content;
            if (content instanceof Element) {
              markRow(content, row);
              return content;
            }
            const carrier: HTMLElement = document.createElement('span');
            carrier.append(document.createTextNode(typeof content === 'string' ? content : ''));
            if (typeof content !== 'string') carrier.append(content);
            markRow(carrier, row);
            return carrier;
          }
          // A wrapper is only paid for by the columns that asked for one — in a real config that is a
          // copy button on a single id column, not a tax on all 348.
          const box: HTMLElement = document.createElement('span');
          box.className = 'weave-extra-table__cell';
          box.append(typeof content === 'string' ? document.createTextNode(content) : content);
          const control: HTMLElement = document.createElement('button');
          control.type = 'button';
          control.className = 'weave-extra-table__cell-action';
          if (column.cellAction.color) control.style.color = column.cellAction.color;
          if (column.cellAction.tooltip) control.title = column.cellAction.tooltip;
          control.setAttribute('aria-label', column.cellAction.tooltip ?? column.cellAction.action);
          control.append(asNode(Icon({ name: column.cellAction.icon })));
          control.addEventListener('click', (event: Event) => {
            cellApi.action(column.cellAction!.action, undefined, event);
          });
          box.append(control);
          if (carries) markRow(box, row);
          return box;
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
      const column: ResolvedColumn | undefined = base().find((entry) => entry.name === name);
      if (!column || column.availability === 'pinned') return;
      const off: string[] = effectiveHidden();
      hidden.set(off.includes(name) ? off.filter((entry) => entry !== name) : [...off, name]);
      report('visibility');
    },
    reorderColumns: (names: string[]): void => {
      order.set(names);
      report('order');
    },
    // Back to null, not back to a snapshot of the defaults: reset means "follow the configuration
    // again", so a config that changes afterwards is picked up rather than shadowed by a stale copy.
    resetColumns: (): void => {
      order.set(null);
      hidden.set(null);
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
    rowEvents: {
      onRowClick: (row: TRow): void => fire({ kind: 'row', gesture: 'click', row }),
      onRowDoubleClick: (row: TRow): void => fire({ kind: 'row', gesture: 'doubleclick', row }),
      menuItems: (row: TRow) =>
        (options.actions ?? [])
          .filter((item) => item.showIn !== 'row' && roleOk(item.roles))
          .filter((item) => !item.visible || item.visible(row))
          .map((item) => ({
            value: item.action,
            label: titleOf(item),
            disabled: item.disabled ? item.disabled(row) : false,
          })),
      onMenuSelect: (action: string, row: TRow): void => fire({ kind: 'item', action, row }),
    },
    virtual: (): boolean => options.virtual === true,
    rowHeight: (): number | undefined => options.rowHeight,
    overscan: (): number | undefined => options.overscan,
    maxHeight: (): number | string | undefined => options.maxHeight,
  };
}
