# A Markdown Block Keeps Its Markdown

## Goal

Write a block in Markdown, see it rendered, and still have the Markdown. The source is stored in the
document file exactly as it was typed, the block renders automatically, and a panel on the block
switches between the two. Per block, independent of every other block, so one document can be written
partly in Markdown and partly in the editor.

Math is included, rendered by the KaTeX the rest of the document already uses.

The decision and its reasoning are in `AGENT/adr/0012-a-markdown-block-keeps-its-source.md`.

## What was there before

`Markdown > Render` read the text of a block, rendered it, and replaced the block with the result.
It is a one-way conversion: once it ran, the Markdown was gone from the document, from the file and
from history. That button still exists and still behaves that way; the new block is the way to write
Markdown you intend to keep.

## The rendered result is real content, not a picture of one

The obvious way to build this is an atom - one opaque box that the node view draws. It cannot be used
here, and the reason is specific to this editor.

The pagination engine measures lines by walking text nodes, then turns each line into a document
position with `view.posAtDOM`. Inside a node view that ProseMirror does not own as content, that call
returns the position of the node itself, so every line in the block maps to the same position, the
solve's `at > lastPos` test fails, and the loop stops. **When it stops, everything after the block
stops being paginated too.**

Measured, by building the block both ways and running the same test:

```
                                     as real content      as an atom
page breaks placed inside the block    7 of 7 spacers      0 of 1 spacers
lines sitting outside their column     0 of 362            45
```

The second column is text running straight through the page boundary - the original complaint that
ADR 0001 was written about, reappearing.

Being real content is also why a heading written in Markdown appears in the table of contents, is
numbered, can be cross-referenced, and is styled by the document's profiles rather than by the
browser's defaults.

## How a block becomes markdown, and what it looks like

**A markdown block carries no chrome.** At rest it is indistinguishable from the blocks around it -
no label, no toolbar, no panel. Nothing may occupy a line of the page that the writer did not write.

- **Which mode a block is in** is shown by a Markdown icon on the block's own handle, the floating
  panel that appears when the pointer is over it, beside the controls every other block already has.
- **`Change to Markdown`** and **`Change to WYSIWYG`**, in that handle menu and in Home, are the way
  in and the way out. Converting in takes the block's **text** as the source, not its HTML: a
  paragraph reading `## Judul` was markdown the writer typed by hand with no way to render it, and
  now it renders. Converting out keeps the rendered content as ordinary blocks and drops the source,
  because there is nowhere left to keep it. A block with no text - an image, a chart, a document map
  - is refused rather than quietly emptied.
- **There is no `Insert > Markdown`.** Markdown is a mode a block is in, not a thing you insert.

## The source shows because the cursor is there

Put the cursor in a markdown block and it shows its markdown. Move away and it shows the rendered
result again. There is no button for it, because the writer has already said which block they are
working in by working in it.

The swap is a **view** change and never a content change. Swapping the document's content on focus
would make every cursor movement a transaction: the document would be marked as changed with nothing
typed, and the undo stack would fill with steps the writer did not take. The content is written only
when the markdown actually changes, on leaving.

One consequence to expect: the block is a different height in each state, so the document repaginates
while its markdown is being edited and settles again when the cursor leaves.

## The source came out one narrow column

Reported from the real editor, and worth recording because the cause is not where the symptom is.

`.pdoc-node-view` is a flex container, so a child with no width shrinks to fit its content - and a
`textarea`'s content width is its `cols` attribute, which defaults to 20 characters. The source
opened as a single narrow column about 160px wide while the rendered half was 553px. That produced a
loop the writer could not escape: a click landed inside the block and opened the source, then landed
outside the narrow textarea and closed it, then landed inside the full-width render again.

Fixed by pinning the flex sizing rather than only setting `width: 100%`, which on a flex item with no
definite parent width resolves back to the intrinsic size. The document map's node view already
solved it the same way. The click that selects the block now also takes the event, so the editor does
not resolve its own selection from the same press and clear the node selection a moment after it is
set.

**The first version of the check for this passed while the bug was fully present.** It compared the
textarea's width to the block's width, and the block shrinks together with the textarea inside it -
160px against 160px, in perfect agreement and completely wrong. It compares against the width the
block had before the click now, which nothing about the bug can move. Two values that are wrong the
same way can only tell you they agree.

## Two ways to reach the source

