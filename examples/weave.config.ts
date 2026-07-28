import { defineConfig } from '@weave-framework/cli';

/**
 * The examples site — one small page per extra, built with Weave itself.
 *
 * It imports the components the way a real consumer does (`@weave-framework/extra/components/split`,
 * resolved by this package's own `exports` map through Node's self-reference), so a broken or
 * forgotten export entry fails here rather than in someone else's app.
 *
 * `styleLang` MUST stay in step with `weave.styleLang` in package.json — the loader pairs a component
 * with `<base>.<styleLang>` and does not probe, so a mismatch renders every component unstyled with
 * nothing reporting it. `tools/verify-styles.mjs` fails the build if the two drift apart.
 */
export default defineConfig({
  root: 'src/app/shell',
  index: 'src/index.html',
  // Explicit, and not optional: with no `publicDir` the static web root defaults to this config's own
  // directory, which `weave build` then tries to copy into `examples/dist` — a directory inside
  // itself. The build fails with an EINVAL from `cp` that reads like a filesystem problem.
  publicDir: 'public',
  outDir: 'dist',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'],
  dev: { port: 8180 },
  build: { minify: true },
});
