/**
 * The columns panel — which columns show, and in what order.
 *
 * A `use:` action rather than a component, so the panel's markup stays with the consumer: the rows
 * are theirs to build from the library's `<Checkbox>` and to place in whatever surface fits — a
 * popover, a drawer, a settings page. All this adds is the reordering, and it adds it by reading the
 * DOM rather than by being told an array, so the order it reports is always the order on screen.
 *
 * Reordering is the CDK's `dropList`, which brings keyboard drag-and-drop with it: Space to lift,
 * arrows to move, Space to drop. A columns panel that can only be reordered by dragging is a columns
 * panel some people cannot reorder.
 */

import { effect } from '@weave-framework/runtime';
import { dropList, moveItemInArray, type DropEvent } from '@weave-framework/ui/cdk';

/** Attribute naming the column a row stands for. Read on drop, so the DOM is the source of order. */
export const COLUMN_ATTR = 'data-column';

/** Attribute marking the grip inside a row. Only a drag started on it moves the row. */
export const HANDLE_ATTR = 'data-column-handle';

/** On the row being dragged. */
export const DRAGGING_CLASS = 'is-dragging';

/** On the row the dragged one would land before. */
export const DROP_TARGET_CLASS = 'is-drop-target';

export interface ColumnsPanelOptions {
  /** Called with the full column order after a move. */
  onReorder: (names: string[]) => void;
  /** Turn reordering off — visibility still works. */
  disabled?: boolean | (() => boolean);
}

/**
 * Weave `use:` action for the element holding the column rows:
 *
 *   <div use:columnsPanel={{ grid.columnsPanel }}>
 *     @for (column of grid.allColumns(); track column.name) {
 *       <div data-column={{ column.name }}>
 *         <span data-column-handle>⠿</span>
 *         <Checkbox … />
 *       </div>
 *     }
 *   </div>
 */
export function columnsPanel(host: HTMLElement, options: ColumnsPanelOptions): () => void {
  const ref = dropList(host, {
    itemSelector: `[${COLUMN_ATTR}]`,
    handle: `[${HANDLE_ATTR}]`,
    orientation: 'vertical',
    disabled: options.disabled,
    onDrop: ({ previousIndex, currentIndex }: DropEvent): void => {
      // Read the names off the DOM at drop time. Taking them from a captured array instead would go
      // stale the moment a column was added, removed or hidden between renders — and the failure
      // would be a silent reorder of the wrong columns, not an error.
      const names: string[] = [...host.querySelectorAll(`[${COLUMN_ATTR}]`)].map(
        (element) => element.getAttribute(COLUMN_ATTR) ?? ''
      );
      options.onReorder(moveItemInArray(names, previousIndex, currentIndex));
    },
  });
  /**
   * Mark the lifted row and the gap it would drop into.
   *
   * Not decoration. `dropList` moves nothing until the drop commits, so without this a drag shows
   * absolutely nothing between grabbing a row and releasing it — which reads as a control that does
   * not work, whether or not the drop then succeeds. The state is reactive on the ref rather than
   * an attribute the CDK sets, so it has to be read and applied here.
   */
  effect(() => {
    const active: number = ref.activeIndex();
    const over: number = ref.overIndex();
    const live: boolean = ref.dragging();
    const rows: Element[] = [...host.querySelectorAll(`[${COLUMN_ATTR}]`)];
    rows.forEach((rowEl, index) => {
      rowEl.classList.toggle(DRAGGING_CLASS, live && index === active);
      rowEl.classList.toggle(DROP_TARGET_CLASS, live && index === over && index !== active);
    });
  });

  return (): void => ref.destroy();
}
