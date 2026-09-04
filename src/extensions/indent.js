import { Extension } from '@tiptap/core'
import { NodeRange } from '@tiptap/pm/model'
import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { canJoin, liftTarget } from '@tiptap/pm/transform'

import {
  getListItemContext,
  LIST_ITEM_NODE_NAMES,
  LIST_NODE_NAMES,
} from './list-item/utils'

const DEFAULT_INDENT_UNIT = 'em'

const parseIndentConfig = (indentSize, fallbackUnit = DEFAULT_INDENT_UNIT) => {
  if (typeof indentSize === 'number') {
    return Number.isFinite(indentSize)
      ? { value: indentSize, unit: fallbackUnit }
      : null
  }

  if (typeof indentSize !== 'string') {
    return null
  }

  const match = indentSize.trim().match(/^(-?[\d.]+)\s*([a-z%]*)$/i)
  if (!match) {
    return null
  }

  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) {
    return null
  }

  return {
    value,
    unit: match[2] || fallbackUnit,
  }
}

const parseTextIndent = (textIndent, fallbackUnit = DEFAULT_INDENT_UNIT) => {
  if (typeof textIndent !== 'string') {
    return null
  }

  const match = textIndent.trim().match(/^(-?[\d.]+)\s*([a-z%]*)$/i)
  if (!match) {
    return null
  }

  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) {
    return null
  }

  return {
    value,
    unit: match[2] || fallbackUnit,
  }
}

