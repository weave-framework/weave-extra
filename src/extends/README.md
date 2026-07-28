# extends/

Extensions of components that already exist — a component file that declares
`export const extend = Base` (RFC 0008, shipped since npm 1.1.0 / 1.2.0).

Import path: `@weave-framework/extra/extends/<name>`

## Two modes — one per extension, never mixed

**Mode `#1` — full template override.** The extension ships its own template and composes the base's
setup context. Works against **any** base, including one installed from npm.

```ts
// data-grid.ts
import Table from '@weave-framework/ui/table';
import { computed } from '@weave-framework/runtime';

export const extend = Table;

// optional — reshape props BEFORE the base setup reads them
export function extendProps(props) {
  return { ...props, rows: props.rows.map(normalize) };
}

// `base` is the base's setup context; override existing keys or add new ones
export function setup(props, base) {
  return { ...base, totalCount: computed(() => base.rows().length) };
}
```

**Mode `#3` — declarative template patches.** No template of its own; a static
`export const patch = [ … ]` of ops the compiler applies to the base's template AST at build time
(so a patch on a `@for` row also hits rows generated at runtime).

```ts
export const extend = LocalBase;
export const patch = [
  { op: 'attr', sel: '.row', attr: 'on:dblclick={{ open(item) }}' },
  { op: 'prepend', sel: 'tbody', html: '<tr class="summary">…</tr>' },
];
```

Ops: `attr`, `removeAttr`, `prepend`, `append`, `before`, `after`, `replace`, `wrap`, `remove`.
Selectors: `tag`, `.class`, `[attr]`, `[attr=value]`. A selector matching nothing throws — fail-loud.

## The constraint that decides the mode here

Mode `#3` is **local-base only**. A published package ships compiled output and SCSS, not raw
templates — `@weave-framework/ui` has no `.html` on npm for the compiler to patch. So:

- extending a `@weave-framework/ui` component → **mode `#1`**;
- patching a component that lives in this repo → mode `#3` is available.

Mode `#1` additions are also fully type-checked; `#3` patch strings are not.