Clicking into the block is the natural one, and it turned out not to be reliable enough on its own:
the writer reported still struggling to get the cursor in. Setting a node selection makes ProseMirror
focus its own DOM, and that can land after the source has been focused - so the block looked open and
would not take a keystroke.

**The Markdown icon on the block's handle is therefore a button.** Pressing it opens that block's
source and puts the cursor in it, without needing a click to land anywhere in particular.

It holds the source open for five seconds. **The hold is a safety net, not the mechanism**: pressing
the button also focuses the source, and the moment that succeeds the hold is cancelled and the
ordinary rule takes over - the source closes when the cursor leaves. If focus never lands, the block
returns to its rendered form by itself rather than being left open by a stray press.

Asking for the source is an **event**, not a transaction. Which half of a block is on screen belongs
to this reader's session, not to the document; written into the document it would mark the file
changed with nothing typed. `paginationChanged` is the same mechanism for the same reason.

## Markdown styling is its own group

`Home > Markdown Styles` opens it. It is **not** one of the block style profiles, and it is not in
that list. A profile answers "which profile is this one block under" and is chosen per block;
markdown is not like that, because `# Judul` is an `h1` because the writer typed a hash, not because
anyone assigned it anything.

There is a section for each kind of thing markdown produces - normal paragraph, headings 1 to 6,
bullet list, numbered list, list item, inline math, block math - and each section has its own font
family, size, weight, line height, top margin, bottom margin, alignment and first line indent. The
two list sections also have a nesting indent.

**Nesting indent puts a top level list at the text margin** and adds one step per level below it,
which is what was asked for: a markdown list should start where the paragraphs around it start, not
at the browser's own inset.

**Everything is empty by default.** Until a setting is given a value, markdown renders as markdown.

### The fields could not be typed into

Reported from the real editor, and the cause was one binding. A TDesign input given a `value` prop is
**controlled**: it renders that prop and nothing else. The prop was only updated on `change`, which
fires on blur, so every keystroke was overwritten as it was made and the field stayed empty. It looked
like the keyboard was being ignored.

The fields hold their own text now and commit when the writer leaves them. Measured both ways: with
the binding put back, typing `19pt` leaves the field empty and nothing is stored; with it fixed, the
field holds `19pt`, the setting is stored, and the paragraph inside the markdown block renders at
25px while text outside stays at 16px.

**The test that missed this was the first one.** It set the styles through a command, which verified
the mechanism and nothing about the route - the dialog was never opened. The check now opens
`Markdown Styles` from Home with a real click and types with real key presses.

### Adding a setting later

`src/utils/markdown-styles.js` holds two tables, and the generator, the defaults and the settings
dialog are all built from them. There is no third place to keep in step.

- A new setting - letter spacing, say - is **one row** in the fields table, naming the CSS property.
  It appears in the dialog for every section and is written wherever it is set.
- A new section - blockquote, code block, table - is **one row** in the targets table, naming the
  selector it matches inside a markdown block.

A field marked as block-only is not offered for inline sections, so an inline formula is never given
a top margin that the browser would ignore. A control that does nothing is worse than one that is
absent.

### Measured on the rendered result

```
h1 53px against h2 27px                      each heading level has its own setting
paragraph 15px, margin-top 44px, justify,    a paragraph is not styled by a heading rule
  first line indent 29px
inline math 40px                             its own section
block math margin-top 56px                   its own section
list 0px, nested list 70px                   level zero at the margin, one step per level
heading outside the block 19px, unmoved      nothing leaks out of a markdown block
```

The last line is the one that owes nothing to the others. Everything else measures inside a markdown
block, where a wrong selector and a wrong measurement could agree with each other.

### What the file holds

`markdownStyles` travels with the document. `createDocumentSnapshot` and `validateDocumentSnapshot`
are whitelists, so it had to be named in both - a field that is not named there is dropped on the way
out **and** on the way in, which is exactly how page number settings were lost once before. A section
this version does not recognise is carried through untouched, so a document written by a later
version does not lose settings by being opened here.

## A markdown heading is not labelled

`# Judul` renders as "Judul", never as "BAB II Judul", because a label the writer did not type is
what this product exists to avoid. It is still a heading, so the contents lists it in its place, but
it carries no label and consumes no number: two ordinary chapters with a markdown heading between
them stay `BAB I` and `BAB II`.