export default Extension.create({
  name: 'indent',
  addOptions() {
    return {
      types: ['heading', 'listItem', 'taskItem', 'paragraph'],
      minLevel: 0,
      maxLevel: 20,
      indentSize: 2,
      defaultUnit: DEFAULT_INDENT_UNIT,
    }
  },
  addGlobalAttributes() {
    const getIndentConfig = () =>
      parseIndentConfig(this.options.indentSize, this.options.defaultUnit)
    const parseElementIndent = (element) => {
      const config = getIndentConfig()
      if (!config) {
        return null
      }
      return parseTextIndent(element.style.textIndent, config.unit)
    }

    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: null,
            renderHTML: (attributes) => {
              const { indent, indentUnit } = attributes
              const { minLevel } = this.options
              if (!indent || indent <= minLevel) {
                return {}
              }
              const config = getIndentConfig()
              if (!config) {
                return {}
              }
              return {
                style: `text-indent: ${indent * config.value}${indentUnit || config.unit};`,
              }
            },
            parseHTML: (element) => {
              const parsedIndent = parseElementIndent(element)
              const config = getIndentConfig()
              if (!parsedIndent || !config?.value) {
                return null
              }
              const level = Math.round(parsedIndent.value / config.value)
              return level > this.options.minLevel ? level : null
            },
          },
          indentUnit: {
            default: null,
            renderHTML: () => ({}),
            parseHTML: (element) => {
              const parsedIndent = parseElementIndent(element)
              const config = getIndentConfig()
              if (!parsedIndent || !config?.value) {
                return null
              }
              const level = Math.round(parsedIndent.value / config.value)
              return level > this.options.minLevel ? parsedIndent.unit : null
            },
          },
        },
      },
    ]
  },
  addCommands() {
    const getIndentConfig = () =>
      parseIndentConfig(this.options.indentSize, this.options.defaultUnit)
    const shouldClampMaxLevel = (indentUnit) => {
      const config = getIndentConfig()
      if (!config) {
        return true
      }
      return !indentUnit || indentUnit === config.unit
    }

    const setNodeIndentMarkup = (tr, pos, delta) => {
      const node = tr.doc.nodeAt(pos)
      if (!node) return tr
      const nextLevel = (node.attrs.indent || 0) + delta
      const { minLevel, maxLevel } = this.options
      let indent = nextLevel
      if (nextLevel < minLevel) indent = minLevel
      if (nextLevel > maxLevel && shouldClampMaxLevel(node.attrs.indentUnit)) {
        indent = maxLevel
      }
      if (indent !== node.attrs.indent) {
        const attrs = { ...node.attrs }
        delete attrs.indent
        delete attrs.indentUnit
        const config = getIndentConfig()
        const nextAttrs =
          indent > minLevel
            ? {
                ...attrs,
                indent,
                indentUnit:
                  node.attrs.indentUnit || config?.unit || DEFAULT_INDENT_UNIT,
              }
            : attrs
        return tr.setNodeMarkup(pos, node.type, nextAttrs, node.marks)
      }
      return tr
    }
    const updateIndentLevel = (tr, delta) => {
      const { doc, selection } = tr
      if (
        selection instanceof TextSelection ||
        selection instanceof AllSelection
      ) {
        const { from, to } = selection
        doc.nodesBetween(from, to, (node, pos) => {
          if (this.options.types.includes(node.type.name)) {
            tr = setNodeIndentMarkup(tr, pos, delta)
            return false
          }
          return true
        })
      }
      return tr
    }
    const applyIndent =
      (direction) =>
      () =>
      ({ tr, state, dispatch }) => {
        tr.setSelection(state.selection)
        tr = updateIndentLevel(tr, direction)
        if (tr.docChanged) {
          if (dispatch) {
            dispatch(tr)
          }
          return true
        }
        return false
      }
    /**
     * Move a list item one level deeper, whatever sits above it.
     *
     * Nesting under the item above is only one of the three shapes this can take, and the editor
     * used to know only that one - so the first item of a list could not be indented at all, and
     * `a.` and `b.` could not be put under a `3.` that began its own list. The other two follow from
     * a list being allowed to hold a list (adr/0014):
     *
     *   - an item above  -> nest under it, which is ProseMirror's own sink
     *   - a list above   -> join the end of that list
     *   - nothing above  -> become a list of one, in place
     *
     * The last two are the same transform: wrap the item in a list, then join it to the list before
     * it if there is one. `wrap` and `join` are steps ProseMirror maps positions through, so the
     * cursor stays where the writer left it.
     */
    const indentListItem = ({ state, dispatch, tr, commands }) => {
      const context = getListItemContext(state)
      if (!context) {
        return false
      }
      const { listNode, listItemIndex, listItemNode, listItemPos, listDepth } =
        context
      const previous =
        listItemIndex > 0 ? listNode.child(listItemIndex - 1) : null

      if (previous && LIST_ITEM_NODE_NAMES.has(previous.type.name)) {
        return listNode.type.name === 'orderedList'
          ? commands.sinkOrderedListItemWithType()
          : commands.sinkListItem(context.itemTypeName)
      }

      const range = new NodeRange(
        state.doc.resolve(listItemPos + 1),
        state.doc.resolve(listItemPos + listItemNode.nodeSize - 1),
        listDepth,
      )
      const wrapping = [
        { type: listNode.type, attrs: { ...listNode.attrs, start: 1 } },
      ]
      if (dispatch) {
        tr.wrap(range, wrapping)
        // The new list opens where the item did. Joining is what makes a second indented item land
        // in the same list as the first rather than starting its own count.
        if (canJoin(tr.doc, listItemPos)) {
          tr.join(listItemPos)
        }
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    /**
     * Move a list item one level out.
     *
     * When its list sits directly in another list there is no item to lift out of, and
     * `liftListItem` would carry the item out of the lists entirely - from level 1 straight to a
     * plain paragraph, skipping level 0. Lifting the item into the list above is now a legal shape,
     * so `lift` does it and the levels stay in order.
     */
    const outdentListItem = ({ state, dispatch, tr, commands }) => {
      const context = getListItemContext(state)
      if (!context) {
        return false
      }
      const parentOfList =
        context.listDepth > 0 ? context.$pos.node(context.listDepth - 1) : null
      if (!parentOfList || !LIST_NODE_NAMES.has(parentOfList.type.name)) {
        return commands.liftListItem(context.itemTypeName)
      }

      const range = new NodeRange(
        state.doc.resolve(context.listItemPos + 1),
        state.doc.resolve(context.listItemPos + context.listItemNode.nodeSize - 1),
        context.listDepth,
      )
      const target = liftTarget(range)
      if (target === null || target === undefined) {
        return commands.liftListItem(context.itemTypeName)
      }
      if (dispatch) {
        tr.lift(range, target)
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    /**
     * Indent the list the cursor is actually in.
     *
     * This used to ask `editor.isActive('orderedList')` first, which is true for anything with an
     * ordered list anywhere above it - including a bullet list nested inside one. It then ran the
     * ordered-list command, which refuses a parent that is not an ordered list, and Tab did nothing
     * at all. Measured on `1. Satu` with two bullets under it: indenting the second bullet, which
     * has a sibling directly above it to nest under, silently failed.
     *
     * The list item's own context says which list it is in and which kind of item it is, so there
     * is nothing to guess.
     */
    const handleListIndent =
      (direction) =>
      () =>
      ({ commands, tr, state, dispatch }) => {
        if (getListItemContext(state)) {
          return direction > 0
            ? indentListItem({ state, dispatch, tr, commands })
            : outdentListItem({ state, dispatch, tr, commands })
        }
        return applyIndent(direction)()({ tr, state, dispatch })
      }
    return {
      setIndent: handleListIndent(1),
      setOutdent: handleListIndent(-1),
    }
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.setIndent(),
      'Shift-Tab': () => this.editor.commands.setOutdent(),
    }
  },
})
