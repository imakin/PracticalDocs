import { mergeAttributes, Node } from '@tiptap/core'

// The break the user means: the one they have selected, or the one immediately around the cursor.
// A page break is an atom, so a plain click selects it; arrowing past it leaves the cursor beside it.
export const findPageBreakNear = (state) => {
  const { selection } = state
  const selected = selection.node
  if (selected?.type?.name === 'pageBreak') {
    return { node: selected, pos: selection.from }
  }
  const { $from } = selection
  for (const candidate of [$from.nodeAfter, $from.nodeBefore]) {
    if (candidate?.type?.name === 'pageBreak') {
      const pos =
        candidate === $from.nodeAfter ? $from.pos : $from.pos - candidate.nodeSize
      return { node: candidate, pos }
    }
  }
  return null
}

export default Node.create({
  name: 'pageBreak',
  group: 'block',
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'umo-page-break',
        'data-line-number': false,
      },
      getContentLabel: () => t('page.break'),
    }
  },
  // A page break is also where page numbering can change, because a numbering change always happens at
  // a page boundary. Rather than introduce a second kind of marker, the break carries the section.
  // Every field is optional and null means "carry on from the section before this one"; only
  // `sectionStartAt` is different, where a number restarts the count and null continues it.
  addAttributes() {
    return {
      sectionEnabled: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-section-enabled')
          return value === null ? null : value !== 'false'
        },
        renderHTML: ({ sectionEnabled }) =>
          sectionEnabled === null || sectionEnabled === undefined
            ? {}
            : { 'data-section-enabled': String(sectionEnabled) },
      },
      sectionPosition: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-position') || null,
        renderHTML: ({ sectionPosition }) =>
          sectionPosition ? { 'data-section-position': sectionPosition } : {},
      },
      sectionFormat: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-format') || null,
        renderHTML: ({ sectionFormat }) =>
          sectionFormat ? { 'data-section-format': sectionFormat } : {},
      },
      sectionTemplate: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-template'),
        renderHTML: ({ sectionTemplate }) =>
          sectionTemplate === null || sectionTemplate === undefined
            ? {}
            : { 'data-section-template': sectionTemplate },
      },
      sectionStartAt: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-section-start-at')
          if (value === null) return null
          const n = Number(value)
          return Number.isFinite(n) ? Math.trunc(n) : null
        },
        renderHTML: ({ sectionStartAt }) =>
          sectionStartAt === null || sectionStartAt === undefined
            ? {}
            : { 'data-section-start-at': String(sectionStartAt) },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[class*="umo-page-break"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-content': this.options.getContentLabel(),
      }),
    ]
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
          }),
      // Change the numbering section a break opens. A break carries no section by default - it just
      // ends a page - so this is how a user opts one in. Passing null for a field puts it back to
      // following the section before it.
      setPageBreakSection:
        (attrs = {}) =>
        ({ state, dispatch }) => {
          const found = findPageBreakNear(state)
          if (!found) {
            return false
          }
          const next = { ...found.node.attrs, ...attrs }
          dispatch?.(state.tr.setNodeMarkup(found.pos, undefined, next))
          return true
        },
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    }
  },
})
