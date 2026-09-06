import { t } from '@/composables/i18n'
import { documentSections } from '@/extensions/page-break'
import { sectionIndexAt } from '@/utils/page-sections'

// What a section can change, and where a page break keeps it.
const FIELDS = [
  ['size', 'sectionSize'],
  ['orientation', 'sectionOrientation'],
  ['margin', 'sectionMargin'],
]

/**
 * Keep a change inside the run of pages the menu named.
 *
 * A field left unset on a break means "carry on from the section before", which is what lets a
 * document that sets nothing behave exactly as it always did. It also means a change ripples
 * forward: set one section landscape and every later section that had set nothing turned landscape
 * too - while the menu had just said the change ran only as far as the next page break.
 *
 * So the section after the one being changed is given, explicitly, the value it is already drawn at
 * - for the fields being changed, and only where it had none of its own. Sections beyond it inherit
 * from that one, so freezing a single break stops the whole ripple.
 */
const freezeNextSection = (editor, sections, index, patch) => {
  const next = sections[index + 1]
  if (!next || typeof next.startPos !== 'number') {
    return null
  }
  const node = editor.state.doc.nodeAt(next.startPos)
  if (node?.type?.name !== 'pageBreak') {
    return null
  }
  const attrs = {}
  for (const [field, attribute] of FIELDS) {
    if (field in patch && node.attrs[attribute] === null) {
      attrs[attribute] = next[field]
    }
  }
  return Object.keys(attrs).length > 0 ? { at: next.startPos, attrs } : null
}

/**
 * The run of pages the cursor is in, and how to change its geometry.
 *
 * Page size, margins and orientation are not document wide settings any more: they belong to the
 * section the cursor is in, which runs from the page break above it to the page break below it. The
 * first section is opened by the document itself and its geometry is the document settings, which is
 * where it was always kept, so a document with no page break behaves exactly as it did.
 *
 * The three menus that change page geometry all read this, so there is one answer to "which pages
 * does this change" rather than three that could disagree.
 */
export function usePageSection() {
  const editorRef = inject('editor')
  const page = inject('page')

  // Recomputed whenever the cursor moves or the document changes, because both can put the cursor in
  // a different section without anything else changing.
  const revision = ref(0)
  const bump = () => {
    revision.value += 1
  }
  watch(
    () => editorRef?.value,
    (instance, previous) => {
      previous?.off?.('selectionUpdate', bump)
      previous?.off?.('update', bump)
      instance?.on?.('selectionUpdate', bump)
      instance?.on?.('update', bump)
      bump()
    },
    { immediate: true },
  )
  onUnmounted(() => {
    editorRef?.value?.off?.('selectionUpdate', bump)
    editorRef?.value?.off?.('update', bump)
  })

  const current = computed(() => {
    // Read so the computed re-runs when the cursor moves; the document itself is not reactive.
    revision.value
    const editor = editorRef?.value
    const settings = page?.value
    if (!editor?.state || !settings) {
      return null
    }
    const sections = documentSections(editor.state.doc, settings)
    const index = sectionIndexAt(sections, editor.state.selection.from)
    const section = sections[index] ?? sections[0]
    return {
      sections,
      section,
      index,
      // Where to write a change: the page break that opens this section, or null when the section is
      // the first one and the change belongs in the document settings.
      breakPos: index <= 0 ? null : section.startPos,
    }
  })

  /** What the reader is told a change will cover. */
  const label = computed(() => {
    const section = current.value?.section
    if (!section) {
      return ''
    }
    const { openedBy, closedBy } = section
    if (!openedBy && !closedBy) {
      return t('page.section.wholeDocument')
    }
    if (!openedBy) {
      return t('page.section.fromStart', { to: closedBy })
    }
    if (!closedBy) {
      return t('page.section.toEnd', { from: openedBy })
    }
    return t('page.section.between', { from: openedBy, to: closedBy })
  })

  /**
   * Change the geometry of the section the cursor is in, and of no other.
   *
   * `patch` names the geometry in the document's own words - `size`, `orientation`, `margin` - and
   * this puts it wherever that section keeps it.
   */
  const applyToSection = (patch) => {
    const state = current.value
    const editor = editorRef?.value
    if (!state || !editor) {
      return false
    }
    const freeze = freezeNextSection(editor, state.sections, state.index, patch)
    if (state.breakPos === null) {
      // The first section's geometry is the document settings. The freeze still has to be written,
      // and it is a document change rather than a settings change, so it goes through the editor.
      if (freeze) {
        editor.commands.setSectionGeometry?.([freeze])
      }
      page.value = { ...page.value, ...patch }
      return true
    }
    const attrs = {}
    for (const [field, attribute] of FIELDS) {
      if (field in patch) {
        attrs[attribute] = patch[field]
      }
    }
    const edits = [{ at: state.breakPos, attrs }]
    if (freeze) {
      edits.push(freeze)
    }
    return Boolean(editor.commands.setSectionGeometry?.(edits))
  }

  return { current, label, applyToSection }
}
