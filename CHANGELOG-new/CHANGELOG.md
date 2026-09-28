### The Layout Switch Says Page View And Web View Again

- `Reported By The User`: the status bar showed the raw key `layout.page` beside the character count, and the console warned that `layout.page` and `layout.web` were missing from the English messages.
- `Where They Went`: `ad026f6`, which added the layout timing to the status bar, wrote its two strings into the `layout` group of `en-US.json` by replacing the group instead of adding to it. `web` and `page` were deleted with no one noticing, because the Chinese messages still carried them.
- `Restored As Page View And Web View`, the English they had before and the meaning of the Chinese `页面视图` and `Web 视图`. The same words label the status bar switch and the two buttons under View.
- `Version 12.2.3`: the writer's own bump rides along.
- `Test script`: no test. Checked once in a tab of its own: the status bar reads `Page View`, and the console carries no warning for either key.

### The Status Bar Button Shows The Version

- `Asked For By The User`: the version, the same one `package.json` carries, beside (c) PracticalDocs in the same button.
- `One Source`: the button reads `version` from `src/utils/copyright.js`, which takes it from `package.json` - the same value the build banner and the console greeting already use. Bumping the package is the only step; nothing else has to be kept in step with it.
- `Version 12.2.1`: the writer's own bump rides along in this commit, as `12.1.0` did in `ab3d834`.
- `Test script`: no test. Checked once in a tab of its own: the button reads `PracticalDocs 12.2.1` on one line, 18px high. Screenshot `tests/screenshots/statusbar-version.png`.

### Pages Are Laid Out From One Measurement, In Steps, Two Seconds After You Stop

- `Asked For By The User`: could laying out the page run in the background. Two ways were offered - (A) cut the solve into slices, or (B) place every break from **one** measurement instead of measuring again after each break. The writer chose B, then asked for A on top of it.
- `B: Predict Every Break, Then Check`: the natural layout is measured once; every break is decided on a model of the lines, the lines below each break shifted by the height of its spacer arithmetically, as `adr/0026` suggested; the whole batch is applied; one more measurement compares every line with where it was predicted. From the first line that disagrees, the steps are rolled back and the old one-break-at-a-time loop takes over. The decision is `adr/0032`.
- `The Same Breaks, Far Fewer Layouts`: on a copy of a 53 sheet thesis, 51 breaks took **52 layouts and 2633 ms** before and take **2 layouts and 85 ms** now, and the two engines place identical breaks. The status bar read `Layout 136 ms` for opening the whole document.
- `A: The Solve Stops Between Batches`: a solve now pauses only right after a batch is applied, where the page is whole. A change made during a pause abandons that solve and the change's own solve replaces it; two solves never overlap. Measured on the writer's thesis, the solve holds the main thread for 56 to 110 ms at a time.
- `Reported By The User`: pages 55 to 57 of `tesis8ag` were wrong on screen and every page after them was off, while the PDF was right. **Not caused by B**: the old engine failed the same way on the same copy. A line with inline code in it was two lines to the engine, because the code's glyph box sits 1px above the text around it and fragments were grouped by their top. The engine placed a break in the middle of that line, the other half was left crossing the foot of the sheet, and the solver gave up. Fragments are grouped by **vertical overlap** now, at least half of the shorter one. The thesis settles at 80 sheets with no cut line.
- `One Range, Not One Per Text Node`: a CPU profile showed **5.2 s in `removeChild`**. Measuring created a new `Range` for every text node and every step of a binary search, and the browser updates every live range on every change to the page, so each solve made the next one slower. One shared range now, in `src/utils/measuring-range.js`, used by the engine and by the list item node view.
- `The Whole Open`: `Layout 1465 ms` on the thesis, where the old engine took 12858 ms and got it wrong.
- `A Break Inside A Table Ends The Batch`: a spacer in one cell does not move the cells beside it, so a prediction across it was measured 36px off.
- `The Wait Is Two Seconds`, as the writer asked: `RECOMPUTE_DELAY` is a fixed 2000ms, and "wait as long as the last solve took" is gone. This replaces decision 1 of `adr/0028`.
- `What The Engine Keeps`: `storage.solve` records `layouts`, `rollbacks`, `at` (the break positions) and `unanchored` (the last things the solver could not place), so the next fault can be read rather than guessed.
- `Test script`: no new test. The existing parity tests all pass on this engine - `pagination-pdf-parity`, `block-pagination` 11/11, `page-sections`, `page-sections-export`, `page-break`, `page-number-section`, `page-numbers-export`, `math-block-pagination`, `math-export-parity`, `toc-multipage-export`, `sections-same-paper-export`, `columns-never-split-export`, `markdown-math-align`, `markdown-code`, `list-marker-font` - and unit 208/208. Not checked: the PDF page count of `tesis8ag` against its 80 sheets.

  ```bash
  npm run test:e2e:pagination-pdf
  npm run test:e2e:block-pagination
  npm run test:e2e:columns-never-split-export
  ```

### A Paragraph's First Line Indent Stops At The Edge Of A List

- `Reported By The User`: setting First Line Indent to 2em on Normal Paragraph indented every bullet and numbered item too, and setting the list's own indent to 0 did nothing about it.
- `Markdown Renders A Spaced List As A Paragraph Inside An Item`, so the Normal Paragraph rule lands on the text of every list item as well. That is wanted for the font and the size - the marker beside the text already follows the same rule, deliberately - and wrong for the indent: a thesis body indents its first line, a bullet must not.
- `Why Setting The List To 0 Did Nothing`: it wrote `ul { text-indent: 0 }`, and the paragraph inside the item is what carries the text, so `p { text-indent: 2em }` won. The indent of a list's text is stated on that inner paragraph now, where it can win.
- `Where It Comes From`: List Item if that is set, then the kind of list, then **none**. Never from Normal Paragraph - a writer who has said nothing about lists has not asked for their bullets to be indented.
- `A Descendant Selector, Not A Child One`: in the editor a list item is a node view, so its text sits in `li > span + div > p` rather than directly in the `li`; the saved file renders the plain `li > p`. Measured on both - `li > p` styled the file and missed the screen entirely.
- `And Only When There Is Something To Say`: a document that sets no indent anywhere still gets no rule at all. The first attempt emitted one always, and the unit test that guards *nothing set means no rules* caught it - markdown renders as markdown until the writer asks otherwise.
- `Test script`: five unit tests on the rules themselves, and `markdown-styles-persist.cdp.mjs` grew a case that sets the indent through the dialog with the mouse and measures both paragraphs. Seen failing with the rule removed, the bullet reading 28px where it should read 0.

  ```bash
  node --test tests/unit/markdown-styles.test.mjs
  npm run test:e2e:markdown-styles
  ```

### Markdown Styling Is Kept When The Document Is Saved, And Applied When It Is Opened

- `Reported By The User`: the Markdown Styles dialog was useless - what it set was neither saved with the file nor loaded back.
- `Four Places, None Of Them Talking To The Next`: the editor's snapshot carried the settings, and after that nothing did. The save never sent them; the storage server's `settings.json` held page settings, profiles and assets and had no field for them; the read never returned them; and the Open dialog never put them in the snapshot it built.
- `And A Fifth, Which Is The One Worth Knowing`: on opening, the styling was applied **inside the branch that only runs when the document carries a non-empty profile list**. A document styled through the Markdown Styles dialog and nothing else therefore opened with none of it, even once the other four were fixed. Markdown styling is its own group beside the profiles, as the code says in three places; it is applied on its own terms now.
- `The Dialog Itself Was Never Broken`: its fields commit on Enter or on losing focus. A value typed and left sitting in the box is not a setting yet, which is easy to mistake for the fault being reported.
- `Test script`: `markdown-styles-persist.cdp.mjs`, 8 checks. The dialog is driven with the mouse; the document is written to the storage server under a name of the test's own and deleted at the end, because pressing Save writes under the document's own name and a test must not write over the writer's work.
- `The Test Had To Reload The Page`, not merely empty it: clearing the content leaves this session's styling in place, so the document opened looking right for a reason that had nothing to do with what was saved - run against the unfixed editor, that check passed while the store held nothing at all. Reloading raises the browser's own leave-site dialog, which blocks every command sent over the wire until it is answered; the run did not fail, it stopped.

  ```bash
  npm run test:e2e:markdown-styles
  ```

### The Status Bar Says How Long The Page Took To Lay Out, And The Engine Stops Working While You Type

- `Asked For By The User`: they knew the pagination engine was heavy and wanted to know **how** heavy, in the bar at the foot of the window - with the condition that if the slow part was not `solve`, the measurement should go wherever the slow part actually was.
- `It Is Solve`: **1764 ms** on a 44 sheet thesis, measured directly. A sampling profile does not show it, because most of that time is the browser laying out the page rather than any JavaScript frame - it comes back spread across `(program)` and `(idle)`, which is how this went unnamed for so long.
- `Then The Measurement Found Something Worse`: typing five characters with 400ms between them cost **nine solves and 18.7 seconds** of blocked main thread, each solve slower than the last - 878, 795, 818, 1201, 1728, 2037, 1637, 2183, 2899. The debounce was 200ms, and a pause between two keystrokes is longer than that, so every keystroke bought its own solve; the confirming solve from `adr/0027` then doubled it. It is also why the toolbar felt slow - a menu cannot open while the thread is inside a solve.
- `The Engine Waits As Long As Its Last Solve Took` now, never less than the old 200ms and never more than two seconds. On a document where a solve is 30ms nothing changes. On the thesis: the same five characters cost **two solves and 1.6 seconds**, and **not one solve while the typing was going on**.
- `When It Says It, And Why That Is The Whole Trick`: a solve holds the main thread for its whole length, so a message raised when one starts cannot be painted until it has finished. Raised when the solve is **scheduled**, it appears on every keystroke and reads as a promise the engine has not kept - which is exactly what the writer reported. It is raised one painted frame before the work: announce, let the browser draw it, then take the thread.
- `A Hidden Tab Still Lays Out`: reaching for that frame with `requestAnimationFrame` alone stopped the engine dead in a tab nobody was looking at - measured, five characters typed and **no solve at all** twenty-five seconds later. A timer is used when the page is not visible.
- `The Number Is Work, Not Waiting`: the solves added together, not the wall clock from first schedule to settled. Counting the deliberate wait reported the thesis as 5888 ms where the work was 1601 ms, which would have made the fix look like a regression.
- `Test script`: `layout-timing.cdp.mjs`, 6 checks, real keystrokes, asserting the working state is actually seen and not only its result.

  ```bash
  npm run test:e2e:layout-timing
  ```

### Columns Are The Width Of The Page They Sit On

- `Reported By The User`, with the steps to see it: a portrait page, a page break, a landscape page, another break, a portrait page again - then insert columns on that last page. They came out as wide as the **landscape** page, running off the paper they were on.
- `A Mixed Document Is Drawn On One Canvas`, as wide as the widest sheet it holds, and the engine brings a block on a narrower page in with a margin of its own. A margin does not shrink a width of `100%`, which is read from the canvas - and the column container states `width: calc(100% + 16px)`, so it took the landscape width wherever it was put.
- `The Table Rule Already Knew This`: it takes `--pdoc-section-left` and `--pdoc-section-right` off its own width for exactly this reason, and has a comment saying so. The columns were never taught the same thing. They are now.
- `Measured`: on a page whose text column is 553px, in a document holding a landscape page 882px wide, the columns came out **898px**. They are **569px** now - the text column plus the 16px of their own padding, which is deliberately pulled back out so their text lines up with the text above them.
- `Test script`: `column-divider.cdp.mjs` grew Case D, 4 checks, 11 in the file. It builds the writer's own three sections and inserts the columns from the real menu with the cursor placed on the third page by clicking there. Seen failing on two with the fix removed, reading `columns 898px against a portrait text column of 553px`.

  ```bash
  npm run test:e2e:column-divider
  ```

### Columns Sit Edge To Edge, And The Divider Is Still Easy To Catch

- `Reported By The User`: dragging the divider between columns met an invisible margin. They asked for the margin to be nothing while the area the pointer may grab stayed as wide as it was.
- `It Was A 12px Gap` on the column container - empty band nobody had written and nobody could reach, which is this product's first principle broken in the plainest way. The space between the texts is the columns' own padding now, which sits inside a column and therefore belongs to it.
- `The Grabbing Area Never Came From The Gap`: it is a band measured around the column's edge in `findBoundaryPosition`. It was **asymmetric** - four pixels on the left of the edge and twelve on the right, reaching into the gap - so the divider could be missed from the left. Measured with the old code, a pointer 5px to the **left** of the edge caught nothing while 5px to the right caught it. It is the same width as before and centred on the edge now, so it catches from either side.
- `The Constant That Looked Wrong Was Right`: the stored width subtracts a constant that turns out to be the gap doubled. Replacing it with the padding measured from the box made **pressing** the divider jump further - 279 to 306 before, 285 to 327 after - so it was put back. How far a drag actually moves the edge varies from one attempt to the next, because of the next point, so no figure is claimed for it.
- `What Is Still True And Is Not About The Gap`: every column keeps `flex-grow: 1`, so a width written on one of them is a starting size the row shares out again. Pressing the divider still shifts the edge by some tens of pixels before any dragging. That behaviour predates this change and is left alone; the test says so in its own words rather than leaving the next reader to discover it.
- `Test script`: `column-divider.cdp.mjs`, 7 checks. The columns are inserted from the real menu and the divider is dragged with the mouse. Run against the old code it fails on four, including the gap and the left-hand edge of the grabbing band.

  ```bash
  npm run test:e2e:column-divider
  ```

### A Cell Draws The Sides The Writer Chose

