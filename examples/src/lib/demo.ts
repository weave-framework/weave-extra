/**
 * A framed live area for one example: heading, a line of context, a running stage, and the code
 * behind it.
 *
 * The stage is a real `<Card>` from the component library rather than a bordered `<div>` of our own —
 * the same choice the Weave documentation site makes, and for the same reason: a site about a
 * component library should be built out of it.
 *
 * The height is not decoration. `<Split>` fills its container, so a stage with no height collapses to
 * nothing — the single most common way a splitter appears "broken" in a real app. Every example here
 * states its height out loud so the reason is visible rather than incidental.
 */

import Card from '@weave-framework/ui/card';
import Code from './code.js';

export interface DemoProps {
  title: string;
  /** One line under the heading — what this example is showing, or what to try. */
  note?: string;
  /** CSS height for the stage. */
  height?: string;
  /** Region id to show the source for. Omit for a demo with no code worth quoting. */
  snippet?: string;
}

export const propDefaults = { height: '260px' } as const;

export interface DemoContext {
  props: DemoProps;
  stageStyle: () => string;
}

export function setup(props: DemoProps): DemoContext {
  return {
    props,
    stageStyle: (): string => `height: ${props.height ?? '260px'}`,
  };
}

export { Card, Code };
