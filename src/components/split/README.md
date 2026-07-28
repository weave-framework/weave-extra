# Split

Resizable panes separated by draggable gutters — the WAI-ARIA
[window splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) pattern.

```ts
import Split from '@weave-framework/extra/components/split';
import SplitPane from '@weave-framework/extra/components/split-pane';
```
```html
<Split direction="horizontal" sizes={{ sizes() }} onSizesChange={{ persist }}>
  <SplitPane size={{ 30 }} min={{ 15 }} collapsible>sidebar</SplitPane>
  <SplitPane>editor</SplitPane>
</Split>
```
No stylesheet to include: the styles live beside the component (`split.scss` next to `split.ts`), get
scoped to it by the compiler, and compile into the module. Importing the component brings them.

## How it is laid out

A CSS grid whose tracks alternate pane, gutter, pane, … Nothing is absolutely positioned; the browser
does the layout. Panes register through context and are ordered by **document position**, so putting a
pane behind an `@if` or inside a `@for` behaves the same as listing it statically.

Pane tracks are `minmax(0, …)`. Without the zero floor, overflowing content sets an implicit
min-content floor and the gutter jams with nothing on screen to explain why.

## Persistence

Sizes are transport-neutral: nothing here knows about `localStorage`, and nothing assumes the store
is synchronous.

```ts
<Split
  loadSizes={{ () => api.get(`/layout/${userId}`) }}   // sync or async; null keeps the declared sizes
  onSizesChange={{ (sizes, reason) => {
    if (reason.type === 'load') return;                 // do not echo back what we just loaded
    if (reason.type === 'drag' && reason.phase !== 'end') return;  // one write per drag, not per frame
    api.put(`/layout/${userId}`, sizes);
  } }}
  onLoadError={{ (error) => report(error) }}
/>
```

`reason` is a discriminated union — `drag` (with `phase`), `keyboard` (with `key`), `cancel`,
`collapse`, `expand`, `load`, `panes`. That is what lets a remote store tell a cheap local echo from a
commit worth a round trip.

Sizes can be owned three ways: a plain array (you own it, only the callback fires), a writable signal
(`bind:sizes`, written in place), or omitted entirely (the component owns it, seeded from
`defaultSizes` or from what each pane declared).

## Keyboard

| Key | Action |
|---|---|
| `←` `→` / `↑` `↓` | Move the gutter one `keyboardStep` (default 10px, snapped to `gutterStep`) |
| `PageUp` / `PageDown` | Grow / shrink the primary pane by `keyboardPageStep` (default 10 × step) |
| `Home` / `End` | Move to the primary pane's smallest / largest allowed size |
| `Enter` | Collapse the primary pane, or restore it to the size it had |
| `Escape` | Abandon a drag in progress and put the sizes back |

Horizontal arrows flip under RTL; vertical ones do not, because a vertical split reads top-to-bottom
either way. The Page keys always mean "a big step for the primary pane", whichever axis the split is
on — the one reading that does not change meaning between a horizontal and a vertical splitter.

## Props

### `<Split>`

| Prop | Default | |
|---|---|---|
| `direction` | `'horizontal'` | Axis the panes are laid out along |
| `unit` | `'percent'` | `'percent'` (of the space left after gutters) or `'pixel'` |
| `dir` | CDK active direction | `'ltr'` / `'rtl'` |
| `sizes` | — | Array, or a writable signal (`bind:sizes`) |
| `defaultSizes` | — | Uncontrolled initial sizes |
| `loadSizes` | — | `() => SplitSize[] \| null \| Promise<…>` — fetched on mount |
| `gutterSize` | `11` | Gutter thickness in px |
| `gutterStep` | `1` | Snap drags to a multiple of this |
| `gutterClickDeltaPx` | `2` | Movement below this still counts as a click |
| `gutterDblClickDuration` | `0` | Double-click window; `0` disables it |
| `keyboardStep` | `10` | Pixels per arrow key |
| `keyboardPageStep` | `step × 10` | Pixels per Page key |
| `disabled` | `false` | Gutters stay in the layout, drop out of the tab order |
| `restrictMove` | `false` | Confine a drag to the flanking pair instead of cascading |
| `useTransition` | `false` | Animate size changes that did not come from a drag |
| `gutterLabel` | — | `string` or `(gutter: number) => string` |

