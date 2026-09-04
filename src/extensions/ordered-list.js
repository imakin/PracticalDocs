import { OrderedList } from '@tiptap/extension-list'
import { Fragment, Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { ReplaceAroundStep } from '@tiptap/pm/transform'

import {
  getContinueOrderedListStart,
  getOrderedListContext,
  normalizeOrderedListStart,
} from './list-item/utils'

const focusListItem = (tr, listItemPos) => {
  const nextPos = Math.min(listItemPos + 2, tr.doc.content.size)
  return tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos)))
}

/*
 * There was a `syncNestedOrderedListType` here, called by every command that sets a start value. It
 * walked the whole list and rewrote the `listType` of every list nested inside it to match the
 * outer one.
 *
 * Nothing asked it to. Choosing Reset Counter on item 4 turned `2.a` and `2.b` into `2.1` and `2.2`,
 * because resetting a count also rewrote the numerals of every nested list - a change to a level the
 * writer was not even pointing at. A command that is asked to set a start sets a start.
 *
 * Changing the numeral style has its own route, `Number Type`, which updates the one list the cursor
 * is in and leaves the rest alone.
 */

const updateOrderedListStart = (tr, context, start) => {
  tr.setNodeMarkup(context.orderedListPos, undefined, {
    ...context.orderedListNode.attrs,
    start: normalizeOrderedListStart(start),
  })
  return focusListItem(tr, context.listItemPos)
}

const splitOrderedListAtItem = (tr, context, start) => {
  const firstChildren = []
  const secondChildren = []

  context.orderedListNode.forEach((child, _offset, index) => {
    if (index < context.listItemIndex) {
      firstChildren.push(child)
      return
    }
    secondChildren.push(child)
  })

  const firstList = context.orderedListNode.type.create(
    {
      ...context.orderedListNode.attrs,
      start: context.orderedListStart,
    },
    firstChildren,
  )
  const secondList = context.orderedListNode.type.create(
    {
      ...context.orderedListNode.attrs,
      start: normalizeOrderedListStart(start),
    },
    secondChildren,
  )

  tr.replace(
    context.orderedListPos,
    context.orderedListPos + context.orderedListNode.nodeSize,
    new Slice(Fragment.fromArray([firstList, secondList]), 0, 0),
  )

  const secondListPos = context.orderedListPos + firstList.nodeSize
  return focusListItem(tr, secondListPos + 1)
}

const applyOrderedListStartAtItem = (tr, context, start) => {
  return context.listItemIndex > 0
    ? splitOrderedListAtItem(tr, context, start)
    : updateOrderedListStart(tr, context, start)
}

/**
 * Whether a start would leave the numbering exactly as it is.
 *
 * The one guard all three commands share, and it is about the document rather than about the menu:
 * every command stays offered whatever the state, because a writer cannot tell why an item is
 * greyed out and the old menu greyed out the important one most of the time. This only stops a
 * transaction that would change nothing from being dispatched, which would otherwise mark the
 * document unsaved for a click that did nothing.
 */
const isOrderedListStartUnchanged = (context, start) => {
  const nextStart = normalizeOrderedListStart(start)

  return context.listItemIndex === 0
    ? nextStart === context.orderedListStart
    : nextStart === context.currentNumber
}

const withOrderedListContext =
  ({ listItemPos, getStart, shouldSkip }) =>
  ({ state, dispatch }) => {
    const context = getOrderedListContext(state, listItemPos)
    if (!context) {
      return false
    }

    if (shouldSkip?.(context)) {
      return true
    }

    const nextStart = normalizeOrderedListStart(getStart(context))
    const tr = applyOrderedListStartAtItem(state.tr, context, nextStart)

    if (dispatch) {
      dispatch(tr.scrollIntoView())
    }

    return true
  }

const createOrderedListStartCommand =
  ({ getStart, shouldSkip }) =>
  ({ listItemPos, start } = {}) =>
    withOrderedListContext({
      listItemPos,
      getStart: (context) => getStart(context, start),
      shouldSkip: shouldSkip
        ? (context) => shouldSkip(context, start)
        : undefined,
    })

