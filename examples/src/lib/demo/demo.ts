/**
 * A framed stage that shows a live, running example.
 *
 * Deliberately just the stage: no title, no description, no code. Those belong to the PAGE — the
 * heading is prose, the explanation is a paragraph, the source is a sibling `<CodeTabs>`. An earlier
 * version carried its own title and note, which fenced every example off into a little titled box
 * that read as unrelated to the sentence introducing it.
 *
 * `height` exists because a component that FILLS its container — a splitter, most of all — collapses
 * to nothing on a stage that has none. Stages with a height lay their child out as a block; the
 * default is the docs' flex row of loose controls.
 */

import Card from '@weave-framework/ui/card';

export interface DemoProps {
  /** CSS height for the stage. Omit for a row of loose controls. */
  height?: string;
}

export interface DemoContext {
  stageClass: () => string;
  stageStyle: () => string | undefined;
}

export function setup(props: DemoProps): DemoContext {
  return {
    stageClass: (): string => (props.height ? 'demo-stage demo-stage--sized' : 'demo-stage'),
    stageStyle: (): string | undefined => (props.height ? `height: ${props.height}` : undefined),
  };
}

export { Card };
