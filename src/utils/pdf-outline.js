/**
 * Writing an outline into a PDF the writer already has.
 *
 * The editor never holds the bytes of its own export: `print.vue` hands the document to Chrome's
 * print dialog and Chrome writes the file. That was read for a long time as "post-processing is
 * impossible", but it is a fact about the workflow rather than a law - if the writer hands the saved
 * file back, the bytes are here, and everything a word processor puts in a PDF and Chrome does not
 * can be written into it.
 *
 * `experiments/0002-pdf-outline-written-in-the-browser.md` measured what follows. Two results from it
 * are worth keeping in view:
 *
 * - Chrome's print output already carries a structure tree, and it survives this rewrite untouched.
 * - The page text is byte-identical afterwards. This adds to the file; it does not re-render it.
 *
 * Nothing here touches the DOM or the editor, so it is testable in Node against a real PDF.
 */
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib'

/**
 * Our numeral names, as PDF spells them.
 *
 * A `/PageLabels` entry is a style and a start value. There is no "hidden" style, because a reader
 * always shows something in its page box - so a page whose folio is switched off is still labelled,
 * with the plain number it would otherwise have.
 */
const LABEL_STYLES = {
  numeric: 'D',
  'roman-lower': 'r',
  'roman-upper': 'R',
  'alpha-lower': 'a',
  'alpha-upper': 'A',
}

/**
 * The flat list of headings as a tree.
 *
 * Level is the heading's own level, so a document that starts at h2, or skips from h1 to h3, still
 * produces a tree rather than an error - a heading deeper than the one before it becomes its child,
 * whatever the gap.
 */
export const buildOutlineTree = (entries) => {
  const roots = []
  const stack = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const level = Number(entry?.level)
    if (!Number.isFinite(level)) continue
    const node = {
      title: String(entry.title ?? '').trim(),
      number: String(entry.number ?? '').trim(),
      page: Math.max(1, Math.trunc(Number(entry.page) || 1)),
      level,
      children: [],
    }
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
}

export const countOutlineItems = (nodes) =>
  (nodes || []).reduce((total, node) => total + 1 + countOutlineItems(node.children), 0)

/**
 * What a bookmark reads.
 *
 * The number and the title, joined - `BAB I Pendahuluan`. The number is included because it is part
 * of what the writer named that chapter: they set the template themselves, and a bookmark reading
 * `Pendahuluan` beside a page headed `BAB I Pendahuluan` is a different name for the same thing.
 */
