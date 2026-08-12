# Requests for `@weave-framework`

Findings from building `@weave-framework/extra` that belong in the framework rather than around it.
W-4 … W-7 were reproduced against 2.1.0 and shipped in **2.2.0**. W-8 was reported against 2.2.0 and
shipped in **3.0.0**, which is a major because closing it properly required narrowing a type. This
package installs from npm; nothing here is linked.

W-1 … W-3 were reported earlier and applied (`c10be506`, `d69a8f77`, `d1b7c6b0`). This file starts at
W-4.

**Status: W-4 … W-8 are released and verified against this package from npm. W-9 is open against 3.0.0.**

| | fix | weave commit |
|---|---|---|
| W-4 | `flush()` refuses re-entry | `a23aaa9b` (+ `e47c1c96`, size budget) |
| W-5 | a component's synthesized default returns `Node` | `45e49bdc` |
| W-6 | `Table` — a second header row | `ac43c6ff` |
| W-7 | `Table` — a virtual body | `4962a963` |
| W-8 | a generic component's props no longer collapse to `unknown` | `1fb0dd35` (+ `af4343a0`, the accessors it exposed) |
| W-9 | every non-decimal numeric literal in a template expression is mis-lexed | open |

One more was needed to consume them: `e502f448` (compiler — a comment between the pieces of a split
template is not a non-static template). Without it the published CLI cannot parse the new `Table`
source at all.

Verified here, production build, 20 columns:

- **W-4** — 1000 rows, column set toggled off and back: zero errors, all 1000 checkboxes restored.
  Before: `RangeError` and 360 of 1000 rows left carrying a checkbox the render was removing.
- **W-7** — 1000 × 20 first render goes from **482 ms / 851 ms and 46 414 DOM nodes** to
  **13.8 ms / 16.8 ms and 867 nodes**. The cost stops following the row count: 200 rows measures
  6.2 ms, 1000 rows 13.8 ms, both at 867 nodes.
- **W-5** — `icon.d.ts` now declares `=> Node`.
- **W-6** — `headerRow?: (col) => Node | null` is on `TableProps`.

Two things worth writing down while consuming them:

1. `virtual` is read ONCE at setup, along with its guards (it throws without `maxHeight`, and throws
   if `expandable` is also set). Flipping the prop on a mounted table does nothing — the mode has to
   arrive with a new instance.
2. `virtual` and `expandable` being mutually exclusive is a real constraint for this package: the
   plugin's expandable detail row and a virtual body cannot be used together.

---

## W-4 — `flush()` has no re-entrancy guard, so a write during render recurses per row

**Severity:** crash, with the DOM left inconsistent.
**Where:** `packages/runtime/src/reactive.ts`, `flush()`.

### What happens

```
Uncaught RangeError: Maximum call stack size exceeded
    at runOnce (reactive.ts:162)
    at run (reactive.ts:113)
    at updateIfNecessary (reactive.ts:189)
    at flush (reactive.ts:197)
    at read.set (reactive.ts:236)
    at setRef (dom.ts:185)
    at render16 (checkbox.ts:139)
```

`flush()` guards only on `batchDepth`:

```ts
function flush(): void {
  if (batchDepth > 0) return;
  for (const e of queue) {
    queue.delete(e);
    if (e.state !== CLEAN) updateIfNecessary(e);
  }
}
```

`setRef` (`dom.ts:183`) writes a signal **during render**. So a component that takes a `ref` — which
includes `<Checkbox>` — drains the effect queue *on top of the render that is still running* instead of
appending to it. Rendering a list nests one level per item, and the stack runs out.

### Reproduction

`<Table selectable expandable resizableColumns>` over N rows, then change the column set (add or
remove a column) while it is rendered. Bisected on Chrome/Windows:

| rendered rows | 30 | 50 | 100 | 150 | 200 | 500 | 1000 |
|---|---|---|---|---|---|---|---|
| rows keep identity | ok | ok | ok | ok | **throws** | throws | throws |
| rows replaced too | ok | ok | ok | ok | ok | **throws** | throws |

Aftermath is worse than the throw: the render aborts mid-list. One run left **360 of 1000 rows still
carrying a checkbox** the render was in the middle of removing.

Three conditions, and dropping any one makes it go away:

1. row-level components that write a `ref` during render (selection checkbox, expand toggle, grip);
2. a column-set change on an already-rendered grid;
3. enough **rendered** rows.

