export const findBoundaryPosition = (view, event, handleWidth) => {
  const gridDOM = event
    .composedPath()
    .find((el) => el.classList?.contains('pdoc-node-column-container'))
  if (!gridDOM) return -1

  const children = Array.from(gridDOM.children).filter((el) =>
    el.classList.contains('pdoc-node-column'),
  )
  for (let i = 0; i < children.length; i++) {
    const colEl = children[i]
    const rect = colEl.getBoundingClientRect()
    // The same 16px band the pointer always had, now centred on the edge instead of reaching into a
    // gap that no longer exists. Deliberately wider than the 2px line it grabs: a divider that can
    // only be caught on its own pixel is a divider nobody catches.
    const reach = handleWidth + 6
    if (
      event.clientX >= rect.right - reach &&
      event.clientX <= rect.right + reach
    ) {
      const pos = view.posAtDOM(colEl, 0)
      if (pos !== null) {
        return pos
      }
    }
  }

  return -1
}

export const draggedWidth = (dragging, event, minWidth) => {
  const offset = event.clientX - dragging.startX
  return Math.max(minWidth, dragging.startWidth + offset)
}

export const updateColumnNodeWidth = (view, pos, attrs, width) => {
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...attrs,
      colWidth: width - 12 * 2,
    }),
  )
}

export const getColumnInfoAtPos = (view, boundaryPos) => {
  const $pos = view.state.doc.resolve(boundaryPos)
  const node = $pos.parent
  if (!node || node.type.name !== 'column') return null

  const dom = view.domAtPos($pos.pos)
  if (!dom.node) return null

  const columnEl =
    dom.node instanceof HTMLElement ? dom.node : dom.node.childNodes[dom.offset]

  const domWidth = columnEl.offsetWidth

  return { $pos, node, columnEl, domWidth }
}
