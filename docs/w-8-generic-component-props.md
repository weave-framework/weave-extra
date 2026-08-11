# W-8 — a generic component's props are checked against `unknown`

**Package:** `@weave-framework/check`, `@weave-framework/ui` (build tooling)
**Found against:** 2.2.0
**Reported from:** `@weave-framework/extra` — the table plugin's filter row
**Severity:** silent loss of type checking in templates; hard compile errors imperatively

---

## Summary

A component whose `setup` is generic ships a default export that has thrown the type parameter away.
Both producers of that default flatten `setup`'s first parameter through a conditional/`Parameters<>`
extraction, and TypeScript resolves an *uninstantiated* generic's parameter to `unknown` — **not** to
its declared default.

The consequence is not only that `Select<Option>(…)` will not compile. It is that in a **template**,
where the props are checked as `Parameters<typeof Select>[0]`, `options` has type `unknown[]` and
accepts anything at all. The checking a component's author wrote `SelectProps<T>` to provide is
absent, and nothing reports it.

Six components in `@weave-framework/ui` are affected: **`autocomplete`, `list`, `select`, `table`,
`tabs`, `tree`** — i.e. every data-driven one.

---

## Reproduction

Against `@weave-framework/ui@2.2.0`, no Weave build involved — plain `tsc`:

```ts
import Select from '@weave-framework/ui/select';

// Exactly what packages/check/src/emit.ts emits for a `<Select …>` tag in a template.
type TemplateProps = NonNullable<Parameters<typeof Select>[0]>;

// 1. NO ERROR. The option shape is not checked at all.
const absurd: TemplateProps = {
  options: [{ nothing: 'like an option' }, 42, null],
};

interface Option { value: string; label: string }

// 2. TS2322: '(o: Option) => string' is not assignable to '(item: unknown) => string'.
const typed: TemplateProps = {
  options: [{ value: 'a', label: 'A' }] as Option[],
  optionValue: (o: Option): string => o.value,
};

// 3. TS2322: 'unknown' is not assignable to 'string'. No inference from `options`.
const change: TemplateProps = {
  options: [],
  onChange: (v): void => {
    const check: string = v;
  },
};
```

Imperatively there is a fourth:

```ts
Select<Option>({ options })
// TS2558: Expected 0 type arguments, but got 1.
```

Case 1 is the serious one. Cases 2–4 are loud and can be worked around; case 1 means a template
passing a malformed option array compiles clean.

---

## Root cause

`setup` is generic:

```ts
// packages/ui/src/select/select.ts
export function setup<T = { value: string; label: string }>(props: SelectProps<T>): SelectContext<T>
```

Two separate producers synthesize the default export, and both flatten it:

**1. The shipped `.d.ts`** — `tools/ui-typed-default.mjs`, `typeDefault()`:

```js
const propsType = hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
…
`const _weaveDefault = ${tail} as unknown as (props: ${propsType}, slots?: Record<string, () => Node>) => Node;`
```

producing, in `dist/select/select.d.ts`:

```ts
declare const _weaveDefault: (props: Parameters<typeof setup>[0], slots?: Record<string, () => Node>) => Node;
export default _weaveDefault;
```

**2. The virtual module `weave check` and the editor tooling see** —
`packages/check/src/emit.ts:493, 510, 516`:

```ts
type __WeavePropsOf<F> = F extends (props: infer P, ...rest: any[]) => any ? P : Record<string, never>;
…
const baseProps = hasSetup ? '__WeavePropsOf<typeof setup>' : 'Record<string, never>';
declare const __weaveDefault: (props: ${propsType}, slots?: Record<string, () => Node>) => Node;
```

Both spellings have the same defect: `Parameters<F>` and `F extends (props: infer P, …)` applied to
an uninstantiated generic function type give `P` with every type parameter resolved to `unknown`.
The declared default (`T = { value: string; label: string }`) is **not** used — that default only
applies when the function is *called* without an explicit argument, not when its type is destructured.

And the flattened result is a plain `const`, so there is no parameter left for a caller to supply.

