/**
 * The filter row — a control per column, in a second `<thead>` row, and the query it turns into.
 *
 * Two halves on purpose. The **controls** are the library's own `<Input>` and `<Select>`, chosen per
 * column type and overridable per type like cells are. The **query** is a separate, replaceable
 * function: OData by default because that is what the configs this replaces emitted, but a consumer
 * with a different backend supplies their own and nothing else changes. The table has no business
 * knowing which query language it is feeding.
 *
 * Controls are UNCONTROLLED. The DOM holds what is being typed and the plugin reads it on commit
 * (Enter, or a select changing), rather than writing every keystroke into a signal. A controlled
 * filter re-renders the row it lives in, which takes the focus and the caret with it — a filter box
 * you cannot type more than one character into.
 */

import Input from '@weave-framework/ui/input';
import Select from '@weave-framework/ui/select';
import type { CellApi, ResolvedColumn } from './contract.js';

/** See `CellComponent`: a compiled component is declared as returning `unknown`. */
const asNode = (value: unknown): Node => value as Node;

export interface FilterProps {
  column: ResolvedColumn;
  /** The committed value for this column, if any. */
  value: unknown;
  /** Apply a value for this column. Pass `undefined` or `''` to clear it. */
  commit: (value: unknown) => void;
  api: CellApi;
  /** Enum tables, for a type that resolves values against one. */
  enums?: Record<string, readonly { value: unknown; name?: string; displayName?: string }[]>;
}

/** A filter control. Return `null` for a column that should have none. */
export type FilterRenderer = (props: FilterProps) => Node | null;

interface Option {
  value: string;
  label: string;
}

const FILTER_CLASS = 'weave-extra-table__filter';

/** A text-ish box that commits on Enter. */
function textFilter(props: FilterProps, type: string): Node {
  let draft: string = props.value == null ? '' : String(props.value);
  const node: Node = asNode(
    Input({
      value: draft,
      type,
      class: FILTER_CLASS,
      label: `Filter ${props.column.title}`,
      clearable: true,
      onInput: (next: string): void => {
        draft = next;
        // A cleared box applies immediately: there is nothing to press Enter on once it is empty,
        // and leaving a stale filter in force after the user emptied it reads as a broken control.
        if (next === '') props.commit(undefined);
      },
    })
  );
  node.addEventListener('keydown', (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      props.commit(draft === '' ? undefined : draft);
    }
  });
  return node;
}

function selectFilter(props: FilterProps, options: Option[]): Node {
  const current: string = props.value == null ? '' : String(props.value);
  return asNode(
    Select<Option>({
      options,
      value: options.find((option) => option.value === current),
      optionValue: (option: Option): string => option.value,
      optionLabel: (option: Option): string => option.label,
      class: FILTER_CLASS,
      label: `Filter ${props.column.title}`,
      clearable: true,
      placeholder: 'All',
      onChange: (next: unknown): void => {
        const picked: Option | undefined = next as Option | undefined;
        props.commit(picked ? picked.value : undefined);
      },
    })
  );
}

const text: FilterRenderer = (props: FilterProps): Node => textFilter(props, 'text');
const numeric: FilterRenderer = (props: FilterProps): Node => textFilter(props, 'number');

const boolean: FilterRenderer = (props: FilterProps): Node =>
  selectFilter(props, [
    { value: 'true', label: props.api.t('True') },
    { value: 'false', label: props.api.t('False') },
  ]);

const enumeration: FilterRenderer = (props: FilterProps): Node => {
  const name: string = props.column.options.enum as string;
  const table = props.enums?.[name] ?? [];
  return selectFilter(
    props,
    table.map((entry) => ({
      value: String(entry.value),
      label: entry.displayName ?? entry.name ?? String(entry.value),
    }))
  );
};

/** Filter controls by column type. A consumer may register over any of these. */
export const BUILT_IN_FILTERS: Readonly<Record<string, FilterRenderer>> = Object.freeze({
  string: text,
  text,
  number: numeric,
  integer: numeric,
  timestamp: text,
  enum: enumeration,
  boolean,
  icon: (): null => null,
});

/** Turns the committed filter values into whatever the backend wants. */
export type QueryBuilder = (
  filters: Readonly<Record<string, unknown>>,
  columns: readonly ResolvedColumn[]
) => unknown;

/** Values that mean "no filter" — `0` and `false` are filters, `''` and nullish are not. */
function active(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * The default: an OData `$filter` string.
 *
 * Numbers, booleans and enums compare with `eq`; everything else is a substring match, except a
 * single character, which becomes `startswith` — matching one letter anywhere in a large table
 * returns most of it, so the narrower operator is the useful one.
 */
export const odataQuery: QueryBuilder = (filters, columns): string => {
  const byName: Map<string, ResolvedColumn> = new Map(columns.map((column) => [column.name, column]));
  const parts: string[] = [];
  for (const [name, value] of Object.entries(filters)) {
    if (!active(value)) continue;
    const type: string | undefined = byName.get(name)?.type;
    if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'enum') {
      parts.push(`${name} eq ${String(value)}`);
      continue;
    }
    // Doubling the quote is how OData escapes one inside a literal.
    const escaped: string = String(value).replace(/'/g, "''");
    parts.push(escaped.length <= 1 ? `startswith(${name},'${escaped}')` : `contains(${name},'${escaped}')`);
  }
  return parts.join(' and ');
};

/** Hands back the committed values untouched, for a backend that wants its own shape. */
export const rawQuery: QueryBuilder = (filters): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(filters)) if (active(value)) out[name] = value;
  return out;
};
