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
 * `showIn`, not two inputs a caller has to keep in step by hand. `actionsIn` sets the default for
 * the whole list, so a grid can drop the button column and keep every action in the menu without
 * touching a single entry.
 */

import { computed, effect, signal, type Computed, type Signal } from '@weave-framework/runtime';
import { selectionModel, type SelectionModel } from '@weave-framework/ui/cdk';
import type { TableColumn, SortState } from '@weave-framework/ui/table';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';
import type { CellApi, CellRenderer, CellSource, ResolvedColumn } from './contract.js';
import { BUILT_IN_TYPES, resolveColumns, validateColumns, type ColumnConfig } from './columns.js';
import { BUILT_IN_RENDERERS, NUMERIC_TYPES } from './renderers.js';
import { markRow, type RowEventOptions } from './row-events.js';
import { BUILT_IN_FILTERS, odataQuery, type FilterRenderer, type QueryBuilder } from './filters.js';
import type { ColumnsPanelOptions } from './columns-panel.js';
import type { EnumTables } from './enums.js';

/** What a page of rows is asked for with. `offset` counts rows; `cursor` counts pages. */
export type PageMode = 'offset' | 'cursor';

/** See `CellComponent`: a compiled component is declared as returning `unknown`. */
const asNode = (value: unknown): Node => value as Node;

/** Where a row action appears: as a button in the row, in the row's right-click menu, or both. */
export type ActionPlacement = 'row' | 'menu' | 'both';

/** A row action. The same entry renders in the row and in the row's context menu. */
export interface TableAction<TRow> {
  /** Identifier reported back through `onAction`. */
  action: string;
  icon?: string;
  /** Label, or a translation key when `translate` is set. */
  title?: string;
  translate?: boolean;
  /** Where this one appears, overriding {@link TablePluginOptions.actionsIn} for itself. */
  showIn?: ActionPlacement;
  /** Hide entirely for rows that do not qualify. */
  visible?: (row: TRow) => boolean;
  /** Render, but inert. */
  disabled?: (row: TRow) => boolean;
  /** Checked through the configured `checkRole`. */
  roles?: string[];
}

/**
 * A table-wide action — one control in the grid's own header.
 *
 * Every predicate is a GETTER rather than a value, because this list is live: the bar is built once
 * and re-derived whenever anything it reads changes, so an action can appear when a selection is
 * made, grey out while a request is in flight, and go pressed when what it controls is on. A value
 * read at construction would freeze on the day the table was configured.
 */
export interface GlobalAction {
  /** Identifier reported back through `onAction`. {@link FILTER_ACTION} is reserved. */
  action: string;
  icon?: string;
  /** Label, or a translation key when `translate` is set. Falls back to `action`. */
  title?: string;
  translate?: boolean;
  /** Checked through the configured `checkRole`. */
  roles?: string[];
  /** Drop it from the bar entirely. Read live. */
  visible?: () => boolean;
  /** Drawn, but inert. Read live. */
  disabled?: () => boolean;
  /** Drawn pressed — for a control that has an on/off state, the way the filter toggle does. */
  active?: () => boolean;
  /**
   * Build the control yourself — a `<Select>`, a count badge, anything.
   *
   * Called ONCE per appearance in the bar, so whatever it returns must be a live node in the sense
   * of the cell contract: driven by an effect, not a value read at build time. Returning a Weave
   * component's node is the ordinary case.
   */
  render?: (context: GlobalActionContext) => Node | string;
}

/** What a custom global control is handed. */
export interface GlobalActionContext {
  action: string;
  /** Report this action out through `onAction`, optionally with a payload. */
  fire: (data?: unknown) => void;
  api: CellApi;
}

/**
 * The reserved action name: whoever declares it, its control toggles the filter row.
 *
 * Reserved rather than hard-coded so the built-in can be REPLACED — declare a `filter` action of
 * your own and you get your icon, your title, your position in the bar, and the toggle still works.
 */
export const FILTER_ACTION = 'filter';

/** A global action resolved for rendering — titles translated, predicates read. */
export interface GlobalActionView {
  action: string;
  icon?: string;
  title: string;
  disabled: boolean;
  active: boolean;
}

/** Where an added action goes. Anchors name another action; unmatched anchors append. */
export interface GlobalActionPlacement {
  before?: string;
  after?: string;
}

/** What a plain click on a row does to the selection. */
export type SelectionClick = 'replace' | 'toggle' | 'none';

/**
 * Selecting rows by clicking them, not only through the checkbox column.
 *
 * The checkbox and the click are two different gestures for the same set, and both are wanted: a
 * checkbox is deliberate and survives a mis-aimed pointer, a click is how every file manager and
 * mail client on the machine already behaves. The modifiers follow that same convention, because a
 * grid is not the place to teach someone a new one — plain click replaces, Ctrl (Cmd) adds and
 * removes one, Shift extends a range from the last row touched.
 */
