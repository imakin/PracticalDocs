# Saving Documents to JSON Files

## Goal

Add document save and load functionality so users can continue working across sessions or devices without depending on `localStorage`.

## V1 Scope

- Add a `Save to JSON` action to download a document snapshot.
- Add an `Open JSON` action to select and load a document snapshot.
- Use Tiptap JSON as the canonical content format.
- Save page settings that affect document presentation.
- Validate the entire file before changing the active document.
- Show a confirmation before replacing the active document.
- Keep the existing local cache as the recovery mechanism.

## File Name

Recommended file name format:

```text
<document-title>.umodoc.json
```

The file remains standard JSON. The `.umodoc` segment only identifies the JSON structure as a Umo Editor document.

## File Format

```json
{
  "format": "umodoc",
  "formatVersion": 1,
  "editorVersion": "11.0.4",
  "savedAt": "2026-07-28T10:00:00.000Z",
  "document": {
    "title": "Project Plan"
  },
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {
          "level": 1
        },
        "content": [
          {
            "type": "text",
            "text": "Project Plan"
          }
        ]
      }
    ]
  },
  "page": {
    "layout": "page",
    "size": {
      "label": "A4",
      "width": 21,
      "height": 29.7
    },
    "margin": {
      "left": 3.18,
      "right": 3.18,
      "top": 2.54,
      "bottom": 2.54
    },
    "orientation": "portrait",
    "background": "#ffffff",
    "watermark": {
      "type": "compact",
      "alpha": 0.2,
      "fontColor": "#000000",
      "fontSize": 16,
      "fontFamily": "SimSun",
      "fontWeight": "normal",
      "text": ""
    },
    "showBreakMarks": true,
    "showLineNumber": false,
    "showBookmark": false,
    "showToc": false
  }
}
```

## Field Definitions

| Field            | Required | Description                                            |
| ---------------- | -------- | ------------------------------------------------------ |
| `format`         | Yes      | Fixed identifier with the value `umodoc`.              |
| `formatVersion`  | Yes      | File schema version used for validation and migration. |
| `editorVersion`  | Yes      | Umo Editor version that created the file.              |
| `savedAt`        | Yes      | Save time in ISO 8601 UTC format.                      |
| `document.title` | Yes      | Document title and base file name.                     |
| `content`        | Yes      | Tiptap JSON document passed to `setContent()`.         |
| `page`           | Yes      | Page settings that are part of the document.           |

## Data Not Saved

- Callbacks such as `onSave`, `onFileUpload`, and `onFileDelete`.
- Runtime configuration such as `editorProps`, extensions, and user sessions.
- UI state such as zoom, auto width, preview, toolbar mode, theme, and locale.
- Undo and redo history.
- Browser cache and connection status.

## Save to JSON Flow

1. Read the latest content through `getJSON()`.
2. Read the document title from the document configuration.
3. Read the page state and select only fields included in the schema.
4. Build a snapshot with `formatVersion: 1`.
5. Serialize it with `JSON.stringify(snapshot, null, 2)`.
6. Create a `Blob` with the `application/json` MIME type.
7. Download it as `<document-title>.umodoc.json`.
8. Update the saved time after the download starts successfully.

## Open JSON Flow

1. Open a file picker filtered to `.json` and `application/json`.
2. Read the file with `File.text()`.
3. Parse the JSON and reject invalid files.
4. Validate `format`, `formatVersion`, `content`, and all page fields.
5. Reject unsupported schema versions before modifying the editor.
6. Ask for confirmation when the active document has unsaved changes.
7. Load `content` as a new document.
8. Apply the title and page settings.
9. Reset undo and redo history so the previous document cannot be restored.
10. Synchronize the recovery cache and mark the document as unchanged.

## Validation

- The file root must be a JSON object.
- `format` must equal `umodoc`.
- `formatVersion` must be a supported integer.
- `content.type` must equal `doc`.
- `content.content` must be an array.
- `page.layout` must be either `page` or `web`.
- `page.orientation` must be either `portrait` or `landscape`.
- Margins, page dimensions, alpha, and font size must be valid numbers.
- Colors and text values must be strings.
- Validation must finish before calling `setContent()` or modifying any other state.

## Media and Attachments

- `https:`, `http:`, and `data:` URLs remain stored as node attributes.
- `blob:` URLs are not portable and stop working after the browser closes.
- Save must warn when the document still contains `blob:` URLs.
- V1 does not store binary attachments inside the JSON file.
- Portable documents require uploaded media or data URLs.

## Autosave and Recovery

- Autosave does not download new files because the browser cannot overwrite downloaded files automatically.
- Autosave continues to use the existing `onSave` callback and recovery cache.
- `Save to JSON` is an explicit user action.
- The File System Access API and direct writes to the same file are outside the V1 scope.

## Error Handling

- Malformed JSON must not modify the active document.
- Unknown formats must show a message explaining that the file is not a Umo Editor document.
- Newer schema versions must show an incompatibility message.
- Parsing or content application failures must show a clear error.
- The active document must remain intact when the open operation fails at any stage.

## Test Plan

- Test serialization of document content, metadata, and page state.
- Test that a saved file can be loaded without changing its content.
- Test that headings, lists, tables, images, and custom nodes remain intact.
- Test malformed JSON, unknown formats, and unsupported versions.
- Test confirmation when the active document has unsaved changes.
- Test warnings for `blob:` URLs.
- Test that the active document remains unchanged when open fails.
- Add the CDP test at `tests/e2e/save-file.cdp.mjs`.

## Completion Criteria

- Users can download a document as a JSON file.
- Users can reopen the file in a new browser session.
- Content and page settings are restored correctly.
- The file does not store runtime state or application callbacks.
- The active document remains safe when a file is invalid or fails to load.
- Unit tests, CDP tests, lint, and build all pass.
