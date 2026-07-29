# `@weave-framework/extra/plugins/table`

Drive a Weave `<Table>` from a column configuration, with cell types you supply as ordinary Weave
components.

> **Running examples.** Every section here has a live counterpart in the examples app —
> `pnpm run examples`, then **Table recipes** (`#table-recipes`): one grid per feature, configured
> for that feature and nothing else, with its own source underneath. **Table plugin** (`#table`) is
> the same plugin assembled the way a real screen uses it.

This is a **props factory, not a wrapper**. It does not render a table and it does not replace one.
`<Table>` already owns sorting, selection, expansion, sticky columns and keyboard-accessible column
resizing; wrapping it would mean re-exposing all of that and rotting the first time any of it
changed. So you keep writing `<Table>`, and the plugin decides what its props are.

Two rules the whole surface is built on:

- **One way out.** Every action — a control inside a cell, a row action, a header action, a column
  switched off, a page turned, a filter committed, a selection changed — arrives at a single
  `onAction` with a discriminated payload, carrying the row in its original shape.
- **One list of actions.** Row buttons and the row's context menu are the same array with a
  placement, not two inputs you keep in step by hand.

---

## Contents

1. [The smallest grid that works](#1-the-smallest-grid-that-works)
2. [Column configuration](#2-column-configuration)
3. [Cell types](#3-cell-types)
4. [Turning things on and off](#4-turning-things-on-and-off)
5. [Row (item) actions](#5-row-item-actions)
6. [Global actions](#6-global-actions)
7. [Actions from inside a cell](#7-actions-from-inside-a-cell)
8. [Filters](#8-filters)
9. [Selection](#9-selection)
10. [Sorting](#10-sorting)
11. [Pagination](#11-pagination)
12. [The columns menu, and saving preferences](#12-the-columns-menu-and-saving-preferences)
13. [Row events and row classes](#13-row-events-and-row-classes)
14. [Virtual scrolling](#14-virtual-scrolling)
15. [Enums](#15-enums)
16. [Roles](#16-roles)
17. [Translation and dates](#17-translation-and-dates)
18. [Every event, one handler](#18-every-event-one-handler)
19. [API reference](#19-api-reference)
20. [Rules and pitfalls](#20-rules-and-pitfalls)

---

## 1. The smallest grid that works

Nothing is on by default except the columns. No filters, no selection, no paging, no actions.

**`page.ts`**

```ts
import { signal, type Signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import { tablePlugin, type ColumnConfig, type TablePluginApi } from '@weave-framework/extra/plugins/table';

export interface Doc extends Record<string, unknown> {
  id: number;
  sender: string;
  created: number;
}

const COLUMNS: ColumnConfig[] = [
  { name: 'id', type: 'integer', title: 'Id', width: 90 },
  { name: 'sender', type: 'string', title: 'Sender' },
  { name: 'created', type: 'timestamp', title: 'Created' },
];

export interface Context {
  Table: typeof Table;
  grid: TablePluginApi<Doc>;
  rows: () => Doc[];
}

export function setup(): Context {
  const rows: Signal<Doc[]> = signal<Doc[]>([]);

  const grid: TablePluginApi<Doc> = tablePlugin<Doc>({
    columns: COLUMNS,
    formatDate: (value: unknown): string => new Date(value as number).toLocaleString(),
    onAction: (event): void => console.log(event),
  });

  return { Table, grid, rows };
}
```

**`page.html`**

```html
<Table columns={{ grid.columns() }} dataSource={{ rows }}
       trackBy={{ (row: Doc) => row.id }}
       sort={{ grid.sort() }} onSort={{ grid.onSort }}
       ariaLabel="Documents" />
```

That is the whole contract for a read-only grid. Everything below is opt-in.

---

## 2. Column configuration

### 2.1 Every field

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | **Required.** Field in the row, and the column's stable id. |
| `type` | `string` | **Required.** A built-in type or one you registered. An unknown type throws. |
| `title` | `string` | Header text, or a translation key when `translate` is set. Defaults to `name`. |
| `translate` | `boolean` | Run `title` and `cellAction.tooltip` through your translator. |
| `visible` | `boolean` | Start visible. Default `true`. |
| `hideInMenu` | `boolean` | Rendered, but not offered in the columns menu — the user cannot switch it off. |
| `hidden` | `boolean` | Not rendered at all. The field stays in the row for other columns to read. |
| `width` | `string \| number` | A number is px. |
| `align` | `start \| center \| end \| left \| right` | `left`/`right` are mapped to the logical values. |
| `sortdisabled` | `boolean` | No sorting on this column. |
| `searchDisabled` | `boolean` | No filter control for this column. |
| `resizable` | `boolean` | Overrides the table-wide `resizableColumns` for this column. |
| `tooltip` | `string` | Header tooltip. |
| `roles` | `string[]` | Only rendered for a viewer holding one of these. Acts on its own — no second flag. |
| `cellAction` | `{ icon, action, tooltip?, color? }` | A control appended to every cell in the column. |

Per-type keys:

| Type | Extra keys |
| --- | --- |
| `string`, `text` | — |
| `number`, `integer` | — (right-aligned with tabular figures by default) |
| `timestamp` | `format` — passed through to your `formatDate` |
| `enum` | `enum` — **required**, the enum table name |
| `boolean` | `iconTrue`, `iconFalse`, `hideTrueIcon`, `hideFalseIcon` |
| `icon` | `icon` (static name; omit to use the cell value), `showWhenTruthy` (default `true`) |
| *(your own)* | anything — it arrives at your cell as `column.options` |

### 2.2 The three visibility states

One field, not three flags:

```jsonc
{ "name": "sender",     "type": "string" }                       // toggleable — in the grid, in the menu
{ "name": "reprocess",  "type": "boolean", "hideInMenu": true }  // pinned — in the grid, not in the menu
{ "name": "rawState",   "type": "string",  "hidden": true }      // absent — never rendered, still in the row
```

### 2.3 Authored as a file

```jsonc
// documents.columns.json
[
  { "name": "id", "type": "integer", "title": "Id", "width": 90 },
  { "name": "documentFormat", "type": "string", "title": "Format" },
  { "name": "momentCreated", "type": "timestamp", "title": "Created", "format": "short" },
  { "name": "documentStateType", "type": "enum", "title": "State", "enum": "DocumentStateType" },
  { "name": "testIndicator", "type": "boolean", "title": "Test", "hideFalseIcon": true },
  { "name": "internalNote", "type": "string", "title": "Note", "roles": ["Admin"] }
]
```

**Bundled** — type-checked at build time, needs a rebuild to change:

```ts
import columns from './documents.columns.json' with { type: 'json' };

const grid = tablePlugin<Doc>({ columns: columns as ColumnConfig[] });
```

**Fetched** — a deployment can change what a screen shows without shipping code:

```ts
const configs: Signal<ColumnConfig[]> = signal<ColumnConfig[]>([]);

// A GETTER, so the plugin re-validates and re-resolves when they land.
const grid = tablePlugin<Doc>({ columns: (): ColumnConfig[] => configs() });

onMount(() => {
  fetch('json/documents.columns.json')
    .then((r) => r.json() as Promise<ColumnConfig[]>)
    .then((loaded) => configs.set(loaded));   // this is the whole handover
});
```

Build the plugin with an empty array and hand it the real set later. That is supported on purpose.

### 2.4 Validation

Validation runs on every change of the source, not once at construction — a config that arrives late
is exactly as capable of being wrong as one that was there from the start. It throws **once**, with
every problem it found:

```
@weave-framework/extra table: invalid column configuration
  - columns[3] (state): unknown type "enumeration" — register a cell for it, or use one of: string, text, number, integer, timestamp, enum, boolean, icon
  - columns[7] (created): align "middle" is not one of start, center, end, left, right
  - columns[9]: missing "name"
```

A typo'd type used to fall through to a default renderer and show a blank column. Fifteen silent
blanks are worse than one loud failure at startup.

---

## 3. Cell types

### 3.1 The built-ins

| Type | Renders | Returns |
| --- | --- | --- |
| `string`, `text` | the value as text | `string` |
| `number`, `integer` | the value as text, right-aligned | `string` |
| `timestamp` | `api.formatDate(value, column.options.format)` | `string` |
| `enum` | the member's display name | **live `Text` node** |
| `boolean` | a tick or a cross, either side suppressible | `Node \| ''` |
| `icon` | a named icon, static or from the value | `Node \| ''` |

All of them are registered under a name you can override. Register `timestamp` yourself and the
built-in steps aside.

### 3.2 Registering your own — a Weave component

A Weave component **is** a cell renderer. No adapter.

**`status-chip.html`**

```html
<span class={{ 'chip chip--' + tone() }}>{{ label() }}</span>
```

**`status-chip.ts`**

```ts
import type { CellProps } from '@weave-framework/extra/plugins/table';

export interface Doc extends Record<string, unknown> {
  processingState: string;
}

export function setup(props: CellProps<Doc>) {
  return {
    label: (): string => String(props.value ?? ''),
    tone: (): string => (props.value === 'failed' ? 'bad' : 'ok'),
  };
}
```

**Registering it**

```ts
import StatusChip from './status-chip.js';

const grid = tablePlugin<Doc>({
  columns: configs,
  cells: { 'status-chip': StatusChip },
});
```

```jsonc
{ "name": "processingState", "type": "status-chip", "title": "State" }
```

### 3.3 Registering your own — a plain function

Cheaper when there is nothing to compose:

```ts
import type { CellRenderer } from '@weave-framework/extra/plugins/table';

const money: CellRenderer<Doc> = ({ value, column }): string => {
  const currency = (column.options.currency as string) ?? 'EUR';
  return value == null ? '' : `${Number(value).toFixed(2)} ${currency}`;
};

const grid = tablePlugin<Doc>({ cells: { money }, columns: configs });
```

```jsonc
{ "name": "total", "type": "money", "title": "Total", "currency": "USD" }
```

Anything the JSON entry carries that is not a base key arrives as `column.options`, untouched and
frozen.

### 3.4 The rule that bites: a cell is mounted ONCE

`<Table>` keys its cells by column. When only *outside* data changes — enums arriving over the
network, a translation loading, a store updating — the keys are identical, the keyed diff keeps the
existing DOM, and a freshly returned string is thrown away.

So: **a cell that resolves against data which can arrive later must return a live node.**

```ts
// WRONG — renders once, blank, forever, with nothing reporting it
const status: CellRenderer<Doc> = ({ value, api }): string => api.enumValue('State', value);

// RIGHT — a Text node driven by an effect
const status: CellRenderer<Doc> = ({ value, api }): Node => {
  const node: Text = document.createTextNode('');
  effect(() => {
    node.nodeValue = api.enumValue('State', value);
  });
  return node;
};
```

A `Text` node costs no element and updates in place. This is what the built-in `enum` cell does, and
it is the normal path rather than a corner case.

The same law applies to the header bar and to a global action's own `render`. See
[§20](#20-rules-and-pitfalls).

### 3.5 Return a string when a string will do

Measured on a 200 × 20 grid: cells that are real components take the DOM from 4,455 nodes to 9,341
and the build from ~50 ms to ~69 ms. Worth it for a status chip. Not worth it for a date.

### 3.6 `cellAction` — a control appended to a cell

Whatever the cell's type renders, plus a button:

```jsonc
{
  "name": "correlationId",
  "type": "string",
  "title": "Correlation",
  "cellAction": { "icon": "copy", "action": "copy-correlation", "tooltip": "Copy", "color": "#6b7280" }
}
```

```ts
onAction: (event) => {
  if (event.kind === 'cell' && event.action === 'copy-correlation') {
    navigator.clipboard.writeText(String(event.value));
  }
}
```

Only the columns that ask for one pay for the wrapper element — it is not a tax on the other 300.

---

## 4. Turning things on and off

Everything is off unless switched on. This is the whole list:

| Option | Off by default | Turns on |
| --- | --- | --- |
| `filters: true` | ✓ | The filter row, and a toggle in the header bar |
| `filtersVisible: true` | ✓ | …and starts it open |
| `rowEvents: true` | ✓ | Row click / double-click / right-click menu |
| `selection: true` | ✓ | The checkbox column |
| `selection: { … }` | ✓ | …and selecting by clicking (needs `rowEvents`) |
| `pagination: true` | ✓ | `paginator()` and page reporting |
| `resizableColumns: true` | ✓ | Draggable column edges |
| `virtual: true` | ✓ | Windowed rendering (needs `maxHeight`) |
| `columnsMenu: false` | on | *Off* — stops the right-click columns panel |
| `stickyActions: false` | `'end'` | *Off* — lets the actions column scroll away |
| `actionsIn: 'menu'` | `'both'` | Drops the row action buttons, keeps the menu |
| `rowClass` | — | Per-row classes from the row's own data (needs `rowEvents`) |
| `onPreferencesChange` | — | Persisting column order / visibility / widths / sort / page size |

Two of these refuse at construction rather than failing quietly later:

```ts
tablePlugin({ virtual: true });
// throws: `virtual` needs `maxHeight` — without one the body grows to fit its rows
//         and there is no viewport to window.

tablePlugin({ selection: { rows: () => rows() } });
// throws: selecting rows by clicking needs `rowEvents: true` — that is the listener
//         the clicks arrive on.

tablePlugin({ selection: { }, rowEvents: true });
// throws: `selection.range` needs `selection.rows` — a Shift-click extends across the
//         rows as they are rendered, which only the caller knows.
```

---

## 5. Row (item) actions

One array. Two renderings.

```ts
const grid = tablePlugin<Doc>({
  columns: configs,
  rowEvents: true,                       // required for the context menu
  actions: [
    { action: 'open', icon: 'eye', title: 'Open' },
    { action: 'reprocess', icon: 'package', title: 'Reprocess', visible: (row) => row.isReprocessable },
    { action: 'archive', icon: 'box', title: 'Archive', disabled: (row) => row.archived },
    { action: 'delete', icon: 'trash-2', title: 'Delete', showIn: 'menu' },
    { action: 'purge', icon: 'flame', title: 'Purge', roles: ['Admin'] },
  ],
  onAction: (event) => {
    if (event.kind === 'item') doSomething(event.action, event.row);
  },
});
```

| Key | Effect |
| --- | --- |
| `action` | Reported back as `{ kind: 'item', action, row }` |
| `icon` / `title` | The button's glyph and its label. No icon → the title renders as text |
| `translate: true` | Run `title` through your translator |
| `showIn` | `'row'`, `'menu'` or `'both'` — overrides `actionsIn` for this entry |
| `visible(row)` | Drop it entirely for rows that do not qualify |
| `disabled(row)` | Render, but inert |
| `roles` | Checked through your `checkRole` |

### 5.1 Context menu only, no buttons

For the whole table:

```ts
tablePlugin<Doc>({ actions, actionsIn: 'menu', rowEvents: true });
```

The button column disappears; the right-click menu keeps every action. On a wide table that is a
column back, and on a dense one it is a lot of repeated icons gone.

The cost is discoverability — a right-click menu is invisible until someone tries it. Worth it for a
tool used all day, a poor trade for a screen visited twice a year.

For one action, and regardless of the table-wide setting:

```ts
{ action: 'delete', icon: 'trash-2', title: 'Delete', showIn: 'menu' }
```

### 5.2 Switching it while the grid is running

`actionsIn` takes a getter:

```ts
const placement: Signal<ActionPlacement> = signal<ActionPlacement>('both');

const grid = tablePlugin<Doc>({
  actions,
  rowEvents: true,
  actionsIn: (): ActionPlacement => placement(),
});

// later, from a settings toggle
placement.set('menu');
```

### 5.3 Wiring the menu up

The context menu lives in the `tableRows` action, so the grid needs the wrapper:

```html
<div use:tableRows={{ grid.rowEvents }}>
  <Table columns={{ grid.columns() }} dataSource={{ rows }} … />
</div>
```

```ts
// returned from setup(), NOT exported — a `use:` action resolves from the setup context
return { grid, rows, tableRows };
```

---

## 6. Global actions

The table-wide controls, rendered in the grid's own header — not on a strip floating above it.

### 6.1 A fixed list

```ts
tablePlugin<Doc>({
  columns: configs,
  globalActions: [
    { action: 'reload', title: 'Reload' },                     // no icon → renders its title
    { action: 'export', icon: 'cloud-download', title: 'Export' },
  ],
  onAction: (event) => {
    if (event.kind === 'global' && event.action === 'reload') refetch();
  },
});
```

### 6.2 A live list

Pass a getter and the bar re-derives itself. Every predicate is a getter too, so a control can
appear, grey out and go pressed without the grid being rebuilt:

```ts
const busy: Signal<boolean> = signal<boolean>(false);
const selected = (): number => grid.selected().length;

globalActions: (): GlobalAction[] => [
  { action: 'reload', title: 'Reload', disabled: (): boolean => busy() },
  { action: 'export', icon: 'cloud-download', title: 'Export', disabled: (): boolean => busy() },
  // only there when something is selected
  { action: 'bulk-delete', icon: 'trash-2', title: 'Delete selected', visible: (): boolean => selected() > 0 },
],
```

| Key | Read | Effect |
| --- | --- | --- |
| `visible()` | live | Out of the bar entirely |
| `disabled()` | live | Drawn, but inert |
| `active()` | live | Drawn pressed (`is-active`, `aria-pressed="true"`) |
| `roles` | once | Checked through your `checkRole` |
| `render()` | once | You build the control |

### 6.3 Adding one at runtime

For a caller with no signal to hang it on. You get a disposer back:

```ts
const drop: () => void = grid.addGlobalAction(
  { action: 'archive', icon: 'package', title: 'Archive' },
  { before: FILTER_ACTION }        // anchored, not appended
);

// when the mode that owns it ends
drop();
```

Anchors name another action; `{ before }` and `{ after }` both work, and an anchor that matches
nothing appends. `grid.removeGlobalAction('archive')` is there for the cases that would rather hold
a name — it only removes actions added this way, not ones declared in the options.

The disposer is identity-based on purpose: two callers may legitimately add the same action name,
and removing by name would take the wrong one.

### 6.4 A control that is not a button

```ts
{
  action: 'count',
  render: ({ api }): Node => {
    const box: HTMLElement = document.createElement('span');
    box.className = 'grid__badge';
    const text: Text = document.createTextNode('');
    // Built ONCE — so it has to be live, exactly like a cell.
    effect(() => {
      text.nodeValue = String(matched());
    });
    box.append(text);
    return box;
  },
}
```

`render` is handed `{ action, api, fire }`. Call `fire(data?)` to report out through `onAction` as
`{ kind: 'global', action, data }`.

Widen the column when you put something non-button in there:

```ts
actionsColumnWidth: 168,
```

### 6.5 The reserved `filter` action

When `filters: true` the plugin appends a filter toggle. It is a normal entry in the list, so you can
**replace** it — declare an action named `filter` (the exported `FILTER_ACTION`) and you get your
icon, your title and your position in the bar, and the toggle still works:

```ts
globalActions: [
  { action: FILTER_ACTION, icon: 'sliders', title: 'Search' },   // ours, first in the bar
  { action: 'reload', title: 'Reload' },
],
```

Either way it reports through `onAction` like everything else — one way out includes the controls the
plugin supplies itself.

---

## 7. Actions from inside a cell

A cell's only outbound channel is `api.action(name, data?, event?)`:

```ts
const linkCell: CellRenderer<Doc> = ({ value, api }): Node => {
  const button: HTMLButtonElement = document.createElement('button');
  button.textContent = String(value ?? '');
  button.addEventListener('click', (event) => {
    // Pass the event and it is stopped for you — a control inside a selectable
    // row must not also select the row.
    api.action('open-detail', { from: 'cell' }, event);
  });
  return button;
};
```

Arrives as:

```ts
{ kind: 'cell', action: 'open-detail', row, column: 'sender', value, data: { from: 'cell' } }
```

Never call `stopPropagation` by hand. One place decides what a cell control does to the row's own
click handling, so the answer is the same in every column.

---

## 8. Filters

A control per column, in a second `<thead>` row, so the boxes line up with their columns whatever the
widths are.

### 8.1 Turning it on

```ts
const grid = tablePlugin<Doc>({
  columns: configs,
  filters: true,             // the row exists, and a toggle appears in the header bar
  filtersVisible: false,     // start closed (the default)
});
```

```html
<Table columns={{ grid.columns() }} headerRow={{ grid.headerRow() }} … />
```

`headerRow()` returns `undefined` while the row is hidden, which is what makes `<Table>` leave the
second row out entirely rather than draw an empty one.

Per column, opt out:

```jsonc
{ "name": "actions", "type": "icon", "searchDisabled": true }
```

### 8.2 The built-in controls

| Column type | Control |
| --- | --- |
| `string`, `text`, `timestamp` | text box, commits on <kbd>Enter</kbd> |
| `number`, `integer` | number box, commits on <kbd>Enter</kbd> |
| `boolean` | select — True / False |
| `enum` | select, filled from the enum table |
| `icon` | none |

Emptying a box applies immediately — there is nothing left to press <kbd>Enter</kbd> on, and leaving
a stale filter in force after someone emptied the box reads as a broken control.

### 8.3 The plugin does not filter anything

It reports. The rows it was given are a page from a server that has to do the work:

```ts
onAction: (event) => {
  if (event.kind === 'filter') {
    // event.filters — the raw committed values, by column name
    // event.query   — whatever buildQuery produced (an OData $filter string by default)
    fetchDocuments({ $filter: event.query, ...grid.pageQuery() });
  }
}
```

Committing a filter also resets the page to 1 and reports that separately as
`{ kind: 'page', reason: 'filter' }` — staying on page 7 of a result set that no longer has seven
pages is how a filter comes to look like it returned nothing.

### 8.4 A different query language

```ts
import { rawQuery } from '@weave-framework/extra/plugins/table';

tablePlugin<Doc>({ filters: true, buildQuery: rawQuery });   // the committed values, untouched
```

Or your own:

```ts
const sqlish: QueryBuilder = (filters, columns): string =>
  Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([name, v]) => `${name} LIKE '%${String(v)}%'`)
    .join(' AND ');

tablePlugin<Doc>({ filters: true, buildQuery: sqlish });
```

The default is `odataQuery`: `eq` for numbers, booleans and enums; `contains` for text; `startswith`
for a single character, because matching one letter anywhere in a large table returns most of it.

### 8.5 A different control for a type

```ts
import { BUILT_IN_FILTERS, type FilterRenderer } from '@weave-framework/extra/plugins/table';

const dateRange: FilterRenderer = (props): Node => {
  const input: HTMLInputElement = document.createElement('input');
  input.type = 'date';
  // props.value() is a LIVE getter — read it, do not snapshot it
  effect(() => {
    const committed = props.value();
    if (document.activeElement !== input) input.value = committed == null ? '' : String(committed);
  });
  input.addEventListener('change', () => props.commit(input.value || undefined));
  return input;
};

tablePlugin<Doc>({ filters: true, filterTypes: { timestamp: dateRange } });
```

`FilterProps` is `{ column, value: () => unknown, commit, api, enums? }`. `value` is a getter and not
a snapshot because the filter row is deliberately **not** re-rendered when a value is committed —
re-rendering it would take the focus and the caret out of whatever is being typed.

### 8.6 Reading and clearing

```ts
grid.filters();          // Computed<Record<string, unknown>> — the committed values
grid.filterQuery();      // Computed<unknown>                 — what buildQuery produced
grid.filtersEnabled();   // is a filter row configured at all
grid.filtersVisible();   // is it showing
grid.toggleFilters();
grid.clearFilters();     // clears and reports
```

---

## 9. Selection

The checkbox column and the row itself drive **one** set, because the plugin owns the model and hands
it to `<Table>` instead of letting the table build its own.

### 9.1 Checkbox only

```ts
tablePlugin<Doc>({ columns: configs, selection: true });
```

```html
<Table selectable={{ grid.selectable() }}
       selectionMode={{ grid.selectionMode() }}
       selection={{ grid.selectionModel }}
       … />
```

### 9.2 …and clicking

```ts
tablePlugin<Doc>({
  columns: configs,
  rowEvents: true,                                  // required
  selection: {
    rows: (): readonly Doc[] => rows(),             // required for Shift ranges
    compareWith: (a, b): boolean => a.id === b.id,  // for refetched pages
  },
});
```

| Gesture | Result |
| --- | --- |
| click | replaces the selection with this row |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + click | adds or removes this row |
| <kbd>Shift</kbd> + click | extends from the anchor, replacing |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + click | extends from the anchor, adding |
| checkbox | adds or removes, without disturbing anything else |

The anchor is the last row touched **without** Shift, and a Shift-click does not move it — so a range
can be stretched and shrunk without starting over.

### 9.3 Every knob

```ts
selection: {
  mode: 'multiple',      // or 'single' — also drops the select-all box
  click: 'replace',      // 'toggle' makes every row behave like its own checkbox; 'none' keeps
                         // only the modified gestures, for a grid where a click means something else
  range: true,           // Shift
  additive: true,        // Ctrl / Cmd
  rows: () => rows(),    // the rows AS DISPLAYED — required when range is on
  initial: [someRow],
  compareWith: (a, b) => a.id === b.id,
}
```

`rows` is required for ranges because a range is a slice of what the reader can see: sorted,
filtered, and only the current page. The plugin holds no data of its own and cannot infer it.

### 9.4 Reading it

```ts
grid.selected();          // Doc[] — reactive
grid.clearSelection();
grid.selectionModel;      // the CDK SelectionModel, if you want select/deselect/toggle directly
```

```ts
onAction: (event) => {
  if (event.kind === 'selection') {
    console.log(event.rows.length, event.added, event.removed);
  }
}
```

Changes are reported here rather than through `<Table onSelectionChange>` because the table only
calls its own callback for a model it built itself.

---

## 10. Sorting

The plugin holds the sort state and reports the change; who does the sorting is your decision.

**Locally**

```ts
const sorted = computed<Doc[]>(() => {
  const { active, direction } = grid.sort();
  if (!active || !direction) return filtered();
  const dir = direction === 'asc' ? 1 : -1;
  return [...filtered()].sort((a, b) => String(a[active]).localeCompare(String(b[active])) * dir);
});
```

**On the server**

```ts
onAction: (event) => {
  if (event.kind === 'columns' && event.reason === 'order') {
    const { active, direction } = grid.sort();
    refetch({ $orderby: active ? `${active} ${direction}` : undefined });
  }
}
```

Sorting also resets the page and reports `{ kind: 'page', reason: 'sort' }`. Turn it off per column
with `"sortdisabled": true`.

---

## 11. Pagination

```ts
tablePlugin<Doc>({
  columns: configs,
  pagination: true,
  pageMode: 'offset',            // or 'cursor'
  pageSize: 25,
  pageSizeOptions: [10, 25, 50],
  total: (): number | undefined => totalFromServer(),   // required by 'offset'
  hasNextPage: (): boolean => more(),                   // used by 'cursor'
});
```

```html
@let pages = grid.paginator();
@if (pages) {
  <Paginator length={{ pages.length }} pageSize={{ pages.pageSize }} pageIndex={{ pages.pageIndex }}
             pageSizeOptions={{ pages.pageSizeOptions }} onPage={{ grid.onPage }} />
}
```

`paginator()` returns `undefined` when there is nothing to draw — paging off, cursor mode, or a total
that has not arrived — so `@if (pages)` is the whole of the decision.

| Mode | Query it builds | Needs |
| --- | --- | --- |
| `offset` | `{ $top, $skip }` | `total()` |
| `cursor` | `{ pageNumber, itemsOnPage }` | `hasNextPage()` |

```ts
onAction: (event) => {
  if (event.kind === 'page') {
    // event.reason: 'navigate' | 'size' | 'filter' | 'sort'
    fetchDocuments(event.query);
  }
}
```

`filter` and `sort` matter: the page reset itself, so the request about to be made is for page 1 of a
different result set, not the next page of the old one. A page-size change also starts over, because
a bigger page makes the old index point somewhere else entirely.

---

## 12. The columns menu, and saving preferences

### 12.1 The panel

Right-click any column header. It needs `rowEvents` (that is where the listener lives) and is on by
default — `columnsMenu: false` turns it off.

```html
@if (grid.columnsOpen()) {
  <div class="columns-panel" style={{ panelStyle() }} use:columnsPanel={{ grid.columnsPanel }}>
    @for (column of grid.allColumns(); track column.name) {
      <div class="columns-panel__row" data-column={{ column.name }}>
        <span class="columns-panel__grip" data-column-handle tabindex="0"
              role="button" aria-label={{ 'Reorder ' + column.title }}>
          <Icon name={{ 'grip-vertical' }} />
        </span>
        <Checkbox checked={{ isOn(column) }} disabled={{ column.availability !== 'toggleable' }}
                  onChange={{ () => grid.toggleColumn(column.name) }} label={{ column.title }} />
      </div>
    }
    <div class="columns-panel__foot">
      <Button variant="ghost" on:click={{ grid.resetColumns }}>Reset to the file</Button>
    </div>
  </div>
}
```

The markup is yours. The `columnsPanel` action only adds reordering, and it reads the order from the
DOM at drop time, so what it reports is always what is on screen. It brings keyboard drag-and-drop
with it: <kbd>Space</kbd> to lift, arrows to move, <kbd>Space</kbd> to drop. It also closes itself on
a press outside or <kbd>Escape</kbd>.

Anchor it where the right-click landed:

```ts
panelStyle: (): string => {
  const at = grid.columnsMenuAt();
  const top = Math.min(at.y, Math.max(8, window.innerHeight - 360));
  return `left:${at.x}px; top:${top}px`;
},
```

Style hooks during a drag: `is-dragging` on the row being moved, `is-drop-target` on the row it would
land before, `is-drop-end` on the last row when it would land after everything. Exported as
`DRAGGING_CLASS`, `DROP_TARGET_CLASS`, `DROP_END_CLASS`.

### 12.2 Persisting

Transport-neutral by design: the plugin never names a storage, it asks for this shape on start and
hands it back on change, so `localStorage`, a settings service and a remote profile are all the same
amount of work.

```ts
const grid = tablePlugin<Doc>({
  columns: configs,
  preferences: JSON.parse(localStorage.getItem('docs.grid') ?? '{}'),
  onPreferencesChange: (preferences, reason): void => {
    localStorage.setItem('docs.grid', JSON.stringify(preferences));
    console.log(reason);   // 'visibility' | 'order' | 'reset' | 'width' | 'load'
  },
});
```

```ts
interface TablePreferences {
  order?: string[];        // column names in display order
  hidden?: string[];       // column names switched off
  sort?: SortState;
  widths?: Record<string, number>;
  pageSize?: number;
}
```

Loading asynchronously is your business — call `grid.setPreferences(loaded)` when it arrives.

`resetColumns()` goes back to *null*, not to a snapshot of the defaults: reset means "follow the
configuration again", so a config that changes afterwards is picked up rather than shadowed by a
stale copy.

### 12.3 Widths

```ts
tablePlugin<Doc>({ resizableColumns: true });
```

```html
<Table columnWidths={{ grid.columnWidths() }} onColumnResize={{ grid.onColumnResize }}
       resizableColumns … />
```

Widths ride along in the preferences.

---

## 13. Row events and row classes

```ts
tablePlugin<Doc>({
  rowEvents: true,
  rowClass: (row): string[] => {
    const names: string[] = [];
    if (row.state === 'failed') names.push('row--bad');
    if (row.test) names.push('row--test');
    return names;
  },
});
```

```ts
onAction: (event) => {
  if (event.kind === 'row') {
    // event.gesture: 'click' | 'doubleclick'
  }
}
```

`rowEvents` is off by default because it is not free. To get from a clicked `<tr>` back to the row
object, the plugin marks one cell per row, and a cell that renders as plain text needs a wrapper
element to carry the mark — roughly 2% more DOM on a 20-column grid. Worth it when a grid is
interactive, pointless when it is a read-only report.

Position is deliberately **not** used for that lookup: sorting, a virtual window, detail rows and
spacer rows all break the mapping between DOM order and array order, silently and only sometimes.

If you need the row from your own listener:

```ts
import { rowFromEvent } from '@weave-framework/extra/plugins/table';

element.addEventListener('mouseover', (event) => {
  const row = rowFromEvent<Doc>(event);
});
```

---

## 14. Virtual scrolling

```ts
tablePlugin<Doc>({
  virtual: true,
  rowHeight: 34,      // must match what a row actually renders at
  maxHeight: 360,     // required — without one there is no viewport to window
  overscan: 4,
});
```

```html
<Table virtual={{ grid.virtual() }} rowHeight={{ grid.rowHeight() }}
       overscan={{ grid.overscan() }} maxHeight={{ grid.maxHeight() }} … />
```

Measured on 1000 rows × 20 columns: first render goes from ~482 ms over 46,414 DOM nodes to ~14 ms
over 867, and the cost stops following the row count.

It is a trade, not a free win. It fixes the row height, and `<Table>` refuses it together with
`expandable`, because mapping a scroll offset to a row index cannot survive a detail row of unknown
height. `<Table>` reads it **once**, at its own setup — changing it on a mounted grid does nothing.

---

## 15. Enums

Enums are the one part of a grid's configuration that is almost never local: the column file ships
with the application, the enum tables come from the server, reliably *after* the first page of rows
in at least some races.

```ts
import { enumsFromList, type EnumTables } from '@weave-framework/extra/plugins/table';

const enums: Signal<EnumTables> = signal<EnumTables>({});

const grid = tablePlugin<Doc>({
  columns: configs,
  enums: enums,        // a GETTER — read reactively
});

fetch('/api/enums')
  .then((r) => r.json())
  .then((list) => enums.set(enumsFromList(list)));   // [{ name, values }] → { name: values }
```

Read once, those columns would stay blank for the life of the grid with nothing reporting it. Read
reactively, a late arrival fills the enum cells **and** the enum filters.

```jsonc
{ "name": "documentStateType", "type": "enum", "title": "State", "enum": "DocumentStateType" }
```

An entry's `displayName` wins over `name`. `enumsFromList` skips nameless entries — one would produce
a table keyed `undefined`, which never matches a column and looks exactly like an enum that failed to
load.

---

## 16. Roles

One function, checked in three places: columns, row actions, global actions.

```ts
const grid = tablePlugin<Doc>({
  columns: configs,
  checkRole: (roles: string[]): boolean => roles.some((role) => session.roles.includes(role)),
});
```

```jsonc
{ "name": "internalNote", "type": "string", "roles": ["Admin", "Support"] }
```

A column the viewer has no role for is **dropped**, not hidden — so it cannot be switched back on
from the columns menu. `roles` acts on its own: no second flag to remember, because a permission that
reads as set and is not is worse than no permission at all.

---

## 17. Translation and dates

```ts
tablePlugin<Doc>({
  translate: (key, params) => i18n.t(key, params),
  formatDate: (value, format) => dates.format(value, format ?? 'short'),
});
```

`translate` is applied to column titles and action titles **only when the entry asks for it** with
`"translate": true`. Without a translator, keys pass through unchanged.

`formatDate` receives the column's `format` from the JSON. Without one, values are stringified.

Both are available to your cells through `api.t` and `api.formatDate`.

---

## 18. Every event, one handler

```ts
import type { TableActionEvent } from '@weave-framework/extra/plugins/table';

onAction: (event: TableActionEvent<Doc>): void => {
  switch (event.kind) {
    case 'cell':
      // { action, row, column, value, data? } — a control inside a cell
      break;
    case 'item':
      // { action, row } — a row action, from the button or from the menu
      break;
    case 'row':
      // { gesture: 'click' | 'doubleclick', row }
      break;
    case 'global':
      // { action, data? } — a header action, including the filter toggle
      break;
    case 'selection':
      // { rows, added, removed }
      break;
    case 'filter':
      // { filters, query }
      break;
    case 'page':
      // { page, pageSize, query, reason: 'navigate' | 'size' | 'filter' | 'sort' }
      break;
    case 'columns':
      // { reason: 'visibility' | 'order' | 'reset' | 'width' | 'load', preferences }
      break;
  }
}
```

There is no second mechanism. An action item does not *also* get called directly, because two
parallel paths for the same event is how they drift apart.

---

## 19. API reference

### 19.1 Options

```ts
tablePlugin<TRow>({
  // data shape
  columns,                 // ColumnConfig[] | (() => ColumnConfig[])   — required
  cells,                   // Record<string, CellSource>
  enums,                   // EnumTables | (() => EnumTables)
  translate, formatDate, checkRole,

  // actions
  actions,                 // TableAction[]
  actionsIn,               // 'row' | 'menu' | 'both' | (() => …)       default 'both'
  globalActions,           // GlobalAction[] | (() => GlobalAction[])
  onAction,

  // filters
  filters,                 // boolean
  filtersVisible,          // boolean
  filterTypes,             // Record<string, FilterRenderer>
  buildQuery,              // QueryBuilder                             default odataQuery

  // selection
  selection,               // boolean | RowSelectionOptions

  // paging
  pagination, pageMode, pageSize, pageSizeOptions, total, hasNextPage,

  // columns
  resizableColumns, columnsMenu, preferences, onPreferencesChange,

  // rows
  rowEvents, rowClass,

  // layout
  stickyActions,           // 'start' | 'end' | false                  default 'end'
  actionsColumnWidth,      // number
  virtual, rowHeight, overscan, maxHeight,
});
```

### 19.2 What comes back

| Member | Type | For |
| --- | --- | --- |
| `columns` | `Computed<TableColumn[]>` | `<Table columns>` |
| `allColumns` | `Computed<ResolvedColumn[]>` | a columns menu |
| `sort` / `onSort` | `Signal<SortState>` / fn | `<Table sort onSort>` |
| `toggleColumn` / `reorderColumns` / `resetColumns` | fn | the columns menu |
| `preferences` / `setPreferences` | `Computed` / fn | persistence |
| `globalActions` | `Computed<GlobalActionView[]>` | rendering the bar elsewhere |
| `addGlobalAction` / `removeGlobalAction` | fn | runtime actions |
| `menuActions(row)` | fn | building your own row menu |
| `filters` / `filterQuery` | `Computed` | reading the filter state |
| `filtersEnabled` / `filtersVisible` / `toggleFilters` / `clearFilters` | fn | the filter row |
| `headerRow` | fn | `<Table headerRow>` |
| `selectable` / `selectionMode` / `selectionModel` | fn / fn / model | `<Table selectable selectionMode selection>` |
| `selected` / `clearSelection` | fn | reading the selection |
| `page` / `pageSize` / `paginator` / `onPage` | signals / fn | `<Paginator>` |
| `pageQuery` / `hasNextPage` | `Computed` / fn | building a request |
| `columnWidths` / `onColumnResize` | fn | `<Table columnWidths onColumnResize>` |
| `columnsOpen` / `columnsMenuAt` / `toggleColumns` / `closeColumns` | signal / fn | the panel |
| `columnsPanel` | options | `use:columnsPanel` |
| `rowEvents` | options | `use:tableRows` |
| `virtual` / `rowHeight` / `overscan` / `maxHeight` | fn | `<Table>` pass-throughs |
| `fire` | fn | reporting something yourself |
| `api` | `CellApi` | `t`, `formatDate`, `enumValue` outside a cell |

### 19.3 Exports

```ts
import {
  tablePlugin,
  FILTER_ACTION,
  // cells
  BUILT_IN_RENDERERS, BUILT_IN_TYPES, resolveColumns, validateColumns,
  // filters
  BUILT_IN_FILTERS, odataQuery, rawQuery,
  // actions (use:)
  tableRows, columnsPanel,
  rowFromEvent, markRow, ROW_MARKER,
  COLUMN_ATTR, HANDLE_ATTR, DRAGGING_CLASS, DROP_TARGET_CLASS, DROP_END_CLASS,
  // enums
  enumsFromList,
  // types
  type ActionPlacement, type CellApi, type CellProps, type CellRenderer,
  type ColumnConfig, type ColumnAvailability, type ResolvedColumn,
  type EnumEntry, type EnumTables, type EnumList,
  type FilterProps, type FilterRenderer, type QueryBuilder,
  type GlobalAction, type GlobalActionContext, type GlobalActionPlacement, type GlobalActionView,
  type RowSelectionOptions, type SelectionClick,
  type TableAction, type TableActionEvent, type TablePreferences,
  type TablePluginApi, type TablePluginOptions,
} from '@weave-framework/extra/plugins/table';
```

---

## 20. Rules and pitfalls

### 20.1 Mounted once — the law behind four separate bugs

`<Table>` keys its header cells by column and its body cells by (row, column). Anything the plugin
hands over is built **once** for that key. Re-returning different content under the same key changes
nothing: the keyed diff sees the same key and keeps the DOM it has.

This has bitten in four places, and every fix was the same shape:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Enum column permanently blank | cell returned a string, enums arrived later | return a live `Text` node |
| Filter toggle looked dead | header bar read its pressed state at build time | drive it from an `effect` |
| Action buttons stayed after `actionsIn: 'menu'` | column key unchanged | put the row-action count in the key |
| Header bar rendered empty after a remount | the cached element's effect had been disposed with its owner | build a fresh element per mount |

If something you render depends on data that can change, it must be a live node driven by an
`effect`, and it must be owned by the mount that shows it.

### 20.2 What is safe to read once

`visible`, `disabled` and `active` on a global action; `visible` and `disabled` on a row action.
The plugin reads those itself, live. You do not need an effect for them.

### 20.3 `use:` actions come from `setup()`

```ts
// WRONG — compiles cleanly, attaches nothing
export { tableRows };

// RIGHT
return { grid, rows, tableRows, columnsPanel };
```

A `use:` action resolves from the setup context; a capitalised component tag resolves from the
module's exports. They are different lookups.

### 20.4 `weave check` does not type-check this package

It reports "no type errors" on a file containing an identifier that exists nowhere — verified
deliberately with a probe. Use `tsc`:

```bash
npx tsc --noEmit -p tsconfig.json
```

Under a linked Weave checkout it also reports two `has no default export` lines for
`@weave-framework/ui/*`; those are the link, not your code.

### 20.5 Sizing the actions column

The default is arithmetic over 26px icon buttons and knows nothing about a custom `render`. Set
`actionsColumnWidth` when the bar holds something else.

### 20.6 Row identity

Give `<Table trackBy>` a stable key, and give `selection.compareWith` one too when rows are refetched
— a selection compared by reference empties itself on every reload, silently.
