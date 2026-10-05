import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { documentSections } from '@/extensions/page-break'
import { measuringRange } from '@/utils/measuring-range'
import {
  computePageNumbers,
  defaultPageNumberSettings,
} from '@/utils/page-numbering'
import {
  sameGeometry,
  sectionInsets,
  sheetSizeOf,
  widestSheet,
} from '@/utils/page-sections'

/**
 * Decoration-based pagination. See AGENT/adr/0002-decoration-based-pagination.md.
 *
 * The engine measures where lines actually land and pushes the first line that would cross a page
 * boundary down to the top of the next sheet's text column, so the band made of bottom margin, sheet
 * gap and top margin never holds text. The push is expressed as a `Decoration.widget`, so the editor
 * view owns every node it renders: nothing is injected into the contenteditable behind its back, and
 * document positions are untouched because decorations do not occupy any.
 */
export const paginationPluginKey = new PluginKey('pagination')
export const paginationRefreshKey = new PluginKey('paginationRefresh')
const sectionInsetsKey = new PluginKey('sectionInsets')

// A document longer than this many sheets stops being repaginated rather than looping.
/**
 * The clock the engine is timed by.
 *
 * `performance.now` where there is one, so a solve that takes a fifth of a second is reported as
 * such rather than as a whole number of milliseconds rounded twice.
 */
const now = () =>
  typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()

const MAX_SHEETS = 500
/**
 * Quiet period before re-paginating: two seconds, as the writer asked - more than once.
 *
 * Every change restarts it, so a writer who keeps typing, or keeps dragging a picture's handle, pays
 * for no solve at all until they stop for two seconds. A solve on a thesis holds the main thread for
 * seconds, and each one that starts in a pause between keystrokes is time the writer cannot type or
 * open a menu. It was 200ms, then "as long as the last solve took", capped at two seconds; both were
 * shorter than the writer wanted, and the writer decides this.
 */
const RECOMPUTE_DELAY = 2000

/**
 * Run something after the browser has had a chance to paint.
 *
 * Two frames, not one: the first carries the change that was just made to the DOM into the render,
 * and the work is handed to the second. One frame is enough in principle and is not in practice.
 */
const paintThen = (work) => {
  // A frame only comes to a tab somebody is looking at. Waiting for one in a hidden tab stops the
  // engine dead - measured: five characters typed with the tab in the background produced **no
  // solve at all**, twenty-five seconds after the typing stopped. A timer runs either way.
  const visible =
    typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (!visible || typeof requestAnimationFrame !== 'function') {
    setTimeout(work, 16)
    return
  }
  requestAnimationFrame(() => requestAnimationFrame(work))
}
/**
 * Hand the thread back to the browser for a moment: input, menus, scrolling, a paint.
 *
 * `scheduler.yield` where there is one, because it resumes this work ahead of other queued tasks once
 * the input has been handled; a zero timer elsewhere.
 */
const yieldToBrowser = () =>
  typeof globalThis.scheduler?.yield === 'function'
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0))

// Sub-pixel slack: line boxes and cm-to-px conversion both round.
const TOLERANCE = 1

/**
 * The width the element would have with no transform on it, fractions kept.
 *
 * `offsetWidth` is rounded to a whole pixel, and it used to be the divisor here. On a canvas
 * measuring 793.695px that made it 794, so the scale came out **0.9996** where the page's transform
 * was plainly `matrix(1, 0, 0, 1, 0, 0)` - measured. Every length the engine writes is divided by
 * this, so each one was 0.04 per cent out, and the error is not paid once: it accumulates down the
 * document. Measured on a 44 sheet document, the drawn sheets fell behind the geometry the engine
 * had solved by 3px at sheet 6, 11px at sheet 24 and **21px** by the last one - the pages drifting
 * further out of step the further down you read, which is what the writer reported.
 *
 * The computed width keeps its fraction and is unaffected by transforms, which is exactly the
 * quantity wanted.
 */
const borderBoxWidth = (element) => {
  const style = getComputedStyle(element)
  const width = Number.parseFloat(style.width)
  if (!Number.isFinite(width)) {
    return element.offsetWidth
  }
  if (style.boxSizing === 'border-box') {
    return width
  }
  // Content box: the rect measures the border box, so the two have to be made comparable.
  return (
    width +
    ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
      (sum, name) => sum + (Number.parseFloat(style[name]) || 0),
      0,
    )
  )
}

/**
 * The page geometry of every section, in pixels.
 *
 * A centimetre is measured rather than assumed - it depends on the browser's own dpi, and on the
 * zoom transform the canvas carries - and the same factor converts every section, so two sections
 * described by the same numbers can never round apart.
 *
 * Web layout has no sheets. Its single geometry is read from the CSS variables exactly as it was
 * before sections existed, so switching to web layout is still switching pagination off.
 */
const readGeometry = (view, sections) => {
  const host = view.dom.closest('.pdoc-page-content')
  if (!host) {
    return null
  }
  const ruler = document.createElement('div')
  ruler.style.cssText =
    'position:absolute;visibility:hidden;width:1px;top:0;left:0'
  host.appendChild(ruler)
  const measure = (value) => {
    ruler.style.height = value
    return ruler.getBoundingClientRect().height
  }
  const cm = measure('1cm')
  const gap = measure('var(--pdoc-page-sheet-gap, 16px)')
  const web = Boolean(host.closest('.pdoc-web-container'))
  const single = web
    ? {
        width: host.getBoundingClientRect().width,
        height: measure('var(--pdoc-page-height, 29.7cm)'),
        marginTop: measure('var(--pdoc-page-margin-top, 0cm)'),
        marginBottom: measure('var(--pdoc-page-margin-bottom, 0cm)'),
        marginLeft: measure('var(--pdoc-page-margin-left, 0cm)'),
        marginRight: measure('var(--pdoc-page-margin-right, 0cm)'),
      }
    : null
  ruler.remove()
  if (!(cm > 0)) {
    return null
  }
  /**
   * How much the canvas is scaled by the zoom control.
   *
   * Everything the engine measures comes from `getBoundingClientRect`, which reports the scaled box,
   * while every length it writes - a spacer's height, a sheet's box - is a CSS length on an element
   * inside the same transform and is therefore unscaled. The two are only the same at 100 per cent.
   * The engine works in the scaled space, because that is what it measures, and divides by this on
   * the way out.
   */
  const scale = (() => {
    const measured = host.getBoundingClientRect().width
    const unscaled = borderBoxWidth(host)
    return unscaled > 0 ? measured / unscaled : 1
  })()

  const source = web ? sections.slice(0, 1) : sections
  const list = source.map((section) => {
    const size = sheetSizeOf(section)
    const box = single ?? {
      width: size.width * cm,
      height: size.height * cm,
      marginTop: section.margin.top * cm,
      marginRight: section.margin.right * cm,
      marginBottom: section.margin.bottom * cm,
      marginLeft: section.margin.left * cm,
    }
    return {
      index: section.index,
      ...box,
      column: box.height - box.marginTop - box.marginBottom,
    }
  })
  if (list.length === 0 || !(list[0].height > 0) || !(list[0].column > 0)) {
    return null
  }
  const canvasWidth = Math.max(...list.map((item) => item.width))
  // Sheets of different widths are centred on each other, which is how a reader expects a landscape
  // page inserted into a portrait document to sit.
  for (const item of list) {
    item.left = (canvasWidth - item.width) / 2
  }
  return {
    host,
    cm,
    gap,
    web,
    scale: scale > 0 ? scale : 1,
    sections: list,
    canvasWidth,
  }
}

/**
 * Where every sheet begins, when not all sheets are the same height.
 *
 * The engine used to work from one constant - `stride`, a page plus the gap after it - because every
 * sheet was the same. A section can now turn the paper or change it, so a sheet's top depends on the
 * heights of all the sheets above it, and which section a sheet belongs to is only learned as the
 * solver walks down the document and takes each page break in turn.
 *
 * So the layout is built forward, one sheet at a time, and a sheet inherits the section of the sheet
 * above it until a page break says otherwise. `open` records that, and discards everything below the
 * sheet it changes, because those tops were derived from an answer that has just changed.
 */
class SheetLayout {
  constructor(geometry) {
    this.geometry = geometry
    // Which sheet opens each section. Keyed by the section rather than by the sheet, because the
    // solver revises its answer: a break can look as though it opens one sheet early on and open a
    // later one once the content above it has been paginated, and an assignment keyed by sheet would
    // leave the first answer behind for good.
    this.opens = new Map()
    this.boundaries = []
    // The top of each sheet in pixels from the top of the canvas, built forward and thrown away
    // whenever a boundary moves.
    this.tops = [0]
  }

  sectionIndexOf(sheet) {
    let section = 0
    for (const { sheet: opensAt, section: opened } of this.boundaries) {
      if (opensAt > sheet) {
        break
      }
      section = opened
    }
    return section
  }

  sectionOf(sheet) {
    const list = this.geometry.sections
    return list[Math.min(this.sectionIndexOf(sheet), list.length - 1)]
  }

  extendTo(sheet) {
    while (this.tops.length <= sheet && this.tops.length < MAX_SHEETS) {
      const last = this.tops.length - 1
      this.tops.push(
        this.tops[last] + this.sectionOf(last).height + this.geometry.gap,
      )
    }
  }