Content inside a markdown block takes no part in the per-block profile system at all -
`collectTargetDescriptors` stops at a markdown block and does not descend. **That is what gives
`numberingProfileId` a single owner.** An earlier design gave each markdown block its own profile and
corrected its children afterwards; the correction and the document's own profile sync overwrote each
other forever and hung the editor.

## One editing surface## One editing surface## One editing surface

The source is the truth and the rendered half is derived from it. The rendered half is therefore not
typeable: the block is changed by pressing `Source`, editing the Markdown, and pressing `Rendered`.

This is deliberate and it has a cost - making one word bold means typing asterisks rather than
selecting the word and pressing a button. The alternative is two ways to change one block, which is
how a stored value and its rendering drift apart with nothing to notice. This project has paid for
that twice: the on-screen engine against the PDF, and the numbering decoration against the CSS
counters.

## What the file holds

```html
<div data-markdown-block class="pdoc-markdown-block">
  <pre data-markdown-source hidden>
# Metodologi
The equation is $E = mc^2$
  </pre>
  <div data-markdown-rendered>
    <h1>Metodologi</h1>
    <p>The equation is <span data-type="inline-math" data-latex="E = mc^2"></span></p>
  </div>
</div>
```

The source is a `pre` rather than an attribute, so it keeps real newlines and can be read and edited
by hand. `format-html.js` already treats `pre` as verbatim, so the formatter copies every character
out byte for byte and cannot reflow the Markdown into something else. The rendered half is ordinary
HTML, so opening `document.html` straight in a browser still shows the document.

**Editing the rendered half by hand has no effect**: the source wins, and the next load rebuilds the
rendering from it. To change such a block in the file, edit the Markdown in the `pre`.

## Math

`$...$` becomes `<span data-type="inline-math">` and `$$...$$` becomes `<div data-type="block-math">`,
which is the markup `@tiptap/extension-mathematics` parses. The formula is therefore a real math node
drawn by KaTeX, identical to one typed anywhere else in the document. There is one math renderer, not
two.

Two rules the renderer follows, both because the alternative is worse:

- `It costs $ 20 and then $ 30 more` is not a formula. A delimiter counts only when it hugs its
  content.
- `$$` with no closing `$$` stays as typed rather than swallowing the rest of the document.

## The comparison that had to ignore most of the block

The rebuild-on-load only rewrites a block whose rendering no longer matches its source, because
rewriting one that already matches marks the document as changed the moment it is opened, and the
unload guard then claims unsaved work that does not exist.

Comparing the two renderings directly does not work. A freshly inserted `# Judul` came back carrying
fourteen attributes where the Markdown had set one - `id` and `data-toc-id` from UniqueID,
`referenceId`, `referenceNumber` and `referenceLabel` from document references, and the whole
numbering group from the profile sync. All of them are written after insertion, by other extensions.

So the comparison is on what Markdown itself can express: node structure, marks, text, and a short
list of attributes such as heading level and formula. **Had this been missed, opening a document
would have rebuilt every Markdown block and stripped the reference ids and numbering of everything
inside them.** The E2E test caught it.

## Test script

`markdown-block.cdp.mjs`, 71 checks, own fixture throughout - it never opens a stored document. Seven
cases: the source is kept and the render is real content; math becomes real math nodes and KaTeX
draws them; the source survives a serialise and parse round trip byte for byte; a block taller than a
page is paged through and the document after it survives; a hand-edited file has its rendering
rebuilt from its source, and a file that agrees with itself is not rewritten; the block carries zero panel elements and shows
its source only while it holds the cursor, measured on what is actually visible; and the conversion routes, driven by **real
mouse input** - the pointer moved over a block to raise its handle, the handle clicked, and
`Convert to Markdown` clicked in the menu that opens. That last case is the one that starts where the
writer starts rather than at a command.

Case D was **run against the rejected design** - the block rebuilt as an atom - and went red exactly
where it should, which is the table above. Worth knowing: the check that was meant to be the
independent claim, that the paragraph after the block lands on a later sheet, stayed green in both
directions. The two checks that caught it were the direct ones.

```bash
npm run test:e2e:markdown-block
```

Plus `markdown.test.mjs`, 9 unit checks on the renderer, and `markdown-styles.test.mjs`, 11 on the style tables and their generator. The three math assertions were seen red
against the renderer as it was before this work.

```bash
npm run test:unit:markdown
```