Row count alone is not it: with the chrome off, 1000 rows plus a column change is clean, and a fresh
render of 1000 rows with the chrome on is clean.

### `batch` does not help

```ts
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); }
  finally { batchDepth--; flush(); }   // decremented BEFORE flushing
}
```

The render runs inside that `flush()`, with `batchDepth` already back to 0, so every `setRef` inside it
is unguarded again. Wrapping the mutation in `batch` changed nothing, measured.

### Proposed change

```ts
let flushing: boolean = false;

function flush(): void {
  if (batchDepth > 0 || flushing) return;
  flushing = true;
  try {
    for (const e of queue) {
      queue.delete(e);
      if (e.state !== CLEAN) updateIfNecessary(e);
    }
  } finally {
    flushing = false;
  }
}
```

`queue` is a `Set`, and `Set` iteration visits entries added during iteration, so effects queued by a
write made mid-flush are still processed by the outer loop. Nothing is dropped; only the recursion goes.

### Suggested test

Render 1000 rows, each containing a component that takes a `ref`, then change the rendered column set.
Assert no throw and that the resulting DOM matches the new column set for **every** row — the
half-rendered state is the part a "does it throw" test would miss.

---

## W-5 — a compiled component's declaration returns `unknown` instead of `Node`

**Severity:** every imperative call site needs a cast.
**Where:** whatever emits component `.d.ts` (observed in `@weave-framework/ui/dist/*`).

### What happens

```ts
// node_modules/@weave-framework/ui/dist/icon/icon.d.ts
declare const _weaveDefault: (props: Parameters<typeof setup>[0], slots?: Record<string, () => unknown>) => unknown;
export default _weaveDefault;
```

But the runtime type is exact:

```ts
// packages/runtime/src/dom.ts:1085
export type Component = (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node;
```

A component always returns a `Node`. The declaration says it might return anything.

### Why it matters beyond one cast

Anywhere a component is called imperatively rather than through a template, the result has to be cast.
That is most of the interesting composition surface: `<Table>`'s `cell: (row) => Node | string`,
`<Expansion>`'s panel bodies, anything taking a `Node`. In this package it means a consumer registering
their own cell component would need a cast at the registration site, so `extra` carries a
`CellComponent` alias whose only purpose is to absorb it.

### Proposed change

Emit `=> Node`, and `slots?: Record<string, () => Node>`. Pure narrowing; no runtime change, and it
deletes the workaround alias here.

---

## W-6 — `<Table>` needs a second header row for per-column filters

**Severity:** feature gap that cannot be worked around from outside.
**Where:** `packages/ui/src/table/table.ts`.

### What is missing

A per-column filter row belongs inside `<thead>`, immediately under the header cells. `<Table>`'s
template is a fixed string with no slots, so it cannot be injected from a consumer.

Rendering the filters as a sibling element above the table only aligns when **every** column has an
explicit width. Columns without one auto-size, and the two rows drift apart. There is no version of
this that works from outside.

### Proposed change

```ts
/** Rendered as a second row inside <thead>, under the column headers. Return null for no cell. */
headerRow?: (col: TableColumn<T>) => Node | null;
```

Rendered as one `<tr>` after the header row, each cell inheriting the same width, alignment and
sticky treatment as its header cell, with empty cells for the synthetic expand/select columns.

### Why upstream rather than in `extra`

Per-column filtering is standard data-grid furniture. The alternative is for `extra` to ship its own
grid, which means duplicating sorting, selection, expansion, sticky columns and keyboard column
resize — all of which `<Table>` already does well, and all of which would then rot separately.

---

## W-7 — `<Table>` renders every row; a virtual body is the follow-on already noted in its source

