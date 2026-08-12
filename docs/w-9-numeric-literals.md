# W-9 — every non-decimal numeric literal in a template expression is mis-lexed

**Package:** `@weave-framework/compiler`
**Found against:** 3.0.0
**Reported from:** `@weave-framework/extra` — `<Metric value={{ 182_400 }} />`
**Severity:** build failure on valid ECMAScript; hex, exponent, BigInt, binary, octal and separators

---

## Summary

The expression tokenizer has no number-literal branch. Digits fall through to its default
copy-a-character path, so the moment a character that can *start an identifier* appears inside a
numeric literal — `_`, `x`, `b`, `o`, `e`, `n` — the scanner begins an identifier there and the
scope pass qualifies it against the component context.

In component mode every bare name resolves to `ctx`, so this always fires:

| written | emitted |
| --- | --- |
| `182_400` | `182ctx._400` |
| `1_000.5` | `1ctx._000.5` |
| `0xFF` | `0ctx.xFF` |
| `0xDE_AD` | `0ctx.xDE_AD` |
| `0b1010` | `0ctx.b1010` |
| `0o17` | `0ctx.o17` |
| `1e3` | `1ctx.e3` |
| `1e+3` | `1ctx.e+3` |
| `1.5e-3` | `1.5ctx.e-3` |
| `9007199254740993n` | `9007199254740993ctx.n` |

Only a plain integer (`1000`) and a plain decimal (`1.5`, `0.5`) survive. Everything else is a build
error:

```
X [ERROR] Syntax error "c"
    examples/src/pages/chart.ts:326:69:
      326 │ ...enue", get value() { return 182ctx._400; }, get delta() { retu...
```

All of these are valid ECMAScript. `0xFF` needs no separator and no unusual style — a mask, a colour,
a char code — and it does not compile in a template today.

---

## Reproduction

No app required; the compiler's own API is enough.

```js
import { compileComponent } from '@weave-framework/compiler';

const script = 'export function setup() { const a = 1; return { a }; }';
const out = compileComponent({ script, template: '<X v={{ 0xFF }} />', name: 'p' }, {});
// out.code contains:  get v() { return 0ctx.xFF; }
```

In an application it surfaces as a build failure pointing at generated code, with the source span
mapped back to the page — which is what makes it read as a mysterious syntax error rather than as a
lexing bug.

---

## Root cause

`packages/compiler/src/scope.ts`. The tokenizer handles comments, regex literals, strings and
template literals, then falls through to:

```ts
const ID_START: RegExp = /[A-Za-z_$]/;
const ID_CHAR: RegExp = /[A-Za-z0-9_$]/;
…
if (ID_START.test(c)) {
  let j: number = i + 1;
  while (j < n && ID_CHAR.test(expr[j])) j++;
  const name: string = expr.slice(i, j);
  …
}
```

There is no branch for a numeric literal anywhere in the loop (`grep` for a digit class in that file
returns nothing), and `ID_START` is tested without regard to what precedes it. `182_400` is copied as
`1`, `8`, `2`, and then `_` starts an identifier: `_400`.

### Why it looked intermittent

The split is invisible unless the suffix resolves in scope. Checked directly:

```js
rewrite('182_400', ctxScope(new Set()),        'ctx').code  // '182_400'    — clean
rewrite('182_400', ctxScope(new Set(['_400'])), 'ctx').code // '182ctx._400' — broken
```

`compileTemplate` on its own leaves unknown names bare, so the bug does not reproduce there. A real
component compiles in **ctx mode**, where every unbound identifier becomes `ctx.<name>` — so in an
application it fires every time. Any minimal reproduction must go through `compileComponent`, which
is worth saying because the obvious first probe reports the compiler as healthy.

---

## Proposed fix

Consume a numeric literal as one token, before the identifier branch. It has to cover the whole
grammar rather than just the underscore that prompted the report:

```
DecimalLiteral       1000  1.5  .5  1e3  1e+3  1.5e-3  1_000  1_000.5
HexIntegerLiteral    0xFF  0xDE_AD
BinaryIntegerLiteral 0b1010  0b1010_1010
OctalIntegerLiteral  0o17  0o1_7
BigIntLiteralSuffix  1n  0xFFn  9007199254740993n
LegacyOctal          017        (sloppy mode only; treating it as decimal is fine here)
```

The narrow alternative — refusing an `ID_START` match whose preceding character is a digit — fixes
the emitted output but leaves the tokenizer without a notion of numbers, so `1.toString()` and
`.5.toFixed(1)` stay unhandled and the next reader has to rediscover this. A real token is the
smaller long-term cost.

Two places worth checking for the same gap: `auto-return.ts` keeps its own token scanner
(`ID_CHAR` appears there too, in the division-versus-regex disambiguation), and any other scanner
that classifies a preceding token by its last character will also read the tail of a numeric literal
as an identifier.

---

## Acceptance criteria

1. Every row in the table above emits the literal unchanged.
2. A binding actually named `n`, `e3` or `_400` in the component still rewrites correctly when it
   appears as a real reference: `{{ n }}` → `ctx.n`, and `{{ 9n }}` stays `9n` in the same component.
3. `1.toString()` and `(0.5).toFixed(1)` compile.
4. A numeric literal inside a string or a template literal is untouched, as today.
5. Source-map segments still line up — the literal is one verbatim run, so coverage should improve
   rather than regress.

Worth a fixture per literal form; a single "separators work" test would have passed while `0xFF` was
still broken, which is how the narrow reading of this bug survives.

---

## Workaround

Write the literal in `setup()` and reference it by name, or spell it in a form the tokenizer
survives — `182400`, `255`, `1000`. Nothing needs to change in a `.ts` file: the same literal
compiles correctly there. It is only the template path.
