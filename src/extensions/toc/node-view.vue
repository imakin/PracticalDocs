<template>
  <node-view-wrapper
    :id="node.attrs.id"
    class="pdoc-node-view"
    @click.capture="editor?.commands.setNodeSelection(getPos())"
  >
    <div class="pdoc-node-container pdoc-node-toc">
      <div class="pdoc-node-toc-body" :class="profileClass">
        <p v-if="entries.length === 0" class="pdoc-toc-empty">{{ t('toc.empty') }}</p>
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="pdoc-toc-item-row"
          :style="{ paddingLeft: entry.indent }"
          @click="goToHeading(entry.id)"
        >
          <span v-if="entry.label" class="pdoc-toc-item-label">{{ entry.label }}</span>
          <span class="pdoc-toc-item-text">{{ entry.textContent }}</span>
          <span class="pdoc-toc-item-dots"></span>
          <span class="pdoc-toc-item-page">{{ entry.pageNumber }}</span>
        </div>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { TextSelection } from '@tiptap/pm/state'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

import { getNumberingProfileList } from '@/extensions/document-references'
import { pageOfElement } from '@/extensions/pagination'
import { profileClassName } from '@/utils/profile-stylesheet'
import { resolveTocProfile, tocIndentOf } from '@/utils/toc-indent'

const { node, getPos } = defineProps(nodeViewProps)

const container = inject('container')
const editor = inject('editor')

defineEmits(['close'])

// A flat list, deliberately. This was a `t-tree`, which drew connector lines, an expand arrow, a
// hover tooltip and an indent of its own - none of which the user could turn off, change or reach.
// A table of contents is a list of lines; its indentation is a setting, and it lives on the
// `Table of Contents` profile alongside everything else that decides how this block looks.
let entries = $ref([])
let previous = ''

const headingElement = (id) => {
  if (!id || typeof document === 'undefined') return null
  return editor.value?.view?.dom?.querySelector(`[data-toc-id="${id}"]`) || null
}

/**
 * The page a heading is on, as the reader would say it.
 *
 * This used to count `.pdoc-page-node` elements and take the heading's index among them. Since
 * pagination became decorations there is one such element for the whole canvas, so every entry came
 * out as page 1 - which is what the contents showed. It now asks the pagination engine, which has
 * already solved the geometry and already computed what each sheet is numbered, so a contents entry
 * agrees with the folio printed on the page: roman front matter, restarts and hidden numbers all
 * included.
 */
const getPageNumber = (id) => {
  const page = pageOfElement(editor.value, headingElement(id))
  if (!page) return ''
  // The folio when there is one, the physical page when numbering is off or this page's number is
  // hidden. A contents entry has to point somewhere either way.
  return page.visible && page.text !== '' ? page.text : String(page.index)
}

/**
 * The number the heading carries, if its profile gives it one - "BAB I", "1.1".
 *
 * Read from the rendered decoration rather than recomputed, so the contents cannot disagree with the
 * heading it points at. A template containing a newline renders as several lines; the contents wants
 * them on one.
 */
const getLabel = (id) => {
  const number = headingElement(id)?.querySelector('.pdoc-heading-number')
  return (number?.textContent || '').replace(/\s+/g, ' ').trim()
}

// Which profile styles this map: the one it names, else the built-in, else any contents profile.
// More than one can exist - a table of contents indented, a list of figures flat - so the map has to
// say which, and `resolveTocProfile` owns that decision for everyone who asks.
const tocProfile = () =>
  resolveTocProfile(getNumberingProfileList(editor.value), node?.attrs?.profileId)

let profileClass = $ref('')

const build = () => {
  const toc = editor.value?.storage?.tableOfContents?.content
  if (!toc) return
  const profile = tocProfile()
  // The class is how the profile's font, size and spacing reach the map, through the same generated
  // stylesheet as every other profile.
  profileClass = profile ? profileClassName(profile.id) : ''
  const next = toc.map((item) => ({
    id: item.id,
    textContent: item.textContent,
    label: getLabel(item.id),
    level: item.originalLevel,
    indent: tocIndentOf(item.originalLevel, profile),
    pageNumber: getPageNumber(item.id),
  }))
  // Rebuilt from three independent sources - the headings, the engine and the profile - so compare
  // the result rather than trying to watch all three.
  const serialized = JSON.stringify(next)
  if (serialized === previous) return
  previous = serialized
  entries = next
}

watch(() => editor.value?.storage.tableOfContents.content, build, { immediate: true })
// Choosing a different profile changes this node's attributes, not the contents list, so it needs
// watching separately.
watch(() => node?.attrs?.profileId, build)

// Three things change what this shows without changing the document: the pages move (a margin edit,
// a new page size, a page break inserted earlier), and the profile changes (indentation, font). Both
// are plain properties on extension storage, so both are announced rather than watched.
let detach = null
watch(
  () => editor.value,
  (instance) => {
    detach?.()
    detach = null
    if (!instance?.on) return
    instance.on('paginationChanged', build)
    instance.on('profilesChanged', build)
    detach = () => {
      instance.off?.('paginationChanged', build)
      instance.off?.('profilesChanged', build)
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  detach?.()
  detach = null
})

const goToHeading = (id) => {
  if (!editor.value) {
    return
  }
  const nodeElement = headingElement(id)
  if (!nodeElement) return
  const pageContainer = document.querySelector(
    `${container} .pdoc-zoomable-container`,
  )
  const pageHeader = pageContainer?.querySelector('.pdoc-page-node-header')
  pageContainer?.scrollTo({
    top: nodeElement.offsetTop + (pageHeader?.offsetHeight || 0),
  })
  const pos = editor.value.view.posAtDOM(nodeElement, 0)
  const { tr } = editor.value.view.state
  tr.setSelection(new TextSelection.create(tr.doc, pos))
  editor.value.view.dispatch(tr)
  editor.value.view.focus()
}
</script>

<style lang="less">
.pdoc-node-view {
  .pdoc-node-toc {
    padding: 8px 0;
    position: relative;
    outline: none;
    border: none;
    background-color: transparent;
    width: 100%;

    .pdoc-toc-empty {
      margin: 0;
      padding: 8px 0;
      color: #999;
      font-size: 12px;
      text-align: center;
    }

    // One row per heading. Indentation is padding on the row, so it moves the text and leaves the
    // page number where it is - the number column is a fixed track at the right edge and the dot
    // leader takes up whatever is left between them.
    .pdoc-toc-item-row {
      display: flex;
      align-items: baseline;
      // border-box, or the indent is added to a width that is already the full width and the row
      // overhangs to the right by exactly the indent - which drags the page number with it. The
      // number has to end on the same edge whatever the indent is.
      box-sizing: border-box;
      width: 100%;
      gap: 6px;
      padding-top: 2px;
      padding-bottom: 2px;
      cursor: pointer;

      &:hover {
        background-color: rgba(0, 0, 0, 0.04);
      }

      // The heading's own number, kept whole while the title is the part that may be clipped.
      .pdoc-toc-item-label {
        flex: 0 0 auto;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .pdoc-toc-item-text {
        flex: 0 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pdoc-toc-item-dots {
        flex: 1 1 auto;
        min-width: 12px;
        border-bottom: 1px dotted #bbb;
        height: 10px;
        margin: 0 4px;
      }

      .pdoc-toc-item-page {
        flex: 0 0 auto;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
    }
  }
}
</style>
