/**
 * The examples shell — the same shape the Weave documentation site uses, and made of the same
 * pieces: a sticky `<Toolbar>`, a `<Sidenav>` drawer whose groups are `<Expansion>` panels, and the
 * selected page in the content column.
 *
 * A site about extending `@weave-framework/ui` that builds its own chrome argues against its own
 * point, and leaves the library it depends on untested by the one app in the repo. So the chrome is
 * the library: toolbar, buttons, icons, badge, sidenav, expansion.
 *
 * Selection rides `location.hash` rather than the router: an examples site needs links that survive
 * being pasted into a message, and that is the whole of what a router would be buying here. Adding an
 * extra means one entry in `PAGES` and one `@case`.
 */

import { onMount, signal, type Signal } from '@weave-framework/runtime';
import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Badge from '@weave-framework/ui/badge';
import Icon from '@weave-framework/ui/icon';
import Sidenav, { type SidenavApi } from '@weave-framework/ui/sidenav';
import Expansion, { type ExpansionPanel } from '@weave-framework/ui/expansion';
import SplitPage from '../pages/split.js';
import InsidePage from '../pages/inside.js';
import DockingPage from '../pages/docking.js';
import BenchPage from '../pages/bench.js';
import TablePage from '../pages/table.js';
import TableRecipesPage from '../pages/table-recipes.js';

const REPO_URL = 'https://github.com/weave-framework/weave-extra';

export interface PageEntry {
  id: string;
  title: string;
  group: string;
}

export const PAGES: PageEntry[] = [
  { id: 'split', title: 'Split', group: 'Components' },
  { id: 'inside', title: 'Inside a Split', group: 'Components' },
  { id: 'docking', title: 'Docking', group: 'Components' },
  { id: 'table', title: 'Table plugin', group: 'Plugins' },
  { id: 'table-recipes', title: 'Table recipes', group: 'Plugins' },
  { id: 'bench', title: 'Rendering cost', group: 'Measurements' },
];

export interface ShellContext {
  current: () => string;
  panels: () => ExpansionPanel[];
  openIds: () => string[];
  setNavApi: (api: SidenavApi) => void;
  toggleNav: () => void;
  toggleTheme: () => void;
  themeIcon: () => string;
  openRepo: () => void;
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

  /**
   * Panel bodies are built as DOM rather than as a template, because `ExpansionContent` takes a Node.
   * Plain anchors, like the docs site's sidebar: a hash link is the whole of the navigation here, and
   * an anchor is what makes it middle-clickable and copyable.
   */
  const groupLinks = (group: string): Node => {
    const box: HTMLElement = document.createElement('div');
    box.className = 'nav-group-links';
    for (const page of PAGES.filter((entry) => entry.group === group)) {
      const link: HTMLAnchorElement = document.createElement('a');
      link.className = page.id === current() ? 'nav-link active' : 'nav-link';
      link.href = `#${page.id}`;
      link.textContent = page.title;
      box.appendChild(link);
    }
    return box;
  };

  const groups = (): string[] => [...new Set(PAGES.map((page) => page.group))];

  let nav: SidenavApi | null = null;

  const theme: Signal<'light' | 'dark'> = signal<'light' | 'dark'>('light');

  return {
    current,
    // Reading `current()` here is what re-renders the panel bodies with the new active link.
    panels: (): ExpansionPanel[] =>
      groups().map((group) => ({ id: group, header: group, body: () => groupLinks(group) })),
    openIds: groups,
    setNavApi: (api: SidenavApi): void => {
      nav = api;
    },
    toggleNav: (): void => nav?.toggle(),
    toggleTheme: (): void => {
      theme.set((value) => (value === 'dark' ? 'light' : 'dark'));
      document.documentElement.dataset.theme = theme();
    },
    themeIcon: (): string => (theme() === 'dark' ? 'sun' : 'moon'),
    openRepo: (): void => {
      window.open(REPO_URL, '_blank', 'noopener,noreferrer');
    },
  };
}

// Capitalized tags in shell.html resolve to these imports.
export { Toolbar, Button, Badge, Icon, Sidenav, Expansion, SplitPage, InsidePage, DockingPage, BenchPage, TablePage };
