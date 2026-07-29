/**
 * Enum tables — the lookup an `enum` column and an `enum` filter resolve values against.
 *
 * Kept as its own small module because enums are the one piece of a grid's configuration that is
 * almost never local. A column file ships with the application; its enums come from the server,
 * usually once at start-up, and reliably AFTER the first page of rows in at least some races. That
 * timing is the whole design constraint here: the plugin reads them through a getter so a late
 * arrival fills the cells and the filters, rather than leaving those columns permanently blank with
 * nothing reporting it.
 */

/** One member of an enum. `displayName` wins over `name` when both are present. */
export interface EnumEntry {
  value: unknown;
  name?: string;
  displayName?: string;
}

/** Enum members by enum name — what a column's `enum` key points at. */
export type EnumTables = Record<string, readonly EnumEntry[]>;

/** The shape an API usually returns: a list of named tables rather than a map. */
export interface EnumList {
  name?: string;
  values?: readonly EnumEntry[];
}

/**
 * Turn `[{ name, values }]` into `{ name: values }`.
 *
 * A five-line adapter that exists because every consumer would otherwise write it, and because an
 * entry with no name silently produces a table keyed `undefined` — which then never matches any
 * column, and looks exactly like an enum that failed to load. Those are skipped instead.
 */
export function enumsFromList(list: readonly EnumList[] | null | undefined): EnumTables {
  const out: Record<string, readonly EnumEntry[]> = {};
  for (const entry of list ?? []) {
    if (!entry?.name) continue;
    out[entry.name] = entry.values ?? [];
  }
  return out;
}