- `Asked For By The User`: control over a table cell's borders. Every table came out as the same full grid, and a thesis rarely wants one - the house rule is a line above and below and nothing else, and an equation written as a table wants no lines at all, with the number in a cell of its own.
- `What Was There`: a Border Color entry that set `borderColor`, an attribute the cell schema never declared. It did nothing, and it had been commented out of both toolbars. It is replaced rather than repaired.
- `Each Side Is Its Own Attribute` - `borderTop`, `borderRight`, `borderBottom`, `borderLeft` - holding a CSS value rather than a flag, because a flag cannot say what the line looks like and a writer will want a thick rule above a total and a hairline between rows. `null` leaves the side to the stylesheet, so an untouched table is exactly as it was.
- `Written As An Inline Style, Which Is What Carries It`: the saved file and the exported PDF both take the cell's own markup, so nothing else in the editor had to be taught about borders.
- `Reading Them Back Is The Part That Bites`: the browser rewrites what it is given. Four sides all set to `none` come back out of a cell as `border-width: medium; border-style: none; border-color: currentcolor` - the shorthand, with not one longhand left to match - and asking the CSSOM for `borderTop` returns **empty**, because it cannot serialise that side in one piece. The three longhands per side are read instead. Before that, a borderless table drew its full grid again the moment it was reopened; the test caught it, the eye would not have, because it looked right until it was saved.
- `In The Toolbar`: Table > Cell Borders - All Borders, No Borders, Top and Bottom Only, and each side toggled on its own. It applies to every selected cell, so dragging across the table and choosing No Borders clears the whole thing.
- `Test script`: `cell-borders.cdp.mjs`, 8 checks. The cells are selected by dragging the mouse across them and the borders chosen from the real menu, as a writer does; only the fixture is set up in code. Seen failing on three with the attributes removed.

  ```bash
  npm run test:e2e:cell-borders
  ```

### The Engine Confirms Its Answer

- `Reported By The User`: opening their thesis paginated it wrongly from the early pages, and nudging the zoom up one step and back set it right. They had the remedy long before anyone had the cause.
- `A Solve Measures The Document As It Stands`: opening one changes four things that each move every line - the profiles and their stylesheet, the content, the numbering, the page geometry - and they land a tick apart. The driver debounces at 200ms and settles on whichever it happens to measure. Afterwards **nothing schedules another solve**: the document is no longer changing, so the first answer stands however wrong it is. The zoom nudge worked because changing the zoom asks for a solve.
- `Measured in a private window`, on 44 sheets, counting lines that cross the foot of a drawn sheet or sit in the gap between two: **47** as opened, **0** after one more solve that changed nothing else. A third solve agreed with the second.
- `Why It Took A Private Window`: a warm browser has the fonts, profiles and pictures cached, so they arrive before the first solve and it settles right. Three sessions of trying to reproduce this in an ordinary tab came back correct every time. A fresh session puts the arrivals in their worst order.
- `The Fix`: a solve compares its breaks with the previous solve's, and schedules another if they differ. Two that agree end it - one extra solve after a change, none while the document is quiet.
- `Three Fixes Built On The Same Reasoning Measured Nothing And Were Reverted`: re-solving when a web font loads, re-solving when the profile stylesheet is written, and one more solve at the end of opening a document. The last is the instructive one - asking at the end of opening is too early, it coalesces with the solve already scheduled, so it is the same wrong solve rather than a second one. See `adr/0027`.
- `Test script`: the suite is the guard, and the fault itself was measured through the interface with mouse events only - no `setContent`, no commands, the zoom pressed by its own button.

  ```bash
  npm run test:e2e:pagination
  npm run test:e2e:pagination-pdf
  ```

### A Picture Arriving Re-Paginates The Page It Landed On

- `Reported By The User`: opening their thesis paginated wrongly from the early pages, and nudging the zoom up one step and back set it right. They had found the remedy long before the cause.
- `The Remedy Is The Clue`: a zoom change re-solves. So the pagination was not wrong - it was **stale**. Something had changed the height of the page after the last solve, and nothing told the engine.
- `That Something Is The Pictures`: the engine re-solves when the document changes or when it is asked, and an image arriving is neither. `onLoad` set the image's own height and stopped there, so every line below it moved while the sheets kept the geometry of a page whose picture had no height yet.
- `Measured Through The Interface`, on a thesis of 44 sheets opened through the Open dialog with all fourteen pictures loading a moment after the last solve: **47 lines of text crossing the foot of a sheet or sitting in the gap between two**. After the fix, on the same document by the same steps: **0**, and pressing the zoom up and back changes nothing, because there is nothing left to correct.
- `The Fix`: the picture asks for a solve once it has taken its real height, the way the table of contents already does. The driver debounces at 200ms, so fourteen pictures arriving together cost one solve.
- `Test script`: the existing suite is the guard - this changes when the engine is asked, not what it answers. `page-sections`, `page-sections-export`, `pagination-pdf-parity`, `pdf-bookmarks`, `sheet-drift`, `document-assets`, `block-pagination`, `page-break`, `toc`, and `toc-boundaries` three times, all green.

  ```bash
  npm run test:e2e:pagination-pdf
  npm run test:e2e:document-assets
  ```

### The Sheets Are Drawn Where The Engine Solved Them

- `Reported By The User`: in a long document the pagination drifts further out of step the further down you read, and they had predicted this would happen.
- `Measured On Their Thesis`, 44 sheets: the drawn sheets lagged the geometry the engine had solved by **3px at sheet 6, 11px at sheet 24 and 21px by the last one**. Nothing was wrong with the solve - the sheets were simply painted somewhere else.
- `The Cause Is One Divisor`: every length the engine writes - a spacer's height, a sheet's box, a page number's place - is divided by the canvas scale on the way out, and that scale came from dividing a fractional rect width by `offsetWidth`, which is **rounded to a whole pixel**. On a canvas measuring 793.695px the divisor was 794, so the scale came out **0.9996** while the page's own transform was plainly `matrix(1, 0, 0, 1, 0, 0)`. Every length was 0.04 per cent short, and that error is not paid once - it accumulates down the document.
- `The Fix`: take the unscaled width from the computed style, which keeps its fraction and is unaffected by transforms. Measured again on the same 44 sheets, the drift is **0px on every one of them**.
- `Why It Looked Like Rounding And Was Not`: the sheet boxes are each rounded to whole pixels when written, which would wander by half a pixel and stay there. A wrong scale tilts every length in the same direction instead, which is what turns a rounding-sized error into a visible one by the end of a thesis.
- `Test script`: `sheet-drift.cdp.mjs`, 5 checks, its own synthetic document of 260 paragraphs. Seen failing on two with the fix removed - 7px of drift across 16 sheets, where the fixed engine reports 0.

  ```bash
  npm run test:e2e:sheet-drift
  ```

### Reverted: The Pagination Solver Measures The Whole Document Again

- `Reported By The User`: after the solver was taught to skip measuring blocks above the last break, loading their thesis paginated many pages wrongly from early on, and raising the zoom and putting it back to 100 per cent set it right again. They placed it on that change.
- `It Is Reverted`, and the reason is what could **not** be shown rather than what could: the fault did not reproduce here in any of the three load paths tried - a plain `setContent`, the same with the images really fetched from the storage server, and the document opened the way the Open dialog opens it, with its profiles and page settings. Across 44 pages every line sat inside its column, and the measurements before and after a zoom round trip were identical. With no reproduction there is nothing to defend the change with, and a correctness report from a real document outweighs a speedup measured on a synthetic one.
- `What Was Given Up`: about 25-30 per cent on a 48 sheet document, and nothing at all at 24 or 71 sheets. The profile says the dominant cost was never the measuring - it is the forced relayout after each break is dispatched, so a document of 71 sheets is laid out 70 times. That is the thing worth fixing, and `adr/0026` records it along with the coordinate boundary that measured slower than no skip at all.

### The Engine Leaves The Contents' Own Rows Alone

- `Reported By The User`: in their thesis, a gap opened between the DAFTAR ISI heading and the contents under it, and the exported PDF was empty after that heading until the page turned.
- `The Contents Is An Atom`: it holds text with line boxes the solver can measure, but no document position inside it. Measured directly on a contents of 31 rows: the line the solver chose was row 10, **497px** down the canvas, and the position it resolved to was the `toc` node, which begins at **239**.
- `So The Spacer Lands Before The Whole Block` carrying a height worked out for a line far inside it. The block does not reach the next column - it stops part way down this one. The contents then finds a row of its own straddling the foot of the column and pushes it, which makes the block taller, which overflows again. Caught on the user's document twice: a **295px** spacer between the heading and the contents with a **302px** gap inside it, and **580/281** at 200 per cent zoom. Both settled - the solve reported `settled` while the page read as empty.
- `Refusing The Break Is Not The Fix, And The Measurement Says So`: the solver then steps over the block, and `{"stopped":"no-anchor-below-the-last-break","breaks":0,"skipped":1}` is the whole document left unpaginated - the fault `adr/0022` was written about, met again. So these lines are not offered as break candidates at all. A block declares itself with `data-pdoc-self-paginating`, and the engine paginates around the height it settles on. That is the contract `adr/0022` promised, enforced on both sides for the first time.
- `What Is Not Claimed`: the bad state is **intermittent**. Six runs of the same document with the old code - three at each zoom - all came out correct, and a synthetic fixture of the same shape never showed it. What is certain is the mechanism, measured directly, and that a break anchored before a block with a height computed for a line inside it is wrong however rarely it fires. A test written to reproduce the symptom passed with the fix removed, so it was deleted rather than committed: a test that cannot fail is worse than none.
- `One Consequence`: lines below the contents now land exactly on column tops, and `toc-boundaries` read that as a fault - its band check takes an offset modulo the stride, and an exact hit comes back a third of a pixel short of a full stride rather than zero, flagging nine correctly placed lines. It treats a sub-pixel shortfall as zero now.
- `Test script`: the existing suite is the guard. `toc-boundaries` **three times**, as its own note asks, plus `page-sections`, `page-sections-export`, `pagination-pdf-parity`, `pdf-bookmarks`, `toc` and `block-pagination`.

  ```bash
  npm run test:e2e:toc-boundaries
  npm run test:e2e:pagination-pdf
  ```

### The Profile Strip Can Be Scrolled, And The Profile Popup Is A Grid

- `Reported By The User`: the strip of profiles in the toolbar had no usable sideways scrollbar, and the popup listed the profiles one per row - a column of fifteen, taller than the window.
- `The Bar Was Drawn And Then Clipped Away`: measured, the strip stood **66px** tall - 54 of content and a 12px scrollbar - inside a wrapper locked to **56px** with `overflow: hidden`. Every control in the ribbon row is 56px and the row clips vertically, so the wrapper cannot grow: the bar had to be made to fit.
- `What Made It 12px`: `scrollbar-width: thin`. Chrome ignores the `::-webkit-scrollbar` rules on any element that sets the standard property, so the 6px the file asked for was never applied. Without it the bar stands 8px, and the budget works out exactly - 4 of padding, 42 of card, 2 of margin, 8 of bar, 56 in total. The card's vertical margin went from 4px to 1px, which is what pays for it; the 2px at the sides is untouched, so the cards keep their pitch.
- `The Track Is No Longer Transparent`: a thumb on an invisible track says nothing about how far the strip runs, and the writer has to find the bar before they can drag it.
- `The Popup List Had No Styling At All`: the rule for `.block-cards-list` is nested under `.block-profiles-section`, which is not its parent in the template, so the list was a plain block and every card took a row of its own. It is a flex grid now, four across, stated as the width of exactly four cards rather than left to the popup - a popup that sizes itself to its content would re-wrap to a different count the moment a profile with a longer name is added.
- `Test script`: `profile-strip-layout.cdp.mjs`, 8 checks, asserting on the toolbar in an editor left as it opens. Seen failing on three with both fixes removed, including the row count reading `[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]`.

  ```bash
  npm run test:e2e:profile-strip-layout
  ```

### A Document File Opens Because It Carries A Document, Not Because Of Its Stamp

- `What Changed`: opening a file no longer checks the format name or the version number. Any JSON that carries document content opens, whatever it is labelled with - or whether it is labelled at all.
- `Why`: the core storage is the storage server now, so a file arriving on this path was as likely written by a script or another tool as by the Save button. Two stamps stood between the writer and a document whose text they could plainly see. Files written before the rename carried `umodoc`, which needed a second constant to keep readable, and that was only the case anyone had thought of.
- `What Still Refuses`: `content`. It is what tells a document from any other JSON, so a file with none is refused rather than opened blank - which would lose the writer's work behind a file that merely parsed. It says `This file has no document content.` now, instead of naming a field the writer never wrote.
- `The Other Stamps Are Defaulted, Not Demanded`: `editorVersion`, `savedAt` and the title fall back when missing. What is written out is unchanged - this editor still stamps its own name and version.
- `Test script`: `document-file.test.mjs` covers the loosening directly - a file stamped `umodoc`, one stamped `other`, one with no stamp at all, and a version from the future all open with their content intact, and `{"hello":"world"}` and `[]` are still refused. `document-references.cdp.mjs` no longer asserts the stamp on a round trip, only that the document comes back unchanged, which is what a round trip is about.

  ```bash
  node --test tests/unit/document-file.test.mjs
  npm run test:e2e:document-references
  ```

### A Cross-Reference Wears The Styling The Writer Gives It

- `Reported By The User`: a reference inserted into a sentence was always link blue and underlined, and applying a colour to it did nothing.
- `The Mark Was Never The Problem`: it reached the node and was carried on it. Probed on a live document, a reference carried `textStyle{color:#c00000}` and `bold`, and the page painted `font-weight: 700` - the weight came through - and `rgb(52, 128, 249)`, the primary colour, for the colour that did not. A mark renders as a span wrapping the anchor, and `.pdoc-cross-reference` painted the colour on the anchor itself, so it beat what the span passed down. Half of a writer's styling silently worked, which is why it read as arbitrary.
- `Print Copies Every Stylesheet On The Page`, so this was the exported PDF's colour too, not only the editor's.
- `What It Is Now`: a reference takes the styling of the text around it, and anything applied to it shows. It is a few words inside someone's sentence, not a piece of chrome - the product's first principle applied to the one element that was exempt from it.
- `What Stays`: a reference whose target has been deleted is still drawn in the error colour with a wavy underline, whatever the writer has applied. That is a fault to be fixed, not a choice to be honoured - the number it shows is stale.
- `Test script`: `cross-reference-styling.cdp.mjs`, 10 checks, its own synthetic document. Seen failing on three with the fix removed: the colour of its paragraph, the underline, and the applied colour reading `rgb(52, 128, 249)`.

  ```bash
  npm run test:e2e:cross-reference-styling
  ```

### An Image Loads When The Document Is Opened, Not When It Is Scrolled To

