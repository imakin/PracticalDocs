import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
  ruler.remove()

  const column = pageHeight - marginTop - marginBottom
  if (!(pageHeight > 0) || !(column > 0)) {
    return null
  }
  return { sheet, pageHeight, marginTop, marginBottom, gap, column, stride: pageHeight + gap }
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
  const add = (rect, block, node, key) => {
    if (rect.height <= 0 || rect.width <= 0) {
      return
    }
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        block,
        top: rect.top - originTop,
        bottom: rect.bottom - originTop,
        clientTop: rect.top,
        left: rect.left,
        source: node,
      })
      return
    }
    existing.top = Math.min(existing.top, rect.top - originTop)
    existing.bottom = Math.max(existing.bottom, rect.bottom - originTop)
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
    return view.posAtDOM(node, answer)
  } catch {
    return null
  }
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

export const Pagination = Extension.create({
  name: 'pagination',

  addCommands() {
    return {
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
        view: (editorView) => new PaginationDriver(editorView),
      }),
    ]
  },
})

class PaginationDriver {
  constructor(view) {
    this.view = view
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
        if (!overflow) {
          break
        }
        const target = respectWidowsAndOrphans(lines, overflow)
        const sheet = Math.floor(target.top / metrics.stride)
        const nextColumnTop = (sheet + 1) * metrics.stride + metrics.marginTop
        const height = nextColumnTop - target.top
        if (height <= 0) {
          break
        }
        const pos = positionAtLineStart(this.view, target)
        // No position, or no forward progress, means this box cannot be moved. Stop rather than
        // spin: a single unbreakable box taller than a column would otherwise loop forever.
        if (pos === null || pos <= lastPos) {
          break
        }
        lastPos = pos
        breaks.push({ pos, height })
        this.applyBreaks(breaks)
      }
      this.padToWholeSheets(metrics)
    } finally {
      this.solving = false
    }
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
  }

  destroy() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export default Pagination