### Why templates are hit too

`emit.ts:283` checks a component tag's props against the default export, not against `setup`:

```ts
const __props0: NonNullable<Parameters<typeof Select>[0]> = { … };
```

so the template inherits the same `unknown` instantiation. A template cannot even write a type
argument, so there is no way for an author to opt out of it.

A fix applied to only one producer leaves the other disagreeing — the shipped `.d.ts` and the
editor's view of the same component would then check different contracts.

---

## Proposed fix

Carry `setup`'s type parameters onto the synthesized default instead of erasing them:

```ts
// desired, dist/select/select.d.ts
declare const _weaveDefault: <T = { value: string; label: string }>(
  props: SelectProps<T>,
  slots?: Record<string, () => Node>
) => Node;
export default _weaveDefault;
```

With that, all four cases above behave: case 1 errors, case 2 compiles, cases 3–4 infer `T` from
`options`.

Neither producer can express this by string substitution over `typeof setup`, because the parameter
list has to be re-declared. Two routes:

**A. Emit the parameters from the source declaration.** Both producers already read `setup`; read its
type parameter list and its first parameter's type annotation, and re-emit them verbatim:

```ts
declare const _weaveDefault: <TParams>(props: <FirstParamType>, slots?: Record<string, () => Node>) => Node;
```

For a non-generic `setup` this is byte-identical to today's output, so nothing else changes. It needs
the first parameter's annotation to be written explicitly, which is already the convention in `ui`
(and can be required — see acceptance criteria).

**B. Keep the extraction but make the default generic and re-instantiate.** Requires a helper that
re-applies a type argument to an extracted props type, which TypeScript cannot express in general.
Route A is the practical one.

### Interaction with `propDefaults`

`emit.ts` wraps the props in `__WeaveWithDefaults<P, D>` when the module exports `propDefaults`. That
composes fine with route A — the wrapper applies to the (now generic) props type:

```ts
declare const __weaveDefault: <T = …>(
  props: __WeaveWithDefaults<SelectProps<T>, typeof propDefaults>,
  slots?: Record<string, () => Node>
) => Node;
```

### Interaction with `extend`

`export const extend = Base` components go through `extendSetup(extend, setup)` in the emitted tail.
`typeDefault()` reads that tail back rather than rebuilding it, so route A does not disturb it — only
the type annotation changes.

---

## Acceptance criteria

1. `Select<Option>({ options })` compiles.
2. `optionValue: (o: Option) => o.value` compiles when `options: Option[]`.
3. `onChange`'s parameter is inferred from `options`, not `unknown`.
4. `{ options: [{ nothing: 'x' }, 42, null] }` **fails** to compile, in a template and imperatively.
5. A non-generic component's emitted default is unchanged, byte for byte.
6. `weave check`'s virtual module and the shipped `.d.ts` agree — same contract, same diagnostics.
7. `tools/verify-ui-typed-default.mjs` gates the new shape for all six generic components.
8. A `setup` whose first parameter has no explicit type annotation either keeps today's behaviour or
   fails the build with a message naming the component — silently degrading to `unknown` is what
   this issue is about.

Worth a fixture per generic component (`autocomplete`, `list`, `select`, `table`, `tabs`, `tree`),
since each declares its parameter differently — `T = unknown`, `T = Record<string, unknown>`,
`N = unknown`, and an inline object default.

---

## Current workaround, and its limit

In `@weave-framework/extra` the filter row builds its options in the shape `<Select>` already assumes
(`{ value: string; label: string }`) and omits `optionValue`/`optionLabel` entirely — their defaults
read exactly those fields, so nothing changes at runtime and no cast is needed.

That works only because those options happen to match the declared default. A caller whose options
are a domain object has no way out but `(item: unknown)` and a cast inside every accessor — and in a
template, no way to get the checking back at all.

---

## Relationship to W-5

W-5 fixed the **return** type of this same synthesized default (`unknown` → `Node`). This is the same
declaration and the same class of loss, one field over: its **type parameters**. Fixing it in the
same place keeps the two consistent.
