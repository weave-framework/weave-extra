/**
 * `<Split>` — resizable panes separated by draggable gutters (WAI-ARIA window splitter).
 *
 * A CSS grid whose tracks alternate pane, gutter, pane, … so nothing is absolutely positioned and
 * the browser does the layout. Panes register themselves through context and are ordered by
 * document position, so `@if`/`@for` around a pane behaves the same as listing it statically.
 *
 *   import Split from '@weave-framework/extra/components/split';
 *   import SplitPane from '@weave-framework/extra/components/split-pane';
 *
 *   <Split direction="horizontal" sizes={{ sizes() }} onSizesChange={{ save }}>
 *     <SplitPane size={{ 30 }} min={{ 15 }} collapsible>…</SplitPane>
 *     <SplitPane>…</SplitPane>
 *   </Split>
 *
 * Interaction follows the APG window splitter pattern: pointer drag, Arrow keys, PageUp/PageDown,
 * Home/End to the primary pane's bounds, and Enter to collapse or restore it. Escape abandons a
 * drag in progress and puts the sizes back — a plain drag convention the pattern leaves open.
 */

import {
  computed,
  effect,
  inject,
  onDispose,
  onMount,
  provide,
  signal,
  untrack,
  type Signal,
} from '@weave-framework/runtime';
import { DirectionContext, direction as globalDirection } from '@weave-framework/ui/cdk';
import {
  distribute,
  gridTemplate,
  gutterAnchors,
  normalizeSizes,
  resolvePixels,
  snap,
  toSizes,
  type PaneBounds,
} from './layout.js';
import { SplitContext, type SplitContextValue, type SplitPaneDeclaration, type SplitPaneHandle } from './context.js';
import type {
  SplitChangeReason,
  SplitDir,
  SplitDirection,
  SplitGutterEvent,
  SplitSize,
  SplitSizesSource,
  SplitUnit,
} from './models.js';

export type {
  SplitChangeReason,
  SplitDir,
  SplitDirection,
  SplitGutterEvent,
  SplitSize,
  SplitSizesSource,
  SplitUnit,
} from './models.js';

export interface SplitProps {
  /** Axis the panes are laid out along. Default `'horizontal'`. */
  direction?: SplitDirection;
  /** How pane sizes are interpreted. Default `'percent'`. */
  unit?: SplitUnit;
  /** Writing direction. Defaults to the CDK's active direction (context, else `<html dir>`). */
  dir?: SplitDir;

  /**
   * Sizes of all panes. Three forms, matching how much control you want:
   * a plain array (you own it — only `onSizesChange` fires), a writable `Signal` (`bind:sizes`,
   * written in place), or omitted (the component owns it, seeded from `defaultSizes` or each pane's
   * declared `size`).
   */
  sizes?: SplitSize[] | Signal<SplitSize[]>;
  /** Uncontrolled initial sizes. Ignored when `sizes` is set. */
  defaultSizes?: SplitSize[];
  /**
   * Initial sizes fetched on mount — sync or async, so they can come from a server just as easily as
   * from `localStorage`. Resolving to `null`/`undefined` keeps whatever the panes declared, and a
   * rejection is reported through `onLoadError` rather than left unhandled.
   */
  loadSizes?: () => SplitSizesSource;

  /** Gutter thickness in pixels. Default 11. */
  gutterSize?: number;
  /** Snap drags to a multiple of this many pixels. Default 1. */
  gutterStep?: number;
  /** Pointer movement up to this many pixels still counts as a click, not a drag. Default 2. */
  gutterClickDeltaPx?: number;
  /** Window for a second click to count as a double-click. Default 0 — double-click disabled. */
  gutterDblClickDuration?: number;
  /** Pixels one Arrow key moves a gutter. Default 10, snapped to `gutterStep`. */
  keyboardStep?: number;
  /** Pixels one PageUp/PageDown moves a gutter. Default `keyboardStep * 10`. */
  keyboardPageStep?: number;

  /** Disable all resizing. Gutters stay in the layout but drop out of the tab order. */
  disabled?: boolean;
  /** Confine a drag to the two panes flanking the gutter instead of cascading outward. */
  restrictMove?: boolean;
  /** Animate size changes that did not come from a pointer drag. Default false. */
  useTransition?: boolean;
  /** Accessible name for every gutter. `(index) => string` names them individually. */
  gutterLabel?: string | ((gutter: number) => string);