  at(sheet) {
    return this.sectionOf(Math.min(sheet, MAX_SHEETS - 1))
  }

  top(sheet) {
    this.extendTo(sheet)
    return this.tops[Math.min(sheet, this.tops.length - 1)]
  }

  bottom(sheet) {
    return this.top(sheet) + this.at(sheet).height
  }

  columnTop(sheet) {
    return this.top(sheet) + this.at(sheet).marginTop
  }

  columnBottom(sheet) {
    return this.bottom(sheet) - this.at(sheet).marginBottom
  }

  /**
   * The sheet a point falls on, counting a point in the gap as belonging to the sheet above it -
   * which is what dividing by a constant stride used to do, and what a line hanging into the gap
   * means: it has overflowed the sheet it started on.
   */
  sheetAt(y) {
    let sheet = 0
    while (
      sheet < MAX_SHEETS - 1 &&
      y >= this.bottom(sheet) + this.geometry.gap
    ) {
      sheet += 1
    }
    return sheet
  }

  /** Record that a section opens on a sheet. Every top below it is derived again. */
  open(sheet, section) {
    if (sheet >= MAX_SHEETS || this.opens.get(section) === sheet) {
      return
    }
    this.opens.set(section, sheet)
    this.boundaries = [...this.opens.entries()]
      .map(([index, at]) => ({ section: index, sheet: at }))
      .sort((a, b) => a.sheet - b.sheet || a.section - b.section)
    this.tops.length = 1
  }

  /**
   * The sections opened so far, to be put back with `restoreOpens` - a prediction the next
   * measurement disproves takes back the sections it opened along with its breaks.
   */
  saveOpens() {
    return new Map(this.opens)
  }

  restoreOpens(saved) {
    this.opens = new Map(saved)
    this.boundaries = [...this.opens.entries()]
      .map(([index, at]) => ({ section: index, sheet: at }))
      .sort((a, b) => a.sheet - b.sheet || a.section - b.section)
    this.tops.length = 1
  }

  /** One record per sheet, for everything that needs to know where the sheets are. */
  publish(count) {
    const out = []
    for (let sheet = 0; sheet < count; sheet += 1) {
      const box = this.at(sheet)
      out.push({
        top: this.top(sheet),
        left: box.left ?? 0,
        width: box.width,
        height: box.height,
        marginTop: box.marginTop,
        marginRight: box.marginRight,
        marginBottom: box.marginBottom,
        marginLeft: box.marginLeft,
        section: this.sectionIndexOf(sheet),
      })
    }
    return out
  }
}

const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, pre, figcaption, div'

const blockOf = (node) => {
  const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  return start?.closest(BLOCK_SELECTOR) || start
}

const intStyle = (element, property, fallback) => {
  const raw = element ? getComputedStyle(element)[property] : null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * One entry per rendered line of text, plus embedded media, which has no line boxes of its own.
 *
 * Fragments of the same line are merged: a line broken across several text nodes by marks would
 * otherwise look like several independent boxes, and the engine would break inside a line.
 */
const collectLines = (view, originTop) => {
  const merged = new Map()
  const lineHeights = new WeakMap()
  const selfPaginated = new WeakMap()
  /**
   * Text rects are the glyph box, not the line box: at line-height 1.5 a 12pt line measures about
   * 17px where the line it occupies is 24px. Print breaks on the line box, so measuring glyphs makes
   * the engine slightly more permissive at the bottom of a column, and a line sitting within half a
   * leading of the boundary ends up on the wrong sheet. Grow each rect by the half-leading its own
   * block declares.
   */
  const halfLeading = (block, rect) => {
    if (!block) {
      return 0
    }
    if (!lineHeights.has(block)) {
      lineHeights.set(
        block,
        Number.parseFloat(getComputedStyle(block).lineHeight),
      )
    }
    const lineHeight = lineHeights.get(block)
    if (!Number.isFinite(lineHeight) || lineHeight <= rect.height) {
      return 0
    }
    return (lineHeight - rect.height) / 2
  }

  /**
   * Lines inside a block that paginates itself are not the solver's business.
   *
   * Such a block is an **atom**: it holds text with line boxes the solver can measure, but no
   * document position inside it, so `posAtDOM` on one of those lines returns the position of the
   * block itself. Measured on a contents of 31 rows: the line chosen was row 10, 497px down the
   * canvas, and the position it resolved to was the `toc` node, which begins at 239.
   *
   * Anchoring there is not a small error. The spacer is placed before the whole block while its
   * height was worked out for a line far inside it, so the block does not reach the next column - it
   * lands part way down this one. The block then finds a row of its own straddling the foot of the
   * column and pushes it, which makes it taller, which overflows again. Measured on the user's
   * thesis: a 295px spacer between the heading and the contents and a 302px gap inside it, settled,
   * on every solve - a page that reads as empty after its heading, on screen and in the PDF.
   *
   * Refusing the break is not the answer either, and the measurement says so: the solver then steps
   * over the block, and `{"stopped":"no-anchor-below-the-last-break","breaks":0,"skipped":1}` is the
   * whole document left unpaginated - the fault `adr/0022` was written about, met again.
   *
   * So these lines are not collected as breakable at all. `adr/0022` gave this kind of block the job
   * of placing its own rows; the engine's part is to leave them alone and paginate around the height
   * they end up with.
   */
  const selfPaginating = (block) => {
    if (!block) {
      return false
    }
    if (!selfPaginated.has(block)) {
      selfPaginated.set(
        block,
        Boolean(block.closest?.('[data-pdoc-self-paginating]')),
      )
    }
    return selfPaginated.get(block)
  }

  /**
   * A block that renders text the engine can measure but owns no position inside itself.
   *
   * Display mathematics is the case that brought this in. KaTeX draws one formula as dozens of boxes
   * - numerator, rule, denominator, each operator - and every one of them produces text rects, so the
   * solver saw a twelve line block and tried to break between the parts of a fraction. Every one of
   * those rects maps back through `posAtDOM` to the same position, the node's own, so the break it
   * wanted was one it had already placed: measured on the user's thesis, an overflow at position
   * 78141 against a last break at 78145, `no-anchor-below-the-last-break`, and **the last six pages
   * of the document left unpaginated** - text running through the foot of the sheet and the page
   * number printed over it.
   *
   * Collapsing the whole thing into one line is what the document means anyway: a formula is not
   * breakable, so its box is its line, and the engine moves it whole to the next sheet. Measuring the
   * box rather than the glyphs also measures what print measures, which is why the formula now
   * overflows before the paragraph under it does rather than after.
   *
   * `data-pdoc-self-paginating` is the other half of this idea and not a substitute: the contents
   * places its own rows and wants to be left alone, while a formula wants to be moved.
   */
  const ATOMIC_SELECTOR = '[data-type="block-math"], [data-type="inline-math"]'
  const atomKeys = new WeakMap()
  let nextAtomKey = 0
  const atomicOf = (node) => {
    const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const atom = start?.closest?.(ATOMIC_SELECTOR) || null
    if (atom && !atomKeys.has(atom)) {
      nextAtomKey += 1
      atomKeys.set(atom, `atom-${nextAtomKey}`)
    }
    return atom
  }

  const add = (rect, block, node, key) => {
    if (rect.height <= 0 || rect.width <= 0) {
      return
    }
    const leading = halfLeading(block, rect)
    const top = rect.top - originTop - leading
    const bottom = rect.bottom - originTop + leading
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        block,
        placesItself: selfPaginating(block),
        top,
        bottom,
        clientTop: rect.top,
        left: rect.left,
        source: node,
      })
      return
    }
    existing.top = Math.min(existing.top, top)
    existing.bottom = Math.max(existing.bottom, bottom)
    // The leftmost fragment owns the start of the line, which is where a break has to be anchored.
    if (rect.left < existing.left) {
      existing.left = rect.left
      existing.clientTop = rect.top
      existing.source = node
    }
  }

  /**
   * The fragments of text that make up lines, grouped once they have all been read.
   *
   * They used to be keyed by `Math.round(rect.top)`, which is not the same grouping wherever the page
   * happens to sit: two fragments of one line at 100.4 and 100.6 are two lines, the same two at 137.7
   * and 137.9 are one. A block's count of lines feeds the widow and orphan rule, so moving the whole
   * document by a fraction of a pixel could move a break. The solver predicts where lines go after a
   * break instead of measuring them (`PredictedLayout`), and a grouping that changes with the offset
   * made its answer differ from the one measured line by line.
   *
   * Nor by closeness of their tops, which was the first replacement. Inline code draws its glyph box
   * a pixel above the text around it, a tall inline formula many pixels, so a line holding either was
   * two "lines" to the solver. On the writer's tesis8ag the solver then saw `ap_fixed` - the code at
   * the end of a line reading "sejumlah skalar ap_fixed yang lebar..." - overflow on its own, and
   * anchored a break at the code, in the middle of the line. The line split, "sejumlah skalar" stayed
   * behind still crossing the foot of the sheet, its own break now lay above the last one placed, and
   * the solver gave up: `no-anchor-below-the-last-break`, and every page after it unpaginated. The
   * PDF was right, because print breaks between real lines.
   *
   * So a fragment belongs to a line when their extents **overlap** by at least half the height of the
   * shorter - which is what sharing a line box means - wherever on the page the line sits.
   */
  const textFragments = []
  const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) {
      continue
    }
    const atom = atomicOf(node)
    if (atom) {
      // An inline formula is part of the line it sits in, so it is merged into that line rather than
      // becoming one of its own: the block it belongs to is the paragraph, and the key is the line.
      const rect = atom.getBoundingClientRect()
      const inline = atom.getAttribute('data-type') === 'inline-math'
      // The **text node** stays the source, not the element, even though the box being measured is
      // the element's. `positionAtLineStart` anchors an element line by walking out to the start of
      // the top level block it sits in, which for a formula inside a markdown block is the block
      // itself - and the first markdown block in a document begins at position 0. Measured: a break
      // anchored at 0, which on screen is a harmless strip of blank at the top of page one and in
      // the export is a band with `page-break-after: always` before any content - **an empty first
      // page in the PDF**. Through the text node the anchor resolves to the formula's own position,
      // which is where the break belongs.
      if (inline) {
        textFragments.push({ rect, block: blockOf(atom), node })
      } else {
        add(rect, atom, node, atomKeys.get(atom))
      }
      continue
    }
    const block = blockOf(node)
    const range = measuringRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      textFragments.push({ rect, block, node })
    }
  }
  // Stable, so fragments at one height keep document order and the leftmost-wins rule in `add` sees
  // them as it always did.
  textFragments.sort((a, b) => a.rect.top - b.rect.top)
  let lineIndex = -1
  let lineTop = Number.NEGATIVE_INFINITY
  let lineBottom = Number.NEGATIVE_INFINITY
  let lineHeight = 0
  for (const fragment of textFragments) {
    const { rect } = fragment
    if (rect.height <= 0 || rect.width <= 0) {
      continue
    }
    const overlap = Math.min(rect.bottom, lineBottom) - Math.max(rect.top, lineTop)
    if (overlap < Math.min(rect.height, lineHeight) / 2) {
      lineIndex += 1
      lineTop = rect.top
      lineBottom = rect.bottom
      lineHeight = rect.height
    } else {
      lineTop = Math.min(lineTop, rect.top)
      lineBottom = Math.max(lineBottom, rect.bottom)
      lineHeight = Math.min(lineHeight, rect.height)
    }
    add(rect, fragment.block, fragment.node, `line-${lineIndex}`)
  }
  for (const element of view.dom.querySelectorAll(
    'img, video, iframe, canvas, svg',
  )) {
    // KaTeX draws fraction rules and radicals as svg. They belong to the formula's one box, not to a
    // line of their own.
    const atom = atomicOf(element)
    if (atom) {
      continue
    }
    const rect = element.getBoundingClientRect()
    add(
      rect,
      blockOf(element),
      element,
      `media-${Math.round(rect.top)}-${Math.round(rect.left)}`,
    )
  }

  const lines = [...merged.values()].sort((a, b) => a.top - b.top)
  // index of each line inside its own block, and how many lines that block has in total
  const counts = new Map()
  for (const line of lines) {
    line.indexInBlock = counts.get(line.block) ?? 0
    counts.set(line.block, line.indexInBlock + 1)
  }
  for (const line of lines) {
    line.blockLineCount = counts.get(line.block)
  }
  return lines
}

