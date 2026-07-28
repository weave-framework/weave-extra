# components/

Standalone components that do not exist in `@weave-framework/ui` — they may *use* UI components and
the CDK, but they are new surfaces, not modified copies of an existing one.

Import path: `@weave-framework/extra/components/<name>`

Layout, one directory per component, mirroring `@weave-framework/ui`:

```
components/data-grid/
  data-grid.ts        setup() + props
  data-grid.html      sibling template
  data-grid.scss      styles — scoped to this component, compiled into the module
```

Each component gets its own `types`/`import` entry in the root `exports` map.

**Styles belong to the component, beside the component.** There is no shared stylesheet tree and
nothing for a consumer to remember to include: the compiler scopes `data-grid.scss` to
`data-grid.ts` and folds it into the built module, so importing the component brings its styles.
(`weave.config.ts` sets `styleLang: 'scss'`, which is what pairs the two by name.)

Rules:

- Read every value through `var(--weave-<component>-<token>, var(--weave-color-<x>, <literal>))` —
  overridable per component, follows the Weave theme when there is one, and still looks deliberate
  when there is not. Do not introduce a parallel design system.
- A component styles only what it renders. A selector reaching into a child component's markup will
  not survive scoping — put the rule in that child, or rely on inheritance.
- Keep the UI library's API conventions: class forwarding, `label`, controlled `value` + `onChange`,
  or a structurally-typed `control` prop instead of a hard dependency on `@weave-framework/forms`.
- Accessibility follows WAI-ARIA APG, verified by test, not by comment.