  /** Fires on every size change, with the reason it happened. */
  onSizesChange?: (sizes: SplitSize[], reason: SplitChangeReason) => void;
  /** Fires once the initial sizes have settled, after `loadSizes` if there is one. */
  onReady?: (sizes: SplitSize[]) => void;
  /** Fires when `loadSizes` throws or rejects. The declared sizes stay in place. */
  onLoadError?: (error: unknown) => void;
  onDragStart?: (event: SplitGutterEvent) => void;
  onDrag?: (event: SplitGutterEvent) => void;
  onDragEnd?: (event: SplitGutterEvent) => void;
  onGutterClick?: (event: SplitGutterEvent) => void;
  onGutterDblClick?: (event: SplitGutterEvent) => void;
  onCollapse?: (pane: number, sizes: SplitSize[]) => void;
  onExpand?: (pane: number, sizes: SplitSize[]) => void;

  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const propDefaults = {
  direction: 'horizontal',
  unit: 'percent',
  gutterSize: 11,
  gutterStep: 1,
  gutterClickDeltaPx: 2,
  gutterDblClickDuration: 0,
  keyboardStep: 10,
  disabled: false,
  restrictMove: false,
  useTransition: false,
} as const;

/** One gutter, ready to render. */
export interface SplitGutterView {
  index: number;
  style: string;
  label: string | undefined;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  valueText: string;
}

export interface SplitRenderContext {
  host: Signal<Element | null>;
  rootClass: () => string;
  rootStyle: () => string;
  gutters: () => SplitGutterView[];
  gutterClass: (gutter: number) => string;
  ariaOrientation: () => 'horizontal' | 'vertical';
  disabledAttr: () => string | undefined;
  tabindex: () => number;
  draggingIndex: () => number;
  onPointerdown: (event: PointerEvent, gutter: number) => void;
  onPointermove: (event: PointerEvent) => void;
  onPointerup: (event: PointerEvent, gutter: number) => void;
  onKeydown: (event: KeyboardEvent, gutter: number) => void;
}

interface Registration {
  declaration: SplitPaneDeclaration;
  /** Size remembered from before this pane collapsed, so Enter can restore it. */
  expanded: SplitSize | null;
  /** Container-owned collapsed state, used when the pane leaves `collapsed` uncontrolled. */
  collapsed: Signal<boolean>;
}

export function setup(props: SplitProps): SplitRenderContext {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const registrations: Signal<Registration[]> = signal<Registration[]>([]);
  const internal: Signal<SplitSize[] | null> = signal<SplitSize[] | null>(props.defaultSizes ?? null);
  const draggingIndex: Signal<number> = signal<number>(-1);
  const ready: Signal<boolean> = signal<boolean>(false);

  // Resolve the provided direction ONCE, here, where the owner is certainly this component. Calling
  // `activeDirection()` from an event handler would inject against whatever owner happens to be
  // current at that moment, which is not this one.
  const providedDir: SplitDir | undefined = inject(DirectionContext);

  const direction = (): SplitDirection => props.direction ?? 'horizontal';
  const unit = (): SplitUnit => props.unit ?? 'percent';
  const dir = (): SplitDir => props.dir ?? providedDir ?? globalDirection();
  const gutterSize = (): number => props.gutterSize ?? 11;
  const gutterStep = (): number => Math.max(1, props.gutterStep ?? 1);
  const disabled = (): boolean => !!props.disabled;
  const horizontal = (): boolean => direction() === 'horizontal';

  /* ─────────────────────────── pane registry ─────────────────────────── */

  /**
   * Panes in DOCUMENT order, not registration order. A pane inside `@if`/`@for` registers whenever
   * its branch mounts, which is not necessarily where it sits in the markup — ordering by
   * registration would put a late-mounting pane last and silently shuffle every size after it.
   */
  const ordered = computed<Registration[]>(() => {
    const list: Registration[] = registrations();
    const nodes: (Element | null)[] = list.map((r) => r.declaration.el());
    if (list.length < 2 || nodes.some((n) => n === null)) return list;
    return list
      .map((registration, i) => ({ registration, node: nodes[i] as Element }))
      .sort((a, b) =>
        a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .map((entry) => entry.registration);
  });

  const count = (): number => ordered().length;

  const bounds = computed<PaneBounds[]>(() => {
    const total: number = containerPanePx();
    return ordered().map((registration) => {
      const d: SplitPaneDeclaration = registration.declaration;
      return {
        min: toPx(d.min(), total, 0),
        max: toPx(d.max(), total, Number.POSITIVE_INFINITY),
        visible: d.visible(),
        locked: d.lock(),
      };
    });
  });

  const toPx = (size: SplitSize, total: number, wild: number): number => {
    if (size === '*') return wild;
    return unit() === 'pixel' ? size : (size / 100) * total;
  };

  /* ─────────────────────────── sizes ─────────────────────────── */

  const declaredSizes = (): SplitSize[] => ordered().map((r) => r.declaration.size() ?? '*');

  const readSizes = (): SplitSize[] | undefined => {
    const source: SplitSize[] | Signal<SplitSize[]> | undefined = props.sizes;
    if (source === undefined) return undefined;
    return typeof source === 'function' ? source() : source;
  };

  const sizes = computed<SplitSize[]>(() => {
    const n: number = count();
    const controlled: SplitSize[] | undefined = readSizes();
    if (controlled) return normalizeSizes(controlled, n);
    const own: SplitSize[] | null = internal();
    if (own && own.length === n) return own;
    return normalizeSizes(own ?? declaredSizes(), n);
  });

  /** Write sizes back to whoever owns them, then report the change and why it happened. */
  const commit = (next: SplitSize[], reason: SplitChangeReason): void => {
    const source: SplitSize[] | Signal<SplitSize[]> | undefined = props.sizes;
    if (typeof source === 'function' && typeof (source as Signal<SplitSize[]>).set === 'function') {
      (source as Signal<SplitSize[]>).set(next);
    } else if (source === undefined) {
      internal.set(next);
    }
    // A plain-array `sizes` is the parent's to change; we only report.
    props.onSizesChange?.(next, reason);
  };

  /* ─────────────────────────── measurement ─────────────────────────── */

  /** Container size along the layout axis, minus the gutters — the space panes actually share. */
  const containerSize: Signal<number> = signal<number>(0);

  // Counted straight off the declarations rather than off `bounds`: `bounds` resolves min/max
  // against this value, so reading it back here would close a cycle (bounds → panePx → bounds).
  const visibleCount = (): number => ordered().filter((r) => r.declaration.visible()).length;
  const containerPanePx = (): number =>
    Math.max(0, containerSize() - Math.max(0, visibleCount() - 1) * gutterSize());

  const measure = (): void => {
    const el: Element | null = host();
    if (!el) return;
    const rect: DOMRect = el.getBoundingClientRect();
    containerSize.set(horizontal() ? rect.width : rect.height);
  };

  onMount(() => {
    measure();
    // Percentages need no re-measure, but pixel sizes and every drag boundary are derived from the
    // container's real size, so a resized window (or a parent that animates open) must re-measure.
    const observer: ResizeObserver | null =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    const el: Element | null = host();
    if (observer && el) observer.observe(el);
    return () => observer?.disconnect();
  });

  /* ─────────────────────────── initial load ─────────────────────────── */

  onMount(() => {
    let cancelled: boolean = false;
    const finish = (applied: SplitSize[]): void => {
      if (cancelled) return;
      ready.set(true);
      props.onReady?.(applied);
    };

    const load: (() => SplitSizesSource) | undefined = props.loadSizes;
    if (!load) {
      finish(untrack(sizes));
      return () => {
        cancelled = true;
      };
    }

    try {
      const result: SplitSizesSource = load();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<SplitSize[] | null | undefined>).then(
          (loaded) => {
            if (cancelled) return;
            if (loaded) commit(normalizeSizes(loaded, untrack(count)), { type: 'load' });
            finish(untrack(sizes));
          },
          (error: unknown) => {
            if (cancelled) return;
            props.onLoadError?.(error);
            finish(untrack(sizes));
          }
        );
      } else {
        const loaded: SplitSize[] | null | undefined = result as SplitSize[] | null | undefined;
        if (loaded) commit(normalizeSizes(loaded, untrack(count)), { type: 'load' });
        finish(untrack(sizes));
      }
    } catch (error: unknown) {
      props.onLoadError?.(error);
      finish(untrack(sizes));
    }

    return () => {
      cancelled = true;
    };
  });