/**
 * Where the content after a page break actually starts.
 *
 * `coordsAtPos` at the position just past the break is not it. The engine's spacer is a widget
 * anchored there with `side: -1`, and the coordinates come back from *before* the spacer - so a break
 * near the foot of a page reported the sheet it sits on rather than the one it opens, and a numbering
 * section began a page early. Measured on a real document: break at 5530 on sheet 4, coordinates 5561
 * still on sheet 4, while the content was plainly on sheet 5.
 *
 * Reading the DOM and stepping over the spacers answers the question that was actually being asked.
 */
const contentTopAfterBreak = (view, pos, node) => {
  const dom = view.nodeDOM(pos)
  let sibling = dom?.nextElementSibling ?? null
  while (sibling?.classList?.contains('pdoc-page-spacer')) {
    sibling = sibling.nextElementSibling
  }
  if (sibling) {
    return sibling.getBoundingClientRect().top
  }
  try {
    return view.coordsAtPos(pos + node.nodeSize)?.top ?? null
  } catch {
    return null
  }
}

/**
 * Manual page breaks the user inserted.
 *
 * `.pdoc-page-break` carries `break-before: page`, which print honours and this engine used to ignore
 * entirely, so the screen kept flowing where the export started a new page and every sheet after the
 * break inherited the difference. In print the element collapses to zero height, so it is the content
 * *after* the break that opens the new page - which is why the spacer is anchored after the node
 * rather than before it.
 */
const forcedBreaks = (view, originTop) => {
  const found = []
  let ordinal = 0
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'pageBreak') {
      return
    }
    // Which section this break opens. The sections are the runs between the breaks in document
    // order, so a break's ordinal is the index of the section it opens.
    ordinal += 1
    const contentTop = contentTopAfterBreak(view, pos, node)
    if (contentTop === null) {
      return
    }
    found.push({
      pos: pos + node.nodeSize,
      top: contentTop - originTop,
      section: ordinal,
    })
  })
  return found.sort((a, b) => a.top - b.top)
}

/**
 * The end of the top level block holding a position.
 *
 * Used to step over a block the engine cannot anchor a break inside, so that one awkward block does
 * not cost the rest of the document its pagination.
 */
const endOfTopLevelBlock = (view, pos) => {
  try {
    const $pos = view.state.doc.resolve(
      Math.max(0, Math.min(pos, view.state.doc.content.size)),
    )
    return $pos.depth > 0 ? $pos.after(1) : pos + 1
  } catch {
    return pos + 1
  }
}

/**
 * The document as it will be once the breaks decided so far are applied, worked out rather than laid
 * out.
 *
 * A solve used to place one break, dispatch it, and measure the whole document again before placing
 * the next: 51 breaks on the writer's thesis cost 52 full relayouts, which is where a solve's seconds
 * went (`adr/0026`). A break only pushes the content after its anchor down by the spacer's height, so
 * the lines of one measurement can be moved by that amount instead of asking the browser where they
 * went. The next measurement checks the answer (`deviationFrom`) and the solver takes back whatever
 * the arithmetic got wrong.
 *
 * Copies, never the measured lines themselves: `base` is where a line was measured, `top` and `bottom`
 * where it is predicted to be. `source` and `clientTop` stay as measured, because the DOM they point
 * into is the one that was measured - nothing is dispatched until the batch is complete.
 */
class PredictedLayout {
  constructor(lines, forced) {
    this.lines = lines.map((line) => ({ ...line, base: line.top }))
    this.forced = forced.map((item) => ({ ...item, base: item.top }))
  }

  /** Everything measured at or below `from` moves down by `amount`. */
  shift(from, amount) {
    for (const line of this.lines) {
      if (line.base >= from - 0.5) {
        line.top += amount
        line.bottom += amount
      }
    }
    for (const item of this.forced) {
      if (item.base >= from - 0.5) {
        item.top += amount
      }
    }
  }
}

/**
 * Where the content a spacer pushes begins, and how much further it moves than the spacer is tall.
 *
 * Anchored inside a paragraph, the spacer pushes the line it is anchored at and everything after it,
 * by exactly its own height. Anchored between blocks, it pushes the whole block after it - whose box
 * can begin above the line that was chosen, a list item or a row of columns for one - and it separates
 * two margins that used to collapse into one: the block after it then moves by the spacer **plus** the
 * smaller of the two margins. Anything this misses is caught by the next measurement.
 */
// Structures a spacer cannot push uniformly. Inside one cell of a table it pushes that cell's content
// and leaves the cells beside it where they were, while the rows below move by however much the row
// grew - measured on tesis8ag, headings in the next row predicted 36px lower than they landed.
const UNPREDICTABLE_ANCESTORS = new Set(['tableCell', 'tableHeader', 'tableRow', 'table'])

const shiftFromAnchor = (view, pos, lineBase, originTop, scale) => {
  try {
    const $pos = view.state.doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if (UNPREDICTABLE_ANCESTORS.has($pos.node(depth).type.name)) {
        return { from: lineBase, extra: 0, predictable: false }
      }
    }
    if ($pos.parent.isTextblock) {
      return { from: lineBase, extra: 0 }
    }
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof Element)) {
      return { from: lineBase, extra: 0 }
    }
    const from = Math.min(lineBase, dom.getBoundingClientRect().top - originTop)
    const previous = dom.previousElementSibling
    if (!previous) {
      return { from, extra: 0 }
    }
    const below = Number.parseFloat(getComputedStyle(previous).marginBottom) || 0
    const above = Number.parseFloat(getComputedStyle(dom).marginTop) || 0
    return {
      from,
      extra: below > 0 && above > 0 ? Math.min(below, above) * scale : 0,
    }
  } catch {
    return { from: lineBase, extra: 0 }
  }
}

