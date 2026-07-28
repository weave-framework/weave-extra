/**
 * Deliberately empty root barrel.
 *
 * `@weave-framework/ui` ships the same way: importing the package root must not pull every component
 * into the bundle. Everything here is reached through its own subpath export —
 * `@weave-framework/extra/components/<name>`, `/extends/<name>`, `/plugins/<name>` — so a consumer
 * pays only for what it names.
 */
export {};
