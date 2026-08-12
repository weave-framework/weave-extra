# weave-extra

Extras for [Weave](https://github.com/weave-framework/weave) — the fine-grained reactive, signal-native
UI framework. Additional components, extensions of existing ones, and plugins, published as a single
package: **`@weave-framework/extra`**.

## Import paths

Nothing is exported from the package root — every entry has its own subpath, so a consumer pays only
for what it names:

```ts
import Chart from '@weave-framework/extra/components/chart';
import Metric from '@weave-framework/extra/components/metric';
import Split from '@weave-framework/extra/components/split';
import SplitPane from '@weave-framework/extra/components/split-pane';
import { tablePlugin } from '@weave-framework/extra/plugins/table';
```

| Bucket | What belongs there |
|---|---|
| [`components/`](src/components) | New standalone components that do not exist in `@weave-framework/ui` |
| [`extends/`](src/extends) | Extensions of existing components — `export const extend = Base` (RFC 0008) |
| [`plugins/`](src/plugins) | `use:` directives, CDK primitives, and service extensions (forms, data, router, i18n) |

Each bucket's README states its layout and rules.

## Documentation

| Extra | Reference |
|---|---|
| `components/chart` | [docs/chart.md](docs/chart.md) — one component for every chart: bars, lines, areas, pie and donut, candlesticks and OHLC, plus the scales, animation clock, palette and morphing it is built from |
| `components/metric` | [docs/chart.md §11](docs/chart.md#11-sparklines-and-metric) — the KPI tile, and why a delta's colour follows its meaning rather than its sign |
| `plugins/table` | [docs/table-plugin.md](docs/table-plugin.md) — column configuration, cell types, actions, filters, selection, paging, and the rules a cell must follow |

Live counterparts run in the examples app (`pnpm run examples`). Each has a pair of pages: the
**recipes** one is a single feature per section with its own complete source underneath, and the
other is the same surface assembled the way a real screen uses it.

## Requirements

`@weave-framework/runtime` and `@weave-framework/ui` (>= 3.0) are **peer** dependencies — this package
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
pnpm test
```

`pnpm run typecheck` (plain `tsc`) is the check that counts. `weave check` does not type-check this
package's `src` — it reports no errors on a file containing an identifier that exists nowhere.

`pnpm test` builds first and runs `node --test` against `dist/`, with no framework and no config.
Testing the built output rather than the source is deliberate: it is what consumers get, so a build
that drops a module fails here rather than at someone else's install. See
[test/README.md](test/README.md) for what earns a test.

## Publishing

```bash
pnpm run build
pnpm publish --access public
```

**`pnpm publish`, not `npm publish`.** The manifest's `exports`, `main` and `types` point at
`src/*.ts` so the repo and the examples resolve TypeScript directly; `publishConfig` swaps them for
`dist/*.js` at publish time. pnpm applies those overrides — npm 11.17 does **not**. Published with
npm, the tarball ships `dist` (per `files`) while its manifest still points at `src`, so every
consumer import resolves to a file that is not in the package.

Verify before publishing, rather than trusting it:

```bash
pnpm pack --pack-destination /tmp && tar -xzOf /tmp/weave-framework-extra-*.tgz package/package.json
```

The `exports` in that output must read `./dist/…`.

## License

MIT © Aidas Josas
