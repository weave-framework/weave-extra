/**
 * Stage `src/` → `.compiled/` with every COMPONENT module pre-compiled, so the `tsc` that follows
 * emits a real, standalone `dist/`: each component ships `export default defineComponent(render, setup)`
 * plus a typed default in its `.d.ts`.
 *
 * WHY this step exists at all: a plain `tsc` build ships components UNCOMPILED — `export function setup`
 * and a sibling `.html` that never becomes a `render`, and NO default export. Inside this repo the dev
 * exports point at `src/` and the Weave loader compiles on the fly, so `import Split from
 * '@weave-framework/extra/components/split'` works here and HIDES the gap; an npm consumer gets the
 * uncompiled dist and both `weave build` and `weave check` fail on the missing default export. The main
 * Weave repository shipped exactly that bug once. This runs the same `compileComponent` the loader uses.
 *
 * A component = a `.ts` that declares an inline `template` OR has a sibling `.html`. Everything else
 * (types, the layout math, the context module, barrels) is copied verbatim.
 */
import { compileComponent, extractSources, childImportCandidates } from '@weave-framework/compiler';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repo, 'src');
const outDir = join(repo, '.compiled');

/* ── child-tag resolution — mirrors `injectChildImports` in the CLI's esbuild plugin ── */

function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = code[i];
        if (ch === '\\') {
          out += ch + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += ch;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const IMPORT = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;

function importsBinding(script, tag) {
  if (!script) return false;
  const code = stripComments(script);
  const word = new RegExp(`\\b${tag}\\b`);
  IMPORT.lastIndex = 0;
  let m;
  while ((m = IMPORT.exec(code)) !== null) {
    if (word.test(m[1])) return true;
  }
  return false;
}

function resolveChildModule(tag, dir) {
  for (const cand of childImportCandidates(tag)) {
    for (const ext of ['.ts', '.weave']) {
      if (existsSync(resolve(dir, cand + ext))) return cand;
    }
  }
  return null;
}

function injectChildImports(code, components, dir, script, filename) {
  const imports = [];
  for (const tag of components) {
    if (importsBinding(script, tag)) continue;
    const cand = resolveChildModule(tag, dir);
    if (cand === null) {
      throw new Error(`weave: ${filename} composes <${tag}> but no sibling module was found for it.`);
    }
    imports.push(`import ${tag} from ${JSON.stringify(cand + '.js')};`);
  }
  return imports.length ? imports.join('\n') + '\n' + code : code;
}

/* ── per-component compile ── */

const HAS_SETUP = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;

/**
 * Replace the compiler's plain default with a props-typed one, so `weave check` and TS consumers see
 * `import Split from '…/split'` as a callable whose first parameter is the component's props.
 * `Parameters<typeof setup>[0]` derives that from the module's own setup, so one substitution fits
 * every component.
 */
function typeDefault(code, hasSetup) {
  // The exact call varies — `defineComponent(render)`, `…(render, setup)`, or `…(render, setup,
  // propDefaults)` when the component declares prop defaults. Capture whatever the compiler emitted
  // rather than reconstructing it, so a new argument does not silently change the shipped default.
  const tail = /export default (defineComponent\([^)]*\));$/.exec(code);
  if (!tail) {
    throw new Error('weave: unexpected compileComponent tail — cannot inject typed default');
  }
  const propsType = hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  const typed =
    `const _weaveDefault = ${tail[1]} as unknown as ` +
    `(props: ${propsType}, slots?: Record<string, () => unknown>) => unknown;\n` +
    `export default _weaveDefault;`;
  return code.slice(0, tail.index) + typed;
}

let componentCount = 0;

function compileOne(tsPath, decl, template) {
  const dir = dirname(tsPath);
  const { code, components } = compileComponent(
    { script: decl.script, template, styles: undefined },
    { filename: tsPath }
  );
  const wired = injectChildImports(code, components, dir, decl.script, tsPath);
  componentCount++;
  // The compiler-generated `render` is untyped JS. Checking the real source is the `typecheck` gate's
  // job on `src/`; this staged tree is EMIT-ONLY, so silence tsc here — declaration emit (the typed
  // default, setup, exported types) still runs.
  return '// @ts-nocheck\n' + typeDefault(wired, HAS_SETUP.test(decl.script ?? ''));
}

/* ── stage the tree ── */

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

rmSync(outDir, { recursive: true, force: true });

let copied = 0;

walk(srcDir, (full) => {
  if (/\.(browser|test|spec)\.ts$/.test(full)) return;
  const rel = relative(srcDir, full);
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });

  if (!full.endsWith('.ts')) {
    // Templates are folded into the compiled module, so they must not be staged as loose files that
    // a later build step would try to interpret again.
    if (full.endsWith('.html')) return;
    cpSync(full, dest);
    copied++;
    return;
  }

  const source = readFileSync(full, 'utf8');
  const decl = extractSources(source);
  const siblingHtml = full.replace(/\.ts$/, '.html');
  const template = decl.template !== undefined ? decl.template : existsSync(siblingHtml) ? readFileSync(siblingHtml, 'utf8') : undefined;

  if (template === undefined) {
    cpSync(full, dest);
    copied++;
    return;
  }
  writeFileSync(dest, compileOne(full, decl, template));
});

process.stdout.write(
  `\nok  staged @weave-framework/extra -> .compiled/ (${componentCount} component(s) compiled, ${copied} module(s) copied)\n`
);