  /**
   * Keep the sizes array the same length as the pane list. Without this a pane appearing or
   * disappearing would shift every size after it onto the wrong pane — the change is silent and the
   * layout merely looks wrong, which is the hardest kind of bug to trace back to its cause.
   */
  effect(() => {
    const n: number = count();
    if (!ready()) return;
    const current: SplitSize[] = untrack(sizes);
    if (current.length === n) return;
    commit(normalizeSizes(current, n), { type: 'panes' });
  });

  /* ─────────────────────────── collapse ─────────────────────────── */

  const isCollapsed = (registration: Registration): boolean =>
    registration.declaration.collapsed() ?? registration.collapsed();

  const setCollapsed = (index: number, next: boolean): void => {
    const list: Registration[] = ordered();
    const registration: Registration | undefined = list[index];
    if (!registration || !registration.declaration.collapsible()) return;
    if (isCollapsed(registration) === next) return;

    const current: SplitSize[] = sizes();
    const total: number = containerPanePx();
    const px: number[] = resolvePixels(current, bounds(), unit(), total);
    const target: number = next
      ? toPx(registration.declaration.collapsedSize(), total, 0)
      : toPx(registration.expanded ?? registration.declaration.size() ?? '*', total, px[index]);

    // Collapsing frees pixels and expanding demands them; either way the difference is handed to the
    // neighbours through the same cascade a drag uses, so bounds and locks are respected identically.
    const delta: number = target - px[index];
    if (next) registration.expanded = current[index];

    const moved: number[] =
      index > 0
        ? distribute(px, bounds(), index - 1, index, -delta, false)
        : distribute(px, bounds(), index, index + 1, delta, false);

    registration.collapsed.set(next);
    registration.declaration.onCollapsedChange?.(next);

    const nextSizes: SplitSize[] = toSizes(moved, current, unit(), total);
    commit(nextSizes, next ? { type: 'collapse', pane: index } : { type: 'expand', pane: index });
    if (next) props.onCollapse?.(index, nextSizes);
    else props.onExpand?.(index, nextSizes);
  };

