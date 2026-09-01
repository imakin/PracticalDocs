# Tables Carry No Text The User Did Not Write

## Goal

A table renders its cells and nothing else. The caption element the editor composed on its own is
gone, along with the extra row it grew on every save and load.

## What was there before

The table node held a `caption` attribute, and two places turned it into visible text by pasting the
numbering profile's label in front of it:

```
ReferenceTableView.updateReferenceAttributes   ->  the caption element on screen
CustomTable.renderHTML                         ->  <caption> in the saved html
```

Both composed `label: caption`, so a table with the caption "Ringkasan" under the built-in `Tabel`
profile displayed "Tabel 1: Ringkasan". The label half was not the user's text and the element was
`contenteditable="false"`, so there was no way to correct it or take it off the page.

## The extra row

The table schema is `content: "tableRow+"` and its only parse rule is `{ tag: 'table' }`. Nothing
parses `<caption>`. So when a stored document was opened, ProseMirror found text inside the table that
could not be placed and wrapped it into the only thing a table accepts - a row of its own.

A second path fed it. The `caption` attribute parsed as:

```js
element.getAttribute('data-caption') || element.querySelector('caption')?.textContent || ''
```

A table with no caption wrote `data-caption=""`, which is falsy, so the fallback promoted the
automatic label into a caption the user was now deemed to have written. The next render composed
`Tabel 1: Tabel 1` from it, and the cycle repeated: one more row of `Tabel 1: Tabel 1` for every save
and load.

## What changed

- The caption element is gone from `ReferenceTableView`. The view still writes the reference
  attributes, so a cross-reference to a table still finds it and still reads "Table 1".
- `renderHTML` no longer emits `<caption>`, and the `caption` attribute is gone from the node, so it
  is neither written nor read.
- The table's parse rules gained `{ tag: 'caption', ignore: true }`. ProseMirror leaves an `ignore`
  rule unbound to any node, so the element is skipped wherever it appears - which is what neutralises
  every document already carrying one. **The caption text in those documents is dropped, not
  converted.** A caption that was really typed has to be typed again as an ordinary block.
- The number widget no longer covers tables. It was anchored at `pos + 1`, inside the table, where
  the only thing a table accepts is a row.
- `Insert > Caption` applies to figures only. It is disabled with a table selected, and
  `setReferenceCaption` refuses one, so a caption cannot be stored where nothing would render it.
- `.umo-node-table-caption` was removed from the stylesheet, and the button's tooltip no longer
  mentions tables.

A table caption is now written the way any other text is: a block above or below the table, styled
and numbered by a profile, which is where `Tabel {h1}.{number}` already worked.

## Tests

`table-caption-removal.cdp.mjs`, 21 checks, its own fixture. It builds a two-row table, then asserts
on what the browser actually renders: the row count, the text of each cell, and every text node
inside the table that is *not* in a cell - the last one being what the user could see and not remove.
It sends the document through three save and load round trips and requires the row count and the cell
text to be identical every time. It then opens a document written in the old format, verbatim, and
requires the caption to disappear rather than become a row while the table keeps its reference id.

It was seen to **fail** on the unpatched build before it was seen to pass: 19 of the 21 checks red,
with the table growing from two rows to three, four and five across the three round trips and the
stray text reading `Tabel 1: Tabel 1` - the same thing the user reported. The two that stayed green
there are the reference id, which the change deliberately keeps, and the very first row count, since
the first render has not been through a save yet.

```bash
npm run test:e2e:table-caption
```
