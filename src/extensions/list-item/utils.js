import nzh from 'nzh'

export const LIST_ITEM_NODE_NAMES = new Set(['listItem', 'taskItem'])
export const LIST_NODE_NAMES = new Set(['orderedList', 'bulletList', 'taskList'])
const BULLET_MARKERS = {
  disc: '•',
  circle: '◦',
  square: '▪',
}
const metricResizeCallbacks = new WeakMap()
let listItemMetricResizeObserver = null

/**
 * How many list items come before a child index, ignoring nested lists.
 *
 * A list may hold a list directly (adr/0014), so a child index is no longer an item ordinal.
 */
const countItemsBefore = (listNode, childIndex) => {
  let count = 0
  for (let index = 0; index < childIndex; index += 1) {
    if (LIST_ITEM_NODE_NAMES.has(listNode.child(index)?.type?.name)) {
      count += 1
    }
  }
  return count
}

export const normalizeOrderedListStart = (value) => {
  const nextValue = Number(value)
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1
}

const toRoman = (value) => {
  if (!Number.isInteger(value) || value <= 0) {
    return String(value || '')
  }
  const map = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let current = value
  let result = ''
  map.forEach(([number, symbol]) => {
    while (current >= number) {
      result += symbol
      current -= number
    }
  })
  return result
}

const toLatin = (value) => {
  if (!Number.isInteger(value) || value <= 0) {
    return String(value || '')
  }
  let current = value
  let result = ''
  while (current > 0) {
    current -= 1
    result = String.fromCharCode(97 + (current % 26)) + result
    current = Math.floor(current / 26)
  }
  return result
}

/**
 * What a marker says, one level at a time.
 *
 * A marker used to be every level's number joined with dots and a dot on the end, and there was no
 * way to say anything else - a sub-item under `2.` read `2.a.` and could not be made to read `a.`,
 * which is an element of the page the writer could not control.
 *
 * A template is a property of the list, so every item in it agrees. `{number}` is this level's own
 * value in this list's numerals, `{parent}` is the marker of the level above, already rendered by
 * its own template. `2.a.` is `{parent}{number}.` all the way down, which is the default; `a.` is
 * `{number}.`, and `2. a` is `{parent} {number}`.
 *
 * An empty template is a marker that says nothing, and is allowed - the same freedom the page number
 * template has. `null` means the writer has not set one, which is not the same as setting an empty
 * one.
 */
export const DEFAULT_MARKER_TEMPLATE = '{parent}{number}.'

export const renderMarkerTemplate = (template, parent, number) => {
  const source =
    typeof template === 'string' ? template : DEFAULT_MARKER_TEMPLATE
  return source.replace(/\{parent\}/g, parent).replace(/\{number\}/g, number)
}

export const formatOrderedValue = (value, listType) => {
  switch (listType) {
    case 'decimal-leading-zero':
      return value < 10 ? `0${value}` : String(value)
    case 'lower-roman':
      return toRoman(value).toLowerCase()
    case 'upper-roman':
      return toRoman(value)
    case 'lower-latin':
      return toLatin(value)
    case 'upper-latin':
      return toLatin(value).toUpperCase()
    case 'trad-chinese-informal':
      return nzh.cn.encodeS(value)
    case 'simp-chinese-formal':
      return nzh.cn.encodeB(value)
    default:
      return String(value)
  }
}

const getListItemResolvedPos = (state, listItemPos = null) => {
  if (!state) {
    return null
  }

  if (typeof listItemPos === 'number') {
    return state.doc.resolve(listItemPos + 1)
  }

  return state.selection.$from
}

const getListItemDepth = ($pos) => {
  if (!$pos) {
    return null
  }

  const { depth: maxDepth } = $pos
  for (let depth = maxDepth; depth > 0; depth -= 1) {
    const { type } = $pos.node(depth)
    if (LIST_ITEM_NODE_NAMES.has(type?.name)) {
      return depth
    }
  }

  return null
}

