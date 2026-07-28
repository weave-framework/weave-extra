/**
 * The code behind a demo — the actual code, lifted from the page that renders it by
 * `tools/gen-snippets.mjs` rather than retyped underneath it.
 *
 * Two halves, because a Weave component is two files: the markup and the setup. They are shown as a
 * real `<Tabs>` from the component library, with each panel a `<CodeBlock>` node — the same shape the
 * Weave documentation site uses, and for the same reason: a site about a component library should be
 * built out of it.
 */

import Tabs from '@weave-framework/ui/tabs';
import CodeBlock from './code-block.js';
import { SNIPPETS, type Snippet } from '../generated/snippets.gen.js';

export interface CodeProps {
  /** Region id, as marked in the page source. */
  id: string;
}

interface CodeTab {
  label: string;
  content: () => Node;
}

export interface CodeContext {
  props: CodeProps;
  tabs: () => CodeTab[];
  missing: () => boolean;
}

export function setup(props: CodeProps): CodeContext {
  const snippet = (): Snippet | undefined => SNIPPETS[props.id];

  return {
    props,
    tabs: (): CodeTab[] => {
      const found: Snippet | undefined = snippet();
      if (!found) return [];
      const tabs: CodeTab[] = [];
      // Markup first — it is the half a reader is usually after.
      if (found.template !== undefined) {
        tabs.push({
          label: 'template.html',
          content: (): Node => CodeBlock({ code: found.template }) as Node,
        });
      }
      if (found.setup !== undefined) {
        tabs.push({ label: 'setup.ts', content: (): Node => CodeBlock({ code: found.setup }) as Node });
      }
      return tabs;
    },
    // A snippet id with no region behind it is a typo, and it should look like one rather than
    // rendering an empty box that reads as "this demo has no code".
    missing: (): boolean => snippet() === undefined,
  };
}

export { Tabs };