export interface RowSelectionOptions<TRow> {
  /** `'multiple'` by default. `'single'` also drops the select-all box, which would mean nothing. */
  mode?: 'single' | 'multiple';
  /**
   * What an unmodified click does. Default `'replace'`.
   *
   * `'toggle'` is for a grid whose selection is a set being assembled rather than a cursor — it
   * makes every row behave like its own checkbox. `'none'` leaves plain clicks alone and keeps only
   * the modified ones, for a grid where a click already means something else.
   */
  click?: SelectionClick;
  /** Shift extends from the anchor. Default true; ignored in single mode. Needs {@link rows}. */
  range?: boolean;
  /** Ctrl (Cmd) adds and removes one row. Default true; ignored in single mode. */
  additive?: boolean;
  /**
   * The rows as they are RENDERED, in display order — normally the same getter passed to
   * `<Table dataSource>`.
   *
   * A range is a slice of what the reader can see, so it has to be resolved against the order on
   * screen: sorted, filtered, and only the current page. The plugin holds no data of its own and
   * cannot infer this, which is why `range` refuses to be on without it.
   */
  rows?: () => readonly TRow[];
  /** Selected up-front. */
  initial?: readonly TRow[];
  /**
   * Identity, when a row object is not stable — refetched pages hand back equal-but-different
   * objects, and a selection compared by reference silently empties itself on every reload.
   */
  compareWith?: (a: TRow, b: TRow) => boolean;
}

/** Everything a table can report. One handler, one switch. */
export type TableActionEvent<TRow> =
  | { kind: 'cell'; action: string; row: TRow; column: string; value: unknown; data?: unknown }
  | { kind: 'item'; action: string; row: TRow }
  | { kind: 'row'; gesture: 'click' | 'doubleclick'; row: TRow }
  | { kind: 'selection'; rows: TRow[]; added: TRow[]; removed: TRow[] }
  | { kind: 'global'; action: string; data?: unknown }
  | { kind: 'filter'; filters: Readonly<Record<string, unknown>>; query: unknown }
  | { kind: 'page'; page: number; pageSize: number; query: unknown; reason: PageChangeReason }
  | { kind: 'columns'; reason: ColumnChangeReason; preferences: TablePreferences };

export type ColumnChangeReason = 'visibility' | 'order' | 'reset' | 'width' | 'load';

/**
 * Why the page moved. `filter` and `sort` matter to a caller: the page reset itself, so the request
 * about to be made is for page 1 of a different result set, not the next page of the old one.
 */
