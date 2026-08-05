# Page Settings and Custom Margins Preservation

## Goal

Provide a robust Page Settings modal (`page-options.vue`) that allows users to select paper sizes (A4, Letter, Legal, A3) and edit top, bottom, left, and right margins without resetting paper sizes to Custom or zeroing out margins, alongside a visual page-break ruler for paper boundary guidance.

## Key Features & Improvements

1. **Visual Page-Break Ruler (Approach A)**:
   - Added `--umo-page-content-height` dynamic CSS variable computation to `.umo-page-content` in `src/components/container/page.vue`.
   - Applied `repeating-linear-gradient` CSS styling to `.umo-page-container .umo-page-content` rendering subtle, crisp page break indicators at exact paper height intervals (e.g. `29.7cm` for A4, `27.94cm` for Letter, `42cm` for A3).
   - Verified via `tests/e2e/test-page-ruler.cdp.mjs` in real Chrome.

2. **Paper Size Preservation on Margin Edit**:
   - Fixed `inputPageMargin` so editing custom margins (`top`, `bottom`, `left`, `right` cm) updates only the specific field.
   - Prevents paper sizes (A4, Letter, Legal, A3) from falsely converting to Custom or setting all margins to 0.

3. **Full CSS Unit Support in Margin Popup**:
   - Replaced `<t-input-number>` with flexible `<t-input>` in toolbar `margin.vue`.
   - Supports any valid CSS unit (`0.25em`, `4em`, `12px`, `10pt`, `1.5cm`, `0.5rem`, `0`) without red validation errors.

4. **Internationalization & English UI**:
   - Replaced Chinese text on Page Settings modal buttons with clean English (`Confirm` / `Cancel`).

5. **CDP Real-Browser E2E Verification**:
   - `test-comprehensive-e2e.cdp.mjs` and `test-page-ruler.cdp.mjs` verify paper size retention, exact margin-to-page ratios, and visual page break ruler gradients across A4, Letter, and A3 paper sizes in real Chrome.
