/**
 * Which headings are sections of the document, and which are only styled blocks.
 *
 * A profile carrying a heading level turns the block it is applied to into a `heading` node - that
 * is how profiles work (adr/0007), and a profile reaches every block a selection covers, table cells
 * included (adr/0013). So a writer styling the cells of a literature-review table with their own
 * profile ends up with a document full of headings that are not sections of anything.
 *
 * Two things read the document for headings and both were fooled by it: the contents, built from
 * `editor.storage.tableOfContents`, listed every cell as an entry - the row numbers, the citations,
 * the summary sentences - and the numbering gave each one a section number, so the cells consumed
 * the numbers that belonged to the real chapters after them.
 *
 * **A heading inside a table is a styled cell, not a section.** It keeps its profile and its
 * appearance; it takes no number, consumes none, and the contents does not list it. This module is
 * the single owner of that rule, so the contents and the numbering cannot disagree about it.
 */
const TABLE_NODE_TYPES = new Set([
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
])

/** True when `pos` sits anywhere inside a table, however deeply nested. */
export const isInsideTable = (doc, pos) => {
  if (!doc || typeof pos !== 'number' || pos < 0 || pos > doc.content.size) {
    return false
  }
  let resolved
  try {
    resolved = doc.resolve(pos)
  } catch {
    return false
  }
  const { depth: innermost } = resolved
  for (let depth = innermost; depth > 0; depth -= 1) {
    const { name } = resolved.node(depth).type
    if (TABLE_NODE_TYPES.has(name)) {
      return true
    }
  }
  return false
}

/**
 * True when a heading at `pos` is a section of the document - something the contents should list and
 * the numbering should number.
 */
export const headingIsSection = (doc, pos) => !isInsideTable(doc, pos)

/**
 * The headings that are sections, in document order.
 *
 * Four things read the heading store: the contents block, the document map panel, the PDF outline
 * and the editor's own `getTableOfContents()`. They all read this instead, because the alternative
 * is four copies of the same rule drifting apart - the failure the numbering already paid for once,
 * when two writers corrected each other's work forever.
 */
export const sectionHeadings = (editor) => {
  const items = editor?.storage?.tableOfContents?.content
  if (!Array.isArray(items)) {
    return []
  }
  const doc = editor?.state?.doc
  if (!doc) {
    return items
  }
  return items.filter((item) => headingIsSection(doc, item.pos))
}
