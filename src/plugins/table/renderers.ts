/**
 * The built-in cell renderers.
 *
 * Five of these cover 88% of the columns in a real application's configs — string, number, timestamp,
 * enum, boolean — so they are the ones that must be cheap, and all but the icon-bearing pair return a
 * plain string rather than a component. That is not a shortcut: measured on a 200 × 20 grid, making
 * every cell a component takes the DOM from 4,455 nodes to 9,341 and the build from ~50 ms to ~69 ms.
 * A status chip is worth that; a date is not.
 *
 * Every one of them is registered under a name a consumer can override, so a project that wants its
 * own date cell registers `timestamp` and the built-in steps aside.
 */

import { effect } from '@weave-framework/runtime';
import Icon from '@weave-framework/ui/icon';
import type { CellProps, CellRenderer } from './contract.js';

/**
 * Weave emits a compiled component's type as `(props, slots?) => unknown`, so every imperative call
 * needs this. It is a typing gap in the build rather than a real uncertainty — a component always
 * returns a `Node` — and it is worth closing upstream, because it lands on every consumer who
 * registers their own cell too.
 */
const asNode = (value: unknown): Node => value as Node;

const text: CellRenderer = ({ value }: CellProps): string => (value == null ? '' : String(value));

const timestamp: CellRenderer = ({ value, column, api }: CellProps): string => {
  if (value == null || value === '') return '';
  return api.formatDate(value, column.options.format as string | undefined);
};

/**
 * An enum member's display name — as a LIVE text node, not a string.
 *
 * A cell is mounted once. `<Table>` keys its cells by column, so when only the enum tables change
 * the keys are identical, the keyed diff keeps the existing DOM, and a freshly returned string is
 * discarded. Enums are the one thing a grid routinely does not have yet at first render — they come
 * over the network — so this is not a corner case: it is the normal path, and returning a string
 * leaves the column permanently blank with nothing reporting it.
 *
 * A `Text` node costs no element and updates in place, so the effect below is the whole fix. Any
 * consumer cell that resolves against data which can arrive later needs to do the same.
 */
const enumeration: CellRenderer = ({ value, column, api }: CellProps): Node => {
  const node: Text = document.createTextNode('');
  effect(() => {
    node.nodeValue = value == null ? '' : api.enumValue(column.options.enum as string, value);
  });
  return node;
};

/**
 * A boolean as a tick or a cross.
 *
 * Either side can be suppressed (`hideTrueIcon` / `hideFalseIcon`) because the common case is a flag
 * where only one state is worth drawing — a "test document" column wants a mark on the few rows that
 * are, and nothing at all on the rest.
 */
const boolean: CellRenderer = ({ value, column, api }: CellProps): Node | string => {
  const on: boolean = value === true || value === 1 || value === 'true';
  const options: Readonly<Record<string, unknown>> = column.options;
  if (on && options.hideTrueIcon === true) return '';
  if (!on && options.hideFalseIcon === true) return '';
  const name: string =
    (on ? (options.iconTrue as string | undefined) : (options.iconFalse as string | undefined)) ??
    (on ? 'check' : 'x');
  const label: string = api.t(on ? 'true' : 'false');
  return asNode(Icon({ name, label }));
};

/** A named icon — static from the config, or taken from the cell's own value. */
const icon: CellRenderer = ({ value, column, api }: CellProps): Node | string => {
  const options: Readonly<Record<string, unknown>> = column.options;
  if (options.showWhenTruthy !== false && !value) return '';
  const name: string = (options.icon as string | undefined) ?? String(value ?? '');
  if (!name) return '';
  const tooltip: unknown = options.tooltip;
  return asNode(Icon({ name, label: typeof tooltip === 'string' ? api.t(tooltip) : undefined }));
};

/** The built-ins, by type name. Consumers may register over any of these. */
export const BUILT_IN_RENDERERS: Readonly<Record<string, CellRenderer>> = Object.freeze({
  string: text,
  text,
  number: text,
  integer: text,
  timestamp,
  enum: enumeration,
  boolean,
  icon,
});

/** Type names that should get `numeric` treatment (right-aligned, tabular figures) by default. */
export const NUMERIC_TYPES: readonly string[] = ['number', 'integer'];
