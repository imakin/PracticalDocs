<template>
  <node-view-wrapper
    :id="node.attrs.id"
    class="pdoc-node-view"
    @click.capture="editor?.commands.setNodeSelection(getPos())"
  >
    <div class="pdoc-node-container pdoc-node-toc">
      <div ref="bodyRef" class="pdoc-node-toc-body" :class="profileClass">
        <p v-if="entries.length === 0" class="pdoc-toc-empty">{{ t('toc.empty') }}</p>
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="pdoc-toc-item-row"
          :data-toc-break="gaps[entry.id] ? '' : null"
          :style="{ paddingLeft: entry.indent, marginTop: gaps[entry.id] }"
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
import { pageOfElement, paginationRefreshKey } from '@/extensions/pagination'
import { sectionHeadings } from '@/utils/heading-scope'
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
  const all = editor.value?.storage?.tableOfContents?.content
  if (!all) return
  // A heading inside a table is a styled cell, not a section, so it is not an entry here. The
  // heading store collects every heading in the document, and a writer styling the cells of a
  // review table with a profile that carries a heading level had every cell listed: the row
  // numbers, the citations, the summary sentences. `heading-scope.js` owns that rule, and the
  // numbering reads the same one, so the two cannot disagree about what a section is.
  const toc = sectionHeadings(editor.value)
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
  // The rows have changed, so where they fall across the sheets has too. Measured after Vue has
  // written them, not before.
  nextTick(reflow)
}

/**
 * A contents longer than a page paginates itself.
 *
 * This block is an atom, so there is no position inside it for the engine to anchor a page break to.
 * Once the list was taller than a sheet the solver met an overflow it could not place, stepped over
 * the whole block and then gave up: measured on a sixty chapter document, **one** break where nine
 * were needed, and thirteen lines left sitting in the margin bands of sheets two to nine. The damage
 * was never confined to the contents - the rest of the document simply stopped being paginated.
 *
 * So the contents does the one thing the engine cannot do for it: it pushes any row that would
 * straddle the foot of a column down to the top of the next one. With no row crossing a boundary the
 * engine finds nothing here to fix, and carries on down the document as though this were an ordinary
 * block that happens to be tall.
 *
 * Two things this has to get right, both of them lessons already paid for:
 *
 * - **The arithmetic starts from the natural layout**, with the gaps cleared, every time. Computing
 *   the next answer from the current padded one compounds, and the list walks down the document.
 * - **Measurements are scaled, the value written is not.** Everything from `getBoundingClientRect`
 *   is in the zoomed space, and so is what the engine publishes in `storage.sheets`, because
 *   `renderSheets` divides by the scale on the way out. A margin is a CSS length inside the same
 *   transform, so it has to be divided too - the bug that made every spacer half its height at 50
 *   per cent zoom, found the last time something was drawn from these numbers.
 */
// A bound, so that a measurement going wrong stops rather than walking down the document forever.
const MAX_SHEETS_HERE = 1000
let gaps = $ref({})
let previousGaps = ''
const bodyRef = $ref(null)
const COLUMN_TOLERANCE = 1

// The sheets the engine published, extended arithmetically when the padding has made the contents
// need more of them than the last solve knew about. Sheets within a section are all the same box,
// so carrying the last one forward is exact rather than an approximation.
const sheetAt = (sheets, index, pitch) => {
  if (index < sheets.length) {
    return sheets[index]
  }
  const last = sheets[sheets.length - 1]
  return { ...last, top: last.top + (index - (sheets.length - 1)) * pitch }
}

const reflow = () => {
  const host = editor.value?.view?.dom?.closest('.pdoc-page-content')
  const storage =
    editor.value?.extensionStorage?.pagination || editor.value?.storage?.pagination
  const sheets = storage?.sheets
  const body = bodyRef
  if (!host || !body || !(sheets?.length > 0)) {
    return
  }
  const rows = [...body.querySelectorAll('.pdoc-toc-item-row')]
  if (rows.length === 0) {
    return
  }
  const hostRect = host.getBoundingClientRect()
  const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1
  const pitch = Math.max(
    1,
    storage.stride || sheets[0].height + (sheets[1] ? sheets[1].top - sheets[0].top - sheets[0].height : 0),
  )

  // The natural layout, worked out by subtracting what is already applied rather than by clearing it
  // and measuring again. Clearing meant this function and Vue were both writing `margin-top`: the
  // styles cleared here stayed cleared whenever the answer came out unchanged and Vue saw no reason
  // to patch, and a solve landing between the clear and Vue's next patch measured a contents with no
  // gaps in it at all. Measured: the same document settled on one run and straddled fourteen rows on
  // the next. One writer, and this reads.
  let applied = 0
  const natural = rows.map((row, index) => {
    applied +=
      Number.parseFloat(gaps[entries[index]?.id] || '0') * scale || 0
    const rect = row.getBoundingClientRect()
    return { top: rect.top - hostRect.top - applied, height: rect.height }
  })

  const next = {}
  let shift = 0
  let sheet = 0
  for (let index = 0; index < natural.length; index += 1) {
    const top = natural[index].top + shift
    while (
      sheet + 1 < MAX_SHEETS_HERE &&
      top >= sheetAt(sheets, sheet + 1, pitch).top
    ) {
      sheet += 1
    }
    const box = sheetAt(sheets, sheet, pitch)
    const columnBottom = box.top + box.height - box.marginBottom
    if (top + natural[index].height > columnBottom + COLUMN_TOLERANCE) {
      const below = sheetAt(sheets, sheet + 1, pitch)
      const gap = below.top + below.marginTop - top
      if (gap > 0) {
        next[entries[index].id] = `${Math.round(gap / scale)}px`
        shift += gap
        sheet += 1
      }
    }
  }

  const serialized = JSON.stringify(next)
  if (serialized === previousGaps) {
    return
  }
  previousGaps = serialized
  gaps = next
  // The engine re-solves on a document change or on being asked. Nothing here changes the document,
  // only how tall this block is, so it has to ask - otherwise the sheets below keep the geometry of
  // a contents that was shorter.
  const view = editor.value?.view
  if (view) {
    view.dispatch(view.state.tr.setMeta(paginationRefreshKey, true))
  }
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
    // The sheets moved, so the rows have to be placed against them again - this is what makes a
    // contents spanning three pages settle rather than straddle.
    instance.on('paginationChanged', reflow)
    instance.on('profilesChanged', build)
    detach = () => {
      instance.off?.('paginationChanged', build)
      instance.off?.('paginationChanged', reflow)
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
    // The gap that carries a row onto the next sheet is a screen measure. Print breaks the page by
    // itself, and then honours the margin on top of its own break, so the whole document slid down
    // by one gap and came out with a blank page at the end - measured, 12 sheets on screen against
    // 13 printed pages, the last empty, where the same document without a contents printed 11 for
    // 11. In print the row asks for the break instead and takes no margin at all.
    @media print {
      .pdoc-toc-item-row[data-toc-break] {
        margin-top: 0 !important;
        break-before: page;
      }
    }

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
