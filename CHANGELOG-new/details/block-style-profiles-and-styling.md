# Block Style Profiles and Document Styling Restoration

## Goal

Provide per-profile font family, font size, font weight, line height, bottom margin, first-line indent (`text-indent`), text alignment (`text-align`), and placement template settings with Google Fonts auto-loading, non-overwriting inline style rendering, smooth modal interaction, and full backward compatibility.

## Key Fixes & Improvements

### 1. Keystroke Typing Revert Fix (`margin.bottom` Scalar Comparison)

- **Problem Identified**: Previously, `hasDifferentValue(attrs.margin?.bottom, 'bottom', update.profile.marginBottom)` evaluated `('0.25em')['bottom']` which resulted in `undefined`. This caused `hasDifferentValue` to return `true` on **every single keystroke**, triggering `tr.setNodeMarkup()` during typing and reverting typed text in the block.
- **Resolution**: Fixed margin comparison to perform a scalar string check (`String(attrs.margin?.bottom ?? '') !== String(update.profile.marginBottom ?? '')`). Typing text inside blocks is now 100% smooth, instant, and never reverted.

### 2. Extension Storage Lookup (`getRefStorage`) & Snapshot Persistence

- **Problem Identified**: `getDocumentSnapshot()` accessed `editor.value.extensionStorage['document-references']`, which evaluated to `undefined` under Tiptap v2. As a result, `snapshot.profiles` was saved as an empty array `[]`.
- **Resolution**: Created a flexible `getRefStorage()` helper that checks `editor.storage.documentReferences` and all naming variations. Full profile objects (Normal, H1-H6, Table, Figure) are now 100% serialized into snapshot `.json` and `.enc` files.

### 3. Default Profile Styling Attributes & Auto-Extraction

- **Problem Identified**: Default profile objects in `addStorage()` lacked default values for `fontSize`, `fontWeight`, `fontFamily`, `lineHeight`, `marginBottom`, `indent`, and `textAlign`. When opening Edit Profile on a document without existing heading nodes, all fields appeared empty.
- **Resolution**: Added complete out-of-the-box default styling attributes for all standard profiles (`Normal`, `H1`-`H6`, `Table`, `Figure`). Also added auto-extraction from matching document nodes and fallback defaults in `heading.vue` (`editProfile`), ensuring opening any profile modal always displays complete, populated form fields.

### 4. Inline Style Overwrite Prevention

- **Problem Identified**: Previously, separate extensions (`fontSize`, `fontWeight`, `fontFamily`, `lineHeight`, `indent`, `textAlign`) each returned `{ style: '...' }` in their `renderHTML` hooks. Because Tiptap's internal `mergeAttributes()` does `Object.assign()`, the last attribute (`textAlign`) was overwriting the single `style` key in `HTMLAttributes`, stripping away font size, font weight, line height, font family, and margin attributes during DOM rendering and document file reloads.
- **Resolution**: Unified inline style rendering under a single combined `style` attribute builder in `document-references/index.js`. The single renderer formats all active attributes into a clean, complete style string (e.g. `style="font-family: Arial; font-size: 20pt; font-weight: bold; line-height: 2; text-indent: 2em; text-align: justify; margin-bottom: 24px"`). Individual extensions delegate rendering to `{}` so no style property is overwritten.

## Key Features

1. **Per-Profile Styling Options**:
   - **Font Family**: Per-profile selection with automatic Google Fonts CSS injector (`ensureFontFamilyLoaded`) for web fonts.
   - **Font Size & Weight**: Customizable font size (e.g., `14pt`, `24pt`, `18px`) and weight (`bold`, `normal`, `600`).
   - **Line Height & Margin**: Inline visual line-height rendering (`1.5`, `2.0`, `1.75`) and bottom margin (`4em`, `16px`).
   - **First Line Indent (`text-indent`)**: Customizable indentation levels (`0`, `Level 1 = 2em`, `Level 2 = 4em`).
   - **Text Align (`text-align`)**: Selection for `Left`, `Center`, `Right`, `Justify`.
   - **Placement Template**: Multi-line templates with explicit newlines (e.g. `"BAB {number}\n"`).

2. **Modal Interaction & Feedback**:
   - Fixed modal reactivity `v-model:visible="editModalVisible"` ensuring modal auto-closes smoothly on save.
   - Added instant success toast feedback (`useMessage('success', 'Profile saved successfully!')`).

3. **Full Lossless Save & Load Persistence**:
   - Verified via `tests/e2e/test-full-profile-save-load.mjs`, `tests/e2e/test-snapshot-profiles-presence.mjs`, `tests/e2e/test-all-profiles-default-styling.mjs`, and `tests/e2e/test-keystroke-typing.cdp.mjs` that all profile styling properties persist losslessly and typing remains 100% smooth.
