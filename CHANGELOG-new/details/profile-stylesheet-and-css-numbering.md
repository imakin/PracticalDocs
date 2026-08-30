# Profile Stylesheet and CSS Counter Numbering

## Goal

Turn a style profile from a **writer** into a **stylesheet**.

Until now `applyTargetUpdates` copied every profile field into each node's attributes, and `renderHTML`
turned those into an inline `style=`. A stored document therefore repeated the same handful of
declarations on every block, and a profile change had to walk the whole document to take effect. On the
reference thesis: 3421 bytes of inline style across 33 attributes, **8 distinct declarations**.

Numbering had the same shape. A heading's number lived only in `data-reference-label`, drawn by a
ProseMirror decoration, so opening the stored `document.html` in a plain browser showed "PENDAHULUAN"
with no "BAB I" and captions with no "Gambar 1.1". Measured, not assumed.

The target: a profile becomes one CSS rule, a block carries only its class, and numbering is expressed
with CSS counters. The author still never types a number, and the number stays derived - editing "BAB"
to "BEB" in the generated stylesheet renumbers every chapter with no editor involved.

## Landed in this change

`src/utils/profile-stylesheet.js`, a pure function from profiles to CSS text. Nothing consumes it yet;
node rendering, saving, and migration follow separately.

- `buildProfileStylesheet(profiles)` emits one rule per profile, plus a `::before` rule for each
  profile whose numbering is enabled.
- `{number}`, `{label}`, `{h1}`..`{h6}` are expanded into `counter()` terms. `{h1}` always reads plain
  digits, so a chapter shown as "BAB I" is still chapter 1 to a figure - matching `applyTemplate`.
- A level 1 heading shows its configured style (`upper-roman`, `lower-alpha`, ...); deeper levels read
  hierarchically as `1.2.1`, matching `getNextHeadingNumber`.
- A template naming a heading level restarts that profile at that heading, so the template still
  declares its own reset scope. `Gambar {h1}.{number}` restarts at every h1; `Tabel {number}` does not.
- A multiline template such as `BAB {number}\n` becomes a block `::before`; a single-line one stays
  inline with `margin-right: 0.4em`, mirroring `.umo-heading-number` in `editor.less` so the stored
  file and the editor place the number identically.

### Counter scope: measured, not assumed

The first render produced "Gambar 2.3" and "2.3 Dasar Teori" where chapter two should restart at 1.
Isolated in Chrome with a minimal case:

```
root counter-reset AND chapter counter-reset  ->  FIG-2.3   wrong
chapter counter-reset only                    ->  FIG-2.1   correct
```

A counter reset at the root creates an outer scope that wins the sibling lookup, so the chapter's
restart is ignored. The generator therefore seeds only counters that nothing else restarts; the rest are
created by the heading that owns them. Locked by a unit test, because this is invisible in the CSS text
and only shows up when rendered.

## Verification

- `tests/unit/profile-stylesheet.test.mjs`, 13 checks.
- Rendered in a real browser from the actual `tesis4` profiles and inspected visually: `BAB I` block
  above `PENDAHULUAN`, `1.1`/`1.2`/`1.2.1` headings, `Gambar 1.1` and `Gambar 1.2`, then `Gambar 2.1`
  and `2.1` after the second chapter, with `Tabel` running on across chapters as its template requires.

## Wired into the editor

The generator gained two options, and the editor became its first consumer.

- `scope` is the selector for the element holding the blocks. It carries the root counters and
  prefixes every rule, so one generator serves both the stored file (`.umo-document`) and the live
  editor without two sets of rules drifting apart.
- `numbering` selects whether the `::before` counter rules are emitted at all.

`document-references` now keeps one `<style>` element per editor in `document.head`, scoped by a
`data-umo-profile-styles` marker on that editor's own ProseMirror element, so two editors on one page
cannot restyle each other. It is refreshed on create and after every profile mutation, and removed on
destroy.

`renderHTML` for `numberingProfileId` now also emits the profile's class, and `applyTargetUpdates` no
longer copies `fontSize`, `fontWeight`, `lineHeight`, `fontFamily`, `margin.top`, `margin.bottom`,
`indent` or `textAlign` into node attributes - 8 writes, 2210 bytes of code removed. What remains in
those attributes is a genuine per-block override, and an inline style rightly beats the class. This is
also the structural fix for toolbar line spacing and margins not sticking: the sync no longer has
anything to overwrite.

### The editor keeps its decoration; only the file uses counters

Measured before deciding:

| path | source | number present |
|---|---|---|
| editor screen | live DOM plus decoration | yes |
| Export to PDF | `.umo-page-content` outerHTML, so the decoration travels | yes |
| stored `document.html` | `editor.getHTML()`, which has no decorations | **no** |

Only the stored file was wrong, so only the stored file gets counters. Two further reasons not to move
the editor onto counters: `collectLines` in the pagination engine walks text nodes, and generated
content produces none, so a block `::before` would be invisible to it and every page break would
shift; and the editor and the PDF already agree because both come from the live DOM.

Emitting the counter rules into the editor as well renders the number twice - "BAB I / BAB I". The
computed-style probe passed while the page was visibly wrong; only the screenshot caught it. Hence
`numbering: false` for the editor.