- `Reported By The User`: in a thesis with five images, only the first appeared. All five files were on the server and all five answered.
- `The Editor Is One Tall Scrolling Canvas`, and every image was rendered with `loading="lazy"`, so only the image near the viewport ever loaded.
- `Why It Is Worse Than A Missing Picture`: the pagination engine solves from measured geometry, so an image that has not loaded is an element in the flow whose height nobody controls - the product's first principle broken in the place it matters most. It also cost the writer a day of diagnosis: with four images rendering as nothing, a genuinely blank page and a page holding an image that had not drawn look identical.
- `Test script`: covered by the existing asset tests, which still pass - `document-assets.cdp.mjs` and `document-assets-saveas.cdp.mjs`.

### A Page Break With A Line Or Two To Spare Still Opens Its Section

- `Reported By The User`: exporting a thesis gave 29 pages where the editor drew 25, and PDF Bookmarks then refused to write - it compares the two counts before pointing a bookmark at a page, and rightly so, because writing them against a page map that no longer holds would send every one of them to the wrong page, quietly.
- `The Guard Was Right And Was Not Touched`: the mismatch was real. The user narrowed it themselves once the images rendered: it happens where a page break sits on a page that still has a line or two of room left, and in their document that is the breaks on pages iii and iv.
- `Only The Forced Branch Recorded A Section`: the solver takes whichever comes first down the page, a forced break or an overflow. When a page break sits near the foot of its page, the first line to overflow is the one the break itself pushes down - so the overflow is at or above the break and the **overflow** branch takes it. The break lands at exactly the position the page break opens, so the pagination itself is right; but `lastPos` then advances to that position, the break never matches `pos > lastPos` again, and the section it opens is never recorded at all. Instrumenting the solver settled it in one run: the trace of every `layout.open` call held one entry, for the last section.
- `Measured`: three sections and three sheets, and `storage.sheets` reported their sections as **`0,0,2`**. Section 1 owned no sheet. Nothing on screen showed it, because the two sections happened to be drawn on the same paper - and the geometry a sheet is drawn at comes from that same number, so a document where the swallowed break is the one that turns the page landscape would be drawn on the wrong paper too.
- `What The Export Made Of It`: a band is named per section, so the page name ran s0 -> s1 -> s0 -> s2. A change of page name is a forced break, so two of them fell where no section begins: **three sheets printed as five pages**.
- `The Fix Is In The Engine, Not The Export`: a forced break the overflow branch swallowed opens its section too. Fixing it where the answer is produced makes the screen right as well; naming the bands from their neighbours in the export was tried first, fixes only half of it, and measured far worse - all thirteen sweep variants collapsed to a single page - so it was reverted.
- `Test script`: `page-sections-export.cdp.mjs` grew Case C, 4 checks, 16 in the file. It **looks for** the condition rather than hardcoding a line count, since how many lines fill a page depends on the profile in effect, and it fails saying *the case tested nothing* if it cannot find one. Seen failing on three of its four checks with the fix removed: `sheet sections 0,0,2`, `3 sheets vs 5 pages`, `screen PPL vs PDF PPPPL`.

  ```bash
  npm run test:e2e:page-sections-export
  ```

### Each Section Prints On Its Own Paper

- `What Changed`: a document whose sections use different page sizes now exports with each section on its own paper - one PDF page per on-screen sheet, in that section's own text column, at full size. A landscape chapter in a portrait thesis comes out landscape. The export dialog no longer carries the warning that it cannot, because it can.
- `The Cause Was Recorded As One Sentence With An And In It`: *the canvas is as wide as the widest sheet, **and** Chrome scales a printed document down to fit its narrowest page*. Those are two claims, and which one does the work decides whether there is a fix at all. Separated by a spike - four standalone documents printed and measured with poppler - Chrome turned out **not** to scale a document to its narrowest page. It shrinks only when an element overflows the page it is printed on. The variant modelling the old export measured 0.707, reproducing the reported 70 per cent exactly; the variant whose only change is that nothing is wider than its own paper measured 1.000 on every page.
- `So The Rule Is One Line`: no element may be wider than the page it prints on. The canvas is cut to the **narrowest** sheet, each block is given its own section's column and its own section's left margin, and a block wider than the canvas simply overflows it - which prints correctly, and was measured doing so before anything else was built.
- `The Column Stays The Width It Has On Screen`: the page bands that carry the numbers are placed from screen measurements, so a block that broke its lines differently in the export would put every band on the wrong page.
- `And The Page Numbers Came Right On Their Own`: while a mixed document was laid out at one paper, the screen's page boundaries were not the export's and the numbers landed wrong - four of six right, measured. Each sheet being its own paper puts the two back in agreement, so nothing has to be predicted. The test asserts it now; it could not before.
- `Three Faults Surfaced That Had Nothing To Do With Paper`, all latent and harmless while there was only one page name, and together they turned six sheets into **thirteen** pages:
  - `The Wrappers Had No Page Name`: the root, the body, the canvas and the editor resolved to the default page, so the flow crossed from the default page to a named one and back. A change of page name is a forced break, so an unnamed element between two named ones is two of them. Measured before the fix: the landscape section's second page printed **portrait**, because the default page's paper is what that content landed on.
  - `A Band Is A Span, So The Paragraph Is Never Split`: a page boundary usually falls in the middle of a paragraph and that is where the band has to go. Written as a `div` it was invalid inside a `p`, so the parser closed the paragraph, emitted the div, and left everything after it as a **bare text node** - measured, 2076, 1130 and 2076 characters loose in the flow, with no section and no column, because a text node can carry neither an attribute nor a class. A `span` with `display: block` is valid there, so nothing is torn; the page number inside the band became a span too, which is the only reason the band had been a div. The band takes the width of the **column**, not the paper: a paper-wide box starting at the column's left edge hangs off the page by the left margin, measured as a uniform shrink to 0.865, which is 21 / (21 + 3.18) exactly.
  - `A Page Break At A Section Boundary Broke Twice`: its own `break-before` and the change of page name. The marker's own is dropped where the sections differ.
- `Test script`: `page-sections-export.cdp.mjs`, 12 checks over two cases. Every column is measured in points against the paper it belongs to - 415 pt portrait, 662 pt landscape - so a document that shrinks cannot pass. Seen failing on four before the fix, which is how many checks asserted the old compromise.

  ```bash
  npm run test:e2e:page-sections-export
  ```

- `Not Measured, And Only The Writer Can`: every number here was taken with Chrome's `printToPDF`. The Export button prints through Chrome's own print dialog instead, and that path has not been measured since the change.

### A Font Put On A Markdown Block Survives The Block Being Edited Again

- `Reported By The User, In Steps`: open a markdown block's source, set the font to Comic Sans, leave the block - it renders in Comic Sans. Open the source again, leave again, and it comes back in the editor's default.
- `The Rendered Half Is A View Of Its Source`: that is ADR 0012, and it is why leaving the source rebuilds the content from the markdown. The font picker writes a `textStyle` mark onto that content, so the writer's choice lived on the view and was thrown away with it, every time. Measured on the node: the mark present after choosing the font, and gone after the next edit.
- `What The Writer Applied Is Carried Across, What The Markdown Asked For Is Not`: a markdown block is selected whole, never partly, so a mark the writer applied covers all of its content. But so does a mark the markdown itself produced when the source reads `**all of it bold**` - and carrying **that** one over would mean deleting the asterisks no longer un-bolds anything. So the old source is rendered again and the marks it produces are subtracted; what is left is the writer's. Both halves are asserted, and the naive version - carrying every mark that covers everything - was seen leaving the text bold after the asterisks were deleted.
- `Test script`: `markdown-block-styling.cdp.mjs`, 11 checks following the reported steps, seen failing on two before the fix with the report in one line: *P in helvetica neue, expected Comic Sans MS*.

  ```bash
  npm run test:e2e:markdown-block-styling
  ```

- `Two Things About The Test Itself`, both of which would have let it pass against the bug. It reads the element that actually carries the text, because the mark renders as a span inside the paragraph and reading the paragraph shows the default either way. And it chooses a font that is **not** the editor's default, because a test expecting the default cannot tell a font that was kept from a font that was lost - which is exactly how the first attempt at this was written, and why it reported no fault.

### A List Numbers Itself In The Face Of The Text It Opens

- `Reported By The User, With A Photograph`: four numbered items, and the third one's number visibly bigger and heavier than the other three. Only that item contained inline mathematics. The number a list item opens with is part of the sentence; it was being set by something else entirely.
- `A List Is Rendered Two Different Ways`, and both were wrong in their own way. An ordinary list draws its own marker as a span. A list inside a markdown block is a real `<ol>` with a native `::marker`. Fixing one would have left the other exactly as reported.
- `An Ordinary List Took The Editor's Default Face`: the marker carried a font size taken from the item but no font family at all, so it fell back to whatever the editor defaults to - measured, a marker in PingFang SC beside text in Times New Roman. It takes the family and the weight now, from the same place it always took the size.
- `And Its Size Came From The Largest Thing In The Item`: the metric walked every text node in the item and kept the maximum, so a single formula set the size of the number. It takes the first line's own font instead - and where a line mixes fonts, the one most of its characters are set in, because the marker belongs to the prose rather than to the fragment.
- `The Photograph Was A Third Fault Underneath Those Two`: lines were grouped by their rect's `top`, and a fragment set larger sits on the same line but its box begins higher. So the formula was given a line of its own, that line sorted **above** the real first line, and the marker took its font. Lines are grouped by overlapping now. This is why one item in four looked different while the other three agreed.
- `A Markdown List Kept Its Numbers Behind`: `::marker` takes its font from the `li`, and the text a writer sees is a `p` inside it, styled by Normal Paragraph - markdown renders a spaced list that way. Style the paragraph and the text moved while the numbers stayed in the editor's default: measured, markers at 14px beside text at 22px. The generated stylesheet now writes a `li::marker` rule, following List Item where the writer has set it and Normal Paragraph otherwise.
- `Test script`: `list-marker-font.cdp.mjs`, 8 checks over both paths - the face, the size, an item carrying a much larger fragment, and the same for a list inside a markdown block. Seen **failing on five** before the fix, with the numbers that describe the report: a marker at 32px beside 18px text, and PingFang SC beside Courier New.

  ```bash
  npm run test:e2e:list-marker-font
  ```

### A Contents Longer Than A Page Paginates Itself

- `Reported By The User`: once the contents ran past the bottom of its page, the paging of the **whole document** went wrong - not only the contents. Measured on a sixty chapter fixture: **one** page break placed where nine were needed, and thirteen of a hundred and twenty lines left sitting in the margin bands of sheets two to nine.
- `Why The Engine Could Not Do It`: the contents is an atom node, so there is no position inside it for a break to be anchored to. The solver steps over a block it cannot break rather than abandoning the document - that is what `skipped: 1` means - but stepping over this one left it straddling a sheet boundary, and the next overflow it met was above its own last break. It stopped there, and everything below stayed unpaginated. `{"stopped":"no-anchor-below-the-last-break","breaks":1,"skipped":1}`.
- `So The Contents Does It Itself`: it pushes any row that would straddle the foot of a column down to the top of the next one. With no row crossing a boundary the engine finds nothing here to fix and carries on down the document. The same fixture now solves `{"stopped":"settled","breaks":10,"skipped":0}` with no line in any band. **This is the contents only.** A table too tall to break still stops the solver the same way, and that remains open.
- `The Arithmetic Starts From The Natural Layout`: the gaps already applied are subtracted from the measurement rather than cleared from the DOM to measure again. Clearing meant this and Vue were both writing `margin-top`, and the styles cleared for measuring stayed cleared whenever the answer came out unchanged and Vue saw no reason to patch. Measured: the same document settled on one run and straddled fourteen rows on the next. One writer.
- `And The Print Version Is Not The Screen One`: a gap is a screen measure. Print breaks the page itself and then honours the margin **on top of** its own break, so the document slid down and came out with a blank page at the end - 13 printed pages for 12 sheets, where the same document without a contents printed 11 for 11. In print the row asks for `break-before: page` and takes no margin at all.
- `Zoom`: everything measured comes back scaled and every length written is inside that same transform, so the gap is divided by the scale on the way out - the arithmetic that made every page spacer half its height at 50 per cent the last time something was drawn from these numbers. Asserted at 50 per cent, and seen failing there with the division removed.
- `Test script`: `toc-boundaries.cdp.mjs`, 17 checks in four cases - the table rule, a contents across two sheets, the same at 50 per cent zoom, and the exported PDF page for page against the screen. Every one of the three fixes in it was seen failing first, each by removing only its own line.

  ```bash
  npm run test:e2e:toc-boundaries
  ```

### A Heading Inside A Table Is A Styled Cell, Not A Section

- `Reported By The User`: they write a literature review as a table and style its cells with a profile of their own, and the contents filled up with it - the row numbers, the citations, the summary sentences, one entry each. Their own screenshot shows nine table rows between *BAB II Tinjauan Pustaka* and *BAB III Metodologi Penelitian*.
- `Why A Cell Is A Heading At All`: a profile carrying a heading level turns the block it is applied to into a `heading` node - that is how profiles work (adr/0007) - and a profile reaches every block a selection covers, cells included (adr/0013). Nothing was wrong with either decision. What was missing is that being a heading node and being a section of the document are not the same thing.
- `The Numbering Was The Worse Half`: the cells did not only appear in the contents, they **took section numbers**. Measured on a three column table of three rows: the chapter after it came out as the tenth sub-section of the chapter before, and every cross-reference to it moved with it. A cell now takes no number and consumes none, and it opens no sub-section either, so the first real sub-heading after a table carries on where the last real one left off.
- `One Rule, Read By Everything`: `src/utils/heading-scope.js` is the only place that decides what a section is. Four things read the heading store and every one of them was listing cells - the contents block, the **document map panel**, the editor's `getTableOfContents()`, and `collectOutlineEntries`, which is what the **PDF bookmarks** are written from. Fixing only the visible one would have left a reader of the exported PDF with a bookmark for every cell. They all read one function now, because the alternative is four copies of the same rule drifting apart.
- `What A Cell Keeps`: its profile and its whole appearance. Only its claim to be a section is refused. The table itself is still numbered, and so is a figure in one of its cells.
- `Test scripts`: `document-references.test.mjs` gains two unit checks - a cell takes no number, and a cell does not open a sub-section - both seen **failing** before the fix. `toc-boundaries.cdp.mjs` builds a document with a three row review table and asserts on all four readers of the heading store at once.

  ```bash
  npm run test:unit:document-references
  npm run test:e2e:toc
  ```

### One Control For Opening, Saving And Starting A Document

