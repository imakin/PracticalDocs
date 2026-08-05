### Real-Browser E2E Audit & Comprehensive CDP Test Suite

- `Comprehensive CDP Audit`: `test-comprehensive-e2e.cdp.mjs`, `test-keystroke-typing.cdp.mjs`, & `test-page-ruler.cdp.mjs` verify all user requirements in real Chrome:
  - **TEST 1**: Default title (`file-identifier`) and English UI audit.
  - **TEST 2**: Multi-file disk persistence (`a.enc` & `a.json` physical files).
  - **TEST 3**: Document load & computed DOM visual styling (font size, weight, line-height, text-align, margin-bottom, newline widget).
  - **TEST 4**: Incognito clean-state session & localStorage profile preservation.
  - **TEST 5**: Visual computed line-height, text-indent (`2em`), and New Document confirmation modal.
  - **TEST 6**: Page Settings custom margin-to-page ratios across A4, Letter, and A3 sizes.
  - **Keystroke Typing**: Real Chrome typing test verifying text is never deleted or reverted during typing.
  - **Page Break Ruler**: Real Chrome audit verifying `--umo-page-content-height` variable and visual page break ruler gradient.

  Start Chrome with remote debugging enabled, then run:

  ```bash
  node tests/e2e/test-comprehensive-e2e.cdp.mjs
  node tests/e2e/test-keystroke-typing.cdp.mjs
  node tests/e2e/test-page-ruler.cdp.mjs
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

### Page Settings & Custom Margins Preservation

- `Visual Page-Break Ruler`: Added dynamic `--umo-page-content-height` CSS calculation and `repeating-linear-gradient` visual page break indicators at exact paper height intervals.
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
