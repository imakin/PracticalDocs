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

  Start the editor and Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:unit:document-file
  npm run test:e2e:save-file
  ```

### Automatic Numbering and Document Reference Changes

- `Heading numbering`: Adds automatic hierarchical numbers to headings.
- `Figure and table labels`: Adds independent automatic labels and editable captions.
- `Cross-reference`: Adds dynamic references that follow target renumbering and report deleted targets.
- `Citation`: Adds source-backed numeric citations using the existing footnote system.
- `JSON persistence`: Preserves stable IDs, numbers, captions, citations, and cross-references in `.umodoc.json` files.
- `Test scripts`: `document-references.test.mjs` verifies numbering and reference planning, and `document-references.cdp.mjs` verifies the browser workflow and JSON round trip.

  Start the editor and Chrome with remote debugging enabled, then run:

  ```bash
  npm run test:unit:document-references
  npm run test:e2e:document-references
  ```