- `Four Buttons Said Three Things`: **Open JSON**, **Save to JSON**, **Buka / Load** and the status control sat within a few centimetres of each other, and the status control's own panel already offered *Save*, *Open Document* and *New Document*. Only the status control is left, and it is the way in to all three.
- `A Saved .json Was Never The Full File It Looked Like`: it carries the document's html, and after the document has been loaded from the server that html holds **urls** to the images rather than the images. Take the file to another machine and the pictures are gone. Dropping the button is not a loss of a working export; it is the removal of one that looked like it worked. `saveDocumentFile` is still part of the component API for an embedder that wants it.
- `The Green Button Is A Button Now`: 34px tall with 14px text, from 24px and 12px, because it is the only control in that corner rather than the last of four.
- `The Open Dialog Stopped Being Opened By Clicking A Button In The DOM`: `triggerLoadModal` found `[data-testid="open-json"]` and clicked it, behind an `if (btn)` guard - so the moment that button came off the toolbar, both the old Buka / Load and the panel's Open Document would have silently done nothing at all. The dialog's open state is a small shared composable, `src/composables/document-dialogs.js`, and the dialog is asked to open. `open-json.vue` now carries the dialog and no button; the dialog is teleported to the editor container, so it leaves no gap where the buttons were.
- `And The Dialog Fetches Its Own List`: it used to be refreshed by whoever clicked the button. It watches its own visibility instead, so every caller gets a current list without having to know to ask.
- `What Is Still Missing, And Was Missing Before`: there is no way to write a document out as one self-contained file with its images inside. A document **is** a folder on the server, so serving it as an archive is the natural answer, and it is not built.
- `And One Test Went With Them`: `save-file.cdp.mjs` asserted on the Open JSON and Save to JSON buttons and clicked Save to JSON three times, so nothing in it survives their removal. It was already failing before this - it waits for a download named from a document title the application deliberately rewrites - so what is lost is a red test for a button that is gone. `document-file.test.mjs` still holds the file contract.
- `Test scripts`: no check was added. Four tests reached the dialog by clicking the button that is gone; they go through the status control now, which is the path a writer takes. `document-assets` (17 checks) and `document-assets-saveas` (15) were run and pass, which is also what proves the panel's Open Document works. `pagination-geometry` and `pagination-pdf-parity` were driven against a throwaway fixture to see the dialog open and the document load, because both of them still open a stored document rather than building one.

  ```bash
  npm run test:e2e:document-assets
  npm run test:e2e:document-assets-saveas
  ```

### An Image Survives Being Saved Under A Second Name

- `Reported By The User`: make a document with an image, save it as A, reload the page, open A, save it as B, reload, open B - and the image is gone. B's folder held no image at all, and the document pointed into it, so every reader got a 404.
- `Why The Reload Is Part Of It`: the bytes of an upload are kept in a Map in `src/utils/document-assets.js`, which lives as long as the page does. Save A while the upload is still in that Map and the bytes travel with it, which is why the first save was always right. After a reload the document's images are urls into **A's** folder and nothing in the page holds their bytes, so a save to B sent the filenames with no data - and the server can only look for a named file in the folder it is writing, where it was not.
- `The Folder Being Written To Is Now Part Of The Question`: `collectAssets` takes the document id it is saving into, and the url of an image says which document's folder it came from. An image whose bytes are in a different folder is fetched from the url the page is already displaying and carried into the new one. There is no other copy to use.
- `And An Unchanged Image Still Travels Nowhere`: when the url already points at the folder being written, nothing is fetched and the asset is named by hash alone, exactly as before - so autosave on a document full of photographs still costs one request and no image bytes. The test measures this rather than trusting it: it counts the page's fetches across a save to the same name and requires the count not to move.
- `It Was Not Silent, But It Was Easy To Miss`: the server already answered with `missingAssets` and the editor already turned that into *Saved, but 1 image(s) could not be stored*. The document was saved, the warning was one message among several, and what the writer saw afterwards was a document with a hole in it.
- `Test script`: `document-assets-saveas.cdp.mjs`, 15 checks following the reported steps exactly - three separate page loads, the real Open dialog, the real save. It was seen **failing on six checks** before the fix and passing after. The bytes coming back out of B's folder are compared to the bytes that went in by sha256, because an earlier version of that same check compared a string-decoded body and could not have failed.

  ```bash
  npm run test:e2e:document-assets-saveas
  npm run test:e2e:document-assets
  ```

### A Test Types Into Its Own Tab

- `One Test Attached To The Writer's Tab`: `test-keystroke-typing` searched the browser for a page with `9000` in its URL and typed into whatever it found - the writer's editor, holding the writer's document. It creates a tab of its own now and closes it on every way out, waits for the editor to mount rather than assuming it has, and takes its endpoints from `CDP_URL` and `EDITOR_URL` with no fallback. It was never wired to an npm script, which is probably why nobody noticed.
- `Three More Would Have Exited 127 Eventually`: `page-numbers-export`, `pagination-pdf-parity` and `pdf-bookmarks` read the CDP endpoint with `fetch` and then called `process.exit`, which is what made `page-sections-export` report every check passed and exit non-zero on Windows. None of the three has crashed - the assertion needs a payload large enough to still be in flight - so this is prevention rather than repair. They read that endpoint with `node:http` and `agent: false` like the fourth.
- `And What Was Deliberately Left Alone`: 21 files carry the same teardown without ever printing a PDF, and the fault only surfaces with a large payload. 21 do not pin their viewport and do not need to - they type with `Input.insertText` and click with `element.click()` inside the page, and neither hit-tests, which is the only thing the viewport rule protects against. Both counts were measured before deciding, because the first reading of how much was broken was too wide twice over. No shared test harness: a change to one would move the verdict of 25 tests at once, and the real problem was four files.
- `Test scripts`: no check was added or changed. Measured here, each exiting 0 with the browser's tab count back at its starting value: `pdf-bookmarks` 21 checks, `page-numbers-export` 9, `test-keystroke-typing` 1 assertion. `pagination-pdf-parity` opens a stored document instead of building its own fixture, so it still stops at `DOCUMENT_NOT_ON_SERVER` on a clone without that document.

  ```bash
  npm run test:e2e:pdf-bookmarks
  npm run test:e2e:page-numbers-export
  node tests/e2e/test-keystroke-typing.cdp.mjs
  ```

### The PDF Export Tests Run On Any Machine

- `A Run That Passed Every Check Exited 127`: the CDP HTTP endpoints were read with `fetch`, which keeps its sockets alive after the body is read, and `process.exit` over a handle that is still closing trips a libuv assertion on Windows - `UV_HANDLE_CLOSING` in `src/win/async.c`. `page-sections-export` printed `RESULT: PASSED` and then died, so anything reading the exit code saw a failure. It reads those three endpoints with `node:http` and `agent: false` instead, which leaves nothing behind to close. The assertion is loud on Windows and silent elsewhere, but exiting over a closing handle was always wrong.
- `Two Other Ways Out Were Tried And Discarded`: awaiting the WebSocket's own close changed nothing - the sockets were `fetch`'s, not its. Setting `process.exitCode` instead of calling `process.exit` exited cleanly **and broke the failure path**: `finish` no longer halted the file, so a failing run printed `RESULT: FAILED`, carried on to `RESULT: PASSED`, and exited 0. Caught only by forcing a check to fail; a fix verified on the passing path alone would have shipped a suite that could not report a failure.
- `A Preflight That Asked The Wrong Question`: `page-sections-export` checked its tooling with `which`, which is not a question a non-POSIX shell can answer, and which only says a file of that name exists. On a machine carrying poppler's `pdfinfo` and xpdf's `pdftotext` it passed, then fell over three checks in with a usage dump - xpdf 4.00 has no `-bbox`. All three PDF tests now run the tool itself and require `poppler` in its version banner, reading the banner rather than the exit status because the two builds disagree about that too: poppler exits 0, xpdf 99.
- `Test scripts`: no check was added or changed. Measured here: `page-sections-export` 13 checks, `page-numbers-export` 9. `pagination-pdf-parity` still opens a stored document rather than building its own fixture, so it stops at `DOCUMENT_NOT_ON_SERVER` on a clone that does not have that document - unchanged by this, and still the debt it always was.

  ```bash
  npm run test:e2e:page-sections-export
  npm run test:e2e:page-numbers-export
  npm run test:e2e:pagination-pdf
  ```

### Page Size, Margins And Orientation Belong To A Section

- `A Section Is The Run Of Pages Between Two Page Breaks`: the first one is opened by the document itself and keeps its geometry in the document settings, exactly where it always was. Every later one keeps its geometry on the page break that opened it, so it travels with the content. A field left unset carries on from the section before it, which is what every page break in every document written so far says - so a document that sets nothing is laid out, saved and exported exactly as it was.
- `Every Page Break Has A Name`: four characters, drawn on the break's own line - `Page Break a3f9` - and quoted by the three menus that change page geometry, so before making a change the writer reads *Applied from page break a3f9 to page break k2wp*. A name is assigned on sight to a break that has none, and a break pasted or duplicated is renamed rather than left a twin.
- `The Engine Stopped Assuming One Page Height`: it worked from a single constant - a page plus the gap after it - so a document could only ever be one shape. Sheets are now built forward one at a time, each taking the geometry of the section it belongs to, and which section that is is learned as the solver walks down the document and takes each page break in turn. An assignment is keyed by the section rather than by the sheet, because the solver revises its answer as the content above a break is paginated.
- `The Sheets Are Drawn Now`: they used to be painted by a repeating gradient on the canvas, which can only repeat one geometry. They are elements, placed from the same layout the engine solved - so there is one answer to where a sheet begins rather than a painted one and a computed one that could drift apart. A narrower sheet is centred in the canvas, and the canvas is as wide as the widest.
- `One Column, So The Difference Goes On The Blocks`: a section drawn on different paper cannot be given a column of its own, so each of its blocks carries the difference from the first section as a margin. Nothing is emitted at all while every section is drawn the same way - no attribute, no inline style, nothing in the saved HTML.
- `Zoom Was Measuring In One Unit And Writing In Another`: everything the engine measures comes from `getBoundingClientRect`, which reports the zoomed box, while every length it writes is a CSS length inside the same transform and is not zoomed. At 50 per cent every spacer was therefore half the height it needed, and text sat in the margin band. Found by drawing the sheets, which made it visible; it had been wrong at every zoom but 100 per cent.
- `A Change Stops Where The Menu Says It Stops`: a field left unset carries the section before it on, which is what lets an untouched document behave as it always did - and it also meant that turning one section landscape turned every section after it, while the menu had just said the change ran only as far as the next page break. The break after the one being changed is now given, explicitly, the value it is already drawn at, for the fields being changed and only where it had none of its own. Sections beyond it inherit from that one, so pinning a single break stops the whole ripple. Both writes go in one transaction, so it is also one undo.
- `The Solver Was Being Told About Breaks It Had Not Reached`: measuring the forced breaks opened a section for every page break that happened to look column aligned, including ones far below where the solver had got to - and opening a section changes the height of every sheet after it, which silently invalidated breaks already placed. The solver then met an overflow above its own last break, could not anchor it, and gave up, leaving the rest of the document sitting in the margin band. Measured on a real thesis: the last break at position 25541, the overflow it could not place at 23039. A section is opened only when the solver actually reaches that break.
- `And It Steps Over What It Cannot Anchor`: a block the engine cannot anchor a break inside - a table, in the document that showed this - used to stop the solve dead and cost every page below it its pagination. It steps over the block instead, but only when stepping over actually gets somewhere. One block laid out badly is a much smaller wrong than the rest of the document unpaginated.
- `The Engine Says How A Solve Ended`: `settled`, `no-anchor-below-the-last-break`, `ran-out-of-sheets`, and how many blocks it stepped over. A solve that gives up looks exactly like one that finished, from outside - that cost an afternoon once, and the test now asserts on it.
- `Test script`: `page-sections.test.mjs`, 13 unit checks on the section model - inheritance, an unreadable geometry, which section a position falls in. `page-sections.cdp.mjs`, 23 checks driving the real menu with real clicks: the names, a duplicated break, the line that says what a change covers, the rendered sheets after turning one section's paper, the round trip through saved HTML, and a document that sets nothing being untouched.
- `Export test script`: `page-sections-export.cdp.mjs`, 13 checks that build a document whose three sections each run to more than one page, export it the way the dialog does, and read the resulting PDF with `pdfinfo` and `pdftotext` - the page count against the on-screen sheet count, each page's shape against its section, and each page's trailing number against the one the screen gives it.
- `The PDF Does Not Change Paper Yet`: a landscape section prints portrait, and the export dialog says so before printing. Chrome itself can do it - a named `@page` rule per section and a `page` property on its blocks, measured working - but the canvas cannot. On screen every sheet is drawn on one canvas as wide as the widest, and **Chrome scales a printed document down to fit its narrowest page**: with a landscape section in a portrait document that is 21/29.7, and everything comes out at 70 per cent, the text column included. Measured on the user's own thesis: a 14.6 cm column printed at 10.3 cm.
- `Two Earlier Readings Of This Were Wrong, And Both For The Same Reason`: first the export was called hopeless, when four on-screen sheets came out as three pages - that was the solver giving up, not the export. Then it was called done, when the page count and every page size came back correct - but nothing was checking the **scale**, and the whole document was 70 per cent. A test that measures only what you thought to measure will pass while the output is wrong. The export test now measures the printed text column in points and refuses anything shrunk.
- `What A Mixed Document Exports As Now`: the first section's paper throughout, at full size, in the document's own text column, one page per on-screen sheet. The canvas is put back to one page wide and the screen's centring insets are undone - both exist only on screen, and both are wrong on paper.
- `And What It Still Gets Wrong`: laying a mixed document out at one paper means the screen's page boundaries are not the export's, so the bands carrying the page numbers - which are placed from the screen's - do not all land where the screen puts them. Measured on a six page document: four numbers right, the two that came from landscape sheets wrong. The dialog says this too. It cannot be fixed from the export's end; the paper has to change first, and that needs the canvas to be the width of each page rather than of the widest.
- `And The Bands Will Have To Give Way When It Does`: the named `@page` route was measured working before the scale problem was found, and one thing will still be in its way afterwards. A numbered document turns its margins into real blocks in the flow and each one ends its page with `break-after: page`; under a named page that break fires and the page name is re-established after it, which is a second break - measured, six sheets came out as ten pages, four of them holding nothing but a number. Removing the bands' own break instead leaves the pages to be ended by the flow, which lands them a page adrift. Whoever makes the canvas the width of each page has to solve this at the same time.

  ```bash
  npm run test:unit:page-sections
  npm run test:e2e:page-sections
  npm run test:e2e:page-sections-export
  ```