// How far a measured line may sit from its prediction and still count as predicted. A decision turns
// on a line crossing the foot of a column by more than `TOLERANCE`, so a prediction allowed to be a
// pixel out could decide differently from a measurement. Half a pixel: the browser rounds each
// spacer's height to its layout unit, and a quarter was measured being exceeded by that rounding
// alone, 800px below the break, costing a rollback and a relayout for nothing.
const PREDICTION_TOLERANCE = 0.5

// Index of the first value in a sorted list that is at least `value`.
const lowerBound = (sorted, value) => {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (sorted[middle] < value) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

const hasNear = (sorted, value) => {
  const index = lowerBound(sorted, value - PREDICTION_TOLERANCE)
  return index < sorted.length && sorted[index] <= value + PREDICTION_TOLERANCE
}

/**
 * The highest point, in the previous measurement's coordinates, where the new measurement disagrees
 * with what was predicted for it - or null when every line and every forced break landed where it was
 * predicted to.
 *
 * Compared by position, not by index. `collectLines` merges the fragments of a line by their rounded
 * top, and moving a line by a fraction of a pixel can round two fragments together or apart - the
 * count of lines changes although nothing moved anywhere it should not have. Matched by index, every
 * line after that one read as wrong: measured, deviations of 2634px and eight breaks taken back for
 * nothing. So each measured line must have a predicted one where it is, and each predicted line a
 * measured one where it was predicted.
 */
const deviationFrom = (predicted, lines, forced) => {
  let lowest = null
  const note = (base) => {
    if (lowest === null || base < lowest) {
      lowest = base
    }
  }
  const predictedTops = predicted.lines.map((line) => line.top).sort((a, b) => a - b)
  const measuredTops = lines.map((line) => line.top).sort((a, b) => a - b)
  for (const line of predicted.lines) {
    if (!hasNear(measuredTops, line.top)) {
      note(line.base)
      break
    }
  }
  // A measured line nobody predicted belongs to the region of the predicted line just above it.
  const byTop = [...predicted.lines].sort((a, b) => a.top - b.top)
  for (const line of lines) {
    if (!hasNear(predictedTops, line.top)) {
      const above = lowerBound(predictedTops, line.top) - 1
      note(above >= 0 ? byTop[above].base : Number.NEGATIVE_INFINITY)
      break
    }
  }
  const measured = new Map(forced.map((item) => [item.pos, item]))
  for (const item of predicted.forced) {
    const landed = measured.get(item.pos)
    if (!landed || Math.abs(landed.top - item.top) > PREDICTION_TOLERANCE) {
      note(item.base)
    }
  }
  return lowest
}

const firstOverflowing = (lines, layout) => {
  // The lines are sorted down the page, so the sheet only ever moves forward: walking it here keeps
  // the whole pass linear in the number of lines rather than in lines times sheets.
  let sheet = 0
  for (const line of lines) {
    // The block places this line itself. See `collectLines`.
    if (line.placesItself) {
      continue
    }
    while (
      sheet < MAX_SHEETS - 1 &&
      line.top >= layout.bottom(sheet) + layout.geometry.gap
    ) {
      sheet += 1
    }
    if (line.bottom > layout.columnBottom(sheet) + TOLERANCE) {
      return line
    }
  }
  return null
}

/**
 * Move the break earlier when breaking here would violate the block's widows or orphans.
 *
 * Print honours these; Chrome's initial values are 2 and 2. Ignoring them is what made the on-screen
 * breaks drift against Export to PDF: the engine happily left a single line stranded at the top of the
 * next sheet, print refused to, and every following sheet inherited the difference.
 */
const respectWidowsAndOrphans = (lines, overflow) => {
  const blockLines = lines.filter((line) => line.block === overflow.block)
  const widows = intStyle(overflow.block, 'widows', 2)
  const orphans = intStyle(overflow.block, 'orphans', 2)
  let index = overflow.indexInBlock

  const linesMovedDown = overflow.blockLineCount - index
  if (linesMovedDown < widows) {
    index -= widows - linesMovedDown
  }
  // Too few lines would be left behind, so the whole block moves to the next sheet.
  if (index > 0 && index < orphans) {
    index = 0
  }
  if (index < 0) {
    index = 0
  }
  return blockLines[index] || overflow
}

const charTop = (node, index) => {
  const range = measuringRange()
  range.setStart(node, index)
  range.setEnd(node, index + 1)
  const rects = range.getClientRects()
  return rects.length > 0 ? rects[0].top : null
}

/**
 * Document position of the first character of a line.
 *
 * Deliberately not `posAtCoords`: that maps a viewport point, and the line that overflows a page is
 * usually scrolled far out of view, where it returns nothing usable. Character rect tops rise
 * monotonically inside one text node, so the first character of the line can be binary-searched
 * instead, which does not care where the viewport happens to be.
 */
/**
 * Never inside a row of columns.
 *
 * A columns block is a flex row, and a spacer anchored between or inside its columns becomes one
 * more flex item: it takes no height and moves nothing, so on screen the row stays where it was and
 * the solver simply breaks again further down. The export is not so forgiving. It turns every spacer
 * into a band with `break-after: page`, and a band inside the row cuts the row in two - the formula
 * column on one page and the equation number that sits beside it on the next, with everything after
 * it shifted by a page. Measured on the writer's thesis: 54 pages for 53 sheets, two bands found
 * inside `.pdoc-node-column`, both at equation rows.
 *
 * So a break that resolves to a position inside a columns block is anchored before the whole block.
 * The row moves to the next sheet as one piece, which is the only thing a row can do anyway.
 */
const COLUMN_STRUCTURE = new Set(['columnContainer', 'column'])

const outsideAnyColumns = (view, pos) => {
  if (typeof pos !== 'number') {
    return pos
  }
  try {
    const $pos = view.state.doc.resolve(pos)
    for (let depth = 1; depth <= $pos.depth; depth += 1) {
      if (COLUMN_STRUCTURE.has($pos.node(depth).type.name)) {
        return $pos.before(depth)
      }
    }
    return pos
  } catch {
    return pos
  }
}

const positionAtLineStart = (view, line) =>
  outsideAnyColumns(view, positionAtLineStartInside(view, line))

/**
 * The position just before a formula, for a line that begins with one.
 *
 * A formula is one atom in the document; the text KaTeX draws inside it has no position of its own.
 * The search below looks for the first character at or under the line's top - and a line that begins
 * with a formula has the formula's box as its top, which KaTeX's glyphs can stand a fraction of a pixel
 * above. Whether they do depends on the geometry: measured on a copy of tesis8ag, at a device pixel
 * ratio of 1.2 the "T" of an inline T_max stood above its box, the search found nothing, the solver
 * stepped over the block 362 times and gave up - and the writer saw the same page break the same way
 * in one Chrome on one computer and nowhere else. The formula's own position is the answer, whatever
 * the pixels do.
 */
const MATH_ATOM_SELECTOR = '[data-type="block-math"], [data-type="inline-math"]'

const beforeMathAtom = (view, node) => {
  const atom = node?.parentElement?.closest?.(MATH_ATOM_SELECTOR)
  if (!atom || !view.dom.contains(atom) || !atom.parentNode) {
    return undefined
  }
  try {
    const index = Array.prototype.indexOf.call(atom.parentNode.childNodes, atom)
    return beforeBlockIfAtItsStart(view, view.posAtDOM(atom.parentNode, index))
  } catch {
    return undefined
  }
}

/**
 * The document position of a DOM point, read through the node view's content element when the point
 * lies outside it.
 *
 * A list item's marker is drawn by its node view beside the content, not in it, and `posAtDOM` on a
 * point like that answers with either the start or the end of the node by a heuristic of
 * ProseMirror's own - which `prosemirror-view` 1.42.6 turned around: a point *before* the content
 * now resolves to the node's **end**. The marker is the leftmost fragment of an item's first line,
 * so it is what that line is anchored by. Measured on the writer's tesis8ag, in a build that
 * installed 1.42.6: a one line bullet item overflowed, the break was anchored after the item rather
 * than before it, nothing moved, and the solver gave up at break 10 with every page below it
 * unpaginated. The tunnel's build, installed earlier with the old heuristic, paginated the same
 * document. Asking the content element itself does not depend on which way the heuristic points.
 */
const NODE_VIEW_WRAPPER = '[data-node-view-wrapper]'
const NODE_VIEW_CONTENT = '[data-node-view-content]'

const positionAtDOM = (view, node, offset) => {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  const wrapper = element?.closest?.(NODE_VIEW_WRAPPER)
  const content =
    wrapper && view.dom.contains(wrapper)
      ? [...wrapper.querySelectorAll(NODE_VIEW_CONTENT)].find(
          (candidate) => candidate.closest(NODE_VIEW_WRAPPER) === wrapper,
        )
      : null
  if (!content || content.contains(node)) {
    return view.posAtDOM(node, offset)
  }
  const before =
    content.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING
  return view.posAtDOM(content, before ? 0 : content.childNodes.length)
}

const positionAtLineStartInside = (view, line) => {
  const node = line.source
  const formula = beforeMathAtom(view, node)
  if (formula !== undefined) {
    return formula
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    // An element line is a whole block of its own - an image, a video, a canvas. `posAtDOM` on it
    // returns a position **inside** the node, and a spacer anchored there is rendered inside the
    // node view's own content, where it has no height and moves nothing at all.
    //
    // Measured on the user's document with a larger bottom margin: the engine chose to push a 230px
    // figure to the next column, the spacer landed in the image's alt element with a height of 0,
    // the figure did not move, the same line overflowed the next round, the anchor was no further
    // on than the last one, and the solve gave up - leaving 101 lines of the document sitting in
    // the margin band. This is real bug 1.
    try {
      return outsideTheBlockItBegins(view, positionAtDOM(view, node, 0))
    } catch {
      return null
    }
  }
  const { length } = node
  let low = 0
  let high = length - 1
  let answer = null
  while (low <= high) {
    const middle = (low + high) >> 1
    const top = charTop(node, middle)
    if (top === null) {
      low = middle + 1
      continue
    }
    if (top >= line.clientTop - 0.5) {
      answer = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  if (answer === null) {
    return null
  }
  try {
    return beforeBlockIfAtItsStart(view, positionAtDOM(view, node, answer))
  } catch {
    return null
  }
}

/**
 * A break at a block's first line belongs before the block, not inside it.
 *
 * The spacer is a widget anchored at this position. Anchored inside the block, it becomes the first
 * thing in that block's content - and `text-indent` applies to the block's first line box, which the
 * spacer then occupies, so **the text starts on the second line and is not indented at all.**
 *
 * Measured on a four sheet document with a profile stating a 2 level indent: paragraphs in the middle
 * of a sheet started 56px in, and every paragraph that opened a sheet started at 0 while its computed
 * `text-indent` still read 56px. The rule was right; the line it applied to was empty.
 *
 * This is the anchoring fault recorded as real bug 3, which STATE described as "not known to break
 * anything else". It is now known.
 */
const LIST_ITEM_NODES = new Set(['listItem', 'taskItem'])
const LIST_STRUCTURE = new Set([
  'listItem',
  'taskItem',
  'orderedList',
  'bulletList',
  'taskList',
])

/**
 * The position before the node holding this one, and before every list it also begins.
 *
 * A list item's marker is drawn beside its content rather than in it, so a spacer anchored inside
 * the item moves the text and leaves the marker behind - and the marker is a text node the engine
 * counts as a line, so that line can never move however many breaks are placed. The solve then
 * cannot get past it and gives up, which is what stopped a long list being paginated at all.
 */
const outsideTheBlockItBegins = (view, pos) => {
  const $pos = view.state.doc.resolve(pos)
  if ($pos.depth <= 0) {
    return pos
  }
  let depth = $pos.depth
  while (
    depth > 1 &&
    $pos.index(depth - 1) === 0 &&
    LIST_STRUCTURE.has($pos.node(depth - 1).type.name)
  ) {
    depth -= 1
  }
  return $pos.before(depth)
}

const beforeBlockIfAtItsStart = (view, pos) => {
  if (typeof pos !== 'number' || pos <= 0) {
    return pos
  }
  try {
    const $pos = view.state.doc.resolve(pos)
    // `parentOffset === 0` says the position is at the very start of whatever holds it.
    if ($pos.parentOffset !== 0 || $pos.depth <= 0) {
      return pos
    }
    // Either inside a text block at its first character, or already between nodes at the start of a
    // list item - `posAtDOM` on a text node inside a list item's node view returns the position
    // before the paragraph rather than inside it, which is the same hazard the markdown block
    // records. Both mean the same thing: the line about to be pushed is the first thing here.
    if (
      !$pos.parent?.isTextblock &&
      !LIST_ITEM_NODES.has($pos.parent?.type?.name)
    ) {
      return pos
    }
    return outsideTheBlockItBegins(view, pos)
  } catch {
    return pos
  }
}

/**
 * The sheet a page break opens.
 *
 * Not the sheet the content after it happens to start on. Measured on a real document: the engine can
 * anchor its spacer one position *inside* the following heading rather than before it, so that
 * heading's box begins in the previous sheet's bottom margin while its text renders on the next
 * sheet. Reading the content's box then reports the sheet the break sits on, and a restart landed a
 * page early - the page holding the break was numbered 1 and the chapter after it carried on at 2.
 *
 * A page break closes the page it is on, so the section it opens begins on the next one. The only
 * exception is a break that has itself been pushed to the top of a sheet, where the page it closes is
 * empty and the section starts right there.
 */
const sheetOpenedByBreak = (view, pos, layout, originTop) => {
  const dom = view.nodeDOM(pos)
  if (!dom?.getBoundingClientRect) {
    return null
  }
  const top = dom.getBoundingClientRect().top - originTop
  const sheet = layout.sheetAt(top)
  return top <= layout.columnTop(sheet) + TOLERANCE ? sheet : sheet + 1
}

const buildSectionDecorations = (doc, sections) => {
  // Nothing at all while every section is drawn the same way, which is nearly every document: no
  // attribute, no inline style, nothing in the saved HTML, and no way for this to change a layout it
  // has no business changing.
  if (sections.every((section) => sameGeometry(section, sections[0]))) {
    return DecorationSet.empty
  }
  const insets = sectionInsets(sections)
  const decorations = []
  let index = 0
  doc.forEach((node, offset) => {
    const at = Math.min(index, insets.length - 1)
    const inset = insets[at]
    // The section a block belongs to, named on the block itself. The export reads it to give each
    // section its own `@page` rule, which is the only way a printed document changes paper part way
    // through.
    const attrs = { 'data-pdoc-section': String(at) }
    if (inset && (inset.left !== 0 || inset.right !== 0)) {
      // Both the custom properties and the margins: the properties are what the table rule in
      // editor.less reads to take the same width off, and the margins are inline so that no
      // stylesheet rule can out-specify them.
      attrs.style =
        `--pdoc-section-left:${inset.left}cm;` +
        `--pdoc-section-right:${inset.right}cm;` +
        `margin-left:${inset.left}cm;margin-right:${inset.right}cm;`
    }
    decorations.push(Decoration.node(offset, offset + node.nodeSize, attrs))
    // A page break sits at the foot of the page it closes, so it belongs to the section before it.
    if (node.type.name === 'pageBreak') {
      index += 1
    }
  })
  return DecorationSet.create(doc, decorations)
}

const buildDecorations = (doc, breaks, scale = 1) =>
  DecorationSet.create(
    doc,
    breaks.map((item, index) =>
      Decoration.widget(
        item.pos,
        () => {
          const spacer = document.createElement('span')
          spacer.className = 'pdoc-page-spacer'
          spacer.setAttribute('contenteditable', 'false')
          spacer.setAttribute('aria-hidden', 'true')
          spacer.style.display = 'block'
          spacer.style.height = `${item.height / scale}px`
          return spacer
        },
        {
          // -1 keeps the spacer before the character it is anchored to, so that character opens the
          // next sheet instead of being stranded at the bottom of this one.
          side: -1,
          key: `pdoc-page-spacer-${index}-${Math.round(item.height / scale)}`,
          ignoreSelection: true,
        },
      ),
    ),
  )

/**
 * The top of a block's first rendered line, rather than the top of its box.
 *
 * A block that opens a sheet after a forced break can have a box beginning in the previous sheet's
 * bottom margin while its text renders on the next one - measured, and recorded as a known fault of
 * the break spacer's anchoring. Its box would then report the sheet before the one the reader sees it
 * on. The engine itself measures text rects for the same reason, so this agrees with it.
 */
const firstTextTop = (element) => {
  // Text nodes only. A break's spacer can be anchored inside the block that follows it rather than
  // before it, and it is a full-width block, so a range over the element's contents returns the
  // spacer's own rect first - which is the box, in the previous sheet's bottom margin, not the line.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) {
      continue
    }
    const range = measuringRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (rect.height > 0 && rect.width > 0) {
        return rect.top
      }
    }
  }
  return element.getBoundingClientRect().top
}

