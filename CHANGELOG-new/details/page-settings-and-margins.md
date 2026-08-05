# Page Settings and Custom Margins Preservation

## Goal

Provide a robust Page Settings modal (`page-options.vue`) that allows users to select paper sizes (A4, Letter, Legal, A3) and edit top, bottom, left, and right margins without resetting paper sizes to Custom or zeroing out margins.

## Key Features

1. **Paper Size Preservation on Margin Edit**:
   - Fixed `inputPageMargin` so editing custom margins (`top`, `bottom`, `left`, `right` cm) updates only the specific field.
   - Prevents paper sizes (A4, Letter, Legal, A3) from falsely converting to Custom or setting all margins to 0.

2. **Full CSS Unit Support in Margin Popup**:
   - Replaced `<t-input-number>` with flexible `<t-input>` in toolbar `margin.vue`.
   - Supports any valid CSS unit (`0.25em`, `4em`, `12px`, `10pt`, `1.5cm`, `0.5rem`, `0`) without red validation errors.

3. **Internationalization & English UI**:
   - Replaced Chinese text (e.g. `确认`) on Page Settings modal buttons with clean English (`Confirm` / `Cancel`).

4. **CDP Real-Browser E2E Margin-to-Page Ratio Verification**:
   - Test 6 in `test-comprehensive-e2e.cdp.mjs` verifies paper size retention and exact margin-to-page ratios across A4, Letter, and A3 paper sizes in real Chrome.
