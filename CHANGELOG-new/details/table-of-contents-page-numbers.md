# The Table of Contents Points at a Real Page

## Goal

Every entry shows the page the reader will actually turn to, and the number the heading itself
carries. Before this, every entry read "1" and every entry was bare heading text.

## Why every entry said 1

`getPageNumber` in `extensions/toc/node-view.vue` did this:

```js
const pageNode = el.closest('.umo-page-node')
const allPages = [...document.querySelectorAll('.umo-page-node')]
return allPages.indexOf(pageNode) + 1
```

It counted sheets as DOM elements. That was true of the engine ADR 0001 described. Since ADR 0002
made pagination a set of decorations there is **one** `.umo-page-node` for the whole canvas - a sheet
is a region of one tall element, not an element - so the lookup returned the same node for every
heading and every entry fell back to 1. The contents was wrong on any document longer than a page,
and had been since the pagination rewrite.

## One computation, read by both

The engine already solves this. It knows the sheet pitch, and `computePageNumbers` already turns a
sheet index into what the reader sees, restarts and roman front matter included. The contents now
reads that instead of computing a second answer, because two renderings of one thing with no parity
check is what produced the pagination-versus-PDF bug in ADR 0002.

- The driver publishes `pages` and `stride` into the pagination extension's storage on every solve,
  **whether or not numbers are drawn**. The page a heading is on is a fact about the document; a
  reader still wants it in the contents when no folio is printed.
- `pageOfElement(editor, element)` is exported from the pagination extension and answers "which sheet,
  and what is it called".
- The driver emits `paginationChanged` when it has re-solved. A page number changes without the
  document changing - a margin edit, a new page size, a page break inserted earlier - and nothing else
  would tell the contents. This is the same fix, for the same reason, as `profilesChanged` in ADR 0007.
- With numbering off, an entry shows the physical page. A contents entry has to point somewhere.

## The measurement that had to be right

A heading is located by its first rendered **line**, not by its box, and only text nodes count.

Measured on the fixture: the second chapter's box top is 2208px and its text is at 2377px, with the
sheet pitch at 1138px. The box is on sheet 1, inside that sheet's bottom margin; the text is on
sheet 2. Two different answers about the same heading, and the box's is the one the reader would call
wrong.

The cause is a known fault of the break spacer's anchoring: it can land inside the block that follows
the break rather than before it. The spacer is a full-width block, so `selectNodeContents(heading)`
returns the spacer's rect first and reports the box again under another name. Walking text nodes skips
it, and then the contents agrees with `sheetOpenedByBreak`, which the engine uses for the same reason.

## The heading's own number

Read from the rendered `.umo-heading-number` decoration rather than recomputed, so a contents entry
cannot disagree with the heading it points at. A template containing a newline - `BAB I\nPENDAHULUAN` -
renders on several lines in the document and is collapsed to one in the contents.

## The tree lines, and indentation as a setting

The contents was a TDesign `t-tree`. A tree brings connector lines, an expand arrow, a hover tooltip
and an indent of its own. None of it was reachable: the user could not turn the lines off, could not
change how far a sub-heading was indented, and could not stop the tooltip appearing. That is the same
fault as the table's automatic caption - the editor putting something on the page that the user cannot
control - and it gets the same answer.

The contents is now a flat list of rows. Indentation is two fields on the **Table of Contents**
profile, edited in the Profiles dialog like everything else that decides how a block looks:

```
Indent From Heading Level   2       the level indenting starts at
Indent Per Level            2em     how much each level after that adds, 0 for none
```

A level shallower than the starting level is not indented. Setting the step to `0`, or the starting
level below the deepest heading, gives a flat list. The arithmetic is in `utils/toc-indent.js`, a pure
function with its own unit tests, so it can be checked without a browser.

The page numbers stay in one column whatever the indent is. Indentation is padding on the row, the
number is a fixed track at the right edge, and the dot leader takes whatever is left between them.
The row is `box-sizing: border-box` - without it the padding is added to a width that is already the
full width, the row overhangs to the right by exactly the indent, and it drags the page number with
it. That was measured, not foreseen: the first run had the indented row's number at 1072px against
1044px for the others.

**A hazard closed while here.** The block style gallery listed every profile, so clicking `Page Number`
or `Table of Contents` stamped it onto whatever block the cursor was in - measured: the paragraph under
the cursor came away carrying `profile-toc`, styled by a rule written for a contents.

The first attempt hid them from the gallery. That was wrong in the other direction: the user went
looking for the contents profile in the one list that shows profiles and found a gap. **A missing thing
teaches nothing; a refused thing teaches why.** They stay in the list now, greyed and not clickable,
each carrying a hint:

```
Table of Contents   Only for Table of Content / Document Map
Page Number         Only for page numbers
```

The refusal is one guard, `applyCard`, that both card lists go through, rather than a filter a later
caller could miss. The `Apply to Active Block` button in the Profiles dialog offers the same action and
gets the same refusal, with the hint beside it.

## Why the profile could not be found

