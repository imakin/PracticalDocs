import { mergeAttributes, Node } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser, Fragment } from '@tiptap/pm/model'
import { VueNodeViewRenderer } from '@tiptap/vue-3'

import { renderMarkdown } from '@/utils/markdown'

import NodeView from './node-view.vue'

/**
 * A block written in markdown, which keeps the markdown.
 *
 * `adr/0012-a-markdown-block-keeps-its-source.md` carries the decision. Two parts of it are load
 * bearing and are easy to undo by accident:
 *
 * 1. **The rendered result is real content**, not something the node view draws. It has to be, or
 *    pagination cannot break inside the block: `positionAtLineStart` maps a measured line to a
 *    document position with `view.posAtDOM`, which inside a node view ProseMirror does not own
 *    returns the node's own position. Every line would map to one position, the solve's
 *    `at > lastPos` test would fail, and **the rest of the document would stop being paginated**.
 *    Being real content is also why headings in here reach the contents and why profiles style them.
 * 2. **The source is the truth and there is one editing surface.** The rendered half is not
 *    typeable; the block is changed through its source panel. Two surfaces would let the two
 *    representations drift with nothing to notice, which is how the pagination-versus-PDF bug in
 *    ADR 0002 survived.
 */

const SOURCE_SELECTOR = ':scope > pre[data-markdown-source]'

const fragmentFromHtml = (schema, html) => {
  const element = document.createElement('div')
  element.innerHTML = html
  return ProseMirrorDOMParser.fromSchema(schema).parse(element).content
}

/**
 * The attributes markdown itself can express.
 *
 * Everything else a node carries is written **after** it is inserted, by other extensions: `id` and
 * `data-toc-id` from UniqueID, `referenceId`, `referenceNumber` and `referenceLabel` from document
 * references, and the whole numbering group from the profile sync. Measured on a freshly inserted
 * `# Judul`, which came back carrying fourteen attributes where the markdown had set one.
 *
 * They must not count as drift. Comparing whole attribute objects made every block look stale on
 * every load, and rebuilding a block that is not stale throws away exactly those synced values -
 * so opening a document would have silently stripped the reference ids and numbering of every block
 * written in markdown.
 *
 * **Extend this list when markdown starts producing an attribute that is not in it**, not when a new
 * extension starts writing to nodes.
 */
const MARKDOWN_ATTRIBUTES = [
  'level',
  'latex',
  'href',
  'target',
  'src',
  'alt',
  'title',
  'language',
  'start',
  'checked',
]

/**
 * What a piece of content looks like as far as its markdown is concerned.
 *
 * Node structure, the marks on its text, its text, and only the attributes above. Two fragments with
 * the same signature were rendered from the same markdown, whatever else has been written onto them
 * since.
 */
export const markdownSignature = (fragment) => {
  const parts = []
  const walk = (node) => {
    if (node.isText) {
      const marks = node.marks
        .map((mark) => {
          const attrs = MARKDOWN_ATTRIBUTES.filter(
            (key) => mark.attrs?.[key] !== undefined && mark.attrs?.[key] !== null,
          ).map((key) => `${key}=${mark.attrs[key]}`)
          return attrs.length ? `${mark.type.name}(${attrs.join(',')})` : mark.type.name
        })
        .join('+')
      parts.push(`t[${marks}]${node.text}`)
      return
    }
    const attrs = MARKDOWN_ATTRIBUTES.filter(
      (key) => node.attrs?.[key] !== undefined && node.attrs?.[key] !== null,
    ).map((key) => `${key}=${node.attrs[key]}`)
    parts.push(`<${node.type.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`)
    node.content.forEach(walk)
    parts.push('>')
  }
  fragment.forEach(walk)
  return parts.join('')
}

/**
 * The content a source renders to, never empty.
 *
 * The schema says `block+`, so a block whose markdown is empty still needs one child or the node
 * cannot exist at all. An empty paragraph is also what the writer wants to see: somewhere to put the
 * cursor once they open the panel.
 */
export const contentForSource = (schema, source) => {
  const fragment = fragmentFromHtml(schema, renderMarkdown(source))
  if (fragment.childCount > 0) {
    return fragment
  }
  return Fragment.from(schema.nodes.paragraph.create())
}

