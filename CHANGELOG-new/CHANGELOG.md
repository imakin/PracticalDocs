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
