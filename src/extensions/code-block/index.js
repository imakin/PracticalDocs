import CodeBlock from '@tiptap/extension-code-block-lowlight'
import { DOMSerializer } from '@tiptap/pm/model'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { common, createLowlight } from 'lowlight'

import NodeView from './node-view.vue'

/**
 * Whether the code block being drawn sits inside a markdown block's rendered half.
 *
 * Read from the view being drawn rather than from `editor.state`: on the first render the editor has
 * not been handed its view yet, and the view already holds the document it is drawing.
 */
const insideMarkdownBlock = ({ getPos, view, editor }) => {
  const pos = typeof getPos === 'function' ? getPos() : null
  const state = (view ?? editor?.view)?.state
  if (typeof pos !== 'number' || !state) {
    return false
  }
  const $pos = state.doc.resolve(pos)
  for (let { depth } = $pos; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'markdownBlock') {
      return true
    }
  }
  return false
}

const customCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: 'plaintext',
      },
      theme: {
        default: 'light',
      },
      textWrap: {
        default: true,
      },
    }
  },
  /**
   * Inside a markdown block, the code block is drawn as the plain `pre > code` the file stores.
   *
   * The ordinary node view carries a toolbar, a border, a padded box, a height limit and a colour
   * theme - chrome on a line of the page the writer did not write, and spacing they cannot set, in
   * the one place they have no way to reach it: the rendered half is a view of the markdown
   * (ADR 0012) and is not typeable, so the language picker, the theme and the delete button did
   * nothing that survived the next render anyway. How it looks is the Markdown Styles dialog's
   * `Code Block` section, and nothing else.
   *
   * Written from the node's own `toDOM`, so the screen, the export that copies it and the saved file
   * are one markup.
   */
  addNodeView() {
    const vueView = VueNodeViewRenderer(NodeView)
    return (props) => {
      if (!insideMarkdownBlock(props)) {
        return vueView(props)
      }
      const { node } = props
      return DOMSerializer.renderSpec(document, node.type.spec.toDOM(node))
    }
  },
})

export default customCodeBlock.configure({
  lowlight: createLowlight(common),
  enableTabIndentation: true,
  tabSize: 2,
  defaultLanguage: 'plaintext',
})
