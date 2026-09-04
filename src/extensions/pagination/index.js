import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import {
  computePageNumbers,
  defaultPageNumberSettings,
} from '@/utils/page-numbering'

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

// A document longer than this many sheets stops being repaginated rather than looping.
const MAX_SHEETS = 500
// Quiet period before re-paginating, so typing does not repaginate on every keystroke.
const RECOMPUTE_DELAY = 200
// Sub-pixel slack: line boxes and cm-to-px conversion both round.
const TOLERANCE = 1

const readMetrics = (view) => {
  const sheet = view.dom.closest('.umo-page-content')
  if (!sheet) {
    return null
  }
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px;top:0;left:0'
  sheet.appendChild(ruler)
  const measure = (name, fallback) => {
    ruler.style.height = `var(${name}, ${fallback})`
    return ruler.getBoundingClientRect().height
  }
  const pageHeight = measure('--umo-page-height', '29.7cm')
  const marginTop = measure('--umo-page-margin-top', '0cm')
  const marginBottom = measure('--umo-page-margin-bottom', '0cm')
  const gap = measure('--umo-page-sheet-gap', '16px')
  const marginLeft = measure('--umo-page-margin-left', '0cm')
  const marginRight = measure('--umo-page-margin-right', '0cm')
  ruler.remove()

  const column = pageHeight - marginTop - marginBottom
  if (!(pageHeight > 0) || !(column > 0)) {
    return null
  }
  return {
    sheet,
    pageHeight,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    gap,
    column,
    stride: pageHeight + gap,
  }
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, pre, figcaption, div'

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
      lineHeights.set(block, Number.parseFloat(getComputedStyle(block).lineHeight))
    }
    const lineHeight = lineHeights.get(block)
    if (!Number.isFinite(lineHeight) || lineHeight <= rect.height) {
      return 0
    }
    return (lineHeight - rect.height) / 2
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

  const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) {
      continue
    }
    const block = blockOf(node)
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      add(rect, block, node, `${Math.round(rect.top)}`)
    }
  }
  for (const element of view.dom.querySelectorAll('img, video, iframe, canvas, svg')) {
    const rect = element.getBoundingClientRect()
    add(rect, blockOf(element), element, `media-${Math.round(rect.top)}-${Math.round(rect.left)}`)
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
  while (sibling?.classList?.contains('umo-page-spacer')) {
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
 * `.umo-page-break` carries `break-before: page`, which print honours and this engine used to ignore
 * entirely, so the screen kept flowing where the export started a new page and every sheet after the
 * break inherited the difference. In print the element collapses to zero height, so it is the content
 * *after* the break that opens the new page - which is why the spacer is anchored after the node
 * rather than before it.
 */
const forcedBreaks = (view, originTop, metrics) => {
  const found = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'pageBreak') {
      return
    }
    const after = pos + node.nodeSize
    const contentTop = contentTopAfterBreak(view, pos, node)
    if (contentTop === null) {
      return
    }
    const top = contentTop - originTop
    const sheet = Math.floor(top / metrics.stride)
    const columnTop = sheet * metrics.stride + metrics.marginTop
    // Already opening a column: print would not push it either, and a spacer here would insert a
    // whole blank sheet.
    if (top <= columnTop + TOLERANCE) {
      return
    }
    found.push({ pos: after, top })
  })
  return found.sort((a, b) => a.top - b.top)
}

