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

## Matching Export to PDF: widows and orphans

The engine originally packed every line that geometrically fitted, and the on-screen breaks drifted
against the exported PDF: sheet 1 matched, sheet 2 was one line out, sheet 3 two lines, and so on.

The cause is not geometry. Both sides use the same 4cm-to-26.7cm text column, and measuring the
exported PDF showed page 2 ending at 25.69cm with a full centimetre of column still free - print was
declining to fill it. That is `widows` and `orphans`, whose initial value in Chrome is 2. Print refuses
to strand a single line at the top of a page or leave a single line behind at the bottom; the engine
did not care, and every following sheet inherited the difference.

Proof: rendering the same export document with `orphans: 1; widows: 1` forced produced page breaks
identical to the engine's, on every page.

`respectWidowsAndOrphans()` now reads the computed `widows` and `orphans` of the block being broken and
moves the break earlier when needed:

- fewer than `widows` lines would move to the next sheet: break that many lines earlier
- fewer than `orphans` lines would be left behind: move the whole block to the next sheet

With this, all six pages of the reference thesis match the export exactly, line count included.

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

## Second test: parity with Export to PDF

`tests/e2e/pagination-pdf-parity.cdp.mjs` renders the export document through the same path the
application uses, converts it to PDF, and compares the first line of every PDF page against the first
line of the corresponding on-screen sheet.

This is the check the geometry test cannot make. Keeping text out of the margin band is necessary but
not sufficient: the engine can satisfy it while still breaking one line away from the export, which is
exactly the bug that shipped. Removing the widow and orphan handling makes this test fail on four of
six pages, and no other test notices.

```bash
npm run test:e2e:pagination-pdf
```

Both tests require Chrome started with `--remote-debugging-port=9222`, the dev server on port 9000, and
a multi-page document on the storage server (`PAGINATION_DOC`, default `tesis4`). The parity test also
needs `poppler-utils` for `pdfinfo` and `pdftotext`.

## Manual page breaks (2026-08-30)

`.umo-page-break` carries `break-before: page`. Print honoured it and the engine never read it, so a
document with a manual break showed one layout on screen and a different one in the export, and every
sheet after the break inherited the difference. Caught by the parity test the moment the reference
thesis gained a second chapter with a break before it: pages 1 to 5 matched, 6 to 9 did not.

`forcedBreaks` walks the document for `pageBreak` nodes and returns the position after each one with
the geometry of the content that follows. The solve loop now takes whichever comes first down the
page, a forced break or the first overflowing line. A break whose following content already sits at
the top of a column is skipped, or it would insert an entire blank sheet.

The spacer is anchored **after** the break node, not before it. In print the element collapses to zero
height, so it is the content after the break that opens the new page; anchoring before would put the
marker's own box at the top of the sheet and start the text lower than the export does.

### A second cause, in the print stylesheet

Honouring the break moved the failure but did not remove it: page 6 then matched and 7 to 9 still did
not, with the screen fitting one line more per page. Measured under emulated print media:

```
screen  height 1px   margin 30px / 30px
print   height 0px   margin 30px / 30px   <- not zeroed
```

The base rule marks the margins `!important` so they win on screen; the `@media print` block reset
them without `!important`, so they won there too. A page break was therefore pushing the first line of
the new page down by 30px in the export only. The print reset is now `!important`, and a page break
adds no space to the page it starts.

With both fixed, all nine pages of the two-chapter thesis match.

### Test

`tests/e2e/page-break.cdp.mjs`, 9 checks, on its own synthetic document rather than the user's, so it
cannot be broken by whatever they are writing. Two short paragraphs share a sheet; inserting a break
between them moves the second to the next sheet, at exactly the top of its column, with exactly one
spacer, and a second solve adds no more.

```bash
npm run test:e2e:page-break
```


## Page numbers (2026-08-30, screen only so far)

A page carries two numbers and they are not the same thing.

```
index  the physical page, 1..N, never restarted. The PDF outline and page navigation use it.
text   what is printed in the footer: restartable, re-formattable, hideable, purely visual.
```

A thesis whose body restarts at 1 still has its "BAB I" bookmark pointing at physical page 3. The
physical index is produced by Chrome when it prints, so nothing has to be built for it.

