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

- `Blank Autosave Blocked`: Autosave no longer writes an empty document to `practical-umodoc-server`. Because autosave saves under the currently loaded document title, a blank editor could previously overwrite the stored file under that name and destroy it.
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

- `Local Storage Server`: `practical-umodoc-server` Node.js backend listening on port 3001 with AES-256-GCM authenticated encryption.
- `Save Target Selector`: Toolbar status popup allows choosing between **Save to Local Storage Server** and **Download Local File**.
- `Title Reactivity & Filename Resolution`: Document title changes dynamically update file save targets (e.g. title `"a"` resolves to `a.enc` and `a.json`).
- `Multi-File Persistence`: Atomic disk writes creating `.enc` encrypted payloads and `.json` metadata snapshots.
- `Details`: See [Encrypted Storage Server and Multi-File Save/Load Architecture](./details/storage-server-and-multi-file.md).

### Block Style Profiles & Styling Restoration

- `Per-Profile Styling`: Custom font family (Google Fonts auto-loader), font size, font weight, line height, bottom margin, first-line indent (`text-indent`), text align (`text-align`), and placement templates (`BAB {number}\n`).
- `Snapshot Profiles Persistence`: Fixed extension storage lookup (`getRefStorage`) so `snapshot.profiles` is 100% serialized into snapshot `.json` and `.enc` files.
- `Keystroke Typing Revert Fix`: Fixed margin string comparison preventing erroneous `setNodeMarkup()` calls on every keystroke.
- `Default Styling Attributes & Auto-Extraction`: Added out-of-the-box default styling attributes for all standard profiles (`Normal`, `H1`-`H6`) and auto-extraction from matching document nodes.
- `Modal Interaction & Feedback`: Modal auto-closes on save with instant success toast notification (`Profile saved successfully!`).
- `Backward Compatibility`: Full support for opening older document files without profile IDs or pre-attached attributes.
- `Details`: See [Block Style Profiles and Document Styling Restoration](./details/block-style-profiles-and-styling.md).

### Page Settings, Custom Margins, & Automatic Multi-Page Pagination

- `Automatic Pagination Engine`: Two-pass layout engine measuring block element bounds (`offsetTop`) and automatically pushing blocks extending past `pageEnd` to the top of the next page content area.
- `Visual Page Sheet Boundaries`: Dynamic `--umo-page-content-height` calculation, header zone boundary line, footer/page-numbering zone boundary line, and 16px sheet-separation gaps between pages.
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
- `Test scripts`: `document-file.test.mjs` verifies the file contract, and `save-file.cdp.mjs` verifies the complete browser workflow.
- `Details`: See [JSON Document File Contract and Desktop Commands](./details/save-file.md).

### Automatic Numbering and Document Reference Changes

- `Heading numbering`: Adds automatic hierarchical numbers to headings.
- `Figure and table labels`: Adds independent automatic labels and editable captions.
- `Cross-reference`: Adds dynamic references that follow target renumbering and report deleted targets.
- `Citation`: Adds source-backed numeric citations using the existing footnote system.
- `JSON persistence`: Preserves stable IDs, numbers, captions, citations, and cross-references in `.umodoc.json` files.
- `Details`: See [Automatic Numbering and Document References](./details/document-references.md).
