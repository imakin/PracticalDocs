# Autosave Blank-Document Guard

## The problem

Autosave writes to `practical-umodoc-server` under **the document title currently loaded in the
editor**, not under the name of whatever the user last deliberately saved. That makes an empty editor
dangerous: if the title still says `tesis3` while the editor holds nothing, the next autosave replaces
`tesis3.enc` with a blank document, and the stored copy is gone.

Two things made this easy to trigger:

1. `autoSave` is enabled by default at a 300000 ms interval (`src/options/config/index.js`).
2. The flag that arms autosave, `contentUpdated`, is set by the watcher in
   `src/components/index.vue` that tracks **page settings** - margin, paper size, orientation,
   watermark, title - not only editor content. Nudging a margin on an empty document is enough to
   schedule a save five minutes later.

So a user could open the editor, load a document that came back blank, adjust a margin, walk away, and
have the stored document silently overwritten with nothing.

## The guard

Autosave now refuses to write a blank document. The periodic callback checks the document first:

```js
autoSaveInterval = setInterval(() => {
  clearAutoSaveInterval()
  const blank = isDocumentBlank()
  // Reset first either way, so the next real edit can arm autosave again.
  contentUpdated = false
  if (blank) {
    return
  }
  saveContent()
}, autoSave.interval)
```

`contentUpdated` is cleared even when the save is skipped. Without that, the flag would stay `true`,
the watcher would never see a `false -> true` transition again, and autosave would stay dead for the
rest of the session.

## What counts as blank

The test is deliberately strict, because a false "blank" verdict would silently disable autosave for
real work. A document is blank only when **both** hold:

- `doc.textContent.trim()` is empty, and
- every node in the document is one of `doc`, `paragraph`, `heading`, `text`, `hardBreak`.

Anything else - an image, a table, a code block, a horizontal rule, an echart, a page break - counts as
content and is autosaved normally, even with no text in the document.

`editor.isEmpty` is not used. It compares the document against `doc.type.createAndFill()`, which
carries default attributes, so a paragraph that has picked up `indent`, `textAlign`, `lineHeight`, a
`referenceId` or a `numberingProfileId` reports as non-empty even when it holds no text at all. Every
document produced by this editor's numbering profiles is in exactly that state, which is why the
existing blank documents on the server would have slipped straight past an `isEmpty` check.

## What is deliberately not covered

Manual saving is untouched. Ctrl+S and the toolbar save button will still write a blank document,
because emptying a document and saving it on purpose is a legitimate thing to do and the user is
present to see it happen. Only the unattended path is guarded.

## Test

`tests/e2e/autosave-blank-guard.cdp.mjs` measures real behaviour: it records whether a POST to
`/api/documents/save` is actually issued and what content that POST carries. Every save request is
intercepted with `Fetch.fulfillRequest` and answered locally, so the test never writes to the storage
server. It opens a new tab in the existing browser window and closes only that tab.

| Case | Setup | Expected |
|---|---|---|
| A | Blank document, autosave armed by changing a page margin | no POST |
| B | Document with real text, autosave armed by typing | POST carrying the text |
| C | Document with text, emptied by the user, autosave armed | no POST |
| D | Typing real text after a skipped blank autosave | POST carrying the new text |
| E | No text but a horizontal rule present, armed by a margin change | POST |

Cases A and C fail on the unpatched build and pass with the guard; B, D and E pass in both directions,
which is what shows the guard is narrow rather than a blanket disable.

```bash
npm run test:e2e:autosave-blank-guard
```

Requires Chrome started with `--remote-debugging-port=9222` and the dev server on port 9000.
Screenshots are written to `tests/screenshots/autosave-blank-guard-*.png`.
