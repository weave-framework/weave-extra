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

import { effect, signal, type Signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Select from '@weave-framework/ui/select';
import type { CellApi, ResolvedColumn } from './contract.js';
import type { EnumTables } from './enums.js';

/** See `CellComponent`: a compiled component is declared as returning `unknown`. */
const asNode = (value: unknown): Node => value as Node;

export interface FilterProps {
  column: ResolvedColumn;
  /**
   * The committed value for this column, read LIVE.
   *
   * A getter rather than a snapshot because the filter row is deliberately not re-rendered when a
   * value is committed — re-rendering it would take the focus and the caret out of whatever is
   * being typed. A control that needs to show the committed state therefore has to read it as it
   * changes, or it drifts: picking a value while the control still says "All", and clearing the
   * filter while the control still shows what was cleared.
   */
  value: () => unknown;
  /** Apply a value for this column. Pass `undefined` or `''` to clear it. */
  commit: (value: unknown) => void;
  api: CellApi;
  /**
   * Enum tables, read LIVE — for a type that resolves values against one.
   *
   * A getter for the same reason the enum CELL is a live node: the tables come over the network and
   * routinely land after the filter row has been rendered. Read once, an enum filter built before
   * they arrived holds an empty option list forever — and `<Select>` refuses to open with no
   * options, so the control is not merely stale, it is dead.
   */
  enums?: () => EnumTables;
}

/** A filter control. Return `null` for a column that should have none. */
export type FilterRenderer = (props: FilterProps) => Node | null;

interface Option {
  value: string;
  label: string;
}

const FILTER_CLASS = 'weave-extra-table__filter';

/**
 * A text-ish box that commits on Enter.
 *
 * The value prop is a getter over a DRAFT signal that tracks every keystroke — not over the committed
 * filter. Two different things need it, and only this split serves both:
 *
 *   - the clear affordance. `<Input>` decides whether to draw its `×` from `props.value`, so a static
 *     value means the button never appears however much you type — which is exactly why the select had
 *     one and the box did not.
 *   - the caret. `<Input>` never writes its value prop BACK to the field (its only DOM write is inside
 *     its own clear), so a live getter here cannot move the caret. That is what makes this safe, and
 *     it is worth stating, because the same trick on a component that did write back would fight the
 *     person typing.
 *
 * The draft also resyncs when the committed value changes from elsewhere — `clearFilters`, a loaded
 * preference — but only while the box is unfocused. A box still showing a filter that is no longer in
 * force is worse than one that lags a keystroke.
 */
function textFilter(props: FilterProps, type: string): Node {
  const initial: unknown = props.value();
  const draft: Signal<string> = signal<string>(initial == null ? '' : String(initial));
  const node: Node = asNode(
    Input({
      get value(): string {
        return draft();
      },
      type,
      class: FILTER_CLASS,
      label: `Filter ${props.column.title}`,
      clearable: true,
      onInput: (next: string): void => {
        draft.set(next);
        // A cleared box applies immediately: there is nothing left to press Enter on, and leaving a
        // stale filter in force after the user emptied it reads as a broken control.
        if (next === '') props.commit(undefined);
      },
    })
  );
  node.addEventListener('keydown', (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      const value: string = draft();
      props.commit(value === '' ? undefined : value);
    }
  });
  effect(() => {
    const committed: unknown = props.value();
    const next: string = committed == null ? '' : String(committed);
    const field: HTMLInputElement | null = node instanceof Element ? node.querySelector('input') : null;
    // Never fight the person typing — only a box they are not in gets rewritten.
    if (!field || document.activeElement === field) return;
    if (field.value !== next) field.value = next;
    if (draft() !== next) draft.set(next);
  });
  return node;
}

/**
 * A list to pick one value from — the control for booleans and enums.
 *
 * No type argument, and no option accessors — both for the same reason.
 *
 * `setup` is generic, but the compiler emits the DEFAULT export as
 * `(props: Parameters<typeof setup>[0], slots?) => Node`, and `Parameters<…>` of an uninstantiated
 * generic resolves its parameter to `unknown` — not to the declared default. So `Select<Option>(…)`
 * has nothing to instantiate and is a compile error, and `optionValue: (option: Option) => …` does
 * not fit `(item: unknown) => …` either. Recorded as W-8.
 *
 * The accessors are optional and their defaults read `item.value` and `item.label`, which is exactly
 * what `Option` is — so dropping them changes nothing at runtime and costs no cast. That is the whole
 * workaround: build options in the shape `<Select>` already assumes.
 */
function selectFilter(props: FilterProps, options: () => Option[]): Node {
  return asNode(
    Select({
      /**
       * A getter. `<Select>` reads `props.options` reactively — and refuses to open at all while the
       * list is empty — so an enum filter built before its table arrived would be a control that
       * looks fine and does nothing when pressed.
       */
      get options(): Option[] {
        return options();
      },
      /**
       * A getter, and a string.
       *
       * A getter because `<Select>` reads its value reactively, and passing a plain value makes it a
       * CONTROLLED component whose prop then never changes — so the trigger kept saying "All" after
       * a pick, and kept saying the old value after the filter was cleared. Read live, the trigger
       * always shows what is actually in force.
       *
       * A string because `<Select>` takes `string | T` and emits the VALUE by default (`emit:
       * 'object'` is what returns the object). Give it a value, take a value.
       */
      get value(): string | undefined {
        const current: unknown = props.value();
        return current == null || current === '' ? undefined : String(current);
      },
      class: FILTER_CLASS,
      label: `Filter ${props.column.title}`,
      clearable: true,
      placeholder: 'All',
      onChange: (next: unknown): void => {
        props.commit(typeof next === 'string' && next !== '' ? next : undefined);
      },
    })
  );
}

const text: FilterRenderer = (props: FilterProps): Node => textFilter(props, 'text');
const numeric: FilterRenderer = (props: FilterProps): Node => textFilter(props, 'number');

const boolean: FilterRenderer = (props: FilterProps): Node =>
  selectFilter(props, (): Option[] => [
    { value: 'true', label: props.api.t('True') },
    { value: 'false', label: props.api.t('False') },
  ]);

const enumeration: FilterRenderer = (props: FilterProps): Node => {
  const name: string = props.column.options.enum as string;
  // Resolved on every read, not once: the table may not exist yet when this control is built.
  return selectFilter(props, (): Option[] =>
    (props.enums?.()[name] ?? []).map((entry) => ({
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
