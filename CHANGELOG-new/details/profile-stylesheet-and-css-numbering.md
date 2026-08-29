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

## Known gap

A document that starts at `h2` with no `h1` renders `0.1` under CSS counters where the editor shows `1`.
`getNextHeadingNumber` drops zero segments; CSS has no conditional. Not yet handled.

Still to do: profile font is still pushed into `textStyle` marks; the stored file does not yet carry
the generated `<style>` block or drop the derived numbering attributes; older documents are not yet
migrated off their inline styles.

Unrelated and pre-existing: `tests/e2e/document-references.cdp.mjs` fails at "Automatic reference labels
were not synchronized". Confirmed to fail identically on a clean tree with this work stashed.