/**
 * The sheet an element sits on, and what that sheet is numbered.
 *
 * Reads the geometry the engine already solved rather than measuring again: `stride` is the sheet
 * pitch and the container's top is the origin the engine works from, so a box's offset divided by
 * the pitch is its sheet. Returns null when the engine has not solved yet - in web layout mode, for
 * one, where there are no sheets to be on.
 *
 * `index` is the physical page, 1..N, which never restarts. `text` is what the reader sees in the
 * footer, which may restart, change numeral system or be hidden. A caller showing a page reference
 * wants `text` when it exists and `index` otherwise.
 */
export const pageOfElement = (editor, element) => {
  const storage =
    editor?.extensionStorage?.pagination || editor?.storage?.pagination
  const pages = storage?.pages
  const sheets = storage?.sheets
  const host = editor?.view?.dom?.closest('.pdoc-page-content')
  if (!element || !host || !(sheets?.length > 0) || !(pages?.length > 0)) {
    return null
  }
  const top = firstTextTop(element) - host.getBoundingClientRect().top
  // The last sheet whose top is above this point. Not a division by a pitch: sheets can differ in
  // height now, so there is no pitch to divide by, and the tops the engine published are the answer.
  let sheet = 0
  while (sheet + 1 < sheets.length && top >= sheets[sheet + 1].top) {
    sheet += 1
  }
  return pages[Math.min(sheet, pages.length - 1)] ?? null
}