**Severity:** performance, and it bounds W-4.
**Where:** `packages/ui/src/table/table.ts` (its own header comment: "Virtual body is the noted
follow-on"). `packages/ui/src/cdk/virtual-scroll.ts` already exists.

### Measurements

Production build, `weave build --minify`, mixed cell types (10 text, 3 number, 2 timestamp, 2 enum,
2 component-backed, 1 action column), selection + expansion + resize on:

| rows × cols | cells | DOM nodes | build | + layout |
|---|---|---|---|---|
| 50 × 20 | 1 050 | 2 394 | 33 ms | 48 ms |
| 200 × 20 | 4 200 | 9 341 | 65 ms | 109 ms |
| 500 × 20 | 10 500 | 23 250 | 212 ms | 313 ms |
| 1000 × 20 | 21 000 | 46 414 | 482 ms | 851 ms |

Linear, ~15 µs per cell. Re-sorting is already cheap — 0.3 ms build / 5.7 ms laid out at 200 rows —
because `trackBy` moves existing DOM, so the cost is specifically **first render of a large page**.

### Interaction with W-4

W-4's recursion depth scales with *rendered* rows, not with the dataset. A virtual body renders a
viewport's worth — roughly 20–40 — which is about 5× under the observed 150–200 threshold.

That is headroom, not a repair. The threshold is a stack budget that moves with the browser and with
how many frames each row costs, and every other long list of `ref`-bearing components stays exposed.
**W-4 should be fixed on its own merits; W-7 is worth doing for the 482 ms.**

---

## W-8 — a generic component's props are checked against `unknown` — FIXED in 3.0.0

**Specification as submitted: [w-8-generic-component-props.md](w-8-generic-component-props.md).**

A component whose `setup` was generic shipped a default export with the type parameter thrown away.
Both producers flattened it — `tools/ui-typed-default.mjs` (`Parameters<typeof setup>[0]`, the
shipped `.d.ts`) and `packages/check/src/emit.ts` (`__WeavePropsOf<typeof setup>`, the virtual
module) — and an uninstantiated generic resolves its parameter to `unknown`, not to the declared
default. Six components: `autocomplete`, `list`, `select`, `table`, `tabs`, `tree`.

The loud half was `Select<Option>(…)` refusing to compile. The quiet half mattered more: a template
checked its props against that same flattened default, so `options` was `unknown[]` and

```ts
{ options: [{ nothing: 'like an option' }, 42, null] }
```

compiled clean — with no way for an author to opt out, because a template cannot write a type
argument.

### What shipped

`1fb0dd35` re-declares the parameters from the source onto the synthesized default (they cannot be
recovered by substitution over `typeof setup`; the list has to be written out), through **one reader
called by both producers**, so the shipped `.d.ts` and the editor cannot check different contracts.
Templates now check props by **calling** the component, so the parameter is inferred from what is
passed rather than re-flattened.

`af4343a0` is the part the spec's acceptance criterion 4 forced and I had not foreseen: restoring the
type parameter alone did **not** make the reported case fail, because `SelectProps<T>` asked nothing
of `T` — any array satisfied it. `<Select>`/`<Autocomplete>` now require `optionValue` + `optionLabel`
for an option type the defaults cannot read. That is a break, hence the major.

### What it cost this package

Nothing. `Option` here is `{ value: string; label: string }` — self-describing, so the accessors stay
optional and the filter row compiled against 3.0.0 unchanged. The workaround came out: `selectFilter`
names `Select<Option>` again, which is what makes its option shape checked at all.

Verified before and after against the shipped declaration — all four reported cases reproduced on
2.2.0 and behave on 3.0.0.

---

## W-9 — every non-decimal numeric literal in a template expression is mis-lexed

**Full specification: [w-9-numeric-literals.md](w-9-numeric-literals.md)** — written to be handed to
the framework repo as-is.

The expression tokenizer in `packages/compiler/src/scope.ts` has no number-literal branch. Digits
fall through to the copy-a-character default, so the first character inside a literal that can START
an identifier — `_`, `x`, `b`, `o`, `e`, `n` — begins one, and the scope pass qualifies it against
the component context:

```
182_400  ->  182ctx._400          0xFF   ->  0ctx.xFF        1e3  ->  1ctx.e3
0b1010   ->  0ctx.b1010           0o17   ->  0ctx.o17        9n   ->  9ctx.n
```

Only a plain integer and a plain decimal survive. All of these are valid ECMAScript, and `0xFF`
needs no separator and no unusual style.

**Correction to the first version of this entry**, which reported it as a numeric-SEPARATOR bug
because that is the form that happened to bite. It is every non-decimal literal, and the narrow
reading would have been fixed by a change that left `0xFF` broken.

Verified through the compiler's own API rather than by reading it. The obvious first probe reports
the compiler as healthy: `compileTemplate` leaves unknown names bare, so the split stays invisible
there. A real component compiles in ctx mode, where every unbound identifier becomes `ctx.<name>` —
so any reproduction has to go through `compileComponent`.

**Workaround here**: `182400` in the markup, or the literal in `setup()` and a name in the template.
The same literal in a `.ts` file compiles correctly; it is only the template path.