export type PageChangeReason = 'navigate' | 'size' | 'filter' | 'sort';

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
  /** Column widths in px, by column name. */
  widths?: Record<string, number>;
  pageSize?: number;
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
  /**
   * Where the actions in that list appear by default. `'both'` unless said otherwise.
   *
   * `'menu'` is the interesting one: the buttons disappear and the right-click menu keeps every
   * action — a grid that reads as data rather than as a column of icons repeated down the page. On a
   * wide table that is a column back, and on a dense one it is a lot of visual noise gone.
   *
   * Pass a getter to switch it while the grid is on screen; the actions column comes and goes with
   * it. A per-action `showIn` still wins, so one action can stay a button while the rest move.
   *
   * The cost is discoverability: a right-click menu is invisible until someone tries it. Worth it
   * for an expert tool used all day, a poor trade for a screen someone visits twice a year.
   */
  actionsIn?: ActionPlacement | (() => ActionPlacement);
  /**
   * The table-wide actions, in the grid's own header.
   *
   * Pass a getter when the set itself changes — actions that only exist for a loaded document type,
   * a bulk control that appears with a selection. The bar re-derives from it, so an action added
   * this way arrives without the grid being rebuilt. {@link TablePluginApi.addGlobalAction} is the
   * imperative door to the same list, for a caller that has no signal to hang this on.
   *
   * The filter toggle is one of these too, appended when {@link filters} is on — see
   * {@link FILTER_ACTION}.
   */
  globalActions?: readonly GlobalAction[] | (() => readonly GlobalAction[]);

  onAction?: (event: TableActionEvent<TRow>) => void;

  translate?: (key: string, params?: Record<string, unknown>) => string;
  formatDate?: (value: unknown, format?: string) => string;
  /**
   * Enum tables by name, each a list of `{ value, name }` (a `displayName` wins when present).
   *
   * Pass a getter when they are fetched: an application typically loads its enums once, over the
   * network, and they can easily land AFTER the first page of rows. Read reactively, a late
   * arrival re-renders the enum cells and fills the enum filters; read once, those columns stay
   * blank for the life of the grid with nothing reporting it.
   *
   * `enumsFromList` converts the `[{ name, values }]` shape an API usually returns.
   */
  enums?: EnumTables | (() => EnumTables);
  checkRole?: (roles: string[]) => boolean;

  /** Applied once at construction. Async loading is the caller's business — call `setPreferences`. */
  preferences?: TablePreferences;
  onPreferencesChange?: (preferences: TablePreferences, reason: ColumnChangeReason) => void;

  /** Make every column resizable unless its config says otherwise. */
  resizableColumns?: boolean;

  /**
   * Ask for rows a page at a time.
   *
   * `offset` builds `$top`/`$skip` and needs a {@link total} to know how many pages there are.
   * `cursor` builds `pageNumber` and asks {@link hasNextPage} whether another exists — for an API
   * that will not count its results, which is a good reason not to make `total` mandatory.
   */
  pagination?: boolean;
  pageMode?: PageMode;
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Total row count, read reactively. Required by the paginator in `offset` mode. */
  total?: () => number | undefined;
  /** Whether another page exists, read reactively. Used by `cursor` mode. */
  hasNextPage?: () => boolean;

  /**
   * A class (or classes) for a row, from its data — a failed document tinted red, a new one marked.
   *
   * Applied to the `<tr>` through the same marked cell row events use, so it needs {@link rowEvents}
   * to be on. `<Table>` exposes no per-row class of its own.
   */
  rowClass?: (row: TRow) => string | string[] | undefined;

  /**
   * Offer a filter control per column, in a second header row.
   *
   * The control comes from {@link filterTypes} keyed on the column's type, and a column with
   * `searchDisabled` gets none. Committing one reports through `onAction` as `{ kind: 'filter' }`
   * with both the raw values and the built query — the grid does not filter anything itself, because
   * the rows it was given are a page from a server that has to do the filtering.
   */
  filters?: boolean;
  /**
   * Freeze the actions column to an edge, so the row controls and the table-wide ones stay put
   * while the grid scrolls sideways. `'end'` by default; `false` lets it scroll with the rest.
   *
   * A column that holds the only way to act on a row is the last one that should scroll out of
   * reach — but it is still a choice, because a narrow grid that never scrolls gains nothing from
   * it and pays a stacking context for it.
   */
  stickyActions?: 'start' | 'end' | false;
  /**
   * Width of the actions column in px. Defaults to whatever the icon buttons need.
   *
   * Worth setting when a global action renders something that is not an icon button — a select, a
   * search box — because the default is arithmetic over a 26px control and knows nothing about
   * what a custom `render` puts there.
   */
  actionsColumnWidth?: number;

  /**
   * Open the columns panel on a right-click anywhere in the header. Default true.
   *
   * A right-click rather than a toolbar button because that is where a grid's column controls have
   * always been, and because the header cell you press is the one you are thinking about. Needs
   * {@link rowEvents}, which is where the listener lives.
   */
  columnsMenu?: boolean;
  /** Filter controls by column type. Overrides the built-ins for that type. */
  filterTypes?: Record<string, FilterRenderer>;
  /** Turns the committed values into a query. Default: an OData `$filter` string. */
  buildQuery?: QueryBuilder;
  /** Start with the filter row showing. Default false — it opens from the toolbar. */
  filtersVisible?: boolean;

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
   * Row selection, owned by the plugin so a click can drive it.
   *
   * `true` is the checkbox column on its own — what `<Table selectable>` already gives, but with the
   * model held here so `selected()` and the reported changes come from the same place as everything
   * else. An options object adds the pointer gestures, and those need {@link rowEvents}, since that
   * is where the clicks arrive.
   */
  selection?: boolean | RowSelectionOptions<TRow>;

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
  /** The table-wide actions as they currently stand — roles applied, titles translated. */
  globalActions: Computed<GlobalActionView[]>;
  /**
   * Add a table-wide action after construction, and get back the way to remove it.
   *
   * The disposer rather than a name is what you hold: a caller that adds an action for the lifetime
   * of a mode, a selection or a loaded record has somewhere to put a teardown and nowhere sensible
   * to keep a string. `removeGlobalAction` is there for the cases that do.
   */
  addGlobalAction: (action: GlobalAction, at?: GlobalActionPlacement) => () => void;
  /** Remove an added action by name. Actions declared in the options are not removed this way. */
  removeGlobalAction: (action: string) => void;
  /** The actions that belong in a row's context menu, for the given row. */
  menuActions: (row: TRow) => { action: string; icon?: string; title: string; disabled: boolean }[];
  fire: (event: TableActionEvent<TRow>) => void;
  api: CellApi;

  /** The committed filter values, by column name. */
  filters: Computed<Readonly<Record<string, unknown>>>;
  /** The built query for the current filters — whatever `buildQuery` produced. */
  filterQuery: Computed<unknown>;
  /** Whether a filter row is configured at all. */
  filtersEnabled: () => boolean;
  filtersVisible: () => boolean;
  toggleFilters: () => void;
  clearFilters: () => void;
  /**
   * Feed to `<Table headerRow={{ grid.headerRow() }} />`. Returns `undefined` while the filter row is
   * hidden, which is what makes `<Table>` leave the second row out entirely rather than draw an empty
   * one.
   */
  headerRow: () => ((column: TableColumn<TRow>) => Node | null) | undefined;

  /**
   * Paging. `paginator()` returns `undefined` when there is nothing to draw — paging off, or a
   * `cursor` grid, or a total that has not arrived — which is what makes `@if (pages)` the whole of
   * the caller's decision.
   */
  page: Signal<number>;
  pageSize: Signal<number>;
  paginator: () =>
    | { length: number; pageSize: number; pageIndex: number; pageSizeOptions?: number[] }
    | undefined;
  onPage: (event: { pageIndex: number; pageSize: number }) => void;
  /** The current page as query parameters — `$top`/`$skip`, or `pageNumber`/`itemsOnPage`. */
  pageQuery: Computed<Record<string, unknown>>;
  hasNextPage: () => boolean;

  /** Column widths, for `<Table columnWidths>` / `onColumnResize`. Persisted with the preferences. */
  columnWidths: () => Record<string, number>;
  onColumnResize: (event: { key: string; width: number }) => void;

  /** The columns panel: whether it is open, and where the right-click that opened it landed. */
  columnsOpen: Signal<boolean>;
  columnsMenuAt: () => { x: number; y: number };
  toggleColumns: () => void;
  closeColumns: () => void;
  /** Wiring for the `columnsPanel` action — `<div use:columnsPanel={{ grid.columnsPanel }}>`. */
  columnsPanel: ColumnsPanelOptions;

  /**
   * Wiring for the `tableRows` action — attach it to the element wrapping the grid:
   * `<div use:tableRows={{ grid.rowEvents }}><Table … /></div>`.
   */
  rowEvents: RowEventOptions<TRow>;

  /**
   * The selection, for `<Table selectable={{ … }} selectionMode={{ … }} selection={{ … }} />`.
   *
   * Handing `<Table>` a model rather than letting it build its own is what puts the checkbox and
   * the click on the SAME set — two gestures, one selection. Note that `<Table>` only calls its own
   * `onSelectionChange` for a model it made itself, so changes are reported here instead, through
   * `onAction` like everything else.
   */
  selectable: () => boolean;
  selectionMode: () => 'single' | 'multiple';
  selectionModel: SelectionModel<TRow> | undefined;
  /** The selected rows, read reactively. Empty when selection is off. */
  selected: () => TRow[];
  clearSelection: () => void;

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

  const enumsOption: EnumTables | (() => EnumTables) | undefined = options.enums;
  const enumTables: () => EnumTables =
    typeof enumsOption === 'function' ? enumsOption : (): EnumTables => enumsOption ?? {};

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
  const filterValues: Signal<Record<string, unknown>> = signal<Record<string, unknown>>({});
  const columnsOpen: Signal<boolean> = signal<boolean>(false);
  const columnsAt: Signal<{ x: number; y: number }> = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  const page: Signal<number> = signal<number>(0);
  const pageSize: Signal<number> = signal<number>(options.preferences?.pageSize ?? options.pageSize ?? 25);
  const widths: Signal<Record<string, number>> = signal<Record<string, number>>(options.preferences?.widths ?? {});
  const showFilters: Signal<boolean> = signal<boolean>(options.filtersVisible === true);

  const effectiveOrder = (): string[] => order() ?? defaults().order;
  const effectiveHidden = (): string[] => hidden() ?? defaults().hidden;

  const fire = (event: TableActionEvent<TRow>): void => {
    options.onAction?.(event);
  };

  /**
   * The selection, and the pointer gestures that drive it.
   *
   * `selection: true` is the checkbox column alone; an options object is what turns on clicking. The
   * model lives here rather than inside `<Table>` so that both gestures act on one set — a checkbox
   * tick and a Ctrl-click are the same operation arriving by different routes.
   */
  const gestures: RowSelectionOptions<TRow> | null =
    typeof options.selection === 'object' ? options.selection : null;
  const selectionOn: boolean = options.selection === true || gestures !== null;
  const multipleSelection: boolean = gestures?.mode !== 'single';

  // Refused at construction, where the option was written, rather than failing quietly at the first
  // Shift-click — a range is a slice of the rows in DISPLAY order, and the plugin holds no rows.
  if (gestures && multipleSelection && gestures.range !== false && !gestures.rows) {
    throw new Error(
      '@weave-framework/extra table: `selection.range` needs `selection.rows` — a Shift-click extends ' +
        'across the rows as they are rendered, which only the caller knows. Pass the same getter you ' +
        'give `<Table dataSource>`, or set `range: false`.'
    );
  }
  if (gestures && options.rowEvents !== true) {
    throw new Error(
      '@weave-framework/extra table: selecting rows by clicking needs `rowEvents: true` — that is the ' +
        'listener the clicks arrive on.'
    );
  }

  let selection: SelectionModel<TRow> | undefined;
  if (selectionOn) {
    selection = selectionModel<TRow>({
      multiple: multipleSelection,
      initial: gestures?.initial ? [...gestures.initial] : undefined,
      compareWith: gestures?.compareWith,
      // Reported from here because `<Table>` only calls its own `onSelectionChange` for a model it
      // built itself — hand it one and that callback is never wired. One way out either way.
      onChange: (change): void => {
        fire({
          kind: 'selection',
          rows: selection ? selection.selected() : [],
          added: change.added,
          removed: change.removed,
        });
      },
    });
  }

  /** The row a Shift-click measures from — the last one touched without Shift. */
  let anchor: TRow | null = null;

  const sameRow: (a: TRow, b: TRow) => boolean = gestures?.compareWith ?? ((a, b): boolean => a === b);

  /**
   * A click on the row body.
   *
   * Ignores clicks on anything that is already a control. The checkbox especially: it is the other
   * gesture for this same set, and letting a plain click through would wipe the selection the reader
   * is assembling with it, on the very click that adds to it.
   */
  const selectOnClick = (row: TRow, event: MouseEvent): void => {
    if (!selection || !gestures) return;
    const target: Element | null = event.target instanceof Element ? event.target : null;
    if (target?.closest('.weave-table__select, button, a, input, label, [role="button"]')) return;

    const multiple: boolean = selection.multiple;
    const additive: boolean = multiple && gestures.additive !== false && (event.ctrlKey || event.metaKey);
    const ranged: boolean = multiple && gestures.range !== false && event.shiftKey;

    if (ranged && anchor !== null) {
      const list: readonly TRow[] = gestures.rows ? gestures.rows() : [];
      const from: number = list.findIndex((entry) => sameRow(entry, anchor as TRow));
      const to: number = list.findIndex((entry) => sameRow(entry, row));
      if (from >= 0 && to >= 0) {
        const span: TRow[] = list.slice(Math.min(from, to), Math.max(from, to) + 1);
        // Ctrl+Shift adds the range to what is already selected; Shift alone replaces with it. And
        // the anchor does NOT move, which is what lets a reader stretch and shrink one range by
        // Shift-clicking around without starting over.
        if (additive) selection.select(...span);
        else selection.setSelection(...span);
        return;
      }
      // An anchor that is no longer on the page — a filter changed under it, a page turned — falls
      // through to an ordinary click rather than selecting nothing.
    }

    if (additive) {
      selection.toggle(row);
      anchor = row;
      return;
    }

    const click: SelectionClick = gestures.click ?? 'replace';
    if (click === 'none') return;
    if (click === 'toggle') selection.toggle(row);
    else selection.setSelection(row);
    anchor = row;
  };

  const preferences = computed<TablePreferences>(() => ({
    order: effectiveOrder(),
    hidden: effectiveHidden(),
    sort: sort(),
    widths: widths(),
    pageSize: pageSize(),
  }));

  const pageQuery = computed<Record<string, unknown>>(() =>
    (options.pageMode ?? 'offset') === 'cursor'
      ? { pageNumber: page() + 1, itemsOnPage: pageSize() }
      : { $top: pageSize(), $skip: page() * pageSize() }
  );

  const reportPage = (reason: PageChangeReason): void => {
    fire({ kind: 'page', page: page(), pageSize: pageSize(), query: pageQuery(), reason });
  };

  /**
   * Anything that changes WHICH rows match sends the reader back to page one.
   *
   * Staying on page 7 of a result set that no longer has seven pages is how a filter comes to look
   * like it returned nothing. The reason travels with the event, so a caller can tell this apart
   * from ordinary navigation.
   */
  const resetPage = (reason: PageChangeReason): void => {
    if (!options.pagination || page() === 0) return;
    page.set(0);
    reportPage(reason);
  };

  const reportFilters = (): void => {
    const values: Readonly<Record<string, unknown>> = filterValues();
    fire({ kind: 'filter', filters: values, query: buildQuery(values, base()) });
    resetPage('filter');
  };

  const report = (reason: ColumnChangeReason): void => {
    const next: TablePreferences = preferences();
    options.onPreferencesChange?.(next, reason);
    fire({ kind: 'columns', reason, preferences: next });
  };

  // The shared api has no row to speak of, so its `action` is the HEADER's channel. A cell never
  // sees this one: `apiFor` below rebinds `action` to the row and column it was built for, which is
  // what lets a cell say `api.action('open')` and have the consumer receive both.
  /**
   * Put a row's classes on its `<tr>`.
   *
   * Deferred by a microtask because the cell is built detached — `closest('tr')` finds nothing at
   * creation time. Weave inserts the tree synchronously, so by the time this runs the row is
   * mounted. One microtask per rendered row is cheaper than observing the body for mutations, and
   * it runs exactly once per render rather than once per unrelated DOM change.
   */
  const applyRowClass = (element: Element, row: TRow): void => {
    if (!options.rowClass) return;
    const value: string | string[] | undefined = options.rowClass(row);
    if (!value) return;
    const names: string[] = (Array.isArray(value) ? value : value.split(' ')).filter(Boolean);
    if (names.length === 0) return;
    queueMicrotask(() => {
      element.closest('tr')?.classList.add(...names);
    });
  };

  /**
   * The table's own action area: reload, export, the filter toggle.
   *
   * These belong in the grid's header, not on a strip floating above it — they act on THIS table,
   * and a bar outside its frame reads as page furniture that happens to sit nearby. The trailing
   * sticky column also puts them beside the per-row actions they are the table-wide counterpart of.
   *
   * A fresh element per call, and its state driven by an effect inside it. Both halves matter. The
   * effect, because a header cell is mounted ONCE per column key: a bar whose pressed state was read
   * at build time would freeze, which is exactly how the filter toggle came to look dead. And fresh
   * rather than cached, because the effect belongs to the owner that mounted it — hand the same
   * element back to a later mount and it arrives with its effect already torn down by the disposal
   * of the mount before it, which is a bar that renders once and then never updates again.
   */
  const headerBar = (): Node => {
    const host: HTMLElement = document.createElement('div');
    host.className = 'weave-extra-table__header-actions';
    // The element outlives its CONTENTS. One effect re-fills it whenever the resolved list changes —
    // an action added at runtime, one whose `visible` turned true, a role that arrived with the
    // session. Per-control effects are stopped on the way out: a bar rebuilt a dozen times would
    // otherwise leave a dozen live effects writing into nodes that are no longer on screen.
    effect(() => {
      const items: readonly GlobalAction[] = globalActionList();
      const stops: (() => void)[] = [];
      host.replaceChildren(...items.map((item) => headerControl(item, stops)));
      return (): void => {
        for (const stop of stops) stop();
      };
    });
    return host;
  };

  /**
   * One control in the header bar.
   *
   * A custom `render` is handed straight through — it owns its own reactivity, exactly as a cell
   * does. Otherwise this builds the button as DOM rather than composing `<Button>`, because an icon
   * button here is a 26px square and the component's padding and min-height would have to be fought
   * back down anyway.
   *
   * With no icon it falls back to the title as TEXT. An `<Icon>` given a name the registry does not
   * hold renders nothing at all, and a row of blank squares is indistinguishable from a broken
   * toolbar — which is exactly what a mistyped or simply absent icon name produced here.
   */
  const headerControl = (item: GlobalAction, stops: (() => void)[]): Node => {
    const send = (data?: unknown): void => {
      // The reserved name toggles the row it names, and still reports: a caller that persists its
      // grid state, or logs what was opened, learns about this the same way it learns about
      // everything else. One way out, including for the controls the plugin supplies itself.
      if (item.action === FILTER_ACTION) showFilters.set(!showFilters());
      fire({ kind: 'global', action: item.action, data });
    };

    if (item.render) {
      return asNode(item.render({ action: item.action, api, fire: send }));
    }

    const title: string = titleOf(item);
    const icon: string | undefined = item.icon;
    const button: HTMLButtonElement = document.createElement('button');
    button.type = 'button';
    const base: string = 'weave-extra-table__header-action';
    button.title = title;
    button.setAttribute('aria-label', title);
    if (icon) button.appendChild(asNode(Icon({ name: icon })));
    else button.appendChild(document.createTextNode(title));
    // Pressed and disabled are effects, not values read at build time: this button outlives every
    // render of the header it sits in, so anything read once would freeze on the day it was made.
    stops.push(
      effect(() => {
        const on: boolean = item.active ? item.active() : false;
        const off: boolean = item.disabled ? item.disabled() : false;
        button.className = [base, icon ? '' : `${base}--text`, on ? 'is-active' : ''].filter(Boolean).join(' ');
        button.setAttribute('aria-pressed', String(on));
        button.disabled = off;
      })
    );
    button.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      send();
    });
    return button;
  };

  const filterRenderers: Record<string, FilterRenderer> = {
    ...BUILT_IN_FILTERS,
    ...(options.filterTypes ?? {}),
  };
  const buildQuery: QueryBuilder = options.buildQuery ?? odataQuery;
  const filterQuery0 = computed<Readonly<Record<string, unknown>>>(() => filterValues());
  const filterQuery = computed<unknown>(() => buildQuery(filterValues(), base()));

  const api: CellApi = {
    action: (name: string, _data?: unknown, event?: Event): void => {
      event?.stopPropagation();
      fire({ kind: 'global', action: name });
    },
    t: translate,
    formatDate: (value: unknown, format?: string): string =>
      options.formatDate ? options.formatDate(value, format) : String(value ?? ''),
    enumValue: (enumName: string, value: unknown): string => {
      const table = enumTables()[enumName];
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

  // One list, two renderings, and one place that decides which of them an entry gets. Read live, so
  // a grid can move its actions into the menu and back while it is on screen.
  const placementOption: ActionPlacement | (() => ActionPlacement) | undefined = options.actionsIn;
  const actionsIn: () => ActionPlacement =
    typeof placementOption === 'function' ? placementOption : (): ActionPlacement => placementOption ?? 'both';
  const placementOf = (item: TableAction<TRow>): ActionPlacement => item.showIn ?? actionsIn();
  const showsAsButton = (item: TableAction<TRow>): boolean => placementOf(item) !== 'menu';
  const showsInMenu = (item: TableAction<TRow>): boolean => placementOf(item) !== 'row';

  /**
   * The table-wide actions, resolved.
   *
   * Three sources, one list: what the options declared (read reactively, so a getter can change the
   * set), what was added afterwards through `addGlobalAction`, and the filter toggle the plugin
   * contributes itself. Merging them here — rather than at the point each is rendered — is what
   * lets an added action land BETWEEN two declared ones, and what lets a declared `filter` action
   * replace the built-in instead of sitting next to a duplicate of it.
   *
   * `visible` is applied here, in the list, rather than inside each control: an action that turns
   * invisible has to leave the bar, and a control cannot remove itself from a parent it does not
   * own. Everything that only changes how a control LOOKS — `active`, `disabled` — is read inside
   * that control's own effect instead, so toggling the filter row does not rebuild the bar.
   */
  const declared: readonly GlobalAction[] | (() => readonly GlobalAction[]) | undefined = options.globalActions;
  const declaredActions: () => readonly GlobalAction[] =
    typeof declared === 'function' ? declared : (): readonly GlobalAction[] => declared ?? [];

  const addedActions: Signal<{ action: GlobalAction; at?: GlobalActionPlacement }[]> = signal<
    { action: GlobalAction; at?: GlobalActionPlacement }[]
  >([]);

  const globalActionList = computed<GlobalAction[]>(() => {
    const list: GlobalAction[] = [...declaredActions()];

    for (const entry of addedActions()) {
      const anchor: string | undefined = entry.at?.before ?? entry.at?.after;
      const at: number = anchor ? list.findIndex((item) => item.action === anchor) : -1;
      if (at < 0) list.push(entry.action);
      else list.splice(entry.at?.before ? at : at + 1, 0, entry.action);
    }

    if (options.filters === true && !list.some((item) => item.action === FILTER_ACTION)) {
      list.push({ action: FILTER_ACTION, icon: 'search', title: translate('Filter'), active: showFilters });
    }

    return list.filter((item) => roleOk(item.roles) && (!item.visible || item.visible()));
  });

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
              applyRowClass(content, row);
              return content;
            }
            const carrier: HTMLElement = document.createElement('span');
            carrier.append(document.createTextNode(typeof content === 'string' ? content : ''));
            if (typeof content !== 'string') carrier.append(content);
            markRow(carrier, row);
            applyRowClass(carrier, row);
            return carrier;
          }
          // A wrapper is only paid for by the columns that asked for one — in a real config that is a
          // copy button on a single id column, not a tax on all 348.
          const box: HTMLElement = document.createElement('span');
          box.className = 'weave-extra-table__cell';
          box.append(typeof content === 'string' ? document.createTextNode(content) : content);
          const control: HTMLButtonElement = document.createElement('button');
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
          if (carries) {
            markRow(box, row);
            applyRowClass(box, row);
          }
          return box;
        },
      });
    }

    const rowActions: readonly TableAction<TRow>[] = (options.actions ?? []).filter(
      (item) => showsAsButton(item) && roleOk(item.roles)
    );
    // Read reactively: the column has to APPEAR when the first global action is added to a grid
    // that had none, and widen when the bar grows. Both cost a re-render of the header, which is
    // why nothing that merely changes a control's appearance is read here.
    const headerCount: number = globalActionList().length;
    // The trailing column earns its place from EITHER end: per-row actions in the body, or the
    // table-wide ones in its header. Either alone is reason enough for the column to exist.
    if (rowActions.length > 0 || headerCount > 0) {
      out.push({
        /**
         * The key carries the row-action count, and that is load-bearing.
         *
         * A cell is mounted ONCE per (row, column) key. Re-returning a different `cell` under the
         * same key changes nothing — the keyed diff sees the same column and keeps the DOM it has.
         * So moving the actions into the menu, or a role arriving that adds one, has to arrive as a
         * new column identity or the buttons simply stay on screen. Only the count is in the key,
         * not the action names: it is what changes what a cell RENDERS, and a wider key would remount
         * the column for changes that render the same thing.
         */
        key: `__actions:${rowActions.length}`,
        // Built once and handed back on every render: a header cell is mounted ONCE, because
        // `<Table>` keys its header by column and the key does not change when a control inside it
        // does. A freshly built bar would be discarded, which is why the filter toggle appeared dead
        // — it flipped the signal and the DOM kept the old button. See `headerBar` above.
        header: (): Node => headerBar(),
        width: options.actionsColumnWidth ?? Math.max(48, Math.max(rowActions.length, headerCount) * 34),
        sticky: options.stickyActions === false ? undefined : (options.stickyActions ?? 'end'),
        cell: (row: TRow): Node => {
          const box: HTMLElement = document.createElement('div');
          box.className = 'weave-extra-table__actions';
          for (const item of rowActions) {
            if (item.visible && !item.visible(row)) continue;
            const disabled: boolean = item.disabled ? item.disabled(row) : false;
            const button: Node = Button(
              { variant: 'icon', label: titleOf(item), disabled },
              { default: (): Node => (item.icon ? Icon({ name: item.icon }) : document.createTextNode(titleOf(item))) }
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
      resetPage('sort');
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
      if (next.widths) widths.set(next.widths);
      if (next.pageSize) pageSize.set(next.pageSize);
      report('load');
    },
    preferences,
    globalActions: computed<GlobalActionView[]>(() =>
      globalActionList().map((item) => ({
        action: item.action,
        icon: item.icon,
        title: titleOf(item),
        disabled: item.disabled ? item.disabled() : false,
        active: item.active ? item.active() : false,
      }))
    ),
    addGlobalAction: (action: GlobalAction, at?: GlobalActionPlacement): (() => void) => {
      const entry: { action: GlobalAction; at?: GlobalActionPlacement } = { action, at };
      addedActions.set([...addedActions(), entry]);
      // Identity, not name: two calls may legitimately add the same action name — a mode that
      // re-adds its control before the previous owner has torn down — and removing by name would
      // take the wrong one.
      return (): void => {
        addedActions.set(addedActions().filter((item) => item !== entry));
      };
    },
    removeGlobalAction: (action: string): void => {
      addedActions.set(addedActions().filter((item) => item.action.action !== action));
    },
    menuActions: (row: TRow) =>
      (options.actions ?? [])
        .filter((item) => showsInMenu(item) && roleOk(item.roles))
        .filter((item) => !item.visible || item.visible(row))
        .map((item) => ({
          action: item.action,
          icon: item.icon,
          title: titleOf(item),
          disabled: item.disabled ? item.disabled(row) : false,
        })),
    filters: filterQuery0,
    filterQuery,
    filtersEnabled: (): boolean => options.filters === true,
    filtersVisible: (): boolean => options.filters === true && showFilters(),
    toggleFilters: (): void => {
      showFilters.set(!showFilters());
    },
    clearFilters: (): void => {
      filterValues.set({});
      reportFilters();
    },
    headerRow: () => {
      if (options.filters !== true || !showFilters()) return undefined;
      return (column: TableColumn<TRow>): Node | null => {
        const resolved: ResolvedColumn | undefined = base().find((entry) => entry.name === column.key);
        if (!resolved || !resolved.filterable) return null;
        const render: FilterRenderer | undefined = filterRenderers[resolved.type];
        if (!render) return null;
        return render({
          column: resolved,
          value: (): unknown => filterValues()[resolved.name],
          // The getter itself, not a snapshot — enum tables routinely arrive after this row exists.
          enums: enumTables,
          api,
          commit: (next: unknown): void => {
            const merged: Record<string, unknown> = { ...filterValues() };
            if (next === undefined || next === '') delete merged[resolved.name];
            else merged[resolved.name] = next;
            filterValues.set(merged);
            reportFilters();
          },
        });
      };
    },
    page,
    pageSize,
    paginator: () => {
      if (!options.pagination) return undefined;
      const length: number | undefined = options.total?.();
      if (length == null) return undefined; // cursor mode, or a total that has not arrived yet
      return { length, pageSize: pageSize(), pageIndex: page(), pageSizeOptions: options.pageSizeOptions };
    },
    onPage: ({ pageIndex, pageSize: size }: { pageIndex: number; pageSize: number }): void => {
      const sizeChanged: boolean = size !== pageSize();
      pageSize.set(size);
      // A bigger page makes the old index point somewhere else entirely, so a size change starts
      // over rather than trying to keep the reader where they were.
      page.set(sizeChanged ? 0 : pageIndex);
      reportPage(sizeChanged ? 'size' : 'navigate');
    },
    pageQuery,
    hasNextPage: (): boolean => options.hasNextPage?.() ?? false,

    columnWidths: (): Record<string, number> => widths(),
    onColumnResize: ({ key, width }: { key: string; width: number }): void => {
      widths.set({ ...widths(), [key]: width });
      report('width');
    },

    columnsOpen,
    columnsMenuAt: (): { x: number; y: number } => columnsAt(),
    toggleColumns: (): void => {
      columnsOpen.set(!columnsOpen());
    },
    closeColumns: (): void => {
      columnsOpen.set(false);
    },

    columnsPanel: {
      onReorder: (names: string[]): void => {
        order.set(names);
        report('order');
      },
      onDismiss: (): void => {
        columnsOpen.set(false);
      },
    },
    fire,
    api,
    rowEvents: {
      // Selection first, then the report: a consumer's `onAction` for the click should be able to
      // read `grid.selected()` and see the state the click just produced, not the one before it.
      onRowClick: (row: TRow, event: MouseEvent): void => {
        selectOnClick(row, event);
        fire({ kind: 'row', gesture: 'click', row });
      },
      // Shift-clicking text starts a browser range selection, so a grid that ranges with Shift would
      // paint half its rows blue on the way. Killed at mousedown, where it starts.
      preventTextSelection: gestures !== null && multipleSelection && gestures.range !== false,
      onRowDoubleClick: (row: TRow): void => fire({ kind: 'row', gesture: 'doubleclick', row }),
      onHeaderContextMenu: (position: { x: number; y: number }): void => {
        if (options.columnsMenu === false) return;
        columnsAt.set(position);
        columnsOpen.set(true);
      },
      menuItems: (row: TRow) =>
        (options.actions ?? [])
          .filter((item) => showsInMenu(item) && roleOk(item.roles))
          .filter((item) => !item.visible || item.visible(row))
          .map((item) => ({
            value: item.action,
            label: titleOf(item),
            disabled: item.disabled ? item.disabled(row) : false,
          })),
      onMenuSelect: (action: string, row: TRow): void => fire({ kind: 'item', action, row }),
    },
    selectable: (): boolean => selectionOn,
    selectionMode: (): 'single' | 'multiple' => (multipleSelection ? 'multiple' : 'single'),
    selectionModel: selection,
    selected: (): TRow[] => (selection ? selection.selected() : []),
    clearSelection: (): void => {
      selection?.clear();
      anchor = null;
    },
    virtual: (): boolean => options.virtual === true,
    rowHeight: (): number | undefined => options.rowHeight,
    overscan: (): number | undefined => options.overscan,
    maxHeight: (): number | string | undefined => options.maxHeight,
  };
}
