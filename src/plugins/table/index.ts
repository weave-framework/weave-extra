/**
 * `@weave-framework/extra/plugins/table` — drive a Weave `<Table>` from a column configuration, with
 * cell types you can supply yourself as ordinary Weave components.
 *
 * See `contract.ts` for the rules a cell must follow; they are the whole of what makes a cell from
 * one screen safe to drop into another.
 */

export { tablePlugin } from './table-plugin.js';
export type {
  TableAction,
  TableActionEvent,
  TablePreferences,
  TablePluginApi,
  TablePluginOptions,
  ColumnChangeReason,
  PageChangeReason,
  PageMode,
} from './table-plugin.js';

export type {
  CellApi,
  CellProps,
  CellRenderer,
  ColumnAvailability,
  HeaderProps,
  HeaderRenderer,
  ResolvedColumn,
} from './contract.js';

export type {
  BooleanColumnConfig,
  BuiltInColumnConfig,
  ColumnConfig,
  ColumnConfigBase,
  CustomColumnConfig,
  EnumColumnConfig,
  IconColumnConfig,
  NumberColumnConfig,
  StringColumnConfig,
  TimestampColumnConfig,
} from './columns.js';
export { BUILT_IN_TYPES, resolveColumns, validateColumns } from './columns.js';
export { BUILT_IN_RENDERERS } from './renderers.js';

export { enumsFromList } from './enums.js';
export type { EnumEntry, EnumTables, EnumList } from './enums.js';

export { BUILT_IN_FILTERS, odataQuery, rawQuery } from './filters.js';
export type { FilterProps, FilterRenderer, QueryBuilder } from './filters.js';

export { columnsPanel, COLUMN_ATTR, HANDLE_ATTR, DRAGGING_CLASS, DROP_TARGET_CLASS } from './columns-panel.js';
export type { ColumnsPanelOptions } from './columns-panel.js';

export { tableRows, rowFromEvent, markRow, ROW_MARKER } from './row-events.js';
export type { RowEventOptions } from './row-events.js';
