/**
 * The source behind a demo, shown as the real Weave-UI `<Tabs>` — one tab per file, each panel a
 * `<CodeBlock>`. The same shape the Weave documentation site uses for every sample on it.
 *
 * The snippets are lifted from the pages that render the demos by `tools/gen-snippets.mjs`, so what
 * is shown is what runs. Writing them out by hand next to each demo drifts, and it drifts quietly.
 */

import Tabs from '@weave-framework/ui/tabs';
import CodeBlock from '../code-block/code-block.js';
import { SNIPPETS, type Snippet } from '../../generated/snippets.gen.js';

export interface CodeTabsProps {
  /** Region id, as marked in the page source. */
  id: string;
}

interface WeaveTab {
  label: string;
  content: () => Node;
}

export interface CodeTabsContext {
  props: CodeTabsProps;
  weaveTabs: () => WeaveTab[];
  missing: () => boolean;
}

export function setup(props: CodeTabsProps): CodeTabsContext {
  const snippet = (): Snippet | undefined => SNIPPETS[props.id];

  return {
    props,
    weaveTabs: (): WeaveTab[] => {
      const found: Snippet | undefined = snippet();
      if (!found) return [];
      const tabs: WeaveTab[] = [];
      // Markup first — it is the half a reader is usually after.
      if (found.template !== undefined) {
        tabs.push({
          label: 'template.html',
          content: (): Node => CodeBlock({ code: found.template, lang: 'html' }) as Node,
        });
      }
      if (found.setup !== undefined) {
        tabs.push({
          label: 'setup.ts',
          content: (): Node => CodeBlock({ code: found.setup, lang: 'ts' }) as Node,
        });
      }
      return tabs;
    },
    // A snippet id with no region behind it is a typo, and should look like one rather than
    // rendering an empty frame that reads as "this demo has no code".
    missing: (): boolean => snippet() === undefined,
  };
}

export { Tabs };