### PracticalDocs

- `Everything, Not Only The Label`: the product is PracticalDocs, the package `@np_makin/practicaldocs`, the build `practicaldocs.js`, the CSS prefix `pdoc-`, the component `<practical-docs>`, the dev server path `/practicaldocs`, and the browser storage keys `practicaldocs:`. 184 source files, 13 icons and 15 stored documents.
- `The Documents On Disk Were Migrated`: `umo-` is written into every stored `document.html`, in the stylesheet and on the blocks it styles, so a document left alone would have opened with its profile rules matching nothing - all the text, none of the styling. `storage-server/migrate-class-prefix.mjs` rewrites them and recomputes the checksums. It reports what it would do and writes nothing until `--write`, and running it twice is a no-op. **A checksum that does not match is a warning, not a stop**: the point is to save the writer's documents, and a file edited by hand since it was saved is still one of them.
- `Old Files Still Open`: the JSON export format is `practicaldocs` now and the reader accepts `umodoc` as well, and a `.umodoc.json` name is not given a second suffix. A rename is not a reason to refuse someone's work.
- `What The Rename Broke, And How It Showed`: replacing `/umo-editor` with `/practicaldocs` also matched the closing tag `</umo-editor>`, which made `app.vue` fail to compile - and renaming the component to `PracticalDocs` left the tag `<pdoc-editor>` pointing at nothing, so the page mounted with no editor in it. Both were found by the suites failing at `NO_VUE_COMPONENT`, not by reading. The icons were missed entirely on the first pass: they are `.svg`, they paint their accent from `--umo-primary-color`, and they would have gone colourless in silence.
- `Upstream's Name Is Not Renamed`: `Umo Editor`, `Umodoc` and their URLs are protected through the whole substitution. This is a fork, the About panel says so, and `LICENSE` is untouched.

### The Editor Is Called PracticalDocs

- `The Product, Not The Plumbing`: the package is `@np_makin/practicaldocs`, the window title, the About panel, the welcome banner and the build output all say PracticalDocs, and the build is `practicaldocs.js`. What the reader sees is renamed; what files and browsers read is not.
- `Three Identifiers Deliberately Left Alone`: the `pdoc-` CSS prefix is in every saved `document.html`, `format: "umodoc"` is in every saved `settings.json` and is checked before a file is opened, and the `practicaldocs:` localStorage keys hold the open document and the profile list. Renaming any of them would break documents that already exist, for no gain the reader could see - they are identifiers, and nobody reads them. If they are ever to change it is a job of its own, with a migration.
- `And One More`: the dev server is still served at `/practicaldocs`. That is a URL, and changing it changes the address every test and bookmark points at. A separate decision, not a side effect of a rename.
- `The Credit Is Now Accurate`: the About panel said "Powered by Umodoc". This is a fork, so it says what it is - "Based on Umo Editor by Umodoc, MIT licensed". `LICENSE` still carries Umodoc's copyright and is untouched.
- `A Banner That Stops Inventing Facts`: `copyright.js` interpolated `pkg.author.url` and `pkg.homepage` straight into the build header, so a missing field would have printed the word `undefined` into every built file. An absent field now says nothing. `homepage`, `repository` and `bugs` point at `github.com/imakin/umodoc-practical`, which is where this code actually lives - the fields were never the problem, the old values were.

### An Exported Document Says What Language It Is In

- `It Said Chinese`: `<html lang="zh-CN">` was hardcoded in the print template, so every PDF this editor has ever exported declared itself Chinese. A screen reader believes that, and so does an accessibility checker. The default is `en-US` now.
- `And The Writer Can Say Otherwise`: the export dialog carries a Document language field. Any BCP 47 tag - `id-ID`, `en-GB`, whatever the document is actually in - because the set of languages a thesis can be written in is not this editor's to decide. The choice is kept on the page settings, so it is saved with the document and offered back at the next export rather than asked from scratch.
- `Read Permissively On The Way In`: a document saved before this field existed has none, and is opened as `en-US` rather than refused. That is the rule `validatePage` already learned the hard way with page numbers.
- `The Export Document Is Built When The Dialog Opens`: it used to be built at that moment and this change nearly moved it to the confirm button, which would have broken every test that reads what would be printed without pressing print - `pagination-pdf-parity` among them. It is built at both points now: once to be read, once more on confirm in case the language changed.

### PDF Bookmarks, Written In The Browser

- `A Second Door, Not A Replacement`: Export to PDF is untouched. Beside it is **PDF Bookmarks**: export as you always have, hand the saved file back, and the editor writes the outline, the page labels and the title into it. The file never leaves the machine, no server is involved, and nothing was added to `storage-server`.
- `Why This Was Thought Impossible`: `print.vue` gives the document to Chrome's print dialog and Chrome writes the file, so the editor never holds the bytes of its own export. That was read for a long time as "post-processing is impossible". It is a fact about the workflow, not a law - **if the writer hands the file back, the bytes are here**. See [experiment 0002](../AGENT/experiments/0002-pdf-outline-written-in-the-browser.md).
- `The Bookmarks Are The Document's Own`: level, title and number come from the same list the contents is built from, and the page from the pagination engine, so a bookmark cannot disagree with the contents or with the folio printed on the page. A bookmark reads `BAB I Pendahuluan` - the number included, because the writer set that template themselves and a bookmark reading `Pendahuluan` names a different thing. This is what Chrome's own `generateDocumentOutline` could not do: it takes titles from heading text alone, so every chapter would have read `PENDAHULUAN`.
- `Page Labels Too`: a PDF reader's page box shows `iv` for front matter and `1` where the body restarts, instead of counting sheets. The pagination engine already knew every sheet's numeral style and value; it now carries the style on the record so a second reader can use it.
- `It Refuses Rather Than Guess`: the writer chooses scale, paper and margins in Chrome's print dialog, and any of them moves where a heading lands. If the returned PDF has a different page count from the document, nothing is written and the writer is told why. Bookmarks pointing at the wrong pages would be wrong quietly, which is the worst way to be wrong.
- `In Place Where The Browser Allows It`: with the File System Access API the file the writer picked is rewritten in place - one file, no second copy to tell apart. Without it, the new PDF is downloaded.
- `Test script`: `pdf-outline.test.mjs`, 13 unit checks against a PDF the test builds itself - the tree, the label ranges, and the outline read back out of the bytes rather than trusted. `pdf-bookmarks.cdp.mjs`, 18 checks over the whole flow: the real export document, printed by Chrome, handed to the editor, and the result read for a real `/Outlines`. Only the file picker is stubbed, because it is browser UI.

  ```bash
  npm run test:unit:pdf-outline
  npm run test:e2e:pdf-bookmarks
  ```

