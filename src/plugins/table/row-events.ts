/**
 * Row-level interaction — click, double-click and a right-click menu — attached from outside the
 * table.
 *
 * `<Table>` has no row events of its own, and this needs none. It is a Weave `use:` action for the
 * element wrapping the grid: one listener per event type on that wrapper, resolving which row was hit
 * by walking up from the target. Delegation rather than a listener per row also means the cost does
 * not grow with the page.
 *
 * The hard part is going from a `<tr>` back to the row OBJECT. Position is not good enough: sorting,
 * a virtual window, detail rows and spacer rows all break the mapping between DOM order and array
 * order, silently and only sometimes. `aria-rowindex` is no good either — `<Table>` only sets it in
 * virtual mode.
 *
 * So the plugin marks a cell it renders anyway, and hangs the row object straight off that element.
 * No index arithmetic, no lookup table to keep in step with the data, and nothing to leak: the
 * reference dies with the element. When the first column's cell is already an element the marker is
 * one attribute; only a plain-string cell pays for a wrapper.
 */

import { contextMenu, type MenuItem } from '@weave-framework/ui/context-menu';

/** The property the row object is hung off. A symbol, so it cannot collide with anything authored. */
export const ROW_KEY: unique symbol = Symbol('weave-extra-table-row');

/** Marker attribute, so the `<tr>` can be searched for the element carrying the row. */
export const ROW_MARKER = 'data-weave-row';

interface RowCarrier {
  [ROW_KEY]?: unknown;
}

/** Mark `element` as the carrier of `row`. Called by the plugin on one cell per row. */
export function markRow(element: Element, row: unknown): void {
  element.setAttribute(ROW_MARKER, '');
  (element as RowCarrier)[ROW_KEY] = row;
}

/** The row an event landed in, or null when it landed outside the body (a header, a spacer). */
export function rowFromEvent<TRow>(event: Event): TRow | null {
  const target: Element | null = event.target instanceof Element ? event.target : null;
  const tr: Element | null = target?.closest('tr') ?? null;
  const carrier: Element | null = tr?.querySelector(`[${ROW_MARKER}]`) ?? null;
  return carrier ? ((carrier as RowCarrier)[ROW_KEY] as TRow) ?? null : null;
}

export interface RowEventOptions<TRow> {
  onRowClick?: (row: TRow, event: MouseEvent) => void;
  onRowDoubleClick?: (row: TRow, event: MouseEvent) => void;
  /** Items for the row's right-click menu. Re-read on every open, so it can depend on the row. */
  menuItems?: (row: TRow) => MenuItem[];
  onMenuSelect?: (value: string, row: TRow) => void;
  /** A right-click on a HEADER cell. Given the pointer position, for anchoring a panel. */
  onHeaderContextMenu?: (position: { x: number; y: number }) => void;
}

/**
 * Weave `use:` action. Attach to the element WRAPPING the table:
 *
 *   <div use:tableRows={{ grid.rowEvents }}><Table … /></div>
 */
export function tableRows<TRow>(host: HTMLElement, options: RowEventOptions<TRow>): () => void {
  let menuRow: TRow | null = null;

  const onClick = (event: MouseEvent): void => {
    const row: TRow | null = rowFromEvent<TRow>(event);
    if (row !== null) options.onRowClick?.(row, event);
  };
  const onDoubleClick = (event: MouseEvent): void => {
    const row: TRow | null = rowFromEvent<TRow>(event);
    if (row !== null) options.onRowDoubleClick?.(row, event);
  };
  // Registered BEFORE the context menu below, so by the time that opens, `menuRow` is the row the
  // pointer was actually over — same event, same phase, registration order decides.
  const onContextMenu = (event: MouseEvent): void => {
    const target: Element | null = event.target instanceof Element ? event.target : null;
    if (target?.closest('thead')) {
      // A header right-click belongs to the COLUMNS, not to a row. `stopImmediatePropagation`
      // rather than `stopPropagation`: the row menu is bound to this same element, so only halting
      // the remaining listeners HERE keeps it from opening over the header as well.
      event.preventDefault();
      event.stopImmediatePropagation();
      menuRow = null;
      options.onHeaderContextMenu?.({ x: event.clientX, y: event.clientY });
      return;
    }
    menuRow = rowFromEvent<TRow>(event);
  };

  host.addEventListener('click', onClick);
  host.addEventListener('dblclick', onDoubleClick);
  host.addEventListener('contextmenu', onContextMenu);

  let closeMenu: (() => void) | null = null;
  if (options.menuItems) {
    closeMenu = contextMenu<MenuItem>(host, {
      // A getter, not an array: `contextMenu` reads this on every open, which is what lets the menu
      // differ per row — an action hidden for one document and offered for the next.
      get items(): MenuItem[] {
        return menuRow === null ? [] : (options.menuItems as (row: TRow) => MenuItem[])(menuRow);
      },
      onSelect: (selected: string | MenuItem): void => {
        const value: string = typeof selected === 'string' ? selected : selected.value;
        if (menuRow !== null) options.onMenuSelect?.(value, menuRow);
      },
    });
  }

  return (): void => {
    host.removeEventListener('click', onClick);
    host.removeEventListener('dblclick', onDoubleClick);
    host.removeEventListener('contextmenu', onContextMenu);
    closeMenu?.();
  };
}
