### Render Markdown Changes

- `Render Markdown`: Adds a toolbar dropdown for explicit Markdown rendering.
    - `Current Block`: Renders only the active ProseMirror text block.
    - `Entire Document`: Renders all document text after a replacement warning.
- `Test script`: `render-markdown.cdp.mjs` verifies both render scopes and undo through CDP.

    Start the editor and Chrome with remote debugging enabled, then run:

    ```bash
    npm run test:e2e:render-markdown
    ```
