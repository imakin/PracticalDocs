# Block Style Profiles and Document Styling Restoration

## Goal

Provide per-profile font family, font size, font weight, line height, bottom margin, first-line indent (`text-indent`), text alignment (`text-align`), and placement template settings with Google Fonts auto-loading, smooth modal interaction, and full backward compatibility.

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

3. **Full Backward Compatibility**:
   - Seamlessly loads older document files (`.enc` / `.json`) created before profile updates.
   - Automatically maps existing document nodes to matching profiles and applies complete styling specs without data loss.
