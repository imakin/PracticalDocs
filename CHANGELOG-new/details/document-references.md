# Automatic Numbering and Document References

## Goal

Add stable automatic numbering managed via customizable **Numbering Profiles** in the **Home** tab (Heading menu). Profiles support per-profile ON/OFF toggles, numbering formats (Roman, Alphabet, Numeric), custom placement templates (e.g., `"BAB {number}\n"`, `"Tabel {number}"`), and dynamic inline references for headings, figures, tables, and numeric citations.

## Scope & User Interface

### Scope

- Manage numbering via **Numbering Profiles** configured under the **Home** tab (Heading menu).
- Toggle automatic numbering **ON or OFF per profile** when creating or editing a profile.
- Support multiple numbering styles per profile: Numeric (`1`), Roman (`I`, `i`), and Alphabet (`A`, `a`).
- Support flexible number placement templates in profiles (e.g., `"BAB {number}\n"`, `"Tabel {number}"`, `"{number}"`, etc.).
- Assign profiles to any block or heading in the document.
- Number headings hierarchically according to their profile settings.
- Number block images sequentially as figures (e.g., `Figure 1`, `Gambar I`).
- Number tables sequentially as tables (e.g., `Table 1`, `Tabel 1.1`).
- Allow editable figure and table caption text.
- Insert inline cross-references to headings, figures, tables, or citations.
- Update cross-reference text dynamically upon document structural changes.
- Insert numeric citations using the auto-numbered footnote system.
- Persist target IDs, numbering profiles, formatting attributes, captions, and references in Tiptap JSON and `.umodoc.json` files.

### User Interface Controls

#### Home Tab (Base Menu)
- **Heading Menu / Profil Penomoran**: Contains options to select heading levels and manage **Numbering Profiles**:
  - Add new numbering profiles.
  - Edit existing profiles (Profile Name, **ON/OFF Toggle**, Numbering Style, Placement Template).
  - Apply/activate a profile for the active block or heading level.

#### Insert Tab
- `Caption`: Edits the caption text of the selected figure or table.
- `Cross-reference`: Selects a target and inserts a dynamic inline reference.
- `Citation`: Inserts source text as a numbered citation and footnote.

The existing `Footnote` action remains available for blank footnotes.

## Numbering Profiles and Placement Templates

### Profile Configuration

Each Numbering Profile consists of:
- **Profile Name**: Descriptive identifier (e.g. `"BAB Standard"`, `"Sub-Bab 1.1"`, `"Tabel Format"`).
- **Enabled (ON/OFF Toggle)**: Activates or deactivates automatic numbering for blocks using this profile.
- **Numbering Style**:
  - `numeric`: `1, 2, 3, 4, 5...`
  - `roman-upper`: `I, II, III, IV, V...`
  - `roman-lower`: `i, ii, iii, iv, v...`
  - `alpha-upper`: `A, B, C, D, E...`
  - `alpha-lower`: `a, b, c, d, e...`
- **Placement Template**:
  - Heading 1 example: `"BAB {number}\n"` -> Renders `BAB I` above or before heading text.
  - Heading level example: `"{number}"` -> Renders `1.1` or `1.1.1`.
  - Table example: `"Tabel {number}"` -> Renders `Tabel 1` or `Tabel 4.1`.
  - Figure example: `"Gambar {number}"` -> Renders `Gambar 1` or `Gambar I`.

## Persisted Attributes

Heading, block-image, and table nodes receive:

```json
{
  "referenceId": "heading-a1b2c3",
  "referenceNumber": "1.2",
  "referenceLabel": "BAB I",
  "numberingProfileId": "profile-h1",
  "numberStyle": "roman-upper",
  "numberTemplate": "BAB {number}"
}
```

Table nodes additionally receive:

```json
{
  "caption": "Quarterly results"
}
```

An inline reference uses:

```json
{
  "type": "crossReference",
  "attrs": {
    "targetId": "figure-a1b2c3",
    "targetType": "figure",
    "displayMode": "label",
    "targetNumber": "2",
    "targetText": "System architecture",
    "referenceText": "Figure 2",
    "missing": false
  }
}
```

## Numbering Rules

### Per-Profile Toggle
- When a profile's `enabled` flag is `false`, blocks assigned to that profile hide their automatic number labels.
- Cross-references still track stable target IDs, falling back to target titles/labels.

### Headings
- Each heading level maintains its own counter.
- A heading increments the counter for its level and formats its number according to its assigned profile.
- Counters below current level reset on higher level insertion.

### Figures and Tables
- Block images and tables use independent counters and their assigned numbering profiles.

### Citations
- Citation numbering follows footnote-reference order.

## Stable IDs & Cross-reference Display Modes

- Missing IDs generated automatically (`heading-xxx`, `figure-xxx`, `table-xxx`).
- Cross-reference display modes: `label`, `title`, `label-title`.
- Unavailable targets render `Reference unavailable`.

## Interaction & Synchronization

- Editing a profile immediately synchronizes all blocks associated with that profile across the document.
- User commands remain undoable.
- Synchronization transactions use `addToHistory: false`.

## Unit & Browser Testing

- `tests/unit/document-references.test.mjs` verifies profile management, per-profile ON/OFF toggle, Roman/Alphabet conversions, placement templates, and stable IDs.
- `tests/e2e/document-references.cdp.mjs` verifies Home tab Heading menu interaction, adding/editing profiles, assigning profiles to blocks, and `.umodoc.json` round-trip persistence.

## Completion Criteria

- Per-profile ON/OFF toggle and profile configuration are accessible in the Home tab Heading menu.
- Profiles can be created, edited, toggled ON/OFF, and applied to document blocks.
- Roman (`I`), Alphabet (`A`), Numeric (`1`), and template placement render accurately based on active profiles.
- Unit tests, CDP tests, lint, and production build pass.