Callbacks: `onSizesChange`, `onReady`, `onLoadError`, `onDragStart`, `onDrag`, `onDragEnd`,
`onGutterClick`, `onGutterDblClick`, `onCollapse`, `onExpand`.

### `<SplitPane>`

| Prop | Default | |
|---|---|---|
| `size` | `'*'` | Initial size; `'*'` takes what is left |
| `min` / `max` | `'*'` | Bounds; `'*'` means none |
| `lock` | `false` | Keeps its size through any drag |
| `visible` | `true` | Hidden panes keep a zero-width slot; their two gutters become one |
| `collapsible` | `false` | Enables `Enter`, gutter double-click, and the `collapsed` prop |
| `collapsedSize` | `0` | Size to collapse to |
| `collapsed` | — | Controlled collapsed state |
| `onCollapsedChange` | — | Fires on collapse and expand |

## Theming

Every colour and measure reads through a three-step fallback:

```scss
background: var(--weave-split-grip, var(--weave-color-neutral, #9a9ca3));
```

Set `--weave-split-*` to restyle just the splitter, apply the Weave theme to have it follow the app,
or do neither and still get something that looks deliberate.

| Token | Falls back to |
|---|---|
| `--weave-split-gutter` | `transparent` |
| `--weave-split-gutter-hover` | `--weave-color-field` |
| `--weave-split-line` | `--weave-color-line` |
| `--weave-split-grip` | `--weave-color-neutral` |
| `--weave-split-grip-active` | `--weave-color-accent` |
| `--weave-split-focus` | `--weave-color-accent` |
| `--weave-split-duration` | `--weave-motion-fast` |
| `--weave-split-line-thickness` | `1px` |
| `--weave-split-grip-length` / `-thickness` / `-radius` | `24px` / `2px` / `1px` |
| `--weave-split-focus-width` / `-offset` | `2px` / `-2px` |

## Notes on the implementation

- **A pane renders the gutter that follows it**, and the container renders only the grid frame. Tab
  order follows DOM order, so a container emitting every separator after the whole slot puts them
  all *after* every pane — Tab walks all the content first and only then reaches the splitters. Each
  pane sits in a `display: contents` wrapper holding its box and its trailing gutter, so DOM order
  matches visual order while both stay direct grid items. Verified: with an input in each of three
  panes, focus order is `input → separator → input → separator → input`.
- **One pointer path.** `pointerdown` + `setPointerCapture` covers mouse, touch and pen, and keeps the
  drag alive when the pointer crosses an iframe or leaves the window.
- **Nothing in a pane can reach the gutter's key handling.** The listener is on the gutter, and pane
  content is its sibling rather than its descendant, so arrows in a scroll container, `Enter` in a
  form, and a `<select>`'s own arrow handling are all untouched — a property of the DOM shape, not of
  any per-component allowance. The one page-wide listener is `Escape`, and only while a pointer drag
  is actually in flight.
- **`aria-orientation` describes the separator bar, not the pane axis.** APG calls a splitter that
  moves left/right a *vertical* splitter, so a `direction="horizontal"` split reports
  `aria-orientation="vertical"`.
- **Wildcards split the remainder equally.** Handing each `'*'` pane the whole remainder overshoots the
  container as soon as there are two of them, which silently corrupts every drag boundary derived
  from it.
- **The layout math is a separate module** (`layout.ts`) with no DOM and no signals, so wildcard
  resolution, the shrink/expand cascade and grid track placement can be exercised directly.