export const outlineTitle = (node) =>
  [node.number, node.title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

/**
 * Consecutive pages that share a numbering style collapse into one label range.
 *
 * A range starts wherever the style changes or the count stops running on by one, which is exactly
 * where a section starts in this editor - so front matter in roman and a body restarting at 1 come
 * out as two ranges without anything having to say so.
 */
export const pageLabelRanges = (pages) => {
  const list = Array.isArray(pages) ? pages : []
  const ranges = []
  for (let index = 0; index < list.length; index += 1) {
    const page = list[index] || {}
    const style = LABEL_STYLES[page.format] || 'D'
    const start = Number.isFinite(Number(page.value))
      ? Math.trunc(Number(page.value))
      : index + 1
    const previous = ranges[ranges.length - 1]
    if (previous && previous.style === style && previous.start + (index - previous.from) === start) {
      continue
    }
    ranges.push({ from: index, style, start })
  }
  return ranges
}

const destinationFor = (pdf, pageNumber) => {
  const pages = pdf.getPages()
  const page = pages[Math.min(pages.length, Math.max(1, pageNumber)) - 1]
  const array = PDFArray.withContext(pdf.context)
  array.push(page.ref)
  // `/Fit` rather than `/XYZ`: it needs no coordinates, and a bookmark that lands on the page is the
  // whole requirement. `/XYZ` with nulls was measured to read back as `nan` in MuPDF.
  array.push(PDFName.of('Fit'))
  return array
}

/**
 * Write the outline, the page labels and the metadata into a PDF.
 *
 * Returns new bytes; the input is not modified. Throws with a named reason rather than a message, so
 * a caller can say something useful in the writer's own language.
 */
export const writePdfOutline = async (
  bytes,
  { entries = [], pages = [], metadata = {}, expectedPageCount = null } = {},
) => {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const pageCount = pdf.getPageCount()

  // The guard. The writer chooses scale, paper and margins in Chrome's print dialog, and any of them
  // changes where a heading lands. Writing bookmarks against a page map that no longer holds would
  // point every one of them at the wrong page - quietly, which is the worst way to be wrong.
  if (expectedPageCount !== null && pageCount !== expectedPageCount) {
    const error = new Error(
      `The PDF has ${pageCount} pages and the document has ${expectedPageCount}.`,
    )
    error.reason = 'page-count-mismatch'
    error.pageCount = pageCount
    error.expectedPageCount = expectedPageCount
    throw error
  }

  const { context } = pdf
  const roots = buildOutlineTree(entries)

  if (roots.length > 0) {
    // Every item needs a reference before its siblings can point at it, so the refs are handed out
    // first and the dictionaries filled in afterwards.
    const refs = new Map()
    const assign = (nodes) => {
      for (const node of nodes) {
        refs.set(node, context.nextRef())
        assign(node.children)
      }
    }
    assign(roots)

    const outlinesRef = context.nextRef()
    const build = (nodes, parentRef) => {
      nodes.forEach((node, index) => {
        const dict = context.obj({})
        dict.set(PDFName.of('Title'), PDFHexString.fromText(outlineTitle(node)))
        dict.set(PDFName.of('Parent'), parentRef)
        if (index > 0) dict.set(PDFName.of('Prev'), refs.get(nodes[index - 1]))
        if (index < nodes.length - 1) dict.set(PDFName.of('Next'), refs.get(nodes[index + 1]))
        if (node.children.length > 0) {
          dict.set(PDFName.of('First'), refs.get(node.children[0]))
          dict.set(PDFName.of('Last'), refs.get(node.children[node.children.length - 1]))
          // Positive opens the branch in the reader's sidebar; negative would collapse it.
          dict.set(PDFName.of('Count'), PDFNumber.of(countOutlineItems(node.children)))
        }
        dict.set(PDFName.of('Dest'), destinationFor(pdf, node.page))
        context.assign(refs.get(node), dict)
        build(node.children, refs.get(node))
      })
    }
    build(roots, outlinesRef)

    const outlines = context.obj({})
    outlines.set(PDFName.of('Type'), PDFName.of('Outlines'))
    outlines.set(PDFName.of('First'), refs.get(roots[0]))
    outlines.set(PDFName.of('Last'), refs.get(roots[roots.length - 1]))
    outlines.set(PDFName.of('Count'), PDFNumber.of(countOutlineItems(roots)))
    context.assign(outlinesRef, outlines)
    pdf.catalog.set(PDFName.of('Outlines'), outlinesRef)
  }

  const ranges = pageLabelRanges(pages)
  if (ranges.length > 0) {
    const nums = PDFArray.withContext(context)
    for (const range of ranges) {
      nums.push(PDFNumber.of(range.from))
      const entry = context.obj({})
      entry.set(PDFName.of('S'), PDFName.of(range.style))
      entry.set(PDFName.of('St'), PDFNumber.of(range.start))
      nums.push(entry)
    }
    const labels = context.obj({})
    labels.set(PDFName.of('Nums'), nums)
    pdf.catalog.set(PDFName.of('PageLabels'), context.register(labels))
  }

  if (metadata.title) pdf.setTitle(String(metadata.title))
  if (metadata.author) pdf.setAuthor(String(metadata.author))
  if (metadata.subject) pdf.setSubject(String(metadata.subject))
  if (Array.isArray(metadata.keywords) && metadata.keywords.length > 0) {
    pdf.setKeywords(metadata.keywords.map(String))
  }

  return pdf.save()
}
