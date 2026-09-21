import { mergeAttributes, Node } from '@tiptap/core'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@tiptap/pm/state'

import {
  normalizeSectionMargin,
  normalizeSectionOrientation,
  normalizeSectionSize,
  resolveSections,
  sectionIndexAt,
} from '@/utils/page-sections'
import { shortId } from '@/utils/short-id'

/**
 * How long a break's name is.
 *
 * Short enough to read off the line and say out loud, long enough that two breaks in one document
 * colliding is rare - and a collision is repaired rather than trusted, see `pageBreakIds` below.
 */
const BREAK_ID_LENGTH = 4

const readJsonAttribute = (element, name) => {
  const raw = element.getAttribute(name)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

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
        candidate === $from.nodeAfter
          ? $from.pos
          : $from.pos - candidate.nodeSize
      return { node: candidate, pos }
    }
  }
  return null
}

/**
 * Every page break in the document, in order, as the section model wants them.
 *
 * The pos is the break's own position, which is where the section it opens begins.
 */
export const collectPageBreaks = (doc) => {
  const found = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'pageBreak') {
      return
    }
    found.push({
      id: node.attrs.id,
      pos,
      size: node.attrs.sectionSize,
      orientation: node.attrs.sectionOrientation,
      margin: node.attrs.sectionMargin,
    })
  })
  return found
}

/** The sections of a document, resolved against the document wide page settings. */
export const documentSections = (doc, page) =>
  resolveSections(collectPageBreaks(doc), page)

/**
 * The break that opens the section holding `pos`, or null when that section is the first one.
 *
 * A null answer is not a failure: the first section is opened by the document itself, and its
 * geometry is the document settings rather than anything carried on a node.
 */
export const sectionBreakAt = (state, pos, page) => {
  const breaks = collectPageBreaks(state.doc)
  const sections = resolveSections(breaks, page)
  const index = sectionIndexAt(sections, pos)
  if (index <= 0) {
    return null
  }
  const item = breaks[index - 1]
  return item ? { pos: item.pos, node: state.doc.nodeAt(item.pos) } : null
}

