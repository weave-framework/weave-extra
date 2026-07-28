/**
 * Gate: every component stylesheet compiles, emits the tokens it declares, and does so without
 * warnings.
 *
 * A token typo is invisible at the CSS level — `--weave-split-gutter-hovr: #eee` is a perfectly
 * valid custom property that no rule will ever read, so the component just renders slightly wrong
 * with nothing to explain why. Sass reports it as a WARNING, which a plain `sass` invocation prints
 * and then exits 0 on. This treats warnings as failures so the typo cannot ship.
 *
 * It also asserts the emitted CSS actually contains `--weave-<name>-*` declarations: a stylesheet
 * that compiles to nothing is the other silent failure, and "it built fine" would otherwise cover it.
 */
import { compileString, NodePackageImporter } from 'sass';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const componentsDir = join(repo, 'src/styles/components');

console.log('\ntools/verify-styles.mjs');

if (!existsSync(componentsDir)) {
  console.log('ok  no component stylesheets yet\n');
  process.exit(0);
}

const names = readdirSync(componentsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let failures = 0;

for (const name of names) {
  const entry = join(componentsDir, name, '_index.scss');
  if (!existsSync(entry)) {
    console.error(`  x ${name}: no _index.scss`);
    failures++;
    continue;
  }

  // The theme must be included too — the component's tokens resolve to `var(--weave-color-*)`, and
  // compiling without it would pass while emitting references to variables that do not exist.
  const source = [
    `@use 'pkg:@weave-framework/ui' as weave;`,
    `@use './${name}/index' as component;`,
    `@include weave.theme();`,
    `@include component.all();`,
  ].join('\n');

  const warnings = [];
  try {
    const result = compileString(source, {
      // Anchor relative `@use` at the components directory, so `./<name>/index` resolves.
      url: pathToFileURL(join(componentsDir, `__verify-${name}.scss`)),
      importers: [new NodePackageImporter()],
      logger: {
        warn(message, options) {
          warnings.push(`${message}${options?.span?.url ? ` (${options.span.url})` : ''}`);
        },
      },
    });

    const emitted = new RegExp(`--weave-${name}-[a-z0-9-]+\\s*:`).test(result.css);
    if (!emitted) {
      console.error(`  x ${name}: compiled but emitted no --weave-${name}-* custom properties`);
      failures++;
      continue;
    }
    if (warnings.length) {
      for (const warning of warnings) console.error(`  x ${name}: ${warning}`);
      failures += warnings.length;
      continue;
    }
    console.log(`  ok ${name} (${result.css.length} bytes)`);
  } catch (error) {
    console.error(`  x ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failures++;
  }
}

if (failures) {
  console.error(`\nx ${failures} stylesheet problem(s).\n`);
  process.exit(1);
}
console.log(`ok  ${names.length} component stylesheet(s) compile cleanly\n`);
