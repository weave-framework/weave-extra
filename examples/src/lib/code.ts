/**
 * Shows the code behind a demo — the actual code, lifted from the page that renders it by
 * `tools/gen-snippets.mjs` rather than retyped underneath it.
 *
 * Two halves, because a Weave component is two files: the markup and the setup. Either may be
 * absent; a demo that is pure markup shows one tab and no chooser.
 */

import { onDispose, signal, type Signal } from '@weave-framework/runtime';
import { SNIPPETS, type Snippet } from '../generated/snippets.gen.js';

export interface CodeProps {
  /** Region id, as marked in the page source. */
  id: string;
}

export type CodeTab = 'markup' | 'script';

export interface CodeContext {
  props: CodeProps;
  markup: () => string | undefined;
  script: () => string | undefined;
  tab: () => CodeTab;
  setTab: (tab: CodeTab) => void;
  tabClass: (tab: CodeTab) => string;
  body: () => string;
  hasBoth: () => boolean;
  missing: () => boolean;
  copied: () => boolean;
  copy: () => void;
  filename: () => string;
}

export function setup(props: CodeProps): CodeContext {
  const snippet = (): Snippet | undefined => SNIPPETS[props.id];
  const markup = (): string | undefined => snippet()?.template;
  const script = (): string | undefined => snippet()?.setup;

  // Prefer the markup tab when there is one — it is the half a reader is usually after.
  const chosen: Signal<CodeTab | null> = signal<CodeTab | null>(null);
  const tab = (): CodeTab => chosen() ?? (markup() !== undefined ? 'markup' : 'script');

  const copied: Signal<boolean> = signal<boolean>(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  onDispose(() => {
    if (timer !== null) clearTimeout(timer);
  });

  const body = (): string => (tab() === 'markup' ? (markup() ?? '') : (script() ?? ''));

  return {
    props,
    markup,
    script,
    tab,
    setTab: (next: CodeTab): void => {
      chosen.set(next);
    },
    tabClass: (next: CodeTab): string =>
      tab() === next ? 'ex-code__tab ex-code__tab--active' : 'ex-code__tab',
    body,
    hasBoth: (): boolean => markup() !== undefined && script() !== undefined,
    // A snippet id with no region behind it is a typo, and it should look like one rather than
    // rendering an empty box that reads as "this demo has no code".
    missing: (): boolean => snippet() === undefined,
    copied,
    copy: (): void => {
      void navigator.clipboard?.writeText(body());
      copied.set(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => copied.set(false), 1400);
    },
    filename: (): string => (tab() === 'markup' ? 'template.html' : 'setup.ts'),
  };
}