  /* ─────────────────────────── registration API ─────────────────────────── */

  const register = (declaration: SplitPaneDeclaration): SplitPaneHandle => {
    const registration: Registration = { declaration, expanded: null, collapsed: signal<boolean>(false) };
    registrations.set((list) => [...list, registration]);

    const indexOf = (): number => ordered().indexOf(registration);

    return {
      index: indexOf,
      style: (): string => {
        const i: number = indexOf();
        if (i < 0) return '';
        const line: number = i * 2 + 1;
        return horizontal() ? `grid-column: ${line} / span 1` : `grid-row: ${line} / span 1`;
      },
      collapsed: (): boolean => isCollapsed(registration),
      toggle: (): void => setCollapsed(indexOf(), !isCollapsed(registration)),
      dispose: (): void => {
        registrations.set((list) => list.filter((r) => r !== registration));
      },
    };
  };

  const contextValue: SplitContextValue = { register, direction };
  provide(SplitContext, contextValue);

  /* ─────────────────────────── dragging ─────────────────────────── */

  interface DragState {
    gutter: number;
    before: number;
    after: number;
    startCoord: number;
    startPx: number[];
    startSizes: SplitSize[];
    total: number;
    pointerId: number;
    element: Element;
    moved: number;
    announced: boolean;
  }
  let drag: DragState | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  const anchors = (): number[] => gutterAnchors(bounds());

  const paneIndicesFor = (gutter: number): { before: number; after: number } => {
    const list: number[] = anchors();
    const before: number = list[gutter];
    const visible: PaneBounds[] = bounds();
    let after: number = before + 1;
    while (after < visible.length && !visible[after].visible) after++;
    return { before, after };
  };

  const eventFor = (gutter: number): SplitGutterEvent => ({ gutter, sizes: sizes() });

  const applyOffset = (state: DragState, rawOffset: number, reason: SplitChangeReason): void => {
    // Only the horizontal axis flips under RTL; a vertical split reads top-to-bottom either way.
    const oriented: number = horizontal() && dir() === 'rtl' ? -rawOffset : rawOffset;
    const stepped: number = snap(oriented, gutterStep());
    const moved: number[] = distribute(
      state.startPx,
      bounds(),
      state.before,
      state.after,
      stepped,
      !!props.restrictMove
    );
    commit(toSizes(moved, state.startSizes, unit(), state.total), reason);
  };

