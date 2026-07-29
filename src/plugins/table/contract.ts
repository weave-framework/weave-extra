/**
 * The cell contract — what a cell renderer receives, and what it is allowed to do.
 *
 * This file IS the strict document. A consumer writes their own cell as an ordinary Weave component
 * and registers it against a `type` string; everything that component may touch arrives in its props,
 * and everything it may cause goes back out through `api`. Nothing else is in scope: no service
 * injection, no store reach-through, no DOM outside its own subtree. That is what makes a cell
 * testable on its own and what stops one screen's cell from becoming another screen's surprise.
 *
 * The rules, in full:
 *
 *  1. **One root node.** A Weave component returns a single `Node`, and it lands in one `<td>`.
 *  2. **Never mutate `row`.** The row is the caller's data, not the cell's state. A cell that wants
 *     something to change says so — `api.action('toggle-detail')` — and the owner of the data decides.
 *  3. **Reach only through `api`.** Translation, dates, enums and outbound actions all have an entry
 *     there. If something is missing from `api`, that is a gap to fix here, not to route around.
 *  4. **Do not call `stopPropagation` by hand — hand the event to `api.action(name, data, event)`.**
 *     One place decides what a cell control does to the row's own click handling, so the answer is
 *     the same in every column.
 *  5. **Styles live beside the component**, as everywhere else in this package.
 *  6. **A cell that resolves against data which can arrive LATER must return a live node.**
 *     Cells are mounted once: `<Table>` keys them by column, so when only that outside data changes
 *     the keys are identical, the keyed diff keeps the existing DOM, and a freshly returned string
 *     is thrown away. Return a `Text` node (or an element) and drive it from an `effect` — the
 *     built-in `enum` cell does exactly this, because enum tables normally arrive over the network
 *     after the first page of rows.
 *  7. **Return a string when a string will do.** Measured on a 200 × 20 grid, cells that are real
 *     components roughly double the DOM and add ~40% to build time. That is a fine price for a status
 *     chip and a poor one for a date, so the built-in simple types return strings and consumers should
 *     reach for a component only when there is something to compose.
 *
 * Rule 6 is not about cells alone — it is the shape of everything this plugin mounts. A global
 * action's own `render` is called ONCE when the header bar is filled, and the bar is a single element
 * kept across every render of the header, because `<Table>` keys the header by column. Anything in it
 * that shows changing data has to be a live node for exactly the reason a cell does. What is NOT the
 * consumer's problem there: `visible`, `disabled` and `active` are getters the plugin reads itself.
 */

/** How a cell talks back. The only outbound channel a cell has. */
export interface CellApi {
  /**
   * Report something the user did. Reaches the consumer's single `onAction` handler as
   * `{ kind: 'cell', action, row, column, value, data }`.
   *
   * Pass the originating event and this stops it for you — a control inside a selectable row must not
   * also select the row, and leaving that to each renderer is how a grid ends up selecting rows
   * everywhere except over the icons. Pass nothing when there is no event to stop.
   */
  action: (name: string, data?: unknown, event?: Event) => void;
  /** Translate a key. Returns the key itself when no translator is configured. */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Format a date/time value using the consumer's formatter. */
  formatDate: (value: unknown, format?: string) => string;
  /** Resolve an enum member's display name, by enum name and value. */
  enumValue: (enumName: string, value: unknown) => string;
}

/**
 * A column as the plugin resolved it: the raw config entry, normalised.
 *
 * Kept deliberately close to the authored JSON so a cell can read its own extra keys (`icon`,
 * `enum`, `multiple`, whatever a custom type declares) without the plugin having to know them.
 */
export interface ResolvedColumn {
  /** Field name — also the default accessor into the row. */
  name: string;
  /** The registered cell type. */
  type: string;
  /** Header text, already translated when `translate` was set. */
  title: string;
  /** Whether this column can be toggled off by the user, and whether it starts on. */
  availability: ColumnAvailability;
  visible: boolean;
  width?: string | number;
  align?: 'start' | 'center' | 'end';
  sortable: boolean;
  filterable: boolean;
  /** A control appended to every cell in this column, if the config asked for one. */
  cellAction?: { icon: string; action: string; tooltip?: string; color?: string };
  /** Everything else the JSON entry carried, untouched. */
  options: Readonly<Record<string, unknown>>;
}

/**
 * The three states a column can be in — one field instead of the three separate flags
 * (`hidden`, `visible`, `hideInMenu`) that previously lived across two services.
 *
 * - `toggleable` — in the grid and in the columns menu (the default).
 * - `pinned` — in the grid, but not offered in the menu: the user cannot turn it off.
 * - `absent` — not rendered at all. Still present in the config because other columns read the
 *   field (a merged-icon column sourcing three booleans, say).
 */
export type ColumnAvailability = 'toggleable' | 'pinned' | 'absent';

/**
 * What a cell renderer is handed.
 *
 * A `type` alias rather than an `interface` on purpose: TypeScript gives object type ALIASES an
 * implicit index signature and interfaces none, and a Weave component's parameter is
 * `Record<string, unknown>`. As an interface this type would not be assignable to it, and every
 * consumer registering a plain component would need a cast.
 */
export type CellProps<TRow = Record<string, unknown>, TValue = unknown> = {
  /** `row[column.name]`, untransformed. */
  value: TValue;
  /** The original row object, exactly as it came from the caller. */
  row: TRow;
  column: ResolvedColumn;
  api: CellApi;
};

/** A cell renderer written as a plain function. */
export type CellRenderer<TRow = Record<string, unknown>, TValue = unknown> = (
  props: CellProps<TRow, TValue>
) => Node | string;

/**
 * A cell written as a Weave component.
 *
 * The `unknown` return is not a claim that a component might return something else — it always
 * returns a `Node`. It is how Weave currently emits a compiled component's declaration
 * (`(props, slots?) => unknown`), so this type meets the build where it is rather than making every
 * consumer cast at the registration site. When the emitter narrows that to `Node`, this alias
 * collapses into `CellRenderer` and nothing written against it has to change.
 *
 * Declare your cell's props as `CellProps<MyRow>` and narrow `value` inside: the value really is
 * `unknown`, because it came out of a row the plugin knows nothing about.
 */
export type CellComponent<TRow = Record<string, unknown>, TValue = unknown> = (
  props: CellProps<TRow, TValue>,
  slots?: Record<string, () => unknown>
) => unknown;

/** Either form is accepted when registering a cell type. */
export type CellSource<TRow = Record<string, unknown>, TValue = unknown> =
  | CellRenderer<TRow, TValue>
  | CellComponent<TRow, TValue>;

/** What a header renderer is handed, for a custom header. */
export type HeaderProps = {
  column: ResolvedColumn;
  api: CellApi;
};

export type HeaderRenderer = (props: HeaderProps) => Node | string;
