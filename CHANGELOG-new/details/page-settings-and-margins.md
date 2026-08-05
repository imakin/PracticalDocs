# Page Settings, Custom Margins, and Automatic Multi-Page Pagination

## Goal

Provide a robust Page Settings modal (`page-options.vue`) that allows users to select paper sizes (A4, Letter, Legal, A3) and edit top, bottom, left, and right margins without resetting paper sizes to Custom or zeroing out margins, alongside an automatic multi-page pagination engine that prevents text blocks from overlapping margin boundaries.

## Key Features & Improvements

1. **Automatic Multi-Page Pagination Engine**:
   - Added two-pass layout pagination measurement in `updatePagination()` in `src/components/container/page.vue`.
   - Pass 1 clears transient auto-page-break margins and triggers a forced DOM layout reflow (`void pmEl.offsetHeight`).
   - Pass 2 measures natural element positions (`offsetTop`) against `contentHeight` (`pageSize.height - margin.top - margin.bottom`).
   - Any block element (paragraph, heading, table, image) extending past `pageEnd` into the non-printable margin-bottom + sheet-gap + margin-top zone is automatically pushed down (`marginTop: nextPageStart - rawTop`) to the top of the next page content area.
   - Guaranteed: No text block ever overlaps or sits on top of the footer zone, sheet gap, or header zone.

2. **Visual Page Sheet Boundaries & Margin Zones**:
   - Applied dynamic `--umo-page-content-height` and `repeating-linear-gradient` styling to `.umo-page-content` in `src/components/container/page.vue`.
   - Renders a Header zone boundary line (`margin-top`), a Footer & Page Numbering zone boundary line (`page-height - margin-bottom`), and a 16px sheet-separation gap at every paper page height interval.

3. **Paper Size Preservation on Margin Edit**:
   - Fixed `inputPageMargin` so editing custom margins (`top`, `bottom`, `left`, `right` cm) updates only the specific field.
   - Prevents paper sizes (A4, Letter, Legal, A3) from falsely converting to Custom or setting all margins to 0.

4. **Full CSS Unit Support in Margin Popup**:
   - Replaced `<t-input-number>` with flexible `<t-input>` in toolbar `margin.vue`.
   - Supports any valid CSS unit (`0.25em`, `4em`, `12px`, `10pt`, `1.5cm`, `0.5rem`, `0`) without red validation errors.

5. **CDP Real-Browser E2E Multi-Page Audit**:
   - `test-visual-multipage.cdp.mjs` loads multi-page documents (e.g. `tesis3.json`) in real Chrome, measures block positions relative to margin gap boundaries, captures visual screenshots, and asserts 0 text overlaps.
