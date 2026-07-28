# examples

A live page per extra, built with Weave itself.

```bash
pnpm run examples        # dev server on :8180
pnpm run examples:build  # static build into examples/dist
```

Pages import through the package's own name — `@weave-framework/extra/components/split`, resolved by
Node's self-reference through this package's `exports` map — rather than by relative path. A missing
or misspelled export entry therefore fails here rather than in someone else's app.

Adding an extra: one entry in `PAGES` (`src/app/shell.ts`), one `@case` in `shell.html`, one page
under `src/pages/`.

## Known limitation: these files are not type-checked

`weave check` and `pnpm run typecheck` cover `src/` — the published package — and not this directory.
`pnpm run examples:build` goes through esbuild, which strips types without reading them, so it
catches template PARSE errors here but no type errors.

Giving the examples their own check scope was tried and reverted. The examples import the extra's
components by package name, which self-resolves to source; from a scope rooted here the checker reads
`split.ts` as an ordinary module and reports the default export — the one the compiler generates at
build time — as missing. Every page produced two such errors. A gate that reports failures that are
not real gets ignored, and an ignored gate is worse than an absent one.

What that leaves: parse errors are caught by the build (in CI), type errors here are not caught at
all. Worth revisiting if the checker learns to treat a self-referenced package's source as components.
