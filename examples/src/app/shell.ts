/**
 * The examples shell — a sidebar of everything this package ships, and the selected page beside it.
 *
 * The sidebar is a real `<List>` from the component library: it brings the listbox roles, roving
 * tabindex, typeahead and arrow-key navigation with it, none of which a hand-rolled `<ul>` of links
 * would have had. A site about extending `@weave-framework/ui` should be built out of it.
 *
 * Selection rides `location.hash` rather than the router: an examples site needs links that survive
 * being pasted into a message, and that is the whole of what a router would be buying here. Adding an
 * extra means one entry in `PAGES` and one `@case`.
 */

import { onMount, signal, type Signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';
import SplitPage from '../pages/split.js';
import InsidePage from '../pages/inside.js';
import DockingPage from '../pages/docking.js';

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
  {
    id: 'inside',
    title: 'Inside a Split',
    group: 'Components',
    blurb: 'Native HTML and Weave UI in the panes',
  },
  {
    id: 'docking',
    title: 'Docking',
    group: 'Components',
    blurb: 'Re-render a split from a layout config',
  },
];

interface NavItem {
  value: string;
  title: string;
  meta: string;
}

interface PageGroup {
  name: string;
  items: NavItem[];
}

export interface ShellContext {
  groups: () => PageGroup[];
  current: () => string;
  go: (id: string) => void;
}

function pageFromHash(): string {
  const id: string = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  return PAGES.some((page) => page.id === id) ? id : (PAGES[0]?.id ?? '');
}

export function setup(): ShellContext {
  const current: Signal<string> = signal<string>(pageFromHash());

  onMount(() => {
    const onHashChange = (): void => {
      current.set(pageFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  return {
    groups: (): PageGroup[] => {
      const names: string[] = [...new Set(PAGES.map((page) => page.group))];
      return names.map((name) => ({
        name,
        items: PAGES.filter((page) => page.group === name).map((page) => ({
          value: page.id,
          title: page.title,
          meta: page.blurb,
        })),
      }));
    },
    current,
    // Route through the hash rather than setting the signal directly, so selecting a page and
    // arriving at one by link are the same code path — and so the address bar never lies.
    go: (id: string): void => {
      location.hash = `#${id}`;
    },
  };
}

// Referenced by the template; listed here so the values are unmistakably used.
export { List, SplitPage, InsidePage, DockingPage };