The first attempt shipped the `Table of Contents` profile as a built-in and the user went looking for
it and found nothing. `onCreate` merged missing built-ins into a saved list, but **opening a document
did not**: `setNumberingConfig` replaced the profile list outright with whatever that document was
saved with. A document written before the profile existed does not mention it, so it disappeared the
moment the document was opened - which is every time the user actually looks.

Both paths go through `withBuiltInProfiles` now. A saved list keeps every edit the user made and gains
only the built-ins it does not mention. Anything that replaces the profile list has to go through it.

## Which profile a document map uses

More than one contents profile can exist - a thesis wants its table of contents indented and its list
of figures flat - so a map has to say which one it uses. It carries a `profileId` attribute, and the
rule is in `resolveTocProfile`:

1. the profile the map names, if it still exists and is a contents profile,
2. the built-in `profile-toc`, which the picker calls **Default**,
3. any contents profile at all,
4. nothing, and the built-in numbers apply.

A map naming a deleted profile falls back to the default **and keeps the name**, so restoring the
profile restores the map. Rewriting the map's choice on its behalf is what made one profile edit reach
every block in ADR 0007.

## Where the setting is, and why it is there

**A document map cannot be selected the way every other block can.** It is an atom whose rows are a
view rather than content, so there is no text in it to select and no cursor to put inside it - the
usual route of standing in a block and picking a style from the gallery is closed. That is also why
contents profiles are not in the block gallery: clicking one there would stamp it on some other block.

The picker is therefore on the map itself. Click the map, and the bubble menu offers **Style**, listing
`Default (Table of Contents)` and every other contents profile by name. Without it the only way to
style a map would be to have exactly one contents profile and hope.

## The hang: a read that wrote

The first attempt at the picker hung the editor. Clicking any dropdown - the picker's own, or the
profile list in the Home menu - froze the application.

**Every Tiptap command dispatches its transaction**, whether or not it changed anything. See
`CommandManager` in `@tiptap/core`: the single-command path calls `view.dispatch(tr)` unless the
transaction carries `preventDispatch`. `getNumberingProfiles` only reads a list, and it dispatched.

The picker read the list from a `computed`. So: read, dispatch, state changes, the computed re-runs,
read, dispatch. Measured on the unfixed build: **9176 transactions in 2.5 seconds** with the picker on
screen, and 245 from five deliberate reads. The whole application was frozen, which is why the Home
menu appeared to hang too, and why a new page with no document map in it behaved normally.

Two changes, one at the root and one for the caller:

- `getNumberingProfiles` and `getActiveReferenceCaption` set `preventDispatch`. **A command that only
  reads must say so**, and this protects every caller that exists and every one that does not yet.
- The picker and the map read `getNumberingProfileList(editor)`, a plain storage read, instead of
  going through a command at all. A computed that calls into the editor is worth avoiding even when
  the editor promises not to write.

## Tests

`toc-page-numbers.cdp.mjs`, 43 checks, its own fixture: a contents, two chapters with a subsection,
enough filler to span three sheets, and a forced page break before the second chapter. Plus
`tests/unit/toc-indent.test.mjs`, 16 checks on the indent arithmetic and the profile resolution rule
alone.

```bash
npm run test:e2e:toc
```

Every check reads the rendered contents. Entries are compared against each heading's own measured
sheet, and separately against an absolute claim that owes nothing to that measurement: the chapter
after a forced break must be listed later than the heading before it. Then page numbering is turned on
and the break is made to restart at 1 in lower roman, and the contents has to follow.

It then measures the rendered rows at four indent settings, checking that the text moves, that the
page numbers all end on the same right edge, that raising the starting level un-indents the level
below it, and that no tree line or expand icon is rendered at all.

Seen to fail on the unpatched build first: 16 of 24, with every entry reading "1", every label empty,
tree lines and icons present, and no indentation responding to anything. The absolute check earned its
place immediately - it was the one that caught the box-versus-line measurement while the derived
comparison was happily agreeing with itself.

It then hands the editor a profile list with no contents profile in it - exactly what opening an older
document does - and requires the built-in to come back under a name the user can search for, with
nothing the document did carry dropped. Then it creates a second contents profile, gives one to the
map through the command the picker calls, and checks the map's class and its rendered indentation
change; deletes that profile and checks the map falls back to the default while keeping the name.

Seen red on the unpatched build for both: with the merge reverted, the contents profile list comes
back empty; with the command removed, the map cannot be given a profile at all.

It opens the block gallery by pressing its own arrow, with the cursor in an ordinary paragraph, and
clicks the contents profile: the card must be listed, greyed, and carry the exact hint, and the
paragraph must come away unchanged. With the guard removed that paragraph's profile becomes
`profile-toc`, which is the damage stated as a measurement rather than as a worry.

Finally it counts transactions: five reads of the profile list must dispatch none, and the editor must
sit still while the picker is on screen. With the dispatch put back, those two report 245 and 9176 -
the hang, in numbers, rather than as a test that never returns.

The unit tests earned theirs too: `tocIndentDepth(1, null)` returned 2, because `Number(null)` is `0`
and a starting level of zero indents everything by one step more than asked. That is the same trap
that once made every plain page break restart the page count at zero. Absent is now tested before the
value is read as a number.
