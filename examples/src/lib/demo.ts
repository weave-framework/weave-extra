/**
 * A framed live area for one example: heading, a line of context, and a stage of a fixed height.
 *
 * The height is not decoration. `<Split>` fills its container, so a stage with no height collapses
 * to nothing — which is the single most common way a splitter appears "broken" in a real app. Every
 * example here states its height out loud so the reason is visible rather than incidental.
 */

export interface DemoProps {
  title: string;
  /** One line under the heading — what this example is showing, or what to try. */
  note?: string;
  /** CSS height for the stage. */
  height?: string;
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
