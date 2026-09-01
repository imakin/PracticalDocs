import { mergeAttributes, Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'

import NodeView from './node-view.vue'

export default Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      vnode: {
        default: true,
      },
      // Which contents profile styles this map. Its own attribute rather than the global
      // `numberingProfileId`, because that one is synced onto document blocks and a map is not one.
      // Empty means the default, which is a profile the user can open, not numbers hidden in code.
      profileId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-profile-id') || '',
        renderHTML: ({ profileId }) =>
          profileId ? { 'data-profile-id': profileId } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'toc' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['toc', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },
  addNodeView() {
    return VueNodeViewRenderer(NodeView)
  },
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {},
      },
    ]
  },
  addCommands() {
    return {
      addTableOfContents:
        (options) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: options,
            })
            .run()
        },
      // The map cannot be reached by selecting text inside it - it is an atom, and its rows are a
      // view rather than content - so the profile is set on the selected node instead.
      setTableOfContentsProfile:
        (profileId) =>
        ({ state, dispatch }) => {
          const { selection } = state
          const node = selection?.node
          if (!node || node.type.name !== this.name) {
            return false
          }
          dispatch?.(
            state.tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              profileId: profileId || '',
            }),
          )
          return true
        },
    }
  },
})
