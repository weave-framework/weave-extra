# weave-extra

Extras for [Weave](https://github.com/weave-framework/weave) — the fine-grained reactive, signal-native
UI framework. Additional components, extensions of existing ones, and plugins, published as a single
package: **`@weave-framework/extra`**.

## Import paths

Nothing is exported from the package root — every entry has its own subpath, so a consumer pays only
for what it names:

```ts
import DataGrid from '@weave-framework/extra/components/data-grid';
import DataGrid from '@weave-framework/extra/extends/data-grid';
import { dataGrid } from '@weave-framework/extra/plugins/data-grid';
```

| Bucket | What belongs there |
|---|---|
| [`components/`](src/components) | New standalone components that do not exist in `@weave-framework/ui` |
| [`extends/`](src/extends) | Extensions of existing components — `export const extend = Base` (RFC 0008) |
| [`plugins/`](src/plugins) | `use:` directives, CDK primitives, and service extensions (forms, data, router, i18n) |

Each bucket's README states its layout and rules.

## Requirements

`@weave-framework/runtime` and `@weave-framework/ui` (>= 2.1) are **peer** dependencies — this package
never bundles its own copy.

## Examples

A live page for everything in here — one section per extra, imported through the package's own name
so the `exports` map is exercised the way a consumer resolves it.

```bash
pnpm run examples
```

## Development

```bash
pnpm install
pnpm run typecheck
```

## License

MIT © Aidas Josas