  const stopDrag = (state: DragState, restore: boolean): void => {
    window.removeEventListener('keydown', onWindowKeydown, true);
    try {
      (state.element as HTMLElement).releasePointerCapture(state.pointerId);
    } catch {
      /* already released, or a synthetic event with no active pointer */
    }
    drag = null;
    draggingIndex.set(-1);
    if (restore) {
      commit(state.startSizes, { type: 'cancel', gutter: state.gutter });
    }
    props.onDragEnd?.(eventFor(state.gutter));
  };

  /**
   * Escape abandons the drag. The listener is on `window` in the capture phase because the pointer
   * is captured by the gutter but keyboard focus may be anywhere — a page-level listener is the only
   * one guaranteed to see the key while a drag is in flight.
   */
  const onWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    stopDrag(drag, true);
  };

  const onPointerdown = (event: PointerEvent, gutter: number): void => {
    if (disabled() || event.button !== 0) return;
    const element: Element | null = event.currentTarget as Element | null;
    if (!element) return;

    measure();
    const { before, after } = paneIndicesFor(gutter);
    const total: number = containerPanePx();
    const startSizes: SplitSize[] = sizes();

    drag = {
      gutter,
      before,
      after,
      startCoord: horizontal() ? event.clientX : event.clientY,
      startPx: resolvePixels(startSizes, bounds(), unit(), total),
      startSizes,
      total,
      pointerId: event.pointerId,
      element,
      moved: 0,
      announced: false,
    };
    draggingIndex.set(gutter);

    try {
      (element as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* no active pointer (synthetic event) */
    }
    (element as HTMLElement).focus?.();
    window.addEventListener('keydown', onWindowKeydown, true);
    event.preventDefault();
  };

  const onPointermove = (event: PointerEvent): void => {
    const state: DragState | null = drag;
    if (!state) return;
    const coord: number = horizontal() ? event.clientX : event.clientY;
    const offset: number = coord - state.startCoord;
    state.moved = Math.max(state.moved, Math.abs(offset));

    // A press that has not travelled past the click threshold is still a candidate click; moving the
    // layout underneath it would make a plain click twitch the panes.
    if (state.moved <= (props.gutterClickDeltaPx ?? 2)) return;

    if (!state.announced) {
      state.announced = true;
      props.onDragStart?.(eventFor(state.gutter));
      applyOffset(state, offset, { type: 'drag', gutter: state.gutter, phase: 'start' });
    } else {
      applyOffset(state, offset, { type: 'drag', gutter: state.gutter, phase: 'move' });
    }
    props.onDrag?.(eventFor(state.gutter));
    event.preventDefault();
  };

  const onPointerup = (event: PointerEvent, gutter: number): void => {
    const state: DragState | null = drag;
    if (!state) return;

    if (state.moved <= (props.gutterClickDeltaPx ?? 2)) {
      stopDragAsClick(state, gutter);
      return;
    }
    const coord: number = horizontal() ? event.clientX : event.clientY;
    applyOffset(state, coord - state.startCoord, { type: 'drag', gutter: state.gutter, phase: 'end' });
    stopDrag(state, false);
  };

  const stopDragAsClick = (state: DragState, gutter: number): void => {
    window.removeEventListener('keydown', onWindowKeydown, true);
    try {
      (state.element as HTMLElement).releasePointerCapture(state.pointerId);
    } catch {
      /* already released */
    }
    drag = null;
    draggingIndex.set(-1);

    const duration: number = props.gutterDblClickDuration ?? 0;
    if (duration <= 0) {
      props.onGutterClick?.(eventFor(gutter));
      return;
    }
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
      props.onGutterDblClick?.(eventFor(gutter));
      toggleAdjacent(gutter);
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      props.onGutterClick?.(eventFor(gutter));
    }, duration);
  };

  /** Collapse or restore the pane a gutter belongs to — the APG "primary pane", i.e. the one before. */
  const toggleAdjacent = (gutter: number): void => {
    const { before, after } = paneIndicesFor(gutter);
    const list: Registration[] = ordered();
    const target: number = list[before]?.declaration.collapsible()
      ? before
      : list[after]?.declaration.collapsible()
        ? after
        : -1;
    if (target < 0) return;
    setCollapsed(target, !isCollapsed(list[target]));
  };

  onDispose(() => {
    if (clickTimer !== null) clearTimeout(clickTimer);
    window.removeEventListener('keydown', onWindowKeydown, true);
  });

  /* ─────────────────────────── keyboard ─────────────────────────── */

  const onKeydown = (event: KeyboardEvent, gutter: number): void => {
    if (disabled()) return;

    const step: number = Math.max(gutterStep(), props.keyboardStep ?? 10);
    const page: number = props.keyboardPageStep ?? step * 10;
    const rtl: boolean = horizontal() && dir() === 'rtl';
    const { before, after } = paneIndicesFor(gutter);

    let offset: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        if (!horizontal()) return;
        offset = rtl ? step : -step;
        break;
      case 'ArrowRight':
        if (!horizontal()) return;
        offset = rtl ? -step : step;
        break;
      case 'ArrowUp':
        if (horizontal()) return;
        offset = -step;
        break;
      case 'ArrowDown':
        if (horizontal()) return;
        offset = step;
        break;
      case 'PageUp':
        offset = -page;
        break;
      case 'PageDown':
        offset = page;
        break;
      case 'Home':
      case 'End':
        // "Smallest / largest allowed size for the primary pane" — an offset large enough to be
        // clamped by the cascade at exactly that bound, so one path handles every constraint.
        offset = event.key === 'Home' ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        break;
      case 'Enter':
        event.preventDefault();
        toggleAdjacent(gutter);
        return;
      default:
        return;
    }

    measure();
    const total: number = containerPanePx();
    const current: SplitSize[] = sizes();
    const px: number[] = resolvePixels(current, bounds(), unit(), total);
    const moved: number[] = distribute(px, bounds(), before, after, offset, !!props.restrictMove);
    commit(toSizes(moved, current, unit(), total), { type: 'keyboard', gutter, key: event.key });
    event.preventDefault();
  };

  /* ─────────────────────────── render context ─────────────────────────── */

  const labelFor = (gutter: number): string | undefined => {
    const label: string | ((gutter: number) => string) | undefined = props.gutterLabel;
    if (typeof label === 'function') return label(gutter);
    return label;
  };

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-split', `weave-split--${direction()}`];
      if (disabled()) parts.push('weave-split--disabled');
      if (draggingIndex() >= 0) parts.push('weave-split--dragging');
      if (props.useTransition && draggingIndex() < 0) parts.push('weave-split--animated');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    rootStyle: (): string => {
      const template: string = gridTemplate(sizes(), bounds(), unit(), gutterSize());
      return horizontal() ? `grid-template-columns: ${template}` : `grid-template-rows: ${template}`;
    },
    gutters: (): SplitGutterView[] => {
      const list: number[] = anchors();
      const total: number = containerPanePx();
      const px: number[] = resolvePixels(sizes(), bounds(), unit(), total);
      const paneBounds: PaneBounds[] = bounds();

      return list.map((anchor, index) => {
        const line: number = anchor * 2 + 2;
        const bound: PaneBounds | undefined = paneBounds[anchor];
        const asPercent = (value: number): number =>
          total > 0 ? Math.round((value / total) * 100) : 0;
        const valueNow: number = asPercent(px[anchor] ?? 0);
        return {
          index,
          style: horizontal() ? `grid-column: ${line} / span 1` : `grid-row: ${line} / span 1`,
          label: labelFor(index),
          valueNow,
          valueMin: bound ? asPercent(bound.min) : 0,
          valueMax: bound && Number.isFinite(bound.max) ? asPercent(bound.max) : 100,
          valueText: `${valueNow}%`,
        };
      });
    },
    gutterClass: (gutter: number): string =>
      draggingIndex() === gutter ? 'weave-split__gutter weave-split__gutter--dragging' : 'weave-split__gutter',
    // APG calls a splitter that moves left/right a VERTICAL splitter: the value describes the
    // separator bar, not the axis the panes are arranged along.
    ariaOrientation: (): 'horizontal' | 'vertical' => (horizontal() ? 'vertical' : 'horizontal'),
    disabledAttr: (): string | undefined => (disabled() ? 'true' : undefined),
    tabindex: (): number => (disabled() ? -1 : 0),
    draggingIndex,
    onPointerdown,
    onPointermove,
    onPointerup,
    onKeydown,
  };
}
