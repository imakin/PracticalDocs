# Decoration-Based Pagination

Visual page view: the editor shows discrete sheets of paper, a long paragraph splits between its own
text lines at the page boundary, and the band made of bottom margin, sheet gap and top margin holds no
text. Architecture decision recorded in `AGENT/adr/0002-decoration-based-pagination.md`.

## How it works

`src/extensions/pagination/index.js` is a Tiptap extension holding a ProseMirror plugin. The plugin
owns a `DecorationSet`; a driver attached through the plugin's `view()` recomputes it.

One solve pass:

1. Read the sheet geometry from the CSS custom properties already set by `page.vue`
   (`--umo-page-height`, `--umo-page-margin-top`, `--umo-page-margin-bottom`, `--umo-page-sheet-gap`),
   measured through a hidden ruler element so `cm` values arrive as real pixels.
2. Clear the existing decorations. Dispatching is synchronous, so what is measured next is the
   unpaginated layout.
3. Collect one box per rendered line of text, plus embedded media, and find the first box that crosses
   the bottom of its sheet's text column.
4. Resolve the document position of the first character of that line and record a spacer tall enough
   to move the line to the top of the next sheet's column.
5. Apply, and repeat from step 3 until nothing overflows.

The spacers are `Decoration.widget`s, so the editor view renders them. Nothing is written into the
contenteditable behind the view's back, and document positions are untouched, because decorations do
not occupy any.

## Details that matter

**Every solve starts from the unpaginated layout.** Measuring while the previous spacers are still in
place finds nothing overflowing - they are the reason nothing overflows - so the engine concludes the
document needs no breaks and drops the ones holding it together. This showed up as page breaks
vanishing on the first keystroke.

**Line start positions are resolved from the DOM, not from coordinates.** `posAtCoords` maps a
viewport point, and the line that overflows a page is usually scrolled far out of view, where it
returns nothing usable. Character rect tops rise monotonically inside a text node, so the first
character of the line is binary-searched instead and mapped with `posAtDOM`, which does not care where
the viewport happens to be.

**Recomputation is triggered, never observed.** The driver reacts to document changes and to an
explicit `refreshPagination()` command, which `page.vue` issues when page size, margins, orientation or
zoom change. It never watches the DOM it writes to. The previous engine did, and the two fed each other
at animation-frame rate forever.

**The canvas is padded to a whole number of sheets** through `--umo-page-total-height`, measured from
the last laid-out box rather than from the element height, which would feed back into the property
being set. Without it the last sheet is drawn as a fragment ending wherever the text stops.

**Print strips the spacers.** Export builds its document from the live DOM, and print paginates on its
own through `@page`. Leaving the spacers in would stack their blank space on top of the browser's page
breaks. `src/components/container/print.vue` removes them and the padded height before printing.

## Known limitation: justification of the line before a break

A block-level spacer inside a justified paragraph splits it into two anonymous block boxes, so the line
immediately above a page break becomes a "last line" and CSS does not stretch it to the full column.

Measured on a 10702-character thesis: 126 of 177 justified lines fill the column exactly, while the
five lines sitting directly above a page break come in at 90%, 98%, 33%, 80% and 94% of full width.
The effect is visible but small, because those lines were nearly full already.

`text-align-last: justify` is not a fix: it applies to the last line of every block container, so it
would also stretch the paragraph's real final line, trading one artifact for a worse one.

## Test

`tests/e2e/pagination-geometry.cdp.mjs` measures where text actually lands rather than asserting on
CSS. Fourteen checks:

- every text line sits inside a sheet text column
- the scroll container is not taller than its content
- the page settles when idle (no runaway render loop)
- scrolling reaches the true bottom, and returns to the top
- spacers are rendered as decorations, and never reach the saved HTML, JSON or text
- typing repaginates instead of dropping the page breaks, and the typed text reaches the document
- undo restores the document exactly, and leaves the page breaks correct
- changing the bottom margin repaginates
- the export document is built from the live page, and excludes the screen spacers

It opens a new tab in the existing window, closes only that tab, and restores the localStorage keys it
shares with any other open tab.

```bash
npm run test:e2e:pagination
```

Requires Chrome started with `--remote-debugging-port=9222`, the dev server on port 9000, and a
multi-page document on the storage server (`PAGINATION_DOC`, default `tesis4`).
