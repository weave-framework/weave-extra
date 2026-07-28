/**
 * A cell that is a real component — the case the table plugin is being designed around.
 *
 * It exists so the benchmark measures what a component-backed cell actually costs, not what a text
 * node costs. Everything a consumer's own cell would do, it does: reads a value, decides an icon,
 * composes a child component from the library, and carries its own stylesheet.
 */

import Icon from '@weave-framework/ui/icon';

export interface StatusCellProps {
  value: string;
}

export interface StatusCellContext {
  icon: () => string;
  label: () => string;
  toneClass: () => string;
}

const ICONS: Record<string, string> = {
  ok: 'circle-check',
  warn: 'triangle-alert',
  fail: 'circle-x',
};

export function setup(props: StatusCellProps): StatusCellContext {
  return {
    icon: (): string => ICONS[props.value] ?? 'circle',
    label: (): string => props.value,
    toneClass: (): string => `bench-status bench-status--${props.value}`,
  };
}

export { Icon };
