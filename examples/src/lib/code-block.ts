/**
 * One copyable source file.
 *
 * The copy control is a real `<Button variant="ghost">` rather than a styled `<button>`. That is not
 * decoration: this package exists to extend `@weave-framework/ui`, and a site demonstrating it that
 * hand-rolls its own controls is arguing against its own point — as well as quietly not testing the
 * library it depends on.
 */

import { onDispose, signal, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export interface CodeBlockProps {
  /** The source to display and copy. */
  code?: string;
}

export interface CodeBlockContext {
  code: () => string;
  label: () => string;
  copy: () => void;
}

export function setup(props: CodeBlockProps): CodeBlockContext {
  const label: Signal<string> = signal<string>('Copy');
  let timer: ReturnType<typeof setTimeout> | null = null;

  onDispose(() => {
    if (timer !== null) clearTimeout(timer);
  });

  return {
    code: (): string => props.code ?? '',
    label,
    copy: (): void => {
      void navigator.clipboard?.writeText(props.code ?? '');
      label.set('Copied');
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => label.set('Copy'), 1400);
    },
  };
}

export { Button };