export const getListItemContext = (state, listItemPos = null) => {
  const $pos = getListItemResolvedPos(state, listItemPos)
  if (!$pos) {
    return null
  }

  const listItemDepth = getListItemDepth($pos)
  if (listItemDepth === null) {
    return null
  }

  const listDepth = listItemDepth - 1
  const listNode = $pos.node(listDepth)
  if (!LIST_NODE_NAMES.has(listNode?.type?.name)) {
    return null
  }

  const listItemNode = $pos.node(listItemDepth)
  const listPos = $pos.before(listDepth)
  const resolvedListItemPos = $pos.before(listItemDepth)
  const listItemIndex = $pos.index(listDepth)

  const baseContext = {
    $pos,
    listDepth,
    listPos,
    listNode,
    listTypeName: listNode.type.name,
    listItemDepth,
    listItemNode,
    listItemPos: resolvedListItemPos,
    listItemIndex,
    itemTypeName: listItemNode.type.name,
    checked: listItemNode.attrs?.checked === true,
    // What the reader sees as the indentation, and the only thing a count is keyed on.
    indentLevel: getListLevelAt($pos.doc, listPos),
  }

  if (listNode.type.name === 'orderedList') {
    const orderedListStart = normalizeOrderedListStart(listNode.attrs.start)
    const currentNumber = orderedListStart + countItemsBefore(listNode, listItemIndex)
    let markerText = ''
    // The marker of everything above this item's own level, which is what `{parent}` stands for.
    let parentMarkerText = ''

    // One segment per ordered list on the way down, and each segment is the number of the item that
    // owns the level below it.
    //
    // Counted in items, not in children, because a list can now be a child of a list: a nested list
    // sitting between two items must not consume a number, or the item after it would be numbered
    // one too high.
    //
    // A level whose nested list has no item above it contributes no segment at all. That is the
    // empty level 0 - the writer indented the first item of a list, so there is no parent number,
    // and printing one would be inventing it.
    for (let depth = 1; depth < listItemDepth; depth += 1) {
      const currentNode = $pos.node(depth)
      if (currentNode?.type?.name !== 'orderedList') {
        continue
      }
      const childIndex = $pos.index(depth)
      const itemsBefore = countItemsBefore(currentNode, childIndex)
      const start = normalizeOrderedListStart(currentNode.attrs.start)
      const child = currentNode.child(childIndex)

      if (depth === listDepth) {
        parentMarkerText = markerText
      }
      if (LIST_ITEM_NODE_NAMES.has(child?.type?.name)) {
        markerText = renderMarkerTemplate(
          currentNode.attrs.template,
          markerText,
          formatOrderedValue(start + itemsBefore, currentNode.attrs.listType),
        )
        continue
      }
      if (itemsBefore > 0) {
        // A nested list belongs to the last item above it.
        markerText = renderMarkerTemplate(
          currentNode.attrs.template,
          markerText,
          formatOrderedValue(start + itemsBefore - 1, currentNode.attrs.listType),
        )
      }
    }

    return {
      ...baseContext,
      orderedListDepth: listDepth,
      orderedListPos: listPos,
      orderedListNode: listNode,
      orderedListStart,
      currentNumber,
      markerText,
      parentMarkerText,
    }
  }

  if (listNode.type.name === 'bulletList') {
    const listType = listNode.attrs.listType || 'disc'

    return {
      ...baseContext,
      listType,
      markerText: BULLET_MARKERS[listType] || BULLET_MARKERS.disc,
    }
  }

  return {
    ...baseContext,
    markerText: '',
  }
}

export const getOrderedListContext = (state, listItemPos = null) => {
  const context = getListItemContext(state, listItemPos)
  return context?.listTypeName === 'orderedList' ? context : null
}

export const getActiveListItemPos = (state) =>
  getListItemContext(state)?.listItemPos ?? null

/**
 * How deeply a list is nested, counted in lists rather than in document depth.
 *
 * Level 0 is a list that sits in the document, level 1 a list inside a list item, and so on. Every
 * kind of list counts, because the level is meant to say what the reader sees - a numbered list
 * inside a bullet list is indented once, the same as one inside a numbered list, so the two are at
 * the same level and share one count.
 */
