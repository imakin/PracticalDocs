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

/**
 * Every box that must stay inside a text column: one entry per rendered line of text, plus embedded
 * media, which has no line boxes of its own.
 */
const collectBoxes = (view, originTop) => {
  const boxes = []
  const push = (rect, source) => {
    if (rect.height <= 0 || rect.width <= 0) {
      return
    }
    boxes.push({ top: rect.top - originTop, bottom: rect.bottom - originTop, clientTop: rect.top, source })
  }

  const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) {
      continue
    }
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      push(rect, { kind: 'text', node })
    }
  }
  for (const el of view.dom.querySelectorAll('img, video, iframe, canvas, svg')) {
    push(el.getBoundingClientRect(), { kind: 'element', el })
  }

  boxes.sort((a, b) => a.top - b.top)
  return boxes
}

const charTop = (node, index) => {
  const range = document.createRange()
  range.setStart(node, index)
  range.setEnd(node, index + 1)
  const rects = range.getClientRects()
  return rects.length > 0 ? rects[0].top : null
}

/**
 * Document position of the first character of the line the box belongs to.
 *
 * Deliberately not `posAtCoords`: that maps a viewport point, and the line that overflows a page is
 * usually scrolled far out of view, where it returns nothing usable. Character rect tops rise
 * monotonically inside one text node, so the first character of the line can be binary-searched
 * instead, which does not care where the viewport happens to be.
 */
const positionAtBoxStart = (view, box) => {
  if (box.source.kind === 'element') {
    try {
      return view.posAtDOM(box.source.el, 0)
    } catch {
      return null
    }
  }
  const { node } = box.source
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
    if (top >= box.clientTop - 0.5) {
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

const firstOverflowing = (boxes, metrics) => {
  for (const box of boxes) {
    const index = Math.floor(box.top / metrics.stride)
    const columnBottom = index * metrics.stride + metrics.pageHeight - metrics.marginBottom
    if (box.bottom > columnBottom + TOLERANCE) {
      return { box, index }
    }
  }
  return null
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
        const overflow = firstOverflowing(collectBoxes(this.view, originTop), metrics)
        if (!overflow) {
          break
        }
        const nextColumnTop = (overflow.index + 1) * metrics.stride + metrics.marginTop
        const height = nextColumnTop - overflow.box.top
        if (height <= 0) {
          break
        }
        const pos = positionAtBoxStart(this.view, overflow.box)
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
    const boxes = collectBoxes(this.view, originTop)
    const lastBottom = boxes.length > 0 ? boxes[boxes.length - 1].bottom : 0
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
