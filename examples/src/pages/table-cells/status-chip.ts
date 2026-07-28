/**
 * A cell type written the way a consumer writes one: an ordinary Weave component, registered against
 * a `type` string that appears in the column JSON.
 *
 * It follows the contract exactly, and the two rules worth seeing in practice are:
 *
 *  - it never touches `row` — the chip is clickable, and what that MEANS is the page's decision, so it
 *    says `api.action('inspect', …, event)` and stops there;
 *  - it hands the event to `api.action` instead of calling `stopPropagation` itself, which is what
 *    keeps a click on the chip from also selecting the row.
 */

import Icon from '@weave-framework/ui/icon';
import type { CellProps } from '@weave-framework/extra/plugins/table';

const TONES: Record<string, { icon: string; tone: string }> = {
  succeeded: { icon: 'circle-check', tone: 'ok' },
  retrying: { icon: 'refresh-cw', tone: 'busy' },
  failed: { icon: 'circle-x', tone: 'bad' },
  rejected: { icon: 'circle-x', tone: 'bad' },
  warning: { icon: 'triangle-alert', tone: 'warn' },
};

export interface StatusChipContext {
  icon: () => string;
  label: () => string;
  rootClass: () => string;
  onActivate: (event: Event) => void;
}

export function setup(props: CellProps): StatusChipContext {
  // `value` really is `unknown` — it came out of a row the plugin knows nothing about — so narrowing
  // it is the cell's job, and the one place that knows what this column holds.
  const raw = (): string => (props.value == null ? '' : String(props.value));
  const tone = (): { icon: string; tone: string } =>
    TONES[raw().toLowerCase()] ?? { icon: 'circle', tone: 'neutral' };

  return {
    icon: (): string => tone().icon,
    label: (): string => raw(),
    rootClass: (): string => `status-chip status-chip--${tone().tone}`,
    onActivate: (event: Event): void => {
      props.api.action('inspect', { state: raw() }, event);
    },
  };
}

export { Icon };