const sinkOrderedListItemWithType =
  () =>
  ({ state, dispatch }) => {
    const { orderedList, listItem } = state.schema.nodes
    if (!orderedList || !listItem) {
      return false
    }

    const { $from, $to } = state.selection
    const range = $from.blockRange(
      $to,
      (node) => node.childCount > 0 && node.firstChild?.type === listItem,
    )
    if (!range || range.startIndex === 0 || range.parent.type !== orderedList) {
      return false
    }

    const nodeBefore = range.parent.child(range.startIndex - 1)
    if (nodeBefore.type !== listItem) {
      return false
    }

    if (dispatch) {
      const nestedList =
        nodeBefore.lastChild?.type === orderedList ? nodeBefore.lastChild : null
      const nestedBefore = !!nestedList
      const inner = Fragment.from(nestedBefore ? listItem.create() : null)
      const nestedListAttrs = nestedList
        ? nestedList.attrs
        : { ...range.parent.attrs, start: 1 }
      const slice = new Slice(
        Fragment.from(
          listItem.create(
            null,
            Fragment.from(orderedList.create(nestedListAttrs, inner)),
          ),
        ),
        nestedBefore ? 3 : 1,
        0,
      )
      const before = range.start
      const after = range.end

      dispatch(
        state.tr
          .step(
            new ReplaceAroundStep(
              before - (nestedBefore ? 3 : 1),
              after,
              before,
              after,
              slice,
              1,
              true,
            ),
          )
          .scrollIntoView(),
      )
    }

    return true
  }

export default OrderedList.extend({
  // A list may hold a list directly, not only through an item.
  //
  // Indenting means nesting, and nesting used to need an item above to nest under - so the first
  // item of a list could not be indented at all, and a writer could not put `a.` and `b.` under a
  // `3.` that was the start of its own list. There is nothing to nest under there, and inventing an
  // empty numbered item to be the parent would put a number on the page that nobody typed.
  //
  // A list inside a list says the same thing without inventing anything: level 1 sits under level 0
  // even when level 0 holds no item of its own. It is also how Word writes it.
  //
  // `adr/0014-a-list-may-hold-a-list.md`.
  content: '(listItem | orderedList | bulletList)*',
  addAttributes() {
    return {
      ...this.parent?.(),
      listType: {
        default: 'decimal',
        parseHTML: (element) =>
          element.style.getPropertyValue('list-style-type') || 'decimal',
        renderHTML: ({ listType }) => {
          return {
            style: `list-style-type: ${listType}`,
            'data-type': listType,
          }
        },
      },
      // What the marker says. `null` is "the writer has not chosen", which is not the same as an
      // empty template - that one is a deliberate marker that says nothing.
      template: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-marker-template'),
        renderHTML: ({ template }) =>
          typeof template === 'string' ? { 'data-marker-template': template } : {},
      },
      start: {
        default: 1,
        parseHTML: (element) => {
          const start = element.getAttribute('data-start')
          return start ? Number(start) : 1
        },
        renderHTML: (attributes) => {
          if (attributes.start === 1) {
            return {}
          }
          return {
            'data-start': attributes.start,
          }
        },
      },
    }
  },
  addCommands() {
    return {
      ...this.parent?.(),
      continueOrderedListNumberingAtItem: createOrderedListStartCommand({
        getStart: getContinueOrderedListStart,
        shouldSkip: (context) =>
          isOrderedListStartUnchanged(context, getContinueOrderedListStart(context)),
      }),
      startNewOrderedListAtItem: createOrderedListStartCommand({
        getStart: () => 1,
        shouldSkip: (context) => isOrderedListStartUnchanged(context, 1),
      }),
      sinkOrderedListItemWithType,
      setOrderedListStartAtItem: createOrderedListStartCommand({
        getStart: (_context, start) => start,
        shouldSkip: isOrderedListStartUnchanged,
      }),
    }
  },
})