- `Found On The Way`: every PDF this editor exports declares `<html lang="zh-CN">` ([print.vue:256](src/components/container/print.vue#L256), hardcoded), so screen readers and accessibility checkers are told the document is in Chinese. Not fixed here; it is a bug of its own.

### Nothing Is Numbered Unless The Writer Asks

- `A Table No Longer Numbers Itself`: an image never did, and a table did - invisibly, because `adr/0009` removed the caption element that once drew that number. The number was still consumed, so a caption paragraph given the table profile came out `Table 2` while the table above it silently held `Table 1`. A table is a container like an image now: what carries the number is the caption the writer wrote and gave a profile to. One rule for both, in one set.
- `The Built-In Profiles Are English`: `Tabel` and `Gambar` were the only two built-ins not in English, hardcoded beside `Page Number` and `Table of Contents`. They are `Table` and `Figure`, with templates `Table {h1}.{number}` and `Figure {h1}.{number}`, and the dialog placeholders follow. **A document that already stores its own version of either keeps it** - a saved profile list wins over the built-in one, which is what makes this safe for work in progress.
- `A Container Profile Applies To A Caption`: choosing the figure profile used to look for an image node and the table profile for a table node - neither of which is ever numbered. Both now apply to the blocks a writer types into, which is where the number goes.
- `Test script`: `document-references.cdp.mjs` pins the two container profiles to their built-in shape before asserting, because a profile list saved in the browser wins over the built-in one and a test must say what it depends on. The unit plan tests assert the same rule.

### A Test Closes The Tab It Opened

- `Three Tests Left Their Tab Running`: `browser.close()` drops the WebSocket and leaves the page open. Every run left one more editor behind, each with its own timers, and after a dozen of them Chrome was loaded heavily enough that a newly opened editor **would not mount at all** - which reads as a broken test rather than a full browser. Measured the hard way: fourteen editor tabs, and two suites failing for no reason of their own.
- `And One Left A PDF Preview`: exporting opens a tab of its own, so closing only the tab a test created still leaked one per run. `pagination-geometry` now records the pages that existed before it started and closes only what appeared since - tabs that were already there belong to the writer and are never touched.
- `The Unsaved-Changes Dialog Is Answered`: the editor blocks unload while a document has unsaved changes, so a test that navigates raises a real Chrome dialog that blocks the run and the browser with it. The two tests that navigate now accept it. The other route is better and is what the rest do: create a tab, and close it with `Target.closeTarget`, which asks nothing.

### A Cross-Reference Is Text In A Sentence, Not A Heading

- `It Carried The Heading's Line Break`: the default level 1 template is `BAB {number}` followed by a newline, and that newline is what puts the chapter title on the line below its number. A cross-reference to that heading copied the label verbatim, newline included, so writing `see BAB I for details` broke the line in the middle of the sentence. A reference takes the words, never the shape the heading gives them.
- `The Figure Model, Stated`: a figure is numbered because the writer gave its caption the figure profile, never because a node happens to be an image. The image is only the container. That was already how the code worked; nothing about it was written down, and the one test covering it asserted the opposite.
- `Three Stale Assertions Removed`: `document-references.cdp.mjs` had been red long enough that nobody read it. It waited for four automatic labels where only three are automatic, read a figure number from a `figcaption::before` that this editor never draws, and drove a table caption through `Insert > Caption`, a route `adr/0009` removed. It now asserts the model as it is: an image is **not** numbered unless asked, a caption given the figure profile is, and a table's number lives on the node because since `adr/0009` there is no caption element to draw it in.
- `What It Cost To Leave It Red`: the newline in cross-references was sitting behind those assertions the whole time. A suite with a red test in it cannot tell anyone they broke something, and this is what that costs.

  ```bash
  npm run test:e2e:document-references
  ```

### A Break Belongs Before The Block It Moves

- `Real Bug 1 Is Closed`: the oldest open fault - changing the bottom margin left text sitting in the margin band, 101 lines of it - was the same fault as the list one, in a second shape. `collectLines` adds a line for every `img, video, iframe, canvas, svg`, whose source is the element rather than a text node, and that branch of `positionAtLineStart` returned `posAtDOM(element, 0)`: a position **inside** the image node. A spacer anchored there is rendered inside the node view's own content, has no height, and moves nothing.
- `What The Engine Saw`: it chose to push a 230px figure to the next column, applied a 598px spacer, re-measured, and found the figure exactly where it had been - same line, same top, to the pixel. The next anchor was no further on than the last, so the solve stopped rather than spin. Everything below that point was never paginated. The page break that a writer would then add, further down, was never reached; that is why this looked like three unrelated bugs.
- `The Rule`: a break anchors before the block it moves, never inside it. Both element lines and text lines go through it now, and it walks out of every list structure the line also begins. See [adr/0016](../AGENT/adr/0016-a-break-anchors-before-the-block-it-moves.md).
- `Test script`: `block-pagination.cdp.mjs`, 11 checks - own fixture, no stored document. Case C is prose with a 300px figure in it, measured at four different bottom margins because which margin puts a figure across a boundary is a fact about the fixture rather than about the engine. Seen red first: the figure sat 97px past its column and stayed there at every margin.

  ```bash
  npm run test:e2e:block-pagination
  ```

### A List Longer Than A Page Is Paginated All The Way Down

- `The Break Was The Symptom`: the report was that a page break added on the second page of a long numbered list did nothing. It did nothing because **the solve had already given up**, several breaks earlier - everything below the first break inside a list had stopped being paginated, and the list simply ran off the sheet.
- `Why It Gave Up`: `posAtDOM` on a text node inside a list item's node view returns the position *before* the paragraph rather than inside it. That is not a text block start, so the anchor was left as it was and the spacer landed inside the item. A list item's marker is drawn beside its content rather than in it, so the text moved down and the marker did not - and the marker is a text node the engine counts as a line. That line could never move, so the same line overflowed every round, the next anchor was never past the previous one, and the loop stopped rather than spin.
- `A Break Belongs Before Everything It Begins`: the anchor now walks out of every list structure whose start it shares - out of the paragraph, out of the item, and out of the list when it is the first item. The marker travels with its text, and the solve gets past it.
- `Test script`: `block-pagination.cdp.mjs` (cases A and B), own fixture of forty items, and what is asserted is that no line of text sits below the bottom of its column, read from the engine's own geometry so the test cannot drift from it. Seen red first: three checks failed on the unpatched build, the document staying at three sheets when a break was added and item 30's text running 26px past its column.

  ```bash
  npm run test:e2e:block-pagination
  ```

### Numbering Continues, Whatever Is In Between

- `One Rule`: the number a list continues at is the last number at its own indent level, plus one. That is the whole of it. It does not ask what sits between the two lists - a paragraph, a table, a figure, a page break or a whole new chapter makes no difference, because none of those is a number at that level. The old rule looked for an ordered list that was a sibling of this one under the same parent, so the ordinary case in a thesis (a list, some prose, a figure, the list resumes) could not continue at all.
- `Every Level Counts As The Reader Sees It`: a numbered list inside a bullet list is indented once, the same as one inside a numbered list, so both are level 1 and share one count. A nested list continues from the nested numbers above it and never from the level above.
- `Both Actions Are Always Offered`: `Continue Numbering` and `Reset Counter` used to be greyed out whenever they would change nothing, which hid the one the writer wanted most of the time and gave no reason for it. They are always there now. A click that would change nothing still dispatches nothing, so the document is not marked unsaved for it - the no-op belongs in the command, not in the menu.
- `The Menu Says Where It Is`: the panel opens with `Indent level: N`, and `Continue Numbering` carries the number it would give - `Continue Numbering (3)`. The menu was also a column 100px wide, which cut every label in it; it is 260px now.
- `Indenting Asks The List The Item Is In`: it used to ask `editor.isActive('orderedList')` first, which is true for anything with an ordered list anywhere above it - a bullet list nested inside one included. It then ran the ordered-list command, which refuses a parent that is not an ordered list, and Tab did nothing at all. Measured on `1. Satu` with two bullets under it: indenting the second bullet, which has a sibling right above it to nest under, silently failed. The item's own context says which list it is in and which kind of item it is, so there is nothing left to guess.
- `The Panel Indents Too`: `Increase Indent` and `Decrease Indent` sit beside the level they change. Indenting moves the item into a different list and takes its node view with it, so the panel vanished on the first press; the item now asks for the menu at its new position and whichever node view lands there opens it, and the level in the panel updates as it goes.
- `Any Item Can Be Indented`: the first item of a list could not be indented at all, because indenting means nesting under the item above and there is none - so `a.` and `b.` could not be put under a `3.` that began its own list, and the button greyed out. A list may hold a list directly now, so indenting has three shapes and they are three cases of one idea: an item above means nest under it, a list above means join it, nothing above means become a list of one. The last two are one transform - `wrap` then `join` - and outdenting is `lift` into the list above, which returns the document to exactly what it was. See [adr/0014](../AGENT/adr/0014-a-list-may-hold-a-list.md).
- `An Empty Level Prints No Number`: `<ol><ol><li>` has a level 0 with no item in it. The composed marker shows only the levels that have one, so the item reads `1.` at its own level instead of claiming a parent number that does not exist. An empty parent item was rejected for the opposite reason: it would have put a number on the page that nobody typed, and consumed an ordinal, making every item after it one too high.
- `A Child Index Is No Longer An Item Ordinal`: a nested list is a child too, so the three places that counted children to get a number count items instead - an item's own marker, the segments above it, and the scan for the last number at a level. Splitting a list still wants the raw index and keeps it.
- `The Step Had To Be Drawn`: a nested list normally gets its offset for free from the marker column of the item holding it. With no item above there is no marker, so a list held by a list carries `padding-left` of its own, set to the marker plus its gap and measured against the classic shape - 25px against 26px. `--pdoc-list-nested-indent` overrides it.
- `Resetting A Count No Longer Rewrites A Sub-List`: choosing `Reset Counter` on item 4 turned `2.a` and `2.b` into `2.1` and `2.2`. Every start-value command walked the list and rewrote the `listType` of each list nested inside it, which nobody asked for - the writer was pointing at a level the change never mentioned. That walk is gone; a command asked to set a start sets a start. Changing numerals has its own route, `Number Type`, which touches the one list the cursor is in.
- `The Writer Owns What A Marker Says`: `2.a.` could not be made to read `a.`, and a marker that reads `a.` could not be made to compose the level above with its own. A list carries a numbering template now: `{number}` is its own value in its own numerals, `{parent}` is the marker of the level above already rendered by its template. The default `{parent}{number}.` is exactly what markers read before, `{number}.` gives `a.`, `{parent} {number}` gives `2. a`, and an empty template gives a marker that shows nothing - the same freedom the page number template has. It sits in the marker panel as `Numbering Template`, with the item's own marker previewed as it is typed.
- `Test script`: `list-numbering.cdp.mjs`, 47 checks in ten cases - own fixture, the marker menu opened by clicking the marker as a writer does, and what is asserted is the marker text a reader sees rather than the attribute behind it. Case C is the reported case itself: an item with sub-bullets, a paragraph with no numbering, then carrying on at 3. Cases E to H cover indenting - the nested bullet that could not be indented, the panel's own buttons, the first item of a list, and whether the two nesting shapes sit at the same indentation. Case I is the reported reset, seen red first with the removed walk put back in full: `2.a.` and `2.b.` became `2.1.` and `2.2.` exactly as reported.

  ```bash
  npm run test:e2e:list-numbering
  ```

### A Word In A List Is Not Cut In Half

- `One Declaration`: `.pdoc-list-item` carried `word-break: break-all`, which breaks between any two characters rather than only when a word cannot fit a line by itself. Prose under bullets and numbering came out cut mid-word - `latensi` as `la` and `tensi` - while the same prose in an ordinary paragraph was fine. It is gone.
- `Overflow Was Never The Reason`: `.pdoc-editor` already sets `overflow-wrap: anywhere`, which is inherited and breaks a token genuinely too long for the line and nothing else, and `min-width: 0` is what stops a long token pushing the flex row wide. Nothing was holding the layout together that needed a word cut.
- `It Also Put Word Wrap Out Of Reach`: the `wordWrap` extension emits nothing for its `normal` default, so an inherited `break-all` could not be turned off from the toolbar at all. List text answers to the Word Wrap control now, and `break-all` is available there for anyone who wants it.
- `Test script`: `list-word-break.cdp.mjs`, 26 checks - own fixture, every word measured through the rectangles of a Range over it, across all five alignments, with a plain paragraph of the same prose as the control. Seen red first: 11 checks failed on the unpatched build, cutting the same words the report named.

  ```bash
  npm run test:e2e:list-word-break
  ```

### A Page Break Carries A Whole Numbering Section

- `Every Setting, Not Two`: `At this page break` offered the count and the numerals. It offers the position, the chapter first page and a template of its own as well. Nothing had been stopping them: the break node already carried the fields and the engine already resolved all of them per section, so the capability had been sitting unreachable behind a panel that showed two of it. Only the chapter first page needed the model extending; the other two needed a control.
- `A Template Has Three States`: Follow the section before, or use one of its own - which may be empty. An input alone cannot say the difference between inherit and show-nothing, so the choice is explicit.
- `An Empty Template Prints Nothing And Keeps Counting`: Leave the template empty and those pages carry no number, while the pages after them come back with the numbers they would have had. It hides a folio rather than resetting a count, and the physical page the contents and PDF navigation read is untouched. The same freedom applies to the document's own template.
- `Test script`: `page-numbering.test.mjs` grew six checks, and `page-number-section.cdp.mjs` adds 12 - own fixture, opening the panel by pressing the Page tab and then the button, and measuring the drawn numbers move. It closes the debt item that said this panel was covered only by a throwaway probe.

  ```bash
  npm run test:e2e:page-number-section
  ```

- `Details`: See [A Page Break Carries A Whole Numbering Section](./details/page-break-sections.md).

### A Block Can Be Moved Between Two Profiles Of The Same Kind

- `The Click Handler Threw Before It Applied Anything`: Choosing a profile called `setParagraph()` on a block that was already a paragraph, which runs `clearNodes` over the selection and, at the end of a document, reaches the footnotes node and raises `Invalid content for node type footnotes`. The exception left the handler before the profile was applied, so a second block would not take a profile however many times its card was clicked, while the first usually would - a short document does not reach the trailing node. The type is only changed when it differs now, and applying the profile is outside the `try`.
- `An Indent Stored As A Length Was Never Emitted`: `Normal` held its first line indent as the string `2em`, and the generator read that field as a level number - `Number('2em')` is `NaN` - so no `text-indent` rule was written at all. `Normal` had no indent on screen, and moving a block to and from another paragraph profile looked exactly like nothing happening. A bare number is a level now, anything else is a length used as it stands.
- `Numbering Off Is Not The Same As Unusable`: A profile with numbering turned off dimmed its whole card to 0.7 opacity beside numbered profiles at 1, so the user's own paragraph profiles both looked unavailable. Body text is the ordinary case for numbering off. The subtitle still reads `(OFF)` - the fact survives - but only `Page Number` and `Table of Contents`, which genuinely cannot be applied to a block, stay dimmed.
- `A Paragraph Profile Has No Heading Level`: `addNumberingProfile` wrote `level: 1` onto every profile it created, including paragraph ones. It only writes a level for a heading now.
- `Every Profile Is In The Bar, And The Bar Scrolls`: The bar showed four cards and the rest sat behind the dropdown, so a profile in constant use could be out of sight. It holds every profile now, in a strip that scrolls sideways on plain CSS overflow, so wherever it is left scrolled is where it stays. The dropdown button was the width of its own 12px icon beside 68px cards and is 32px now, and the strip stops before it rather than running underneath. Measured: shift with the wheel scrolls it, a sideways wheel or trackpad gesture scrolls it, and there is a scrollbar to drag - but a plain vertical wheel does not.
- `A Profile Applies To Every Selected Block`: A profile applies to a block, and a block is a node of one of four types - paragraph, heading, image, table - wherever it sits. Not "a direct child of the document": a paragraph inside a table cell is a paragraph like any other, which is why the saved file carries the class on the `p` and not on the cell. Selecting several blocks and choosing a profile now styles all of them, including every cell of a table, where before only the block under the cursor was touched. The selection is read as ranges rather than as a start and an end, because a cell selection is several disjoint ranges. With a plain cursor, nothing changes.
- `Test script`: `profile-switch.cdp.mjs`, 32 checks in five cases, own fixture built from the user's real profile shapes, cards clicked with real mouse input, and the third case is the reported sequence itself - empty document, type, click, Enter, type, click. All three faults were put back and measured: 0px in both directions, 0.7 opacity against 1, and the second block stuck at 32px with the RangeError.

  ```bash
  npm run test:e2e:profile-switch
  ```

- `Details`: See [A Block Can Be Moved Between Two Profiles Of The Same Kind](./details/profile-switching.md).

### A Markdown Block Keeps Its Markdown

- `No Chrome`: A markdown block carries no label, no toolbar and no panel. At rest it is indistinguishable from the blocks around it, because nothing may occupy a line of the page that the writer did not write. Which mode a block is in is shown by an icon on its handle, the floating panel that appears on hover.
- `The Source Shows Because The Cursor Is There`: Put the cursor in a markdown block and it shows its markdown; move away and it shows the render again. No button. The swap is a view change and never a content change - swapping content on focus would make every cursor movement a transaction, mark the document changed with nothing typed, and fill the undo stack with steps nobody took. Expect the document to repaginate while a block's markdown is being edited, since the two states are different heights.
- `Change To Markdown, Change To WYSIWYG`: In the handle menu and in Home. Converting in takes the block's text as the source, so a paragraph reading `## Judul` that was typed as markdown by hand now renders. Converting out keeps the rendered content and drops the source. A block with no text, such as an image or a chart, is refused rather than quietly emptied. There is no `Insert > Markdown`: markdown is a mode a block is in, not a thing you insert.
- `The Source Is Stored, Not Consumed`: `Insert > Markdown` adds a block whose Markdown is kept in the document file exactly as it was typed, in a `pre` carrying `data-markdown-source`. The block renders automatically and a panel on it switches between `Rendered` and `Source`. Per block, so one document can be written partly in Markdown and partly in the editor. `Markdown > Render` still exists and still discards the source; this is the way to write Markdown you intend to keep.
- `The Render Is Real Content`: Not a box the view draws. Built as an atom, pagination cannot break inside it - `posAtDOM` maps every line to the node's own position, the solve stops, and everything after the block stops being paginated. Measured by building it both ways: 7 of 7 page breaks land inside the block as real content against 0 of 1 as an atom, and 0 lines outside their column against 45. It is also why a heading written in Markdown reaches the contents, is numbered, and is styled by the document's profiles.
- `One Editing Surface`: The rendered half is not typeable; the block is changed through its source panel. Two ways to change one block is how a stored value and its rendering drift apart with nothing to notice, which this project has paid for twice. The cost is that making one word bold means typing asterisks.
- `Math Is The Editor's Own`: `$...$` and `$$...$$` become `inline-math` and `block-math` nodes, drawn by the KaTeX the rest of the document already uses - one math renderer, not two. `It costs $ 20 and then $ 30 more` is not a formula, and an unterminated `$$` stays as typed instead of swallowing the rest of the document.
- `A Hand-Edited File Is Repaired From Its Source`: The source wins, so opening a document rebuilds any block whose rendering no longer matches it. The comparison ignores everything other extensions write onto a node after insertion - a freshly inserted `# Judul` came back carrying fourteen attributes where the Markdown had set one. Without that, opening a document would have rewritten every Markdown block and stripped the reference ids and numbering of everything inside them.
- `The Source Came Out One Narrow Column`: `.pdoc-node-view` is a flex container, so a child with no width shrinks to fit, and a textarea's content width is its `cols` attribute - 20 characters. The source opened about 160px wide against a 553px render, so a click opened it and the next click, landing outside the narrow box, closed it again, over and over. The flex sizing is pinned now, and the click that selects the block takes the event so the editor does not clear the selection a moment after it is set.
- `The Markdown Icon Is A Button`: Clicking into a block was not a reliable enough way to reach its source - setting a node selection makes ProseMirror focus its own DOM, which could land after the source had been focused, leaving the block open but unable to take a keystroke. Pressing the icon on the block's handle opens that block's source and puts the cursor in it. It holds for five seconds as a safety net; the moment the cursor actually lands the hold is cancelled and the ordinary rule takes over, so the source closes when the cursor leaves.
- `Markdown Styling Is Its Own Group`: `Home > Markdown Styles`, separate from the block style profiles and not in that list. A section for each kind of thing markdown produces - normal paragraph, headings 1 to 6, bullet list, numbered list, list item, inline math, block math - each with font family, size, weight, line height, top and bottom margin, alignment and first line indent, plus a nesting indent on the lists. Everything empty by default, so until a value is given markdown renders as markdown. Measured on the render: h1 53px against h2 27px, a paragraph at 15px with a 44px top margin and a 29px first line indent, inline math 40px, block math 56px top margin, a top level list at 0px and its nested list at 70px, and an ordinary heading outside the block unmoved at 19px.
- `Nesting Indent Starts At The Margin`: A top level markdown list sits where the paragraphs around it sit, not at the browser's own inset, and each level below adds one step.
- `Adding A Setting Later Is One Row`: `src/utils/markdown-styles.js` holds two tables - the sections and the fields - and the generator, the defaults and the dialog are all built from them. A new setting is one row naming its CSS property; a new section is one row naming its selector. A field marked block-only is not offered for inline sections, so an inline formula is never given a margin the browser would ignore.
- `A Markdown Heading Is Not Labelled`: `# Judul` renders as "Judul", never "BAB II Judul". It is still a heading, so the contents lists it, but it carries no label and consumes no number - two ordinary chapters with a markdown heading between them stay `BAB I` and `BAB II`. Content inside a markdown block takes no part in the per-block profile system, which is what keeps `numberingProfileId` to one writer.
- `The Style Fields Could Not Be Typed Into`: A TDesign input given a `value` prop is controlled - it renders that prop and nothing else - and the prop was only updated on `change`, which fires on blur. Every keystroke was overwritten as it was made, so the fields looked as if the keyboard was being ignored. They hold their own text now and commit when the field is left.
- `Test script`: `markdown-block.cdp.mjs`, 71 checks, own fixture throughout, including the conversion routes driven by real mouse input through the block handle. The pagination case was run against the rejected design and went red exactly where it should. Plus `markdown.test.mjs`, 9 unit checks, whose math assertions were seen red against the previous renderer.

  ```bash
  npm run test:e2e:markdown-block
  npm run test:unit:markdown
  ```

- `Details`: See [A Markdown Block Keeps Its Markdown](./details/markdown-block.md).

### The Profiles List Chooses; The Edit Dialog Sets

- `The Numbering Switch Left The List`: Every row in the Profiles dialog carried one, so a profile's numbering could be turned on or off from a list whose purpose is choosing which profile to open - the setting changed without the profile ever being looked at. The edit dialog already had the same switch, beside every other decision the profile makes, and it is now the only one.
- `The State Is Still Visible`: A profile with numbering off says `numbering off` in its details line, beside the target type, style and template already there. Removing a control should not remove the fact.
- `Test script`: `profiles-dialog.cdp.mjs`, 7 checks, own fixture, driven by real clicks through the block gallery arrow and the Manage Profiles bar. The edit dialog's switch is checked against the profile's actual state rather than against a label, because a switch that reflects nothing would pass a label check. Seen to fail on the unpatched build first.

  ```bash
  npm run test:e2e:profiles-dialog
  ```

- `Details`: See [The Profiles List Chooses; The Edit Dialog Sets](./details/profiles-dialog-chooses.md).

### The Table of Contents Points At A Real Page

- `Every Entry Said 1`: `getPageNumber` counted `.pdoc-page-node` elements and took the heading's index among them. Since ADR 0002 made pagination a set of decorations there is one such element for the whole canvas - a sheet is a region of one tall element, not an element - so every heading resolved to the same node and every entry fell back to 1. Wrong on any document longer than a page, and wrong since the pagination rewrite.
- `One Computation, Read By Both`: The engine already knows the sheet pitch, and `computePageNumbers` already turns a sheet into what the reader sees. The contents reads that now instead of computing a second answer. The driver publishes `pages` and `stride` on every solve and exports `pageOfElement`.
- `Published Even When Numbers Are Off`: The page a heading is on is a fact about the document. With numbering off an entry shows the physical page, because a contents entry has to point somewhere.
- `The Contents Is Told When Pages Move`: The driver emits `paginationChanged`. A page number changes without the document changing - a margin edit, a new page size, a page break inserted earlier - and nothing else would tell the view. Same fix, same reason, as `profilesChanged`.
- `Located By Its First Line, Not Its Box`: Measured on the fixture, the second chapter's box top is 2208px and its text is at 2377px with a sheet pitch of 1138px - the box on one sheet, the text on the next. A break's spacer can be anchored inside the block that follows it, and being a full-width block its rect comes back first. Text nodes only, and then the contents agrees with what the engine computes.
- `Entries Carry The Heading Number`: "BAB I Pendahuluan", not "Pendahuluan". Read from the rendered decoration, so the contents cannot disagree with the heading it points at. A template with a newline is collapsed to one line.
- `No Tree Lines, And Indentation Is A Setting`: The contents was a `t-tree`, which drew connector lines, an expand arrow, a hover tooltip and an indent of its own - none of it reachable. It is a flat list of rows now, and indentation is two fields on a new `Table of Contents` profile: which heading level indenting starts at, and how much each level after that adds. `0` gives a flat list.
- `Page Numbers Stay In One Column`: Indentation is padding on the row and the number is a fixed track at the right edge, so the number ends on the same edge whatever the indent. The row is `box-sizing: border-box`, without which the padding overhangs the container by exactly the indent and drags the number with it - measured at 1072px against 1044px before the fix.
- `Non-Block Profiles Are Shown, Greyed, And Say Why`: The gallery listed every profile, so clicking `Page Number` or `Table of Contents` stamped it onto whatever block the cursor was in - measured, the paragraph came away carrying `profile-toc`. Hiding them was the first attempt and was wrong the other way: the user looked for the contents profile in the one list that shows profiles and found a gap. They are listed, greyed and unclickable now, with `Only for Table of Content / Document Map` and `Only for page numbers` as hints. One guard covers both card lists and the dialog's `Apply to Active Block`.
- `A Built-In Profile Stopped Disappearing`: The `Table of Contents` profile was added as a built-in and could not be found, because opening a document replaced the profile list outright with whatever that document was saved with - and a document written before the profile existed does not mention it. `onCreate` merged; `setNumberingConfig` did not. Both go through `withBuiltInProfiles` now, and a saved list keeps every edit the user made.
- `A Map Says Which Contents Profile It Uses`: More than one can exist - a table of contents indented, a list of figures flat. The map carries a `profileId`, and the rule is: the profile it names, else the built-in that the picker calls Default, else any contents profile. A map naming a deleted profile falls back and keeps the name, so restoring the profile restores the map.
- `The Picker Is On The Map`: A document map is an atom whose rows are a view, so there is no text in it to select and no cursor to put inside it - the usual route of standing in a block and choosing a style is closed. Select the map and the bubble menu offers `Style`, listing Default and every other contents profile by name.
- `A Read That Wrote, And Hung The Editor`: Every Tiptap command dispatches its transaction whether or not it changed anything. `getNumberingProfiles` only reads a list and dispatched anyway, and the picker read it from a `computed` - so read, dispatch, state changes, read again. Measured at 9176 transactions in 2.5 seconds with the picker on screen, which froze the whole application, including menus that had nothing to do with it. The read commands set `preventDispatch` now, and the picker reads storage directly rather than going through a command at all.
- `Test script`: `toc-page-numbers.cdp.mjs`, 43 checks, own fixture with a forced page break, a numbering restart in lower roman, four indent settings measured on the rendered rows, an older document's profile list, and a second contents profile applied and then deleted. Plus `toc-indent.test.mjs`, 16 unit checks. Seen to fail on the unpatched build first - 16 of 24 on the first round, both discovery behaviours red when reverted one at a time, and the transaction count at 9176 with the dispatch put back - and to pass after.

  ```bash
  npm run test:e2e:toc
  ```

- `Details`: See [The Table of Contents Points at a Real Page](./details/table-of-contents-page-numbers.md).

### A Profile's Top Margin Works, And The Margin Panel Shows It

- `Top Margin Was Outranked, Not Ignored`: The rule was emitted correctly and lost in the cascade. `.pdoc-editor-content .pdoc-editor > * + *:not(.pdoc-floating-node)` scores three classes against a profile rule's two, and sets `margin-top` to a variable that resolves to `0`, so a profile's Top Margin was zeroed at every value. Measured in Chrome, not inferred.
- `Why Bottom Margin Worked All Along`: Nothing competes for `margin-bottom`. The container reset sets `margin: 0` on both, but at one class and one element it loses to a profile - so one half of the same field worked and the other did nothing.
- `The Gap Is A Default And Now Says So`: That rule is wrapped in `:where()` and scores nothing, so a profile that states a top margin wins and a block without one still takes the gap. Nothing moves on screen today, since the variable is `0`.
- `The Margin Panel Knew Only About Overrides`: It read `node.attrs.margin` alone. Since a profile became a CSS class, a block styled only by its profile carries no margin attribute, so the panel opened blank on a block that plainly had spacing.
- `The Panel Shows The Profile As The Placeholder`: `profile: 5em` under an empty field. Placeholder and not value on purpose - the field means "an override this block carries", and seeding it would make the next keystroke write a per-block override nobody asked for. With an override set, the override is the value and the profile stays visible underneath. The Bottom Margin presets highlight against the effective value.
- `Test script`: `profile-margins.cdp.mjs`, 13 checks, own fixture. It measures computed pixels at two different `em` values, checks a block with no profile top margin still takes the default, and opens the real panel by pressing its own arrow handle. Seen to fail on the unpatched build first - 5 of 13 red - and to pass after.

  ```bash
  npm run test:e2e:profile-margins
  ```

- `Details`: See [A Profile's Top Margin, and What the Margin Panel Shows](./details/profile-top-margin-and-margin-panel.md).

### Tables Carry No Text The User Did Not Write

- `The Composed Caption Is Gone`: A table rendered a `<caption>` holding the numbering profile's label pasted in front of the stored caption, so it read "Tabel 1: Ringkasan". The label half was not the user's text and the element was not editable in place, so it could be neither corrected nor removed from the page.
- `The Extra Row Fixed`: The table schema accepts only rows and nothing parses `<caption>`, so opening a saved document made ProseMirror wrap that text into a row of its own. A second path made it compound: a table with no caption wrote an empty `data-caption`, and the parse fell back to the caption element's text, promoting the automatic label into a caption the user was deemed to have written. Every save and load added one more row.
- `Old Documents Neutralised`: The table's parse rules now ignore `<caption>` outright, so a document already carrying one loses it instead of growing a row. The caption text in those documents is dropped, not converted - a caption that was really typed has to be typed again as an ordinary block.
- `Reference Identity Kept`: The table still carries its reference id, label and number, so a cross-reference to a table still finds it and still reads "Table 1".
- `Caption Dialog Is For Figures`: `Insert > Caption` is disabled with a table selected and the command refuses one, so a caption cannot be stored where nothing would render it. A table caption is written as a block above or below the table, styled and numbered by a profile, which is what `Tabel {h1}.{number}` was already for.
- `Test script`: `table-caption-removal.cdp.mjs`, 21 checks, own fixture. It measures the rendered table - row count, cell text, and every text node inside the table that is not in a cell - across three save and load round trips, then opens a document in the old format and requires the caption to disappear rather than become a row. Seen to fail on the unpatched build first - 19 of 21 red, the table growing to three, four and five rows across the round trips - and to pass after.

  ```bash
  npm run test:e2e:table-caption
  ```

- `Details`: See [Tables Carry No Text The User Did Not Write](./details/table-caption-removed.md).

### Readable Documents, Encryption Gone For Good

- `Encryption Removed Entirely`: All twelve stored documents were converted to folders, and the `.enc` files, the archive reader and `crypto-utils.js` were deleted. Nothing encrypts or decrypts any more. `migrate-legacy.mjs` performed the conversion and is kept for reference.
- `Readable HTML`: `document.html` was one line of 16,900 characters. It is now laid out one block per line with nesting indented. Only the gaps *between* block elements are touched: whitespace inside a text block is content, and `<pre>` is copied byte for byte.
- `Verified Not To Change The Document`: The formatted HTML parses to a byte-identical document - same node count, same text, same JSON. Formatting is idempotent, so a file that is formatted twice does not accumulate whitespace.
- `Test script`: `format-html.test.mjs` covers inline markup, code blocks, attributes containing newlines, void elements and idempotency.

### Document Storage: Plain Folders, Images Kept

- `Images Are Actually Saved`: Media was stored as `blob:` URLs, which are handles to one browser tab's memory. A document recorded an image's name and size and not one byte of it, and looked fine until the tab closed. Images are now written to disk beside the document.
- `A Document Is A Folder`: `document.html`, `settings.json`, `assets/` and `checksums.txt`. Every part can be read and edited with ordinary tools.
- `Relative Paths Are Real`: An image is referenced as `./assets/gambar1.1.png`, so opening `document.html` straight from its folder in a browser renders it with no server involved.
- `Encryption Removed`: It provided no confidentiality - an unencrypted copy was written beside every encrypted file, and the key was hardcoded in the source. What it did provide was integrity, now covered by `checksums.txt` in `sha256sum` format, verifiable with the standard tool.
- `Original Bytes`: No base64, no re-encoding, no renaming to a hash. Checksums decide whether a file needs rewriting, so an unchanged image survives autosave untouched.
- `Legacy Images Rescued`: A document carrying blob URLs from an older session has its bytes read back and stored properly on the next save, while that tab is still open.
- `Older Files Keep Opening`: `.enc` documents still load and convert on the next save. Incomplete stored page settings are filled from the settings in effect instead of failing validation, which also fixes documents that could never be opened at all.
- `Test script`: `document-assets.cdp.mjs` saves an image in one tab, closes it, and reads the bytes back in another, then opens the stored file from disk.

  ```bash
  npm run test:e2e:document-assets
  ```

- `Details`: See [Document Storage: Plain Folders](./details/document-storage-folders.md).

### Profiles: Chapter-Relative Numbering and Top Margin

- `Counted By Profile, Not By Node Type`: A caption is an ordinary paragraph carrying the figure profile, but the number came from the paragraph sequence while the template came from the figure profile, so the sixth paragraph rendered as "Gambar 6". Each profile now owns its own sequence.
- `Chapter-Relative Templates`: Templates accept `{h1}` through `{h6}`, the number of the enclosing heading at that level. `Gambar {h1}.{number}` gives "Gambar 1.1". Naming a heading level also restarts that profile's count whenever the heading changes, so the scope is declared by the template itself rather than by a separate setting. Available to every profile, not only figures.
- `Heading Style Does Not Leak Into Placeholders`: `{h1}` is always plain digits, so a chapter displayed as "BAB I" still yields "Gambar 1.1".
- `Images Are Containers, Not Numbered Blocks`: The image node no longer takes a number; the caption block the user applies a profile to does, exactly like a heading. The profile id automatically attached to image nodes in older documents is cleared on sync.
- `Duplicate Figure Label Fixed`: The label was rendered twice on images, once by a ProseMirror widget and once by a CSS `::before` on the same figcaption, printing "Gambar 1Gambar 1". The widget no longer covers images.
- `Top Margin In Profiles`: Profiles gained a Top Margin field alongside Bottom Margin, applied through the same paths: continuous sync, profile creation, profile editing, and applying a profile to a block.
- `Renamed`: "Numbering Profiles" is now "Profiles", and the template field carries a hint describing the placeholders.

### Page Breaks Now Match Export to PDF

- `Widows and Orphans Honoured`: On-screen page breaks drifted against the exported PDF by one line per sheet, cumulatively. The cause was not geometry - both use the same text column - but `widows` and `orphans`, whose initial value in Chrome is 2. Print refuses to strand a single line at the top of a page or leave one behind at the bottom; the engine did not care. It now reads the computed values of the block being broken and moves the break earlier when needed.
- `Verified Against A Real Export`: All six pages of a 10702-character thesis now match the exported PDF exactly, first line and line count. Rendering the same export document with `orphans: 1; widows: 1` reproduces the old, drifting breaks, which is what identified the cause.
- `Lines Merged Before Breaking`: Line fragments split across text nodes by marks are merged into one line box, so a break can no longer land inside a rendered line.
- `Test script`: `pagination-pdf-parity.cdp.mjs` renders the export document to PDF and compares the first line of every page against the corresponding on-screen sheet. The geometry test cannot see this class of bug: keeping text out of the margin band is necessary but not sufficient. Removing the widow and orphan handling fails four of six pages here and nothing else notices.

  Start Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:e2e:pagination-pdf
  ```

- `Details`: See [Decoration-Based Pagination](./details/decoration-based-pagination.md).

### Visual Page View: Decoration-Based Pagination

- `Sheets On Screen`: The editor shows discrete sheets of paper. A long paragraph splits between its own text lines at the page boundary, and the band made of bottom margin, sheet gap and top margin holds no text. Measured on a 10702-character document: 0 of 183 text lines fall inside that band.
- `Bottom Margin Enforced`: Text no longer runs through the bottom margin into the next sheet, which was the visible symptom the previous engine never fixed.
- `ProseMirror Decorations`: Page breaks are `Decoration.widget` spacers rendered by the editor view. Nothing is injected into the contenteditable behind the view's back, document positions are untouched, and the spacers never reach the saved HTML, JSON or text.
- `Triggered, Not Observed`: Recomputation runs on document changes and on an explicit `refreshPagination()` command issued when page size, margins, orientation or zoom change. The engine never watches the DOM it writes to.
- `Margins Now Repaginate`: The page watcher was missing `margin`, so changing a margin left the old page breaks in place. It is included now.
- `Whole Sheets`: The canvas is padded out to a whole number of sheets, so the last sheet is drawn complete instead of ending wherever the text stops.
- `Print Unaffected`: Export builds its document from the live DOM and paginates through `@page`, so the screen spacers and the padded height are stripped before printing.
- `Known Limitation`: The line directly above a page break loses full justification, because a block-level spacer splits a justified paragraph into two anonymous blocks. Measured at 80-98% of column width on four of five breaks.
- `Test script`: `pagination-geometry.cdp.mjs` measures where text actually lands, plus editing, undo, margin changes, save-content purity and export purity. Fourteen checks.

  Start Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:e2e:pagination
  ```

- `Details`: See [Decoration-Based Pagination](./details/decoration-based-pagination.md).

### Pagination Engine Switched Off Pending Rebuild

- `Runaway Render Loop Stopped`: `updatePagination()` rewrote the same DOM that its own `MutationObserver` watched, so the two fed each other permanently - about 50 scheduled animation frames and 195 observer callbacks per second on an idle document. Measured idle frames are now 0.
- `Phantom Scroll Space Removed`: `updatePageZoomHeight()` sampled `clientHeight` in the same frame the engine had just inflated with `marginTop` pushes, leaving the scroll container 6299px tall around 4904px of content. Scrolling to the bottom landed in over a sheet of emptiness that the mouse wheel could not climb back out of. The container now matches its content, and scrolling returns to the top.
- `Misleading Sheet Bands Hidden`: with nothing enforcing the page boundary, 23 of 183 text lines sat inside the painted bottom-margin and sheet-gap band. The bands are suppressed while the engine is off rather than drawn across live text.
- `Code Kept`: the engine is skipped through a `paginationEngineEnabled` flag, not deleted. Its line-level geometry (`TreeWalker` plus `Range.getClientRects()`) is what the decoration-based engine will reuse.

### Autosave Blank-Document Guard

- `Blank Autosave Blocked`: Autosave no longer writes an empty document to `practicaldocs-server`. Because autosave saves under the currently loaded document title, a blank editor could previously overwrite the stored file under that name and destroy it.
- `Strict Blank Test`: A document counts as blank only when it holds no text **and** consists solely of `doc`, `paragraph`, `heading`, `text`, and `hardBreak` nodes. Images, tables, code blocks, and horizontal rules are treated as content and still autosave. `editor.isEmpty` is deliberately not used, since numbering-profile attributes make it report non-empty on documents that hold no text.
- `Autosave Re-Arms`: `contentUpdated` is cleared even when a blank save is skipped, so the next real edit schedules autosave again instead of leaving it dead for the session.
- `Manual Save Unchanged`: Ctrl+S and the toolbar save button still save a blank document on purpose. Only the unattended path is guarded.
- `Test script`: `autosave-blank-guard.cdp.mjs` records whether a save POST is actually issued and what it carries, intercepting every request so the storage server is never written to.

  Start Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:e2e:autosave-blank-guard
  ```

- `Details`: See [Autosave Blank-Document Guard](./details/autosave-blank-document-guard.md).

### Real-Browser E2E Audit & Comprehensive CDP Test Suite

- `Comprehensive CDP Audit`: `test-comprehensive-e2e.cdp.mjs`, `test-keystroke-typing.cdp.mjs`, `test-page-ruler.cdp.mjs`, & `test-visual-multipage.cdp.mjs` verify all user requirements in real Chrome:
  - **TEST 1**: Default title (`file-identifier`) and English UI audit.
  - **TEST 2**: Multi-file disk persistence (`a.enc` & `a.json` physical files).
  - **TEST 3**: Document load & computed DOM visual styling (font size, weight, line-height, text-align, margin-bottom, newline widget).
  - **TEST 4**: Incognito clean-state session & localStorage profile preservation.
  - **TEST 5**: Visual computed line-height, text-indent (`2em`), and New Document confirmation modal.
  - **TEST 6**: Page Settings custom margin-to-page ratios across A4, Letter, and A3 sizes.
  - **Keystroke Typing**: Real Chrome typing test verifying text is never deleted or reverted during typing.
  - **Multi-Page Pagination Audit**: Real Chrome audit verifying 0 text blocks overlap margin gaps in multi-page documents (e.g. `tesis3.json`).

  Start Chrome with remote debugging enabled, then run:

  ```bash
  node tests/e2e/test-comprehensive-e2e.cdp.mjs
  node tests/e2e/test-keystroke-typing.cdp.mjs
  node tests/e2e/test-page-ruler.cdp.mjs
  node tests/e2e/test-visual-multipage.cdp.mjs
  ```

### Encrypted Local Storage Server & Save Target Selector

- `Local Storage Server`: `practicaldocs-server` Node.js backend listening on port 3001 with AES-256-GCM authenticated encryption.
- `Save Target Selector`: Toolbar status popup allows choosing between **Save to Local Storage Server** and **Download Local File**.
- `Title Reactivity & Filename Resolution`: Document title changes dynamically update file save targets (e.g. title `"a"` resolves to `a.enc` and `a.json`).
- `Multi-File Persistence`: Atomic disk writes creating `.enc` encrypted payloads and `.json` metadata snapshots.
- `Details`: See [Encrypted Storage Server and Multi-File Save/Load Architecture](./details/storage-server-and-multi-file.md).

### Change Case

- `Selection Bar`: Three buttons - `UPPERCASE`, `lowercase`, `Capitalize` - change the case of the selected text and leave its marks alone.
- `Details`: See [Change Case](./details/text-case.md).

### Documents Are Opened, Never Restored

- `No Automatic Reopen`: Reloading the editor no longer reopens the last document from browser storage. It starts empty, and opening a document is always an explicit act through Buka / Load. Restoring it made every reload begin from state nobody could describe, and left a stale title over an empty document - the case the autosave guard exists to catch.

### Block Style Profiles & Styling Restoration

- `Per-Profile Styling`: Custom font family (Google Fonts auto-loader), font size, font weight, line height, bottom margin, first-line indent (`text-indent`), text align (`text-align`), and placement templates (`BAB {number}\n`).
- `Snapshot Profiles Persistence`: Fixed extension storage lookup (`getRefStorage`) so `snapshot.profiles` is 100% serialized into snapshot `.json` and `.enc` files.
- `Server Save Profiles Persistence`: `saveContent()` kept its own copy of the broken lookup, so every save to the storage server wrote `profiles: []` even after the snapshot path was fixed. It now uses `getRefStorage()` too, and `profile-save.cdp.mjs` measures the actual POST body so the regression cannot return unnoticed.
- `Toolbar Overrides Stick`: Line spacing and margins set from the toolbar now survive a sync, further typing, and a storage round trip, and applying a profile to the block clears them again. Verified end to end rather than inferred from the removal of the force-write.
- `Keystroke Typing Revert Fix`: Fixed margin string comparison preventing erroneous `setNodeMarkup()` calls on every keystroke.
- `Default Styling Attributes & Auto-Extraction`: Added out-of-the-box default styling attributes for all standard profiles (`Normal`, `H1`-`H6`) and auto-extraction from matching document nodes.
- `Modal Interaction & Feedback`: Modal auto-closes on save with instant success toast notification (`Profile saved successfully!`).
- `Backward Compatibility`: Full support for opening older document files without profile IDs or pre-attached attributes.
- `Details`: See [Block Style Profiles and Document Styling Restoration](./details/block-style-profiles-and-styling.md).
- `Profile Stylesheet & CSS Counter Numbering`: Profiles can now be generated as a CSS stylesheet with counters instead of inline styles repeated on every block, so a profile change is a rule change and a stored document renders its own numbering outside the editor. The editor now renders blocks by class from an injected per-editor stylesheet, and the sync no longer force-writes profile styling into node attributes, which is also the structural fix for toolbar line spacing and margins not sticking. A saved `document.html` now carries that stylesheet and renders its own numbering when opened straight from the folder; a heading dropped from 417 bytes to 118. Documents written by the old format are migrated on the next sync: an attribute or font mark that merely repeats its profile is dropped, one that differs is kept as the user's override. On the reference thesis this took 33 inline style attributes down to 2 and 58 derived numbering attributes to none, with rendering unchanged. `Details`: See [Profile Stylesheet and CSS Counter Numbering](./details/profile-stylesheet-and-css-numbering.md).

### Page Settings, Custom Margins, & Automatic Multi-Page Pagination

- `Page Numbers, On Screen`: Page numbers with sections anchored on page breaks - shown or hidden, positioned, formatted as roman/decimal/alphabetic, and able to restart or start at any value part way through the document. The physical page index stays 1..N so PDF navigation is unaffected. They reach the exported PDF too: for a numbered document the page margins become real blocks in the flow rather than invisible `@page` padding, which is the only way anything can be drawn in them. Controlled from `Page > Page Numbers`, and styled through the Profiles dialog like any other block. A page break ends a page and nothing else: it restarts the count only when told to, per break, so a document with a break at every chapter needs no numbering setup.
- `Manual Page Breaks On Screen`: A page break inserted by the user now starts a new sheet in the editor, not only in the export. Two causes: the pagination engine never read `break-before: page`, and the print stylesheet failed to zero the break element's margins because the base rule marked them `!important`, which pushed the first line of every page after a break down by 30px in the PDF only.

- `Automatic Pagination Engine`: Two-pass layout engine measuring block element bounds (`offsetTop`) and automatically pushing blocks extending past `pageEnd` to the top of the next page content area.
- `Visual Page Sheet Boundaries`: Dynamic `--pdoc-page-content-height` calculation, header zone boundary line, footer/page-numbering zone boundary line, and 16px sheet-separation gaps between pages.
- `Paper Size Retention`: Margin edits maintain standard paper sizes (A4, Letter, Legal, A3) without converting to Custom or zeroing out margins.
- `Margin Popup CSS Units`: Flexible `<t-input>` supporting any CSS length unit (`0.25em`, `4em`, `12px`, `10pt`, `1.5cm`, `0.5rem`, `0`).
- `English UI`: Translated Page Settings confirm/cancel buttons and status popup controls to English.
- `Details`: See [Page Settings and Custom Margins Preservation](./details/page-settings-and-margins.md).

### New Document Action with Security Confirmation

- `New Document Button`: Added New Document action with TDesign confirmation dialog (`useConfirm`) preventing accidental data loss.

---

### Render Markdown Changes

- `Render Markdown`: Adds a toolbar dropdown for explicit Markdown rendering.
  - `Current Block`: Renders only the active ProseMirror text block.
  - `Entire Document`: Renders all document text after a replacement warning.
- `Test script`: `render-markdown.cdp.mjs` verifies both render scopes and undo through CDP.

  Start the editor and Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:e2e:render-markdown
  ```

### JSON Document File Changes

- `Open JSON`: Validates and opens a `.umodoc.json` snapshot with unsaved-change confirmation and fresh undo history.
- `Save to JSON`: Downloads Tiptap content, the document title, and portable page settings as a versioned JSON snapshot.
- `Unsaved state`: Treats content, title, and saved page-setting changes as unsaved work until a save succeeds.
- `Media safety`: Warns before saving temporary `blob:` media URLs that cannot survive the browser session.
- `Public API`: Adds `getDocumentSnapshot()`, `openDocumentFile()`, and `saveDocumentFile()` to the editor instance.
- `Test scripts`: `document-file.test.mjs` verifies the file contract. `save-file.cdp.mjs` drove the browser workflow and was **removed** when the two toolbar buttons were, since it asserted on controls that no longer exist; it had also been failing on its own, expecting a download named from a title the application now rewrites.
- `Details`: See [JSON Document File Contract and Desktop Commands](./details/save-file.md).

### Automatic Numbering and Document Reference Changes

- `Heading numbering`: Adds automatic hierarchical numbers to headings.
- `Figure and table labels`: Adds independent automatic labels and editable captions.
- `Cross-reference`: Adds dynamic references that follow target renumbering and report deleted targets.
- `Citation`: Adds source-backed numeric citations using the existing footnote system.
- `JSON persistence`: Preserves stable IDs, numbers, captions, citations, and cross-references in `.umodoc.json` files.
- `Details`: See [Automatic Numbering and Document References](./details/document-references.md).
