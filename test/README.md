# Tests

```bash
pnpm test
```

No framework, no runner, no config: `node --test` and `node:assert`. The engine's arithmetic is pure
functions, and pure functions need a way to call them and a way to say what should come back.

**They run against `dist/`, not `src/`.** Building first costs a few seconds and buys the thing worth
having — these test what is actually published, so a build that silently drops a module or an
`exports` entry that points nowhere fails here rather than at a consumer. It is also forced: Node
strips types happily but does not rewrite a `./motion.js` specifier to the `motion.ts` beside it, so
the source cannot be imported directly at all.

## What is worth a test here

Every case below is either **a decision that could be quietly reversed** or **a bug that actually
happened**. Nothing asserts that a function returns a number.

The ones that came from real defects are marked in place, and they are the reason the suite exists:
`timeScale` printing "02:00 AM" twice, `fitArc` floating a semicircle in the top half of its box,
`isUp` colouring a down day green, and the stagger arithmetic that had to keep each mark's own
motion at full length.

What is *not* here: anything needing a DOM. `layout()` measures text through a canvas, `morph()`
samples SVG geometry, and the chart component is a component. Those are verified in a browser
against the examples app, which is where their failures are visible in the first place.