### Verification of this step

- Computed styles before and after the switch are identical on h1, h2 and a paragraph
  (`18.6667px` / `74.6667px` / center, `16px` / `8px`, `16px` / `4px` / justify / `32px` indent), with
  no inline `style` attribute left on any of them.
- `pagination-pdf-parity` still passes on the real thesis: 5 sheets, 5 PDF pages, every page break
  matching. Class-based styling reproduces the previous layout geometry exactly.
- `profile-save` and `autosave-blank-guard` pass. Unit suite 56 checks.

## The stored document

A saved `document.html` is now the generated stylesheet followed by the blocks inside the element the
stylesheet is scoped to:

```html
<style data-umo-profiles>
.umo-document { counter-reset: umo-count-profile-h1 umo-count-profile-table; }
.umo-document .umo-profile-h1 { margin-bottom: 4em; font-size: 14pt; ... }
.umo-document .umo-profile-h1::before { content: "BAB " counter(umo-count-profile-h1, upper-roman) "\A "; ... }
</style>
<div class="umo-document">
<h1 id="gr4oiwoyvw" data-toc-id="gr4oiwoyvw" data-reference-id="heading-mi3sxax885" class="umo-profile-h1">PENDAHULUAN</h1>
...
</div>
```

That heading was **417 bytes and is now 118**. Opened straight from the folder it renders with its own
fonts, spacing and numbering, which the previous format could not do at all.

- **The class is the profile**, so it is also how the profile is read back. `parseHTML` reads the class
  and falls back to `data-numbering-profile-id` for older files. An id the class cannot round-trip -
  every built-in and generated id can - keeps the attribute, or it would be lost on reload.
- **The derived numbering attributes are no longer written**: `data-reference-number`,
  `data-reference-label`, `data-number-style`, `data-number-template` and
  `data-numbering-profile-id`. All are recomputed on sync and, in the file, drawn by the counters.
  `data-reference-id` stays: it is identity, and a cross-reference points at it.
- `composeDocumentHtml` and `extractDocumentHtml` are a pair in one module so they cannot drift. The
  second exists because a stylesheet that reaches the parser is imported as a paragraph of CSS at the
  top of the user's document.

### Verification

`tests/e2e/document-stylesheet.cdp.mjs`, 12 checks, save requests intercepted so the storage server is
never written to. It asserts the saved payload opens with the stylesheet, wraps the blocks, carries
classes, carries no inline block style and none of the derived attributes but keeps
`data-reference-id`; then feeds that payload back and asserts the text survives, no CSS became document
text, the profile is recovered from the class alone, and the numbering is recomputed
(`["BAB I\n", "1.1"]`).

Regression after this step: unit 61 checks; `pagination-pdf-parity` 5 sheets and 5 PDF pages all
matching on the real thesis; `profile-save`, `autosave-blank-guard` and `document-assets` all pass.

## Marks, and migrating documents written by the old format

Two commands still wrote the profile into the document: `updateNumberingProfile` copied its styling
into every matching node and pushed the font onto an inner `textStyle` mark, and
`applyNumberingProfile` did the same for one block. Both are gone - 5461 bytes of code. A mark beats
the block's class, so leaving it would freeze the old font into the text.

`applyNumberingProfile` now **clears** per-block styling instead of writing it. Applying a profile
means "this block follows that profile", so any override the user had set is dropped and the rule
shows through. Writing the profile's values in would recreate the overrides this change exists to
remove.

Migration runs inside the ordinary sync, so a document written by the old format is cleaned the moment
it is opened. The rule: **an attribute that merely repeats its profile's value is a leftover, not an
override.** A value that differs is the user's and is kept. The same test applies to the font on
`textStyle` marks.

One subtlety cost a run: a font family round-trips through CSS as `"Times New Roman"` while a profile
stores it bare, so a plain string comparison read every migrated paragraph as a deliberate override.
`sameStyleValue` strips quotes and case before comparing.

### Measured on the real thesis

Feeding the previously stored `tesis4/document.html` through the editor:

```
                      before   after
bytes                  17251   12128
inline style attrs        33       2   <- both are figure alignment, not profile styling
spans repeating a font    15       0
derived numbering attrs   58       0
profile classes            0      16
data-reference-id         18      18   <- identity preserved
```

Rendering is unchanged: the paragraph still computes to `16px` Times New Roman, `32px` indent,
justified; the heading to `18.6667px`, centred, `74.6667px` bottom margin; numbering still reads
`BAB I`, `1.1`, `Gambar 1.1`, `Gambar 1.2`.

`document-stylesheet.cdp.mjs` gained Case C, 8 checks, which feeds a block written in the old format
through a sync and asserts the inline styles, the font spans and the derived attributes are all gone
while the text, the reference ids, the rendered styling and the numbering survive.

## Known gap

A document that starts at `h2` with no `h1` renders `0.1` under CSS counters where the editor shows `1`.
`getNextHeadingNumber` drops zero segments; CSS has no conditional. Not yet handled.

Unrelated and pre-existing: `tests/e2e/document-references.cdp.mjs` fails at "Automatic reference labels
were not synchronized". Confirmed to fail identically on a clean tree with this work stashed.
