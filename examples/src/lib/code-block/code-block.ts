/**
 * A single copyable, syntax-highlighted source file.
 *
 * The code is rebuilt with `textContent` and spans rather than `innerHTML`, so a snippet containing
 * `<`, `{` or `&` stays literal — which every Weave template does.
 */

import { effect, signal, onDispose, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { highlight } from '../highlight/highlight.js';

export interface CodeBlockProps {
  /** The source to display and copy. */
  code?: string;
  /** Language tag used for highlighting. */
  lang?: string;
}

export interface CodeBlockContext {
  label: () => string;
  copy: () => void;
  /** The <code> element, captured by ref so the effect can fill it. */
  codeEl: Signal<Element | null>;
}

export function setup(props: CodeBlockProps): CodeBlockContext {
  const code = (): string => props.code ?? '';
  const lang = (): string => props.lang ?? 'ts';
  const label: Signal<string> = signal<string>('Copy');
  const codeEl: Signal<Element | null> = signal<Element | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  onDispose(() => {
    if (timer !== null) clearTimeout(timer);
  });

  // Re-highlight whenever the element appears OR the code/lang change, so switching tabs updates
  // rather than only the first render.
  effect(() => {
    const el: Element | null = codeEl();
    const source: string = code();
    const language: string = lang();
    if (!el) return;
    el.textContent = '';
    el.append(highlight(source, language));
  });

  return {
    label,
    copy: (): void => {
      void navigator.clipboard?.writeText(code());
      label.set('Copied');
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => label.set('Copy'), 1400);
    },
    codeEl,
  };
}

export { Button };
