# plugins/

Behaviour and service extensions that are not components — directives used through `use:`, CDK-level
primitives, service wrappers, and anything that plugs into an existing Weave subsystem.

Import path: `@weave-framework/extra/plugins/<name>`

Typical shapes:

- **`use:` directives** — `(el: Element, value: () => T) => void | (() => void)`; the returned
  function is the cleanup, run on disposal.
- **CDK-level primitives** — overlay, focus, positioning, drag-drop behaviours composed from
  `@weave-framework/ui/cdk`.
- **Service extensions** — additional validators for `@weave-framework/forms`, interceptors or
  cache layers for `@weave-framework/data`, router guards, i18n formatters.

Rules:

- No side effects at module scope — the package is `sideEffects: false` and must stay tree-shakable.
- Own every listener and timer you create; register cleanup through the owner, never leave a
  detached listener behind.
- A plugin extending a subsystem depends on that subsystem as a **peer**, never bundling its own copy.