const firstOverflowing = (lines, metrics) => {
  for (const line of lines) {
    const index = Math.floor(line.top / metrics.stride)
    const columnBottom = index * metrics.stride + metrics.pageHeight - metrics.marginBottom
    if (line.bottom > columnBottom + TOLERANCE) {
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
  const range = document.createRange()
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
const positionAtLineStart = (view, line) => {
  const node = line.source
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    try {
      return view.posAtDOM(node, 0)
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
    return beforeBlockIfAtItsStart(view, view.posAtDOM(node, answer))
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
    const insideListItem = LIST_ITEM_NODES.has($pos.parent?.type?.name)
    if (!$pos.parent?.isTextblock && !insideListItem) {
      return pos
    }
    let depth = $pos.depth
    // Walk out of every list structure this line also begins.
    //
    // A list item's marker is drawn beside its content, not inside it, so a spacer anchored inside
    // the item moves the text and leaves the marker on the page before - and the marker is a text
    // node the engine counts as a line, so that line never moves however many breaks are placed.
    // The solve then cannot get past it: the same line overflows every round, the anchor is never
    // beyond the previous one, and the loop gives up. Everything after that point stops being
    // paginated, a manual page break included.
    //
    // Measured on a forty item list: one spacer and then nothing, the list running off the sheet,
    // and a page break added below it doing nothing at all.
    while (
      depth > 1 &&
      $pos.index(depth - 1) === 0 &&
      LIST_STRUCTURE.has($pos.node(depth - 1).type.name)
    ) {
      depth -= 1
    }
    return $pos.before(depth)
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
const sheetOpenedByBreak = (view, pos, metrics, originTop) => {
  const dom = view.nodeDOM(pos)
  if (!dom?.getBoundingClientRect) {
    return null
  }
  const top = dom.getBoundingClientRect().top - originTop
  const sheet = Math.floor(top / metrics.stride)
  const columnTop = sheet * metrics.stride + metrics.marginTop
  return top <= columnTop + TOLERANCE ? sheet : sheet + 1
}

const buildDecorations = (doc, breaks) =>
  DecorationSet.create(
    doc,
    breaks.map((item, index) =>
      Decoration.widget(
        item.pos,
        () => {
          const spacer = document.createElement('span')
          spacer.className = 'umo-page-spacer'
          spacer.setAttribute('contenteditable', 'false')
          spacer.setAttribute('aria-hidden', 'true')
          spacer.style.display = 'block'
          spacer.style.height = `${item.height}px`
          return spacer
        },
        {
          // -1 keeps the spacer before the character it is anchored to, so that character opens the
          // next sheet instead of being stranded at the bottom of this one.
          side: -1,
          key: `umo-page-spacer-${index}-${Math.round(item.height)}`,
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
    const range = document.createRange()
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
  const stride = storage?.stride
  const host = editor?.view?.dom?.closest('.umo-page-content')
  if (!element || !host || !(stride > 0) || !(pages?.length > 0)) {
    return null
  }
  const top = firstTextTop(element) - host.getBoundingClientRect().top
  const sheet = Math.min(pages.length - 1, Math.max(0, Math.floor(top / stride)))
  return pages[sheet] ?? null
}

export const Pagination = Extension.create({
  name: 'pagination',

  addStorage() {
    // `pages` is the computed number of every sheet, and `stride` the sheet pitch in pixels; both
    // are written by the driver on every solve so that anything needing the page a block is on reads
    // one answer rather than computing a second.
    return { pageNumber: defaultPageNumberSettings(), pages: [], stride: 0 }
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
    this.schedule()
  }

  update(view, previousState) {
    this.view = view
    // Ignore the transactions this driver dispatches itself; reacting to them is what turned the
    // previous engine into a loop that never settled.
    if (this.solving) {
      return
    }
    if (view.state.doc !== previousState.doc) {
      this.schedule()
      return
    }
    const before = paginationPluginKey.getState(previousState)?.refresh
    const after = paginationPluginKey.getState(view.state)?.refresh
    if (before !== after) {
      this.schedule()
    }
  }

  schedule() {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.solve()
    }, RECOMPUTE_DELAY)
  }

  applyBreaks(breaks) {
    const { tr } = this.view.state
    tr.setMeta(paginationPluginKey, buildDecorations(this.view.state.doc, breaks))
    tr.setMeta('addToHistory', false)
    tr.setMeta('preventUpdate', true)
    this.view.dispatch(tr)
  }

  solve() {
    const metrics = readMetrics(this.view)
    if (!metrics) {
      return
    }
    this.solving = true
    try {
      // Start from the unpaginated layout every time. Measuring while the previous spacers are still
      // in place would find nothing overflowing - they are the reason nothing overflows - and the
      // engine would conclude the document needs no breaks and drop the ones holding it together.
      // Dispatching is synchronous, so the DOM read below is already the natural layout.
      this.applyBreaks([])
      const breaks = []
      let lastPos = -1
      for (let guard = 0; guard < MAX_SHEETS; guard += 1) {
        const originTop = metrics.sheet.getBoundingClientRect().top
        const lines = collectLines(this.view, originTop)
        const overflow = firstOverflowing(lines, metrics)
        const forced = forcedBreaks(this.view, originTop, metrics).find(
          (item) => item.pos > lastPos,
        )
        if (!overflow && !forced) {
          break
        }
        let chosen = null
        // Whichever comes first down the page wins. A forced break above the overflow has to be
        // taken first, or the sheet it lands on is already the wrong one.
        if (forced && (!overflow || forced.top <= overflow.top)) {
          chosen = { top: forced.top, pos: forced.pos }
        } else if (overflow) {
          // A block long enough to span several sheets gets broken more than once, and the widow and
          // orphan adjustment counts from the start of the block, so it can point at a line above the
          // previous break. Breaking exactly at the overflow is then the only way forward; giving up
          // here would leave the rest of the document unpaginated.
          const candidates = [respectWidowsAndOrphans(lines, overflow), overflow]
          for (const candidate of candidates) {
            const at = positionAtLineStart(this.view, candidate)
            if (at !== null && at > lastPos) {
              chosen = { top: candidate.top, pos: at }
              break
            }
          }
        }
        // Nothing left that can be moved. Stop rather than spin: a single unbreakable box taller
        // than a column would otherwise loop forever.
        if (!chosen) {
          break
        }
        const sheet = Math.floor(chosen.top / metrics.stride)
        const nextColumnTop = (sheet + 1) * metrics.stride + metrics.marginTop
        const height = nextColumnTop - chosen.top
        if (height <= 0) {
          break
        }
        lastPos = chosen.pos
        breaks.push({ pos: chosen.pos, height })
        this.applyBreaks(breaks)
      }
      const sheets = this.padToWholeSheets(metrics)
      this.publishPages(metrics, sheets)
      this.renderPageNumbers(metrics)
    } finally {
      this.solving = false
    }
  }

  /**
   * Work out what every sheet is numbered and publish it, whether or not the numbers are drawn.
   *
   * The table of contents needs the same answer, and it used to compute its own by counting
   * `.umo-page-node` elements - of which there is one for the whole canvas, so every entry came out
   * as page 1. Two answers to one question is what produced the pagination-versus-PDF bug in
   * ADR 0002, so there is one computation here and everything else reads it.
   *
   * Published even when numbering is off: the page a heading is on is a fact about the document, and
   * a reader still wants it in the contents when no folio is printed.
   */
  publishPages(metrics, sheetCount) {
    const settings = this.storage?.pageNumber || defaultPageNumberSettings()
    // Which sheet each page break opens. The breaks are already applied, so the content after one
    // sits at the top of its sheet.
    const originTop = metrics.sheet.getBoundingClientRect().top
    const sections = []
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'pageBreak') {
        return
      }
      const atSheet = sheetOpenedByBreak(this.view, pos, metrics, originTop)
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
    this.storage.stride = metrics.stride
    // A plain property on the storage, so nothing watching it can see it change. Anything that
    // renders a page number it did not compute has to be told, exactly as the profile list does.
    this.editor?.emit?.('paginationChanged', this.storage.pages)
  }

  /**
   * Draw the page numbers.
   *
   * These are plain elements in the page container, not decorations: they belong to the sheet, not to
   * the document, and putting them in the document flow would change the very layout they describe.
   * Absolute positioning was measured to survive Chrome's pagination, so the same elements can reach
   * the export - see ADR 0008.
   */
  renderPageNumbers(metrics) {
    const host = metrics.sheet
    const existing = [...host.querySelectorAll(':scope > .umo-page-number')]
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
        element.className = 'umo-page-number umo-profile-page-number'
        element.setAttribute('contenteditable', 'false')
        element.setAttribute('aria-hidden', 'true')
        host.appendChild(element)
      }
      const [edge, align] = entry.position.split('-')
      // Sit inside the margin band rather than against the paper edge, which is where a reader
      // expects a folio and where the text column is guaranteed not to reach.
      const top =
        edge === 'top'
          ? entry.sheet * metrics.stride + Math.max(8, metrics.marginTop * 0.35)
          : entry.sheet * metrics.stride +
            metrics.pageHeight -
            Math.max(16, metrics.marginBottom * 0.5)
      element.style.cssText = [
        'position: absolute',
        `top: ${Math.round(top)}px`,
        `left: ${Math.round(metrics.marginLeft)}px`,
        `right: ${Math.round(metrics.marginRight)}px`,
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
  padToWholeSheets(metrics) {
    const originTop = metrics.sheet.getBoundingClientRect().top
    const lines = collectLines(this.view, originTop)
    const lastBottom = lines.length > 0 ? lines[lines.length - 1].bottom : 0
    const sheets = Math.max(1, Math.floor(lastBottom / metrics.stride) + 1)
    metrics.sheet.style.setProperty(
      '--umo-page-total-height',
      `${sheets * metrics.stride - metrics.gap}px`,
    )
    return sheets
  }

  destroy() {
    this.view?.dom
      ?.closest('.umo-page-content')
      ?.querySelectorAll(':scope > .umo-page-number')
      .forEach((element) => element.remove())
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export default Pagination
