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

import { effect, onMount, signal, type Signal } from '@weave-framework/runtime';
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
import ChartPage from '../pages/chart.js';
import ChartRecipesPage from '../pages/chart-recipes.js';

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
  { id: 'chart', title: 'Chart', group: 'Components' },
  { id: 'chart-recipes', title: 'Chart recipes', group: 'Components' },
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

  const groups = (): string[] => [...new Set(PAGES.map((page) => page.group))];

  /**
   * Panel bodies are built as DOM rather than as a template, because `ExpansionContent` takes a Node.
   * Plain anchors, like the docs site's sidebar: a hash link is the whole of the navigation here, and
   * an anchor is what makes it middle-clickable and copyable.
   *
   * Built ONCE, here, and each link's class driven by its own effect. A panel body is a Node handed
   * to `Expansion`, and a Node is mounted once: a class decided while building it is a snapshot, so
   * the highlight stuck to whichever page the site was loaded on and never moved again, however many
   * times the content changed underneath it. Rebuilding the list on every change is the other answer
   * and the wrong one — it throws away the panel's DOM, its scroll position and its focus to restyle
   * one anchor.
   *
   * The effects are created here rather than inside the body callback so they belong to this
   * component's scope and are torn down with it.
   */
  const boxes: Map<string, Node> = new Map<string, Node>();
  for (const group of groups()) {
    const box: HTMLElement = document.createElement('div');
    box.className = 'nav-group-links';
    for (const page of PAGES.filter((entry) => entry.group === group)) {
      const link: HTMLAnchorElement = document.createElement('a');
      link.href = `#${page.id}`;
      link.textContent = page.title;
      effect(() => {
        link.className = page.id === current() ? 'nav-link active' : 'nav-link';
        // Announced, not merely coloured: a highlight a screen reader cannot see is decoration.
        if (page.id === current()) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      box.appendChild(link);
    }
    boxes.set(group, box);
  }

  let nav: SidenavApi | null = null;

  const theme: Signal<'light' | 'dark'> = signal<'light' | 'dark'>('light');

  return {
    current,
    panels: (): ExpansionPanel[] =>
      groups().map((group) => ({ id: group, header: group, body: () => boxes.get(group) ?? document.createTextNode('') })),
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
