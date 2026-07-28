# components/

Standalone components that do not exist in `@weave-framework/ui` — they may *use* UI components and
the CDK, but they are new surfaces, not modified copies of an existing one.

Import path: `@weave-framework/extra/components/<name>`

Layout, one directory per component, mirroring `@weave-framework/ui`:

```
components/data-grid/
  data-grid.ts        setup() + props
  data-grid.html      sibling template
  data-grid.scss      styles (optional; token-based)
```

Each component gets its own entry in the root `exports` map — `types`/`import`, plus `sass` when it
ships styles.

Rules:

- Build on `@weave-framework/ui` tokens (`--weave-*`); do not introduce a parallel design system.
- Keep the UI library's API conventions: class forwarding, `label`, controlled `value` + `onChange`,
  or a structurally-typed `control` prop instead of a hard dependency on `@weave-framework/forms`.
- Accessibility follows WAI-ARIA APG, verified by test, not by comment.
