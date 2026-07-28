/**
 * The examples shell — a sidebar of everything this package ships, and the selected page beside it.
 *
 * Selection rides `location.hash` rather than the router: an examples site needs links that survive
 * being pasted into a message, and that is the whole of what a router would be buying here. Adding an
 * extra means one entry in `PAGES` and one `@case`.
 */

import { onMount, signal, type Signal } from '@weave-framework/runtime';
import SplitPage from '../pages/split.js';

export interface PageEntry {
  id: string;
  title: string;
  group: string;
  /** One line, shown under the title in the sidebar. */
  blurb: string;
}

export const PAGES: PageEntry[] = [
  {
    id: 'split',
    title: 'Split',
    group: 'Components',
    blurb: 'Resizable panes with draggable gutters',
  },
];

interface PageGroup {
  name: string;
  pages: PageEntry[];
}

export interface ShellContext {
  groups: () => PageGroup[];
  current: () => string;
  linkClass: (id: string) => string;
}

function pageFromHash(): string {
  const id: string = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  return PAGES.some((page) => page.id === id) ? id : (PAGES[0]?.id ?? '');
}

export function setup(): ShellContext {
  const current: Signal<string> = signal<string>(pageFromHash());

  onMount(() => {
    const onHashChange = (): void => current.set(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  return {
    groups: (): PageGroup[] => {
      const names: string[] = [...new Set(PAGES.map((page) => page.group))];
      return names.map((name) => ({ name, pages: PAGES.filter((page) => page.group === name) }));
    },
    current,
    linkClass: (id: string): string =>
      current() === id ? 'ex-nav__link ex-nav__link--active' : 'ex-nav__link',
  };
}

// Referenced by the template; listed here so the value is unmistakably used.
export { SplitPage };