`src/utils/page-numbering.js` computes the visible number for every sheet from the document's settings
plus **numbering sections**, which are anchored on `pageBreak` nodes: a numbering change always happens
at a page boundary, and a break is already there between chapters, so the break carries five optional
attributes rather than a second kind of marker being introduced. Null means "carry on from the section
before", except `sectionStartAt`, where a number restarts the count and null continues it.

Why the numbers are computed rather than left to CSS is recorded in ADR 0008: Chrome's `@page` margin
boxes can place and format a number, but they cannot restart a count.

The engine draws them, one element per sheet, inside the margin band. They are plain elements in the
page container rather than decorations, because they belong to the sheet and not to the document, and
putting them in the flow would change the layout they describe.

`tests/unit/page-numbering.test.mjs`, 18 checks, including the four cases the user asked for:

```
"mulai dari 10"                     -> 10, 11, 12
"reset ke 1 setelah halaman 5"      -> 1,2,3,4,5, 1,2,3
"reset ke 1 di hal 5, jadi romawi"  -> 1,2,3,4, i,ii,iii
bentuk tesis                        -> i,ii, 1,2,3,4
```

### In the export: the margins became real blocks

Measured, not assumed: with `@page { padding }` the container's coordinate space is the **content
area**, not the full page, so a position computed from the page height lands a page late. Content
pushed past the content area does not render in the page padding either - it spills onto the next
page. An absolutely positioned number therefore cannot reach the margin band, and inside the text
column it would collide with the last line.

The answer came from the reason this product exists: **stop making the margin invisible space**. For a
document that carries page numbers the export drops `@page` padding entirely and the margins become
real blocks in the flow. The engine's spacer already holds exactly what is needed - the leftover
column space, the ending page's bottom margin, the sheet gap, and the next page's top margin - so it
splits into a closing band (leftover + bottom margin, ending the page, holding the number) and an
opening band (the next page's top margin).

Five things had to be got right, each found by measuring rather than reasoning:

1. **The canvas already had real margin blocks.** `.umo-page-node-header` and `.umo-page-node-footer`
   are each one margin tall. The export was applying the top margin twice, as that element and as
   `@page` padding.
2. **A minimum height defeated the whole mechanism.** Clamping a band to the bottom margin pushed it
   past the page boundary where the text ran 4.48px long, and Chrome moved the band and its number to
   the next page. Bands now snap to the boundary with no minimum: a bottom margin a few pixels short
   is invisible, a page number on the wrong page is not.
3. **Half a pixel is enough to spill a band**, so each band measures itself after layout and snaps,
   rather than trusting a height computed from screen geometry.
4. **A manual page break fired twice.** The break element carries its own `break-before: page` and the
   engine puts a spacer there too, giving two breaks at one point and a blank page. The bands are
   authoritative in the export, so the element's own break is turned off.
5. **`<div>` inside `<span>` does not survive.** The engine's spacer is a span, the export serialises
   and re-parses its HTML twice, and the parser hoists the number out again - so the number vanished
   from some bands and not others. The band is now a real `<div>` that replaces the span. The last
   page's band goes into the text flow rather than beside the footer, which is a flex item and gets
   laid out nowhere near the last line.

**Only numbered documents take this path.** Everything else exports as before, with Chrome paginating
freely, so `pagination-pdf-parity` stays an independent verdict on the engine rather than becoming
true by construction. That test is what caught the page-break drift, and it is worth keeping honest.

### Test

`tests/e2e/page-numbers-export.cdp.mjs`, 6 checks, on its own synthetic document: front matter in
lower roman, a page break that restarts the count in decimal, then the exported PDF read back page by
page. It asserts one PDF page per on-screen sheet, a number on every page, the numbers matching the
screen exactly, and the physical page count untouched by the restart.

```bash
npm run test:e2e:page-numbers-export
```

### Superseded note

Measured, not assumed: with `@page { padding }` the container's coordinate space is the **content
area**, not the full page, so a position computed from the page height lands a page late. Content
pushed past the content area does not render in the page padding either - it spills onto the next
page. So an absolutely positioned number cannot reach the margin band, and inside the text column it
would collide with the last line.

This section recorded an interim state in which the numbers were dropped from the export rather than
misplaced. That is no longer the case; see above.
