import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

import { TEXT_CASES } from '@/utils/text-case'

// Changing the case of a selection, without disturbing anything else about it.
//
// The text is replaced run by run so that every mark - bold, a link, a font - stays exactly where it
// was. Runs are rewritten back to front, because replacing one shifts the positions of the ones after
// it and a case change is not always the same length in characters.

export default Extension.create({
  name: 'textCase',

  addCommands() {
    return {
      setTextCase:
        (mode) =>
        ({ state, dispatch }) => {
          const transform = TEXT_CASES[mode]
          if (!transform) {
            return false
          }
          const { from, to, empty } = state.selection
          if (empty) {
            return false
          }
          const runs = []
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText || !node.text) {
              return
            }
            const start = Math.max(pos, from)
            const end = Math.min(pos + node.nodeSize, to)
            if (start >= end) {
              return
            }
            const text = node.text.slice(start - pos, end - pos)
            const next = transform(text)
            if (next !== text) {
              runs.push({ start, end, next, marks: node.marks })
            }
          })
          if (runs.length === 0) {
            return false
          }
          if (dispatch) {
            const { tr } = state
            for (const run of runs.reverse()) {
              tr.replaceWith(run.start, run.end, state.schema.text(run.next, run.marks))
            }
            // Keep the same text selected afterwards, so the user can chain another change. Built
            // explicitly rather than from the old selection's own class: Select All gives an
            // AllSelection, which has no such constructor.
            tr.setSelection(TextSelection.create(tr.doc, from, Math.min(to, tr.doc.content.size)))
            dispatch(tr)
          }
          return true
        },
    }
  },
})
