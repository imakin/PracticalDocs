import { mergeAttributes, Node } from '@tiptap/core'

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
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    }
  },
})
