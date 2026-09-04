# A Block Can Be Moved Between Two Profiles Of The Same Kind

## Goal

Clicking a profile card in the block gallery restyles the block, including when the block is already
under another profile of the same kind - one paragraph profile to another.

## What was reported

Two things, together: a custom paragraph profile `Normal-noindent` looked greyed out on an ordinary
block, and clicking between it and `Normal` changed nothing in either direction.

Neither was in the command. Measured on the user's own profiles, the assignment was correct every
time: the attribute changed, the class changed, and the plan kept the block's choice.

## The click handler threw, and stopped before it applied anything

The one that made the second block impossible. `selectHeadingProfile` called `setParagraph()` on a
block that was already a paragraph. That is not free: it runs `clearNodes` over the selection, and at
the end of a document that reaches the footnotes node and raises
`Invalid content for node type footnotes`. The exception left the click handler **before the line
that applies the profile**.

That is why a second block failed while the first usually worked - a short document does not reach the
trailing node. Measured on the click: three transactions, all with zero steps, and one uncaught
RangeError.

The block type is only changed when it is actually different now, and applying the profile sits
outside the `try`, so a failure in a preparatory step cannot swallow the thing the writer asked for.

**Still open**: `setParagraph` throwing at the end of a document is a fault of its own, and any
control that converts a block type can hit it.

## The indent that was never emitted

`Normal` stored its first line indent as the string `2em`. The generator read that field as a **level
number**, and `Number('2em')` is `NaN`, so the condition failed and **no `text-indent` rule was
written at all.** `Normal` therefore had no indent on screen, and moving a block to and from it
looked exactly like nothing happening.

Fixed by teaching the generator both forms: a bare number is a level and means that many 2em steps;
anything else is a length used as it stands. `0` still means no indent either way.

**The direction that discriminates is the second one.** With `Normal` emitting no rule, moving a
block *to* the no-indent profile still measured 0px and looked like a success. Only moving *back* -
and finding the indent still absent - shows the fault. A test that checks one direction would have
passed on a broken build.

## Numbering off is not the same as unusable

A profile with numbering turned off carried a `disabled` class that dimmed the whole card to 0.7
opacity, next to numbered profiles at 1. Body text is the ordinary case for numbering off, so the
user's own paragraph profiles both looked unavailable, and the reasonable response to a greyed
control is to stop trying to click it.

The fact has to survive - the subtitle still reads `(OFF)` - but the appearance of being unavailable
does not. Only `Page Number` and `Table of Contents`, which genuinely cannot be applied to a block,
stay dimmed.

## A paragraph profile has no heading level

`addNumberingProfile` wrote `level: profile.level || 1` for every profile, so a paragraph profile was
stored carrying `level: 1` - the user's `Normal-noindent` has it. It only has a level when it is a
heading now. Existing profiles keep the stray field harmlessly; nothing reads it for a paragraph.

## Every profile is in the bar, and the bar scrolls

The bar showed four cards. Everything else was behind the dropdown, so a profile the writer uses
constantly could sit where they could not see it. It holds every profile now, in a strip that scrolls
sideways.

**Plain CSS overflow, and no script drives it**, so wherever the strip is left scrolled is where it
stays - measured across a document change. The dropdown button was the width of its own 12px icon
beside 68px cards; it is 32px now, and the strip stops before it rather than running underneath.
Padding was not enough for that: it only pads the end of the content, so mid-scroll a card still
passed beneath the button and a sliver showed past its edge.

**Which gestures move it, measured rather than assumed**: shift with the wheel works, a sideways
wheel or trackpad gesture works, and there is a real scrollbar to drag. **A plain vertical wheel does
not** - Chrome does not map it onto a container that only overflows horizontally, which is what I had
expected before measuring.

## What a block is, and applying a profile to all of them

A profile applies to a **block**, and a block is a node of one of four types - paragraph, heading,
image, table - wherever it sits in the document. It is not "a direct child of the document". A
paragraph inside a table cell is a paragraph like any other, which is why a profile lands on it and
why the saved file carries the class on the `p` rather than on the cell. A cell is not a block; the
paragraph inside it is.

**A profile now applies to every block the selection covers.** Before, only the one block enclosing
the cursor was touched, so selecting three paragraphs styled one and selecting a whole table styled a
single cell.

The selection is read as **ranges** rather than as a start and an end, because a table cell selection
is several disjoint ranges, one per cell; reading only the outer bounds would sweep everything between
them as well. What gets styled is filtered by what the profile can sit on, so dragging across a table
and choosing a paragraph profile does not also stamp it on the table node, which is styled by a
profile of its own. With a plain cursor and nothing selected, nothing changes: the one block the
cursor is in.

## Test script

`profile-switch.cdp.mjs`, 32 checks in five cases. Its fixture is built from the user's real profile
shapes - a length string on one profile and the stray `level` on the other - because those shapes are
what the faults needed. Cards are clicked with real mouse input, and the third case is the reported
sequence itself: an empty document, type, click, Enter, type, click, watching for anything thrown out
of the handler.

All three faults were put back and measured: the indent read 0px in both directions, the card measured
0.7 opacity against 1, and the second block stayed at 32px with the RangeError.

**A first control proved nothing and looked like it had.** It restored the needless `setParagraph`
but kept the `try`, and the case passed - catching the exception was enough on its own. Reverting part
of a fix is not a control.

```bash
npm run test:e2e:profile-switch
```