export const Pagination = Extension.create({
  name: 'pagination',

  addStorage() {
    // `pages` is the computed number of every sheet and `sheets` is where each one is drawn; both
    // are written by the driver on every solve so that anything needing the page a block is on reads
    // one answer rather than computing a second. `page` is the document wide geometry, which is the
    // first section's and the fallback for every later one.
    return {
      pageNumber: defaultPageNumberSettings(),
      page: null,
      pages: [],
      sheets: [],
      stride: 0,
      // How the last solve ended, and how many breaks it placed.
      solve: null,
    }
  },

  addCommands() {
    return {
      // The engine draws the page numbers, because CSS cannot restart a page count (ADR 0008), so it
      // has to be told what the user asked for.
      setPageNumberSettings:
        (settings) =>
        ({ view }) => {
          this.storage.pageNumber = {
            ...defaultPageNumberSettings(),
            ...(settings || {}),
          }
          if (view) {
            view.dispatch(view.state.tr.setMeta(paginationRefreshKey, true))
          }
          return true
        },
      /**
       * The document wide page geometry.
       *
       * The engine needs it because the first section is drawn at it and every later section falls
       * back to it, and it lives in the Vue page options rather than in the document, so nothing in
       * the document can tell the engine it changed.
       */
      setPageGeometry:
        (page) =>
        ({ view }) => {
          this.storage.page = page
            ? {
                size: page.size,
                orientation: page.orientation,
                margin: page.margin,
              }
            : null
          if (view) {
            view.dispatch(view.state.tr.setMeta(paginationRefreshKey, true))
          }
          return true
        },
      // Page size, margins, orientation and zoom all change the geometry without changing the
      // document, so they cannot be picked up from document changes alone.
      refreshPagination:
        () =>
        ({ view }) => {
          if (!view) {
            return false
          }
          view.dispatch(view.state.tr.setMeta(paginationRefreshKey, true))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { storage } = this
    const { editor } = this
    return [
      new Plugin({
        key: paginationPluginKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, refresh: 0 }),
          apply(tr, current) {
            // A refresh request carries no decorations; it only bumps a counter the driver watches,
            // because page size, margins and zoom change the geometry without changing the document.
            if (tr.getMeta(paginationRefreshKey)) {
              return { ...current, refresh: current.refresh + 1 }
            }
            const next = tr.getMeta(paginationPluginKey)
            if (next) {
              return { decorations: next, refresh: current.refresh }
            }
            return {
              decorations: current.decorations.map(tr.mapping, tr.doc),
              refresh: current.refresh,
            }
          },
        },
        props: {
          decorations(state) {
            return paginationPluginKey.getState(state)?.decorations
          },
        },
        view: (editorView) => new PaginationDriver(editorView, storage, editor),
      }),
      /**
       * The horizontal inset of every block, when the sections are not all the same width.
       *
       * A plugin of its own rather than part of the solve: these decorations describe the document
       * and the page settings and nothing else, so they must be in place *before* the engine
       * measures anything - the engine is measuring the layout they produce.
       */
      new Plugin({
        key: sectionInsetsKey,
        state: {
          init: (config, state) =>
            buildSectionDecorations(
              state.doc,
              documentSections(state.doc, storage.page),
            ),
          apply(tr, current, oldState, newState) {
            if (!tr.docChanged && !tr.getMeta(paginationRefreshKey)) {
              return current
            }
            return buildSectionDecorations(
              newState.doc,
              documentSections(newState.doc, storage.page),
            )
          },
        },
        props: {
          decorations(state) {
            return sectionInsetsKey.getState(state)
          },
        },
      }),
    ]
  },
})

class PaginationDriver {
  constructor(view, storage, editor) {
    this.storage = storage || { pageNumber: defaultPageNumberSettings() }
    this.view = view
    this.editor = editor
    this.timer = null
    this.solving = false
    // Set when the document or the page geometry changes while a solve is paused between batches:
    // the breaks it holds were worked out for a document that no longer exists.
    this.interrupted = false
    // A solve was asked for while one was still running. It starts when that one ends.
    this.rerun = false
    this.destroyed = false
    this.lastSignature = null
    // When the wait the writer is sitting through began. Null while nothing is pending.
    this.runStartedAt = null
    // The solving this run has cost so far, in milliseconds. The waiting in between is not in it.
    this.runMs = 0
    this.schedule()
  }

  update(view, previousState) {
    this.view = view
    const changed =
      view.state.doc !== previousState.doc ||
      paginationPluginKey.getState(previousState)?.refresh !==
        paginationPluginKey.getState(view.state)?.refresh
    if (!changed) {
      return
    }
    // The driver's own dispatches change neither the document nor the refresh counter, so reacting to
    // a change never reacts to them - which is what turned the previous engine into a loop that never
    // settled. A change that arrives while a solve is paused between batches is the writer's, and the
    // solve in progress is working on a document that is gone.
    if (this.solving) {
      this.interrupted = true
    }
    this.schedule()
  }