export const getListLevelAt = (doc, listPos) => {
  const $pos = doc.resolve(listPos)
  let level = 0
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if (LIST_NODE_NAMES.has($pos.node(depth)?.type?.name)) {
      level += 1
    }
  }
  return level
}

/**
 * The last number used at one indent level, anywhere before a position.
 *
 * This is the whole rule for continuing a count, and it is deliberately the only one. It does not
 * ask what sits between the two lists: a paragraph, an image, a table, a page break or a new
 * chapter makes no difference, because none of those is a number at this level. It does not ask
 * whether the lists share a parent either - the previous one may be in another section entirely.
 *
 * The list holding `before` is counted like any other: only its items above `before` are, which is
 * what makes continuing at the third item of a list of five mean the number the second item had.
 *
 * Returns null when nothing at this level precedes the position, which is a list that has nothing
 * to continue from and therefore starts at 1.
 */
export const getLastOrderedNumberBefore = (doc, before, level) => {
  let last = null

  doc.descendants((node, pos) => {
    if (pos >= before) {
      return false
    }
    if (node.type.name !== 'orderedList') {
      return true
    }
    if (getListLevelAt(doc, pos) !== level) {
      return true
    }

    const start = normalizeOrderedListStart(node.attrs.start)
    let counted = 0
    node.forEach((child, offset) => {
      // `pos + 1` is the first child's position; a child before the cut counts, one after it does
      // not. For a list that ends before the cut this counts every item. Nested lists are children
      // too now, and are not numbers at this level, so they do not count.
      if (pos + 1 + offset < before && LIST_ITEM_NODE_NAMES.has(child.type.name)) {
        counted += 1
      }
    })
    if (counted > 0) {
      last = start + counted - 1
    }
    return true
  })

  return last
}

/**
 * The number this item takes when the writer asks it to continue.
 *
 * One line, because there is one rule: the last number at this indent level, plus one.
 */
export const getContinueOrderedListStart = (context) => {
  if (!context) {
    return null
  }
  const last = getLastOrderedNumberBefore(
    context.$pos.doc,
    context.listItemPos,
    context.indentLevel,
  )
  return (last ?? 0) + 1
}

const LIST_STRUCTURE_NODE_NAMES = new Set([
  'orderedList',
  'bulletList',
  'taskList',
  'listItem',
  'taskItem',
])

const hasListNodeInRange = (doc, from, to) => {
  let found = false

  doc.nodesBetween(from, to, (node) => {
    if (LIST_STRUCTURE_NODE_NAMES.has(node.type?.name)) {
      found = true
      return false
    }
    return true
  })

  return found
}

export const hasListStructureChange = (tr) => {
  if (!tr.docChanged) {
    return false
  }

  let changed = false

  tr.mapping.maps.forEach((map) => {
    if (changed) {
      return
    }

    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (changed) {
        return
      }

      const from = Math.max(0, Math.min(newStart, newEnd) - 1)
      const to = Math.min(tr.doc.content.size, Math.max(newStart, newEnd) + 1)

      if (hasListNodeInRange(tr.doc, from, to)) {
        changed = true
      }
    })
  })

  return changed
}

const getListItemMetricResizeObserver = () => {
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') {
    return null
  }

  if (!listItemMetricResizeObserver) {
    listItemMetricResizeObserver = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        metricResizeCallbacks.get(target)?.()
      })
    })
  }

  return listItemMetricResizeObserver
}

export const observeListItemMetricResize = (element, callback) => {
  if (!element || typeof callback !== 'function') {
    return
  }

  metricResizeCallbacks.set(element, callback)
  getListItemMetricResizeObserver()?.observe(element)
}

export const unobserveListItemMetricResize = (element) => {
  if (!element) {
    return
  }

  metricResizeCallbacks.delete(element)
  getListItemMetricResizeObserver()?.unobserve(element)
}