export default Node.create({
  name: 'markdownBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      source: {
        default: '',
        // Read out of the child element rather than an attribute. An attribute would have to escape
        // every newline, and the point of the feature is that the markdown survives as it was typed.
        parseHTML: (element) =>
          element.querySelector(SOURCE_SELECTOR)?.textContent ?? '',
        // Written by renderHTML as a child element, so it contributes no attribute of its own.
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-markdown-block]',
        // Only the rendered half is content. Without this the source would be parsed as a code block
        // and the document would show the markdown twice.
        contentElement: 'div[data-markdown-rendered]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-markdown-block': '',
        class: 'pdoc-markdown-block',
      }),
      // `pre` is a verbatim tag to `storage-server/format-html.js`, so every character in here is
      // copied out byte for byte and the formatter cannot reflow the markdown into something else.
      // `hidden` keeps it out of the way when the file is opened straight in a browser.
      ['pre', { 'data-markdown-source': '', hidden: 'hidden' }, node.attrs.source || ''],
      ['div', { 'data-markdown-rendered': '' }, 0],
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(NodeView)
  },

  addCommands() {
    return {
      insertMarkdownBlock:
        (source = '') =>
        ({ chain, state }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { source },
              content: contentForSource(state.schema, source).toJSON(),
            })
            .run()
        },

      /**
       * Write a new source and rebuild the block from it, in one transaction.
       *
       * One transaction because the two halves must never be separately undoable: an undo landing
       * between them would leave a block whose source and rendering disagree, which is the state
       * rule 1 of ADR 0012 exists to make impossible.
       */
      setMarkdownSource:
        ({ pos, source }) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) {
            return false
          }
          const text = String(source ?? '')
          const content = contentForSource(state.schema, text)
          if (dispatch) {
            tr.replaceWith(pos + 1, pos + node.nodeSize - 1, content)
            tr.setNodeMarkup(tr.mapping.map(pos, -1), undefined, {
              ...node.attrs,
              source: text,
            })
          }
          return true
        },

      /**
       * Turn an ordinary block into a markdown block, its own text becoming the source.
       *
       * The text, not the HTML. ADR 0012 rejects turning rendered content back into markdown,
       * because a converter rewrites the line layout and the spelling choices the writer made. A
       * paragraph reading `Halo **dunia**` was markdown the writer typed by hand and had no way to
       * render; it now renders. A paragraph carrying real bold marks converts to the words alone,
       * and the writer types the asterisks they want.
       */
      convertToMarkdownBlock:
        ({ pos }) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name === this.name) {
            return false
          }
          // An image, a chart, a page break or a document map carries no text. Converting one would
          // put an empty markdown block where it used to be, which is a deletion wearing another
          // name.
          if (node.isAtom || node.isLeaf) {
            return false
          }
          const source = node.textBetween(0, node.content.size, '\n', '\n')
          if (dispatch) {
            // No profile carries over. Everything inside a markdown block is styled by the one
            // markdown profile (ADR 0012, amendment 2), so the block being converted brings its
            // text and nothing else.
            const content = contentForSource(state.schema, source)
            tr.replaceWith(
              pos,
              pos + node.nodeSize,
              state.schema.nodes[this.name].create({ source }, content),
            )
          }
          return true
        },

      /**
       * Turn a markdown block back into ordinary blocks.
       *
       * The rendered content is kept and **the markdown source is dropped**, because there is
       * nowhere left to keep it. Without this a markdown block is a one-way door, and a writer who
       * wants to go back to editing in the toolbar has to retype the block.
       */
      unwrapMarkdownBlock:
        ({ pos }) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) {
            return false
          }
          if (dispatch) {
            tr.replaceWith(pos, pos + node.nodeSize, node.content)
          }
          return true
        },

      /**
       * Ask one block to show its source.
       *
       * An event rather than a transaction, because which half of a block is on screen is a property
       * of this reader's session and not of the document. Written into the document it would mark the
       * file changed with nothing typed, and fill the undo stack with steps nobody took.
       *
       * `paginationChanged` is the same mechanism, for the same reason.
       */
      openMarkdownSource:
        ({ pos }) =>
        ({ state, editor }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) {
            return false
          }
          editor?.emit?.('markdownSourceRequested', pos)
          return true
        },

      /**
       * Switch the block the cursor is in between markdown and WYSIWYG.
       *
       * The toolbar needs one action, not two, because the writer is looking at one block and it is
       * in one mode. Which direction to go is a fact about that block, so it is decided here rather
       * than in the button.
       */
      toggleMarkdownBlock:
        () =>
        ({ state, commands }) => {
          const { $from, node: selectedNode } = state.selection
          if (selectedNode?.type.name === this.name) {
            return commands.unwrapMarkdownBlock({ pos: state.selection.from })
          }
          // Walk out from the cursor. A markdown block found on the way means leave markdown; the
          // first ordinary text block means enter it.
          for (let { depth } = $from; depth > 0; depth -= 1) {
            const node = $from.node(depth)
            if (node.type.name === this.name) {
              return commands.unwrapMarkdownBlock({ pos: $from.before(depth) })
            }
            if (node.isTextblock) {
              return commands.convertToMarkdownBlock({ pos: $from.before(depth) })
            }
          }
          return false
        },

      /**
       * Rebuild every markdown block whose rendering no longer matches its source.
       *
       * The rendered half cannot drift from inside the editor, because it is not typeable. It can
       * drift in the file: ADR 0005 makes a document folder editable by hand, and someone editing
       * the markdown in the `pre` leaves the rendered half stale. The source wins, so it is rebuilt
       * on load.
       *
       * Blocks are compared before being replaced rather than rewritten unconditionally. A rewrite
       * marks the document changed, and `shouldBlockUnload` treats any change as unsaved work, so
       * rebuilding everything on load would make every document dirty the moment it opened.
       */
      rebuildMarkdownBlocks:
        () =>
        ({ state, tr, dispatch }) => {
          const stale = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return true
            }
            const wanted = contentForSource(state.schema, node.attrs.source)
            // Signatures, not `Fragment.eq`. See MARKDOWN_ATTRIBUTES above: `eq` compares every
            // attribute, including the ones other extensions write after insertion, so it reported
            // every block as stale on every load.
            if (markdownSignature(wanted) !== markdownSignature(node.content)) {
              stale.push({ pos, node, wanted })
            }
            return false
          })
          if (stale.length === 0) {
            return false
          }
          if (dispatch) {
            // Last to first, so an earlier replacement cannot move a later position.
            for (const item of stale.reverse()) {
              tr.replaceWith(
                item.pos + 1,
                item.pos + item.node.nodeSize - 1,
                item.wanted,
              )
            }
            // A repair is not something the writer did, so it does not belong in their undo stack.
            tr.setMeta('addToHistory', false)
          }
          return true
        },
    }
  },

  onCreate() {
    this.editor.commands.rebuildMarkdownBlocks()
  },
})
