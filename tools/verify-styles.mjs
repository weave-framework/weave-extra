/**
 * Gate: every component stylesheet compiles, produces CSS, and does so without warnings.
 *
 * Sass reports an undefined variable, a deprecated API or a bad `@use` as a WARNING, and a plain
 * `sass` invocation prints it and then exits 0. That is the worst way to fail — the component renders
 * slightly wrong and the build says nothing. Warnings are failures here.
 *
 * A stylesheet that compiles to NOTHING is the other silent failure: "it built fine" covers it
 * completely, so an empty result fails too.
 *
 * Component styles live beside their component (`split.ts` → `split.scss`), so this walks `src/`
 * rather than a separate style tree.
 */
import { compile, NodePackageImporter } from 'sass';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repo, 'src');

/**
 * `weave.styleLang` in package.json is the one source of truth (the build reads it; a
 * `weave.config.ts` cannot hold it because that file must be app-shaped). Any app in this repo
 * restates it in its own config, and the two silently diverging is the failure worth gating: the
 * loader pairs a component with `<base>.<styleLang>` and does NOT probe, so a mismatch renders every
 * component unstyled with nothing anywhere reporting a problem.
 */
function verifyStyleLangAgreement() {
  const declared = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).weave?.styleLang ?? 'css';
  const configs = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name === 'weave.config.ts' || entry.name === 'weave.config.json') configs.push(full);
    }
  };
  scan(repo);

  let bad = 0;
  for (const config of configs) {
    const match = /styleLang\s*:?\s*['"](css|scss|sass)['"]/.exec(readFileSync(config, 'utf8'));
    const found = match ? match[1] : 'css';
    if (found !== declared) {
      console.error(
        `  x ${relative(repo, config).replace(/\\/g, '/')}: styleLang is "${found}" but ` +
          `package.json weave.styleLang is "${declared}"`
      );
      bad++;
    }
  }
  if (!bad) console.log(`  ok styleLang "${declared}" agreed by ${configs.length} config(s)`);
  return bad;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(scss|sass)$/.test(entry) && !entry.startsWith('_')) out.push(full);
  }
  return out;
}

console.log('\ntools/verify-styles.mjs');

let failures = verifyStyleLangAgreement();

const sheets = existsSync(srcDir) ? walk(srcDir).sort() : [];
if (sheets.length === 0 && failures === 0) {
  console.log('ok  no component stylesheets yet\n');
  process.exit(0);
}

for (const file of sheets) {
  const name = relative(repo, file).replace(/\\/g, '/');

  // A stylesheet beside a `.ts` is a COMPONENT stylesheet: the loader pairs them by name, so one
  // without a partner is either a typo in the filename or a sheet nobody will ever load.
  if (!existsSync(file.replace(/\.[^.]+$/, '.ts'))) {
    console.error(`  x ${name}: no sibling .ts — nothing pairs this stylesheet with a component`);
    failures++;
    continue;
  }

  const warnings = [];
  try {
    const result = compile(file, {
      importers: [new NodePackageImporter()],
      // Match the build exactly — this CSS ends up inside a `<style>` element.
      charset: false,
      logger: {
        warn(message, options) {
          warnings.push(`${message}${options?.span?.url ? ` (${options.span.url})` : ''}`);
        },
      },
    });

    if (result.css.trim().length === 0) {
      console.error(`  x ${name}: compiled to no CSS`);
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
console.log(`ok  ${sheets.length} component stylesheet(s) compile cleanly\n`);
