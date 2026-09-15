# A Page Break Carries A Whole Numbering Section

## Goal

The settings under `At this page break` are the same ones the document above them has: where the
number sits, where it sits on the page the break opens, which numerals, where the count starts, and
what the number reads.

## What was there before, and what was stopping it

Two of them: the count, and the numerals.

**Nothing was stopping the rest.** The page break node already carried `sectionEnabled`,
`sectionPosition`, `sectionFormat`, `sectionTemplate` and `sectionStartAt`, and `computePageNumbers`
already resolved position, first-page position, format, template and the count per section. The panel
simply offered two of them, so a break could change how a page was counted but not where its number
sat or what it read - a capability sitting unreachable in the engine.

One field was genuinely missing: the break had no `sectionFirstPagePosition`, and the driver passed
no `firstPagePosition` to the engine. That one needed the model extending. The other two needed only
a control.

## A template needs three states, not two

Follow the section before, or use one of its own - **which may be empty**. An input alone cannot say
the difference between "inherit" and "show nothing", so the choice is an explicit checkbox and the
input appears under it.

## An empty template prints nothing, and the count carries on underneath

Type nothing into the template and those pages carry no number at all, while the pages after them
come back with the numbers they would have had. This hides a folio; it does not reset a count.

It already worked end to end and is now asserted: `applyPageTemplate` returns an empty string for an
empty template rather than falling back to `{number}`, and the renderer draws nothing for an entry
whose text is empty. The physical page in `index` is untouched, which is what the table of contents
and PDF navigation read.

The same freedom applies to the document's own template: whatever is typed is what is printed.

## Test script

`page-numbering.test.mjs` grew six checks - a section changing only the position, a section changing
only the page it opens, a section template, an empty template with the count continuing underneath, a
section that says nothing changing nothing, and a free document template. 32 checks in that file.

`page-number-section.cdp.mjs`, 12 checks, own fixture. It opens the panel the way a writer does -
pressing the **Page tab**, then the button - confirms the section controls appear only once a page
break is selected, and measures the drawn numbers moving on the page. **This closes the debt item
that said the page number panel was covered only by a throwaway probe.**

```bash
npm run test:e2e:page-number-section
npm run test:unit:page-numbering
```

## Each section prints on its own paper (2026-09-15)

The export followed the screen at last. A document whose sections use different page sizes exports
with **each section on its own paper** - one PDF page per on-screen sheet, in that section's own text
column, at full size - and the page numbers land where the screen draws them. The dialog's warning
that none of this was possible is gone, along with the `print.mixedPaperNote` string.

What had blocked it was a cause recorded as one sentence with an **and** in it: *the canvas is as wide
as the widest sheet, and Chrome scales a printed document down to fit its narrowest page*. The second
half is false. Chrome shrinks only when an element overflows the page it is printed on, measured in
`AGENT/experiments/0003` before any of this was built. So the rule is one line - **no element may be
wider than the page it prints on** - and the canvas is cut to the narrowest sheet while each block
takes its own section's column.

Three faults surfaced on the way, all latent while there was only one page name, and together they
turned six sheets into thirteen pages: the wrappers carried no page name and so crossed to the
default page and back; a band written as a `div` inside a `p` made the parser tear the paragraph in
half and leave the remainder as a bare text node, which can carry neither a section nor a column -
the band is a `span` now, so nothing is torn; and a page break at a section boundary broke twice,
once for itself and once for the change of name.

The decision is `AGENT/adr/0024`, which supersedes `0021`.

```bash
npm run test:e2e:page-sections-export
```

Every column in that test is measured in points against the paper it belongs to - 415 pt portrait,
662 pt landscape - so a document that shrinks cannot pass it. Four of its checks asserted the old
compromise and were seen failing before the rewrite.

**Not measured**: the Export button prints through Chrome's own print dialog, and every number here
was taken with `printToPDF`.