export default Node.create({
  name: 'pageBreak',
  group: 'block',
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'pdoc-page-break',
        'data-line-number': false,
      },
      // The name is part of the label, because the geometry menus refer to a break by it and a
      // reader has to be able to find the one they mean without opening anything.
      getContentLabel: (id) =>
        id ? `${t('page.break')} ${id}` : t('page.break'),
    }
  },
  // A page break is also where page numbering can change, because a numbering change always happens at
  // a page boundary. Rather than introduce a second kind of marker, the break carries the section.
  // Every field is optional and null means "carry on from the section before this one"; only
  // `sectionStartAt` is different, where a number restarts the count and null continues it.
  addAttributes() {
    return {
      // The break's name, four characters, shown on its own line and used by the page geometry menus
      // to say which run of pages a setting covers. Assigned by `pageBreakIds` rather than by a
      // default, so that a break written before names existed is given one on sight.
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-break-id') || null,
        renderHTML: ({ id }) => (id ? { 'data-break-id': id } : {}),
      },
      // The page geometry of the section this break opens. null means "carry on with whatever the
      // section before this one was drawn at", which is what every break in every document written
      // before this existed says.
      sectionSize: {
        default: null,
        parseHTML: (element) =>
          normalizeSectionSize(readJsonAttribute(element, 'data-section-size')),
        renderHTML: ({ sectionSize }) =>
          sectionSize
            ? { 'data-section-size': JSON.stringify(sectionSize) }
            : {},
      },
      sectionOrientation: {
        default: null,
        parseHTML: (element) =>
          normalizeSectionOrientation(
            element.getAttribute('data-section-orientation'),
          ),
        renderHTML: ({ sectionOrientation }) =>
          sectionOrientation
            ? { 'data-section-orientation': sectionOrientation }
            : {},
      },
      sectionMargin: {
        default: null,
        parseHTML: (element) =>
          normalizeSectionMargin(
            readJsonAttribute(element, 'data-section-margin'),
          ),
        renderHTML: ({ sectionMargin }) =>
          sectionMargin
            ? { 'data-section-margin': JSON.stringify(sectionMargin) }
            : {},
      },
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
        parseHTML: (element) =>
          element.getAttribute('data-section-position') || null,
        renderHTML: ({ sectionPosition }) =>
          sectionPosition ? { 'data-section-position': sectionPosition } : {},
      },
      // Where the number sits on the page this break opens - the thesis convention of a folio at
      // the foot of a chapter's opening page and at the head elsewhere. The engine already resolved
      // this per section; only the break had no way to say it.
      sectionFirstPagePosition: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-section-first-page-position') || null,
        renderHTML: ({ sectionFirstPagePosition }) =>
          sectionFirstPagePosition
            ? { 'data-section-first-page-position': sectionFirstPagePosition }
            : {},
      },
      sectionFormat: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-section-format') || null,
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
    return [{ tag: 'div[class*="pdoc-page-break"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-content': this.options.getContentLabel(node?.attrs?.id),
      }),
    ]
  },
  addCommands() {
    return {
      // Inserting a block atom leaves it selected, and the next character typed replaces the
      // selection: a writer who pressed Page Break and carried on typing lost the break. So the
      // cursor is moved past it, into the paragraph that follows - a new one when the break is the
      // last thing in the document.
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { id: shortId(BREAK_ID_LENGTH) },
            })
            .command(({ tr, dispatch }) => {
              const { selection } = tr
              if (
                !(selection instanceof NodeSelection) ||
                selection.node.type.name !== this.name
              ) {
                return true
              }
              const after = selection.from + selection.node.nodeSize
              let next = Selection.findFrom(tr.doc.resolve(after), 1, true)
              if (!next) {
                const { paragraph } = tr.doc.type.schema.nodes
                if (!paragraph) {
                  return true
                }
                tr.insert(after, paragraph.create())
                next = TextSelection.create(tr.doc, after + 1)
              }
              if (dispatch) {
                tr.setSelection(next).scrollIntoView()
              }
              return true
            })
            .run(),
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
      /**
       * Write page geometry onto page breaks, in one transaction.
       *
       * Takes a list, because changing one section usually means writing to two breaks: the one that
       * opens it, and the one after it, whose inherited values have to be frozen so that the change
       * stops where the menu said it stops. One transaction, so it is also one undo.
       *
       * Addressed by position rather than by the cursor: the break that opens a section can be far
       * above the block being edited, and the caller has already resolved which one that is. Passing
       * null for a field puts it back to following the section before it.
       */
      setSectionGeometry:
        (edits = []) =>
        ({ state, dispatch }) => {
          const wanted = (Array.isArray(edits) ? edits : [edits]).filter(
            (edit) => state.doc.nodeAt(edit?.at)?.type?.name === 'pageBreak',
          )
          if (wanted.length === 0) {
            return false
          }
          const { tr } = state
          for (const edit of wanted) {
            const node = state.doc.nodeAt(edit.at)
            tr.setNodeMarkup(edit.at, undefined, {
              ...node.attrs,
              ...edit.attrs,
            })
          }
          dispatch?.(tr)
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    return [pageBreakIds()]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    }
  },
})

/**
 * Give every page break a name, and keep the names unique.
 *
 * A break can arrive without one in three ways: it was written before names existed, it was pasted
 * from another document, or it was duplicated within this one - and the last two also arrive with a
 * name that is already taken. Both are repaired here rather than at the point of insertion, because
 * a paste is not an insertion this extension ever sees.
 *
 * The repairing transaction does not go into the history: undoing a document's names is not
 * something a user ever means to do, and it would leave the document in a state this plugin would
 * immediately repair again.
 */
const pageBreakIdsKey = new PluginKey('pageBreakIds')

const pageBreakIds = () =>
  new Plugin({
    key: pageBreakIdsKey,
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null
      }
      const seen = new Set()
      const repairs = []
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== 'pageBreak') {
          return
        }
        const { id } = node.attrs
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id)
          return
        }
        let next = shortId(BREAK_ID_LENGTH)
        while (seen.has(next)) {
          next = shortId(BREAK_ID_LENGTH)
        }
        seen.add(next)
        repairs.push({ pos, attrs: { ...node.attrs, id: next } })
      })
      if (repairs.length === 0) {
        return null
      }
      const { tr } = newState
      for (const repair of repairs) {
        tr.setNodeMarkup(repair.pos, undefined, repair.attrs)
      }
      return tr.setMeta('addToHistory', false)
    },
  })
