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