  schedule() {
    /**
     * Say that the page is being laid out, and how long it took when it stops.
     *
     * Said **here** rather than at the top of `solve`, and that is the whole trick: a solve holds the
     * main thread for its entire length - measured at **1764 ms** on a 44 sheet thesis - so a message
     * shown when it starts is a message the browser cannot paint until it is over. Scheduling happens
     * before the work, with the debounce between, so the writer sees it while they are waiting rather
     * than after.
     *
     * The time reported is the **work**: the solves added together, not the wall clock from the first
     * schedule to the answer settling. The engine waits deliberately between solves - see the wait
     * below - and counting that wait would report a document as slower the more carefully the engine
     * avoided working on it, which is exactly backwards.
     */
    if (this.runStartedAt === null) {
      this.runStartedAt = now()
      this.runMs = 0
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    /**
     * Wait two seconds of quiet (`RECOMPUTE_DELAY`), restarted by every change.
     *
     * The wait has to outlast the pause between two keystrokes or every keystroke buys its own solve.
     * Measured on a 44 sheet thesis with a 200ms wait, typing five characters with 400ms between them:
     * **nine solves, 18.7 seconds of blocked main thread**, each one longer than the last. That is
     * also why the toolbar felt slow - a menu cannot open while the thread is inside a solve.
     */
    this.timer = setTimeout(() => {
      this.timer = null
      // Never two solves at once: they would dispatch over each other's breaks.
      if (this.solving) {
        this.rerun = true
        return
      }
      /**
       * Said here, one painted frame before the work, and not a moment earlier.
       *
       * Saying it when the solve is **scheduled** reads as a promise the engine has not kept: the
       * writer presses a key, the words appear at once, and nothing has been laid out yet - they see
       * a page announcing work through every pause in their typing. Saying it when the solve
       * **starts** is no better, because a solve holds the main thread for its whole length, so the
       * message would first be painted after the work it announces had finished.
       *
       * So: announce, give the browser one frame to paint it, then take the thread.
       */
      this.editor?.emit?.('layoutStart')
      paintThen(() => {
        this.solve().catch((error) => console.error(error))
      })
    }, RECOMPUTE_DELAY)
  }

  applyBreaks(breaks, scale = 1) {
    const { tr } = this.view.state
    tr.setMeta(
      paginationPluginKey,
      buildDecorations(this.view.state.doc, breaks, scale),
    )
    tr.setMeta('addToHistory', false)
    tr.setMeta('preventUpdate', true)
    this.view.dispatch(tr)
  }

  /**
   * Lay the document out, handing the thread back to the browser between batches.
   *
   * The writer asked for the layout to stop getting in the way of the menus and of scrolling. It
   * pauses only where the page is whole: right after a batch of breaks has been applied, when the
   * document shows the pagination the solver expects. The unpaginated layout a solve starts from, and
   * the partial one a rollback leaves, are each followed at once by the next batch in the same stretch
   * of work, so neither is ever painted.
   *
   * `ms` is the work, the stretches added together, not the pauses between them (`adr/0028`).
   */
  async solve() {
    let startedAt = now()
    let workMs = 0
    this.interrupted = false
    const sections = documentSections(this.view.state.doc, this.storage?.page)
    const geometry = readGeometry(this.view, sections)
    if (!geometry) {
      return
    }
    const layout = new SheetLayout(geometry)
    this.solving = true
    try {
      // Start from the unpaginated layout every time. Measuring while the previous spacers are still
      // in place would find nothing overflowing - they are the reason nothing overflows - and the
      // engine would conclude the document needs no breaks and drop the ones holding it together.
      // Dispatching is synchronous, so the DOM read below is already the natural layout.
      this.applyBreaks([], geometry.scale)
      const breaks = []
      let lastPos = -1
      // Why the solve ended. A solve that gives up leaves the rest of the document sitting in the
      // margin band, and from the outside that is indistinguishable from a solve that finished - it
      // cost an afternoon once. Recorded so the next reader can ask instead of guess.
      let stopped = 'ran-out-of-sheets'
      let skipped = 0
      let tried = []
      // How many times the document was measured. Each one is a full relayout, which is what a solve
      // costs (`adr/0026`), so this is the number worth watching.
      let layouts = 0
      // How many times a measurement disproved a prediction and breaks were taken back.
      let rollbacks = 0
      // The breaks decided from the previous measurement, and what it predicted they would do.
      let batch = null
      // What the solver could not anchor, when it steps over a block or gives up: the lines it tried
      // and how far it had got. A solve that gives up looks from outside exactly like one that
      // finished, so this is what the next reader asks instead of guessing.
      const unanchored = []
      // The last measurement, when nothing was dispatched after it.
      let settledLines = null
      const { scale } = geometry
      const stateBefore = () => ({
        breaks: breaks.length,
        lastPos,
        skipped,
        opens: layout.saveOpens(),
      })

      for (let guard = 0; guard < MAX_SHEETS; guard += 1) {
        layouts += 1
        const originTop = geometry.host.getBoundingClientRect().top
        const lines = collectLines(this.view, originTop)
        const forcedAll = forcedBreaks(this.view, originTop)

        /**
         * Check the last batch against what the browser actually did.
         *
         * Every step of a batch was decided from lines moved by the steps before it. The first line
         * that did not land where it was predicted marks the first step whose own shift was wrong;
         * that step's decision was sound, because it was made above the error, but every step after
         * it was made from lines that were not where the solver thought. Those are taken back -
         * breaks, the sections they opened, how far the solver had got - and the document is laid out
         * again with the breaks that stand. At least the batch's first break always stands: it was
         * decided from a real measurement with nothing predicted, which is the old one-break-at-a-time
         * step exactly, so every measurement moves the solve forward.
         */
        if (batch) {
          const deviation = deviationFrom(batch.predicted, lines, forcedAll)
          if (deviation !== null) {
            const shifting = batch.log
              .map((step, index) => ({ ...step, index }))
              .filter((step) => step.from !== null)
            const sound = shifting.filter((step) => step.from <= deviation + 0.5)
            const lastSound = sound.length > 0 ? sound[sound.length - 1] : shifting[0]
            const firstDropped = lastSound ? batch.log[lastSound.index + 1] : null
            if (firstDropped) {
              rollbacks += 1
              breaks.length = firstDropped.before.breaks
              lastPos = firstDropped.before.lastPos
              skipped = firstDropped.before.skipped
              layout.restoreOpens(firstDropped.before.opens)
              batch = null
              this.applyBreaks(breaks, scale)
              continue
            }
          }
          batch = null
        }

        // Decide as many breaks as this one measurement allows.
        const predicted = new PredictedLayout(lines, forcedAll)
        const log = []
        let ended = null
        for (let step = 0; step < MAX_SHEETS; step += 1) {
          const overflow = firstOverflowing(predicted.lines, layout)
          const forced = predicted.forced.find((item) => item.pos > lastPos)
          if (!overflow && !forced) {
            ended = 'settled'
            break
          }
          const before = stateBefore()
          let chosen = null
          // Whichever comes first down the page wins. A forced break above the overflow has to be
          // taken first, or the sheet it lands on is already the wrong one.
          if (forced && (!overflow || forced.top <= overflow.top)) {
            const sheet = layout.sheetAt(forced.top)
            // Already opening a column: print would not push it either, and a spacer here would
            // insert a whole blank sheet. The section it opens is still recorded - otherwise every
            // sheet below would be drawn at the geometry of the section before it - and the solver
            // moves past it.
            //
            // Recorded here rather than while the breaks are being measured. Measuring used to open a
            // section for **every** break that happened to look column aligned, including ones far
            // below where the solver had got to - and opening a section changes the height of every
            // sheet after it, which silently invalidated breaks the solver had already placed. It then
            // met an overflow above its own last break, could not anchor it, and gave up, leaving the
            // rest of the document sitting in the margin band. Measured on a real document: the last
            // break was at position 25541 and the overflow it could not place was at 23039.
            const opened =
              forced.top <= layout.columnTop(sheet) + TOLERANCE
                ? sheet
                : sheet + 1
            layout.open(opened, forced.section)
            if (opened === sheet) {
              lastPos = forced.pos
              log.push({ before, from: null })
              continue
            }
            chosen = { top: forced.top, base: forced.base, pos: forced.pos, opened }
          } else if (overflow) {
            // A block long enough to span several sheets gets broken more than once, and the widow and
            // orphan adjustment counts from the start of the block, so it can point at a line above the
            // previous break. Breaking exactly at the overflow is then the only way forward; giving up
            // here would leave the rest of the document unpaginated.
            const candidates = [
              respectWidowsAndOrphans(predicted.lines, overflow),
              overflow,
            ]
            tried = []
            for (const candidate of candidates) {
              const at = positionAtLineStart(this.view, candidate)
              tried.push({
                at,
                top: Math.round(candidate.top),
                index: candidate.indexInBlock,
                of: candidate.blockLineCount,
                text: String(
                  candidate.source?.textContent ||
                    candidate.source?.tagName ||
                    '',
                ).slice(0, 30),
              })
              if (at !== null && at > lastPos) {
                chosen = { top: candidate.top, base: candidate.base, pos: at }
                break
              }
            }
          }
          // Nothing here can be moved. Step over the block rather than abandon the document: a table
          // whose cells the engine cannot anchor inside used to stop the solve dead, and everything
          // below it - a hundred lines on a real document - was left sitting in the margin band. One
          // block laid out badly is a much smaller wrong than the rest of the document unpaginated.
          if (!chosen) {
            const after = endOfTopLevelBlock(
              this.view,
              tried.find((item) => item.at !== null)?.at ?? lastPos,
            )
            // Only when stepping over actually gets somewhere. Advancing by one position instead
            // would crawl the whole document a position at a time, re-measuring every line each time,
            // which is slower and no more correct than stopping.
            unanchored.push({ lastPos, after, tried })
            if (after > lastPos && after < this.view.state.doc.content.size) {
              skipped += 1
              lastPos = after
              log.push({ before, from: null })
              continue
            }
            ended = 'no-anchor-below-the-last-break'
            break
          }
          // A forced break has already recorded the sheet it opens, because the column it has to
          // reach belongs to the section it opens rather than to the one it closes.
          const opened = chosen.opened ?? layout.sheetAt(chosen.top) + 1
          // And a forced break the **overflow** branch swallowed has not.
          //
          // When a page break sits on a page with only a line or two to spare, the first line that
          // overflows is the one the break itself pushes down, so the overflow is at or above the
          // break and the overflow branch takes it. The break is placed at exactly the position the
          // page break opens - the same boundary, so the pagination is right - but `lastPos` then
          // steps to that position, `pos > lastPos` never matches the break again, and the section it
          // opens is **never recorded at all**.
          //
          // Measured on a fixture of three sections and three sheets: `storage.sheets` reported their
          // sections as `0,0,2`. Section 1 owned no sheet, because only section 2 ever reached
          // `layout.open`. Nothing on screen showed it while the two sections happened to be drawn
          // alike - but the export names a band per section, so the page name ran s0 -> s1 -> s0 -> s2
          // and every change of page name is a forced break: two pages gained in the PDF, and PDF
          // bookmarks refused to write because the counts no longer matched.
          if (chosen.opened === undefined && forced && forced.pos <= chosen.pos) {
            layout.open(opened, forced.section)
          }
          const height = layout.columnTop(opened) - chosen.top
          if (height <= 0) {
            ended = 'next-column-is-not-below-the-line'
            break
          }
          lastPos = chosen.pos
          breaks.push({ pos: chosen.pos, height })
          const { from, extra, predictable = true } = shiftFromAnchor(
            this.view,
            chosen.pos,
            chosen.base,
            originTop,
            scale,
          )
          predicted.shift(from, height + extra)
          log.push({ before, from })
          // Past a break whose effect cannot be worked out, every later decision would be a guess that
          // the next measurement throws away. Stop here and let it measure instead.
          if (!predictable) {
            break
          }
        }

        // Nothing new to lay out: what this measurement says is the answer.
        if (!log.some((step) => step.from !== null)) {
          stopped = ended ?? stopped
          // Nothing is dispatched after this, so these lines are the document as it will be drawn.
          settledLines = lines
          break
        }
        this.applyBreaks(breaks, scale)
        batch = { predicted, log }

        // The page is whole here, so this is where the browser gets its turn.
        workMs += now() - startedAt
        await yieldToBrowser()
        startedAt = now()
        if (this.interrupted || this.destroyed) {
          // The breaks already shown stay, mapped through the change by the plugin, until the solve
          // the change scheduled replaces them. Nothing is published from a stale answer.
          this.storage.interruptions = (this.storage.interruptions || 0) + 1
          return
        }
      }
      this.storage.solve = {
        stopped,
        breaks: breaks.length,
        skipped,
        layouts,
        rollbacks,
        at: breaks.map((item) => item.pos),
        unanchored: unanchored.slice(-4),
        ms: Math.round(workMs + now() - startedAt),
      }
      this.runMs += workMs + now() - startedAt
      /**
       * Solve again until two solves agree.
       *
       * A solve measures the document as it stands at that moment, and while a document is being
       * opened it is still arriving: the profiles and their stylesheet, the content, the numbering
       * and the page geometry each land a tick apart, and each moves every line. The driver settles
       * on whichever of them it happened to measure, and afterwards nothing schedules another solve -
       * the document is no longer changing, so the first answer stands however wrong it is.
       *
       * Measured on a thesis of 44 sheets in a **private window**, where nothing is cached and the
       * order is at its worst: the first solve placed **42** breaks and left **47** lines crossing
       * the foot of a sheet or sitting in the gap between two. A second solve, changing nothing else
       * and taken with the page still at the top, placed **43** and left **none**; a third agreed
       * with the second. That second solve is what the writer had been buying by hand every time
       * they nudged the zoom up and back.
       *
       * So the answer is confirmed rather than assumed. A solve that disagrees with the one before it
       * schedules another, and agreement ends it - normally one extra solve, and none at all once the
       * document is quiet, since an unchanged answer schedules nothing.
       */
      const signature = `${stopped}:${breaks.map((item) => item.pos).join(',')}`
      const settled = signature === this.lastSignature
      this.lastSignature = signature
      const sheets = this.padToWholeSheets(geometry, layout, settledLines)
      this.publishPages(geometry, layout, sheets)
      this.renderSheets(geometry, layout, sheets)
      this.renderPageNumbers(geometry, layout)
      if (settled) {
        this.runStartedAt = null
        this.editor?.emit?.('layoutEnd', Math.round(this.runMs))
      } else {
        this.schedule()
      }
    } finally {
      this.solving = false
      if (this.rerun) {
        this.rerun = false
        this.schedule()
      }
    }
  }

  /**
   * Work out what every sheet is numbered and publish it, whether or not the numbers are drawn.
   *
   * The table of contents needs the same answer, and it used to compute its own by counting
   * `.pdoc-page-node` elements - of which there is one for the whole canvas, so every entry came out
   * as page 1. Two answers to one question is what produced the pagination-versus-PDF bug in
   * ADR 0002, so there is one computation here and everything else reads it.
   *
   * Published even when numbering is off: the page a heading is on is a fact about the document, and
   * a reader still wants it in the contents when no folio is printed.
   */
  publishPages(geometry, layout, sheetCount) {
    const settings = this.storage?.pageNumber || defaultPageNumberSettings()
    // Which sheet each page break opens. The breaks are already applied, so the content after one
    // sits at the top of its sheet.
    const originTop = geometry.host.getBoundingClientRect().top
    const sections = []
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'pageBreak') {
        return
      }
      const atSheet = sheetOpenedByBreak(this.view, pos, layout, originTop)
      if (atSheet === null) {
        return
      }
      sections.push({
        atSheet,
        enabled: node.attrs.sectionEnabled,
        position: node.attrs.sectionPosition,
        firstPagePosition: node.attrs.sectionFirstPagePosition,
        format: node.attrs.sectionFormat,
        template: node.attrs.sectionTemplate,
        startAt: node.attrs.sectionStartAt,
      })
    })
    this.storage.pages = computePageNumbers(sheetCount, settings, sections)
    // One record per sheet, so that anything asking which sheet a block is on reads the geometry the
    // engine solved rather than dividing by a pitch that no longer exists when the sheets differ.
    this.storage.sheets = layout.publish(sheetCount)
    // Still published, and still the pitch of the first sheet. A document whose sheets are all the
    // same - which is nearly all of them - is described exactly as it was.
    this.storage.stride = layout.at(0).height + geometry.gap
    // A plain property on the storage, so nothing watching it can see it change. Anything that
    // renders a page number it did not compute has to be told, exactly as the profile list does.
    this.editor?.emit?.('paginationChanged', this.storage.pages)
  }

  /**
   * Draw the sheets.
   *
   * The sheets used to be painted by a repeating gradient on the canvas, which can only repeat one
   * geometry - so a document whose sections differ could not be drawn at all. They are elements now,
   * placed from the same layout the engine solved, which also means there is one answer to where a
   * sheet begins rather than a painted answer and a computed one that could drift apart.
   *
   * Like the page numbers, they are plain elements in the page container rather than decorations:
   * they belong to the sheet, not to the document, and putting them in the flow would change the
   * layout they describe.
   */
  renderSheets(geometry, layout, sheetCount) {
    const { host } = geometry
    if (geometry.web) {
      host
        .querySelectorAll(':scope > .pdoc-page-sheet')
        .forEach((el) => el.remove())
      return
    }
    const existing = [...host.querySelectorAll(':scope > .pdoc-page-sheet')]
    while (existing.length > sheetCount) {
      existing.pop().remove()
    }
    for (let sheet = 0; sheet < sheetCount; sheet += 1) {
      let element = existing[sheet]
      if (!element) {
        element = document.createElement('div')
        element.className = 'pdoc-page-sheet'
        element.setAttribute('contenteditable', 'false')
        element.setAttribute('aria-hidden', 'true')
        element.innerHTML =
          '<i class="pdoc-page-sheet-guide top"></i><i class="pdoc-page-sheet-guide bottom"></i>'
        host.appendChild(element)
      }
      const box = layout.at(sheet)
      const out = (value) => Math.round(value / geometry.scale)
      const style = [
        `left: ${out(box.left ?? 0)}px`,
        `top: ${out(layout.top(sheet))}px`,
        `width: ${out(box.width)}px`,
        `height: ${out(box.height)}px`,
      ].join(';')
      if (element.dataset.geometry !== style) {
        element.dataset.geometry = style
        element.style.cssText = style
        element.children[0].style.top = `${out(box.marginTop)}px`
        element.children[1].style.top = `${out(box.height - box.marginBottom)}px`
      }
    }
  }

  /**
   * Draw the page numbers.
   *
   * These are plain elements in the page container, not decorations: they belong to the sheet, not to
   * the document, and putting them in the document flow would change the very layout they describe.
   * Absolute positioning was measured to survive Chrome's pagination, so the same elements can reach
   * the export - see ADR 0008.
   */
  renderPageNumbers(geometry, layout) {
    const { host } = geometry
    const existing = [...host.querySelectorAll(':scope > .pdoc-page-number')]
    const settings = this.storage?.pageNumber || defaultPageNumberSettings()

    if (!settings.enabled || !(this.storage.pages?.length > 0)) {
      existing.forEach((element) => element.remove())
      return
    }

    const numbers = this.storage.pages.filter(
      (entry) => entry.visible && entry.text !== '',
    )

    while (existing.length > numbers.length) {
      existing.pop().remove()
    }
    numbers.forEach((entry, index) => {
      let element = existing[index]
      if (!element) {
        element = document.createElement('div')
        // The profile class makes this stylable like any other block, through the same Profiles
        // dialog and the same generated stylesheet.
        element.className = 'pdoc-page-number pdoc-profile-page-number'
        element.setAttribute('contenteditable', 'false')
        element.setAttribute('aria-hidden', 'true')
        host.appendChild(element)
      }
      const [edge, align] = entry.position.split('-')
      const box = layout.at(entry.sheet)
      const sheetTop = layout.top(entry.sheet)
      // Sit inside the margin band rather than against the paper edge, which is where a reader
      // expects a folio and where the text column is guaranteed not to reach.
      const top =
        edge === 'top'
          ? sheetTop + Math.max(8, box.marginTop * 0.35)
          : sheetTop + box.height - Math.max(16, box.marginBottom * 0.5)
      const out = (value) => Math.round(value / geometry.scale)
      element.style.cssText = [
        'position: absolute',
        `top: ${out(top)}px`,
        `left: ${out((box.left ?? 0) + box.marginLeft)}px`,
        `right: ${out(geometry.canvasWidth - (box.left ?? 0) - box.width + box.marginRight)}px`,
        `text-align: ${align === 'center' ? 'center' : align}`,
        'pointer-events: none',
        'user-select: none',
      ].join(';')
      // The export has no sheet gaps and works in cm, so it cannot reuse these pixel offsets. It
      // repositions from these three, which describe intent rather than screen geometry.
      element.dataset.sheet = String(entry.sheet)
      element.dataset.edge = edge
      element.dataset.align = align
      if (element.textContent !== entry.text) {
        element.textContent = entry.text
      }
    })
  }

  /**
   * Without this the canvas stops wherever the text happens to end, and the last sheet is drawn as a
   * fragment. Measured from the last laid-out box rather than from the element height, which would
   * feed back into the very property being set.
   */
  padToWholeSheets(geometry, layout, measured = null) {
    // The solve's own last measurement when it has one: measuring again would be one more relayout of
    // the whole document to learn what is already known.
    const lines =
      measured ??
      collectLines(this.view, geometry.host.getBoundingClientRect().top)
    const lastBottom = lines.length > 0 ? lines[lines.length - 1].bottom : 0
    const sheets = Math.max(1, layout.sheetAt(lastBottom) + 1)
    geometry.host.style.setProperty(
      '--pdoc-page-total-height',
      `${Math.round(layout.bottom(sheets - 1) / geometry.scale)}px`,
    )
    return sheets
  }

  destroy() {
    this.destroyed = true
    this.view?.dom
      ?.closest('.pdoc-page-content')
      ?.querySelectorAll(
        ':scope > .pdoc-page-number, :scope > .pdoc-page-sheet',
      )
      .forEach((element) => element.remove())
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export default Pagination
