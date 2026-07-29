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

export { tableRows, rowFromEvent, markRow, ROW_MARKER } from './row-events.js';
export type { RowEventOptions } from './row-events.js';
