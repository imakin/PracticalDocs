<template>
  <node-view-wrapper
    as="li"
    ref="wrapperRef"
    class="pdoc-list-item"
    :class="wrapperClass"
    :data-checked="isTaskChecked || null"
    data-list-item=""
  >
    <t-dropdown
      v-if="isOrderedList"
      trigger="click"
      overlay-class-name="pdoc-list-item-popup"
      :visible="editor?.isEditable && markerMenuVisible"
      size="small"
      :max-column-width="260"
      :popup-props="popupProps"
    >
      <span
        class="pdoc-list-item-marker is-ordered-list-marker"
        contenteditable="false"
        data-list-marker=""
        @mousedown.prevent
        @click.stop="focusListItem"
      >
        <span class="pdoc-list-item-marker-text">{{ markerText }}</span>
      </span>
      <template #dropdown>
        <t-dropdown-menu>
          <!--
            What level this list is at, because that is the whole of what the count is keyed on.
            A writer choosing Continue is asking to follow the numbers at this indentation, so the
            level has to be visible for the choice to mean anything.

            It has to be a `t-dropdown-item`: `t-dropdown-menu` renders only the children it
            recognises and drops anything else, so a plain element here vanished without a word.
          -->
          <t-dropdown-item class="pdoc-list-item-menu-info">
            <div class="pdoc-list-item-menu-info-row" @click.stop.prevent>
              <span>{{ t('list.ordered.indentLevel') }}: {{ indentLevel }}</span>
              <!--
                The same two actions as Tab and Shift-Tab, next to the level they change, so the
                level is not only reported but adjustable from where it is read.
              -->
              <button
                type="button"
                class="pdoc-list-item-menu-indent-button"
                :title="t('base.outdent')"
                @click.stop.prevent="changeIndent(-1)"
              >
                <icon name="outdent" />
              </button>
              <button
                type="button"
                class="pdoc-list-item-menu-indent-button"
                :title="t('base.indent')"
                @click.stop.prevent="changeIndent(1)"
              >
                <icon name="indent" />
              </button>
            </div>
          </t-dropdown-item>
          <!--
            Both actions are always offered. They used to be greyed out whenever they would change
            nothing, which hid the one the writer wanted most of the time and gave no reason. The
            no-op is handled in the command instead, where it belongs.
          -->
          <t-dropdown-item
            class="pdoc-list-item-menu-item"
            @click="continueNumbering"
          >
            <icon name="continued-outlined" />
            <span>{{ t('list.ordered.continuePrevious') }} ({{ continueNumber }})</span>
          </t-dropdown-item>
          <t-dropdown-item
            class="pdoc-list-item-menu-item"
            @click="startNewList"
          >
            <icon name="new-outlined" />
            <span>{{ t('list.ordered.startNew') }}</span>
          </t-dropdown-item>
          <t-dropdown-item
            divider
            class="pdoc-list-item-menu-item"
            @click="openStartDialog"
          >
            <icon name="reset-outlined" />
            <span>{{ t('list.ordered.changeStart') }}</span>
          </t-dropdown-item>
          <t-dropdown-item
            class="pdoc-list-item-menu-item"
            @click="openTemplateDialog"
          >
            <icon name="ordered-list" />
            <span>{{ t('list.ordered.markerTemplate') }}</span>
          </t-dropdown-item>
          <t-dropdown-item class="pdoc-list-item-menu-item">
            <t-dropdown
              class="pdoc-list-item-menu-item"
              trigger="click"
              placement="right-top"
            >
              <div class="pdoc-list-item-submenu-trigger" @click.stop>
                <icon name="ordered-list" />
                <span>{{ t('list.ordered.numberType') }}</span>
              </div>
              <template #dropdown>
                <t-dropdown-menu>
                  <t-dropdown-item
                    v-for="item in orderedListTypeOptions"
                    :key="item.value"
                    class="pdoc-list-item-menu-item"
                    :class="{ 'is-active': orderedListType === item.value }"
                    @click="changeOrderedListType(item.value)"
                  >
                    {{ item.label }}
                  </t-dropdown-item>
                </t-dropdown-menu>
              </template>
            </t-dropdown>
          </t-dropdown-item>
        </t-dropdown-menu>
      </template>
    </t-dropdown>
    <t-dropdown
      v-else-if="isBulletList"
      trigger="click"
      overlay-class-name="pdoc-list-item-popup"
      :visible="editor?.isEditable && markerMenuVisible"
      size="small"
      :popup-props="popupProps"
    >
      <span
        class="pdoc-list-item-marker is-bullet-list-marker"
        contenteditable="false"
        data-list-marker=""
        @mousedown.prevent
        @click.stop="focusListItem"
      >
        <span class="pdoc-list-item-marker-text">{{ markerText }}</span>
      </span>
      <template #dropdown>
        <t-dropdown-menu>
          <t-dropdown-item
            v-for="item in bulletListTypeOptions"
            :key="item.value"
            class="pdoc-list-item-menu-item"
            :class="{ 'is-active': bulletListType === item.value }"
            @click="changeBulletListType(item.value)"
          >
            <span class="pdoc-list-item-submenu-marker">{{ item.marker }}</span>
            <span>{{ item.label }}</span>
          </t-dropdown-item>
        </t-dropdown-menu>
      </template>
    </t-dropdown>
    <label
      v-else-if="isTaskItem"
      class="pdoc-list-item-task-marker"
      contenteditable="false"
      @mousedown.prevent
    >
      <input
        class="pdoc-list-item-task-checkbox"
        type="checkbox"
        :checked="isTaskChecked"
        :disabled="!editor?.isEditable"
        @change.stop="toggleTaskItemChecked"
      />
    </label>
    <modal
      :visible="startDialogVisible"
      width="360px"
      :header="t('list.ordered.changeStart')"
      :confirm-btn="t('list.ordered.apply')"
      destroy-on-close
      @close="closeStartDialog"
      @confirm="applyStartValue"
    >
      <div class="pdoc-list-item-start-dialog">
        <t-input-number
          v-model="pendingStart"
          :min="1"
          theme="column"
          autofocus
        >
          <template #label>
            <span>{{ t('list.ordered.startValue') }}</span>
          </template>
        </t-input-number>
      </div>
    </modal>
    <modal
      :visible="templateDialogVisible"
      width="420px"
      :header="t('list.ordered.markerTemplate')"
      :confirm-btn="t('list.ordered.apply')"
      destroy-on-close
      @close="closeTemplateDialog"
      @confirm="applyTemplate"
    >
      <div class="pdoc-list-item-start-dialog">
        <t-input v-model="pendingTemplate" autofocus />
        <div class="pdoc-list-item-template-hint">
          {{ t('list.ordered.markerTemplateHint') }}
        </div>
        <div class="pdoc-list-item-template-preview">
          {{ t('list.ordered.markerTemplatePreview') }}: {{ templatePreview }}
        </div>
      </div>
    </modal>
    <node-view-content
      as="div"
      class="pdoc-list-item-content"
      data-list-item-content=""
    />
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

import {
  DEFAULT_MARKER_TEMPLATE,
  formatOrderedValue,
  getContinueOrderedListStart,
  getListItemContext,
  renderMarkerTemplate,
  normalizeOrderedListStart,
  observeListItemMetricResize,
  unobserveListItemMetricResize,
} from './utils'

const BULLET_MARKERS = {
  disc: '•',
  circle: '◦',
  square: '▪',
}

// The position a menu was asked for, read by whichever node view mounts there. Module scope on
// purpose: the instance that asked is often not the instance that answers.
let pendingMenuPos = null

const props = defineProps(nodeViewProps)

const container = inject('container')
const editor = inject('editor')
const listItemState = $computed(() => editor?.storage?.listItem?.state)

let wrapperRef = $ref(null)
let markerMenuVisible = $ref(false)
let startDialogVisible = $ref(false)
let templateDialogVisible = $ref(false)
let pendingTemplate = $ref('')
let pendingStart = $ref(1)
let syncFrame = $ref(0)
// The two facts the menu shows: which indentation this list is at, and the number Continue would
// give it. Read when the menu opens rather than kept in step with the document, because they are
// only ever looked at while it is open.
let indentLevel = $ref(0)
let continueNumber = $ref(1)
let stopMetricObservationWatch = null
let stopMetricSyncWatch = null
let observedContentElement = null

const getWrapperElement = () => wrapperRef?.$el || wrapperRef || null

const getContentElement = () =>
  getWrapperElement()?.querySelector('[data-list-item-content]') || null

const clearMarkerMetricVars = (wrapperElement) => {
  if (!wrapperElement) {
    return
  }

  wrapperElement.style.removeProperty('--pdoc-list-marker-font-size')
  wrapperElement.style.removeProperty('--pdoc-list-marker-font-family')
  wrapperElement.style.removeProperty('--pdoc-list-marker-font-weight')
  wrapperElement.style.removeProperty('--pdoc-list-marker-offset-y')
}

const getMarkerSourceElement = (contentElement) => {
  if (!contentElement) {
    return null
  }

  return contentElement.firstElementChild || contentElement
}

const getTextNodesWalker = (element) =>
  document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      return node.textContent?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    },
  })

/**
 * The font the marker should be set in, out of the fonts the line is written in.
 *
 * A line can mix them - a formula, a citation, a word in another face - and the marker belongs to
 * the prose, not to the fragment. The one most of the line's characters are set in wins; a tie goes
 * to whichever came first, which is the text the marker sits directly beside.
 */
const dominantFont = (contributions) => {
  const byFont = new Map()
  for (const { font, weight } of contributions) {
    const key = `${font.fontFamily}|${font.fontSize}|${font.fontWeight}`
    const seen = byFont.get(key)
    if (seen) {
      seen.weight += weight
    } else {
      byFont.set(key, { font, weight })
    }
  }
  let best = null
  for (const entry of byFont.values()) {
    if (!best || entry.weight > best.weight) {
      best = entry
    }
  }
  return best?.font || null
}

const getMarkerTextMetrics = (element) => {
  if (!element) {
    return null
  }

  const walker = getTextNodesWalker(element)
  let currentTextNode = walker.nextNode()
  const lineGroups = []
  const styleCache = new WeakMap()

  while (currentTextNode) {
    const styleTarget = currentTextNode.parentElement || element
    let font = styleCache.get(styleTarget)
    if (!font) {
      const computed = window.getComputedStyle(styleTarget)
      font = {
        fontSize: Number.parseFloat(computed.fontSize),
        fontFamily: computed.fontFamily,
        fontWeight: computed.fontWeight,
      }
      styleCache.set(styleTarget, font)
    }
    const characters = currentTextNode.textContent.trim().length

    const range = document.createRange()
    range.selectNodeContents(currentTextNode)
    const textRects = Array.from(range.getClientRects()).filter(
      (rect) => rect.height > 0,
    )
    range.detach?.()

    textRects.forEach((rect) => {
      // Grouped by overlapping the line, not by starting at the same height. A fragment set larger
      // than the prose around it - a formula, a superscript - sits on the same line but its box
      // begins higher, so matching on `top` gave it a line of its own that then sorted **above** the
      // real first line and handed the marker its font. That is the fault the user photographed:
      // one item of four with a bigger, heavier number, and mathematics only in that item.
      const lineGroup = lineGroups.find(
        (group) => rect.top < group.bottom - 1 && rect.bottom > group.top + 1,
      )
      if (lineGroup) {
        lineGroup.top = Math.min(lineGroup.top, rect.top)
        lineGroup.bottom = Math.max(lineGroup.bottom, rect.bottom)
        lineGroup.height = Math.max(lineGroup.height, rect.height)
        lineGroup.fonts.push({ font, weight: characters })
        return
      }

      lineGroups.push({
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        fonts: [{ font, weight: characters }],
      })
    })

    currentTextNode = walker.nextNode()
  }

  if (!lineGroups.length) {
    return { font: null, firstLineTop: null, firstLineHeight: null }
  }

  lineGroups.sort((a, b) => a.top - b.top)
  const [firstLine] = lineGroups

  return {
    // The first line's own font, not the largest in the item. Taking the largest meant a single
    // formula in the middle of an item set the size of its number: measured on the user's thesis,
    // item 3 of a list carried a marker visibly bigger and heavier than items 1, 2 and 4, because
    // that item alone contained inline mathematics.
    font: dominantFont(firstLine.fonts),
    firstLineTop: firstLine.top,
    firstLineHeight: Math.max(
      firstLine.height,
      firstLine.bottom - firstLine.top,
    ),
  }
}

const syncMarkerMetrics = () => {
  const wrapperElement = getWrapperElement()
  if (!wrapperElement || !listItemContext) {
    clearMarkerMetricVars(wrapperElement)
    return
  }

  const contentElement = getContentElement()
  const sourceElement = getMarkerSourceElement(contentElement)
  if (!sourceElement) {
    clearMarkerMetricVars(wrapperElement)
    return
  }

  const styles = window.getComputedStyle(sourceElement)
  const { fontSize, lineHeight } = styles
  const textMetrics = getMarkerTextMetrics(sourceElement)
  const markerFont = textMetrics?.font
  const parsedFontSize = markerFont?.fontSize || Number.parseFloat(fontSize)
  const sourceRect = sourceElement.getBoundingClientRect()
  const firstLineTop = textMetrics?.firstLineTop
  const firstLineHeight = textMetrics?.firstLineHeight
  const parsedLineHeight = Number.parseFloat(lineHeight)
  const markerLineHeight =
    Number.isFinite(firstLineHeight) && firstLineHeight > 0
      ? firstLineHeight
      : parsedLineHeight
  const markerLineTop =
    Number.isFinite(firstLineTop) &&
    Number.isFinite(sourceRect.top) &&
    firstLineTop >= sourceRect.top
      ? firstLineTop - sourceRect.top
      : 0
  const markerOffsetY =
    markerLineTop +
    (Number.isFinite(markerLineHeight) &&
    Number.isFinite(parsedFontSize) &&
    markerLineHeight > parsedFontSize
      ? (markerLineHeight - parsedFontSize) / 2
      : 0)
  wrapperElement.style.setProperty(
    '--pdoc-list-marker-font-size',
    Number.isFinite(parsedFontSize) && parsedFontSize > 0
      ? `${parsedFontSize}px`
      : fontSize,
  )
  // The family and the weight, not only the size. Without these the number kept the editor's own
  // default face while the text it belonged to was set in the document's: measured, a marker in
  // PingFang SC beside text in Times New Roman. A number is part of the sentence it opens.
  wrapperElement.style.setProperty(
    '--pdoc-list-marker-font-family',
    markerFont?.fontFamily || styles.fontFamily,
  )
  wrapperElement.style.setProperty(
    '--pdoc-list-marker-font-weight',
    markerFont?.fontWeight || styles.fontWeight,
  )
  wrapperElement.style.setProperty(
    '--pdoc-list-marker-offset-y',
    `${markerOffsetY}px`,
  )
}

const scheduleMarkerMetricsSync = () => {
  if (syncFrame) {
    cancelAnimationFrame(syncFrame)
  }

  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0
    syncMarkerMetrics()
  })
}

const syncMetricObservation = () => {
  const nextContentElement = shouldObserveMetrics ? getContentElement() : null
  if (observedContentElement === nextContentElement) {
    return
  }

  if (observedContentElement) {
    unobserveListItemMetricResize(observedContentElement)
  }

  observedContentElement = nextContentElement

  if (observedContentElement) {
    observeListItemMetricResize(
      observedContentElement,
      scheduleMarkerMetricsSync,
    )
  }
}

const listItemContext = $computed(() => {
  listItemState?.structureVersion
  const { getPos } = props
  const state = editor.value?.state
  const listItemPos = typeof getPos === 'function' ? getPos() : null
  return getListItemContext(state, listItemPos)
})
const orderedContext = $computed(() =>
  listItemContext?.listTypeName === 'orderedList' ? listItemContext : null,
)
const orderedListTypeOptions = $computed(() => [
  { label: `1. ${t('list.ordered.decimal')}`, value: 'decimal' },
  {
    label: `01. ${t('list.ordered.decimalLeadingZero')}`,
    value: 'decimal-leading-zero',
  },
  { label: `i. ${t('list.ordered.lowerRoman')}`, value: 'lower-roman' },
  { label: `I. ${t('list.ordered.upperRoman')}`, value: 'upper-roman' },
  { label: `a. ${t('list.ordered.lowerLatin')}`, value: 'lower-latin' },
  { label: `A. ${t('list.ordered.upperLatin')}`, value: 'upper-latin' },
  {
    label: `一.${t('list.ordered.tradChineseInformal')}`,
    value: 'trad-chinese-informal',
  },
  {
    label: `壹.${t('list.ordered.simpChineseFormal')}`,
    value: 'simp-chinese-formal',
  },
])
const bulletListTypeOptions = $computed(() => [
  { label: t('list.bullet.disc'), marker: BULLET_MARKERS.disc, value: 'disc' },
  {
    label: t('list.bullet.circle'),
    marker: BULLET_MARKERS.circle,
    value: 'circle',
  },
  {
    label: t('list.bullet.square'),
    marker: BULLET_MARKERS.square,
    value: 'square',
  },
])

const listTypeName = $computed(() => listItemContext?.listTypeName || '')
const itemTypeName = $computed(() => listItemContext?.itemTypeName || '')
const isOrderedList = $computed(() => listTypeName === 'orderedList')
const isBulletList = $computed(() => listTypeName === 'bulletList')
const isTaskItem = $computed(() => itemTypeName === 'taskItem')
const isTaskChecked = $computed(() => listItemContext?.checked === true)
const markerText = $computed(() => listItemContext?.markerText || '')
const currentNumber = $computed(() => orderedContext?.currentNumber || 1)
const orderedListType = $computed(
  () => orderedContext?.orderedListNode?.attrs?.listType || 'decimal',
)
const bulletListType = $computed(() => listItemContext?.listType || 'disc')
const activeListItemPos = $computed(
  () => listItemState?.activeListItemPos ?? null,
)
const isCurrentItem = $computed(() => {
  if (!isOrderedList) {
    return false
  }
  const listItemPos = props.getPos?.()
  return (
    typeof activeListItemPos === 'number' && activeListItemPos === listItemPos
  )
})
const shouldObserveMetrics = $computed(
  () =>
    !!listItemContext && (!isOrderedList || isCurrentItem || markerMenuVisible),
)
const markerStateVersion = $computed(() =>
  isTaskItem ? Number(isTaskChecked) : markerText,
)
const metricContextVersion = $computed(() => {
  return [listTypeName, itemTypeName, markerStateVersion].join(':')
})
const wrapperClass = $computed(() => ({
  'is-ordered-list': isOrderedList,
  'is-bullet-list': isBulletList,
  'is-task-checked': isTaskChecked,
  'is-selected': isOrderedList && props.selected,
  'is-current-item': isCurrentItem,
  'is-marker-menu-active': isOrderedList && markerMenuVisible,
}))

const focusListItem = () => {
  const pos = props.getPos?.()
  if (typeof pos !== 'number') {
    return null
  }
  editor.value
    ?.chain()
    .focus()
    .setTextSelection(pos + 2)
    .run()
  return pos
}

const popupProps = $computed(() => ({
  attach: `${container} .pdoc-zoomable-container`,
  overlayClassName: 'pdoc-list-item-overlay',
  destroyOnClose: false,
  onVisibleChange: handleMarkerMenuVisibleChange,
}))

const refreshMenuState = () => {
  const context = orderedContext
  if (!context) {
    return
  }
  indentLevel = context.indentLevel
  continueNumber = getContinueOrderedListStart(context)
}

const closeMarkerMenu = () => {
  markerMenuVisible = false
}

const handleMarkerMenuVisibleChange = (visible) => {
  if (visible) {
    if (!editor.value?.isEditable) {
      markerMenuVisible = false
      return
    }
    focusListItem()
    refreshMenuState()
  }
  markerMenuVisible = visible
}

const openStartDialog = () => {
  pendingStart = currentNumber
  closeMarkerMenu()
  startDialogVisible = true
}

const closeStartDialog = () => {
  startDialogVisible = false
  pendingStart = currentNumber
}

/**
 * The template belongs to the list, so every item in it says the same kind of thing.
 *
 * Written straight onto the list rather than through a start-value command, because it changes what
 * a marker says and nothing about where the count begins.
 */
const openTemplateDialog = () => {
  pendingTemplate =
    typeof orderedContext?.orderedListNode?.attrs?.template === 'string'
      ? orderedContext.orderedListNode.attrs.template
      : DEFAULT_MARKER_TEMPLATE
  closeMarkerMenu()
  templateDialogVisible = true
}

const closeTemplateDialog = () => {
  templateDialogVisible = false
}

const templatePreview = $computed(() => {
  const context = orderedContext
  if (!context) {
    return ''
  }
  const own = formatOrderedValue(
    context.currentNumber,
    context.orderedListNode.attrs.listType,
  )
  return (
    renderMarkerTemplate(pendingTemplate, context.parentMarkerText, own) ||
    t('list.ordered.markerTemplateEmpty')
  )
})

const applyTemplate = () => {
  const pos = focusListItem()
  if (typeof pos !== 'number') {
    templateDialogVisible = false
    return
  }
  editor.value
    ?.chain()
    .focus()
    .updateAttributes('orderedList', { template: pendingTemplate })
    .run()
  templateDialogVisible = false
}

const applyStartValue = () => {
  const nextStart = normalizeOrderedListStart(pendingStart)
  runOrderedListCommand('setOrderedListStartAtItem', {
    start: nextStart,
  })
  startDialogVisible = false
}

const runOrderedListCommand = (command, options = {}) => {
  const pos = focusListItem()
  if (typeof pos !== 'number') {
    return
  }
  editor.value
    ?.chain()
    .focus()
    [command]({ ...options, listItemPos: pos })
    .run()
  closeMarkerMenu()
}

/**
 * Indent or outdent this item from the menu, and keep the menu on it.
 *
 * Indenting always moves the item into a different list, and the node view that was showing the
 * menu goes with it - measured: the panel simply vanished on the first press. A writer moving an
 * item two levels would have to find the marker again in between, which is the thing the panel was
 * added to save them.
 *
 * So the item asks for the menu at its new position and whichever node view ends up there opens
 * it. Both routes are needed because ProseMirror may reuse this instance or build a new one, and
 * which of the two happens is not something to depend on.
 */
const changeIndent = (direction) => {
  const pos = focusListItem()
  if (typeof pos !== 'number') {
    return
  }
  editor.value
    ?.chain()
    .focus()
    [direction > 0 ? 'setIndent' : 'setOutdent']()
    .run()
  const next = getListItemContext(editor.value?.state)?.listItemPos
  if (typeof next !== 'number') {
    return
  }
  pendingMenuPos = next
  editor.value?.emit?.('listItemMenuRequested', next)
}

const openMenuHere = () => {
  pendingMenuPos = null
  refreshMenuState()
  markerMenuVisible = true
}

const onMenuRequested = (pos) => {
  if (pos !== props.getPos?.()) {
    return
  }
  nextTick(openMenuHere)
}

const continueNumbering = () => {
  runOrderedListCommand('continueOrderedListNumberingAtItem')
}

const startNewList = () => {
  runOrderedListCommand('startNewOrderedListAtItem')
}

const changeOrderedListType = (listType) => {
  if (orderedListType === listType) {
    closeMarkerMenu()
    return
  }

  const pos = focusListItem()
  if (typeof pos !== 'number') {
    return
  }

  editor.value
    ?.chain()
    .focus()
    .updateAttributes('orderedList', { listType })
    .run()
  closeMarkerMenu()
}

const changeBulletListType = (listType) => {
  if (bulletListType === listType) {
    closeMarkerMenu()
    return
  }

  const pos = focusListItem()
  if (typeof pos !== 'number') {
    return
  }

  editor.value
    ?.chain()
    .focus()
    .updateAttributes('bulletList', { listType })
    .run()
  closeMarkerMenu()
}

const toggleTaskItemChecked = (event) => {
  const { target } = event
  if (!editor?.isEditable) {
    target.checked = isTaskChecked
    return
  }

  const { checked } = target
  const pos = props.getPos?.()
  if (typeof pos !== 'number') {
    target.checked = isTaskChecked
    return
  }

  editor
    ?.chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const currentNode = tr.doc.nodeAt(pos)
      tr.setNodeMarkup(pos, undefined, {
        ...currentNode?.attrs,
        checked,
      })
      return true
    })
    .run()
}

onMounted(() => {
  stopMetricObservationWatch = watch(
    () => shouldObserveMetrics,
    async () => {
      await nextTick()
      syncMetricObservation()
      scheduleMarkerMetricsSync()
    },
    { immediate: true },
  )

  stopMetricSyncWatch = watch(
    () => metricContextVersion,
    async () => {
      await nextTick()
      scheduleMarkerMetricsSync()
    },
    { immediate: true },
  )

  editor.value?.on?.('listItemMenuRequested', onMenuRequested)
  // A node view built at the position that asked for the menu answers on arrival, because the
  // event fired before it existed.
  if (pendingMenuPos !== null && pendingMenuPos === props.getPos?.()) {
    nextTick(openMenuHere)
  }
})

onBeforeUnmount(() => {
  editor.value?.off?.('listItemMenuRequested', onMenuRequested)
  stopMetricObservationWatch?.()
  stopMetricSyncWatch?.()
  if (syncFrame) {
    cancelAnimationFrame(syncFrame)
  }
  if (observedContentElement) {
    unobserveListItemMetricResize(observedContentElement)
  }
})
</script>

<style lang="less">
ul,
ol {
  list-style-type: none;
}

.pdoc-list-item-popup {
  .pdoc-popup__content {
    min-width: 180px;
  }
}

.pdoc-list-item-menu-info {
  // A row that states a fact rather than offering an action, so it must not look like one.
  font-size: 12px;
  color: var(--pdoc-text-color-light, #8c8c8c);
  cursor: default;
  user-select: none;

  &:hover {
    background-color: transparent;
  }
}

.pdoc-list-item-menu-info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.pdoc-list-item-menu-indent-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background-color: transparent;
  color: var(--pdoc-text-color, #1f1f1f);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background-color: var(--pdoc-button-hover-background, rgb(0 0 0 / 6%));
  }
}

.pdoc-list-item-menu-item {
  .pdoc-dropdown__item-text {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pdoc-icon {
    font-size: 16px;
  }

  &.is-active {
    .pdoc-dropdown__item-text {
      color: var(--pdoc-primary-color);
    }
  }
}

.pdoc-list-item-submenu-marker {
  display: inline-flex;
  align-items: center;
  font-size: 18px;
  line-height: 1;
}

// A list held directly by a list, which is what an empty level looks like (adr/0014).
//
// A nested list normally gets its indentation for free: it sits in an item's content column, which
// begins after that item's marker. Here there is no item above and so no marker, and the step has
// to be drawn. Measured against the classic shape, an item's content column starts 26px in at the
// default size, so this is set close to it - an approximation on purpose, because that column grows
// with the number inside it and no static rule can follow it. Override the variable to taste.
.pdoc-editor {
  ol > ol,
  ol > ul,
  ul > ol,
  ul > ul {
    padding-left: var(--pdoc-list-nested-indent, calc(1.35em + 0.5em));
  }
}

.pdoc-list-item {
  --offset-y: var(--pdoc-list-marker-offset-y, 0);
  --font-size: var(--pdoc-list-marker-font-size, inherit);
  --font-family: var(--pdoc-list-marker-font-family, inherit);
  --font-weight: var(--pdoc-list-marker-font-weight, inherit);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.5em;
  min-width: 0;
  // No `word-break` here. `break-all` breaks between any two characters, so ordinary prose in a
  // list came out cut mid-word - `latensi` as `la` and `tensi` - while the same prose in a
  // paragraph was fine. Overflow was never the reason it was needed: `.pdoc-editor` sets
  // `overflow-wrap: anywhere`, which is inherited and breaks a token genuinely too long for the
  // line and nothing else, and `min-width: 0` above is what keeps this flex item from being pushed
  // wide by one. It also put the Word Wrap control out of reach for list text, because the
  // `wordWrap` extension emits nothing for its `normal` default and so could not turn an inherited
  // `break-all` off.
  list-style-type: none;
  line-height: inherit;
  font-size: inherit;
  padding: 0.25em 0;

  .pdoc-list-item-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: var(--font-size);
    // The number is part of the sentence it opens, so it is set in the same face and weight as the
    // text beside it rather than in whatever the editor's default happens to be.
    font-family: var(--font-family);
    font-weight: var(--font-weight);
    line-height: 1;
    color: var(--pdoc-text-color);
    border-radius: 0.125em;
    white-space: nowrap;
    user-select: none;
    transform: translateY(var(--offset-y));
    &.is-ordered-list-marker {
      padding: 0 0.25em;
      margin-left: -0.1em;
      cursor: pointer;

      &:hover {
        background-color: var(--pdoc-content-table-selected-background);
      }
    }

    &.is-bullet-list-marker {
      padding: 0 0.25em;
      margin-left: -0.1em;
      cursor: pointer;

      &:hover {
        background-color: var(--pdoc-content-table-selected-background);
      }
    }
  }

  .pdoc-list-item-marker-text {
    display: inline-block;
    line-height: 1;
    white-space: nowrap;
  }

  .pdoc-list-item-task-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform: translateY(var(--offset-y));
  }

  .pdoc-list-item-task-checkbox {
    appearance: none;
    cursor: pointer;
    width: var(--font-size);
    height: var(--font-size);
    border: 1px solid #999;
    background-color: white;
    position: relative;
    margin: 0;
    opacity: 0.8;
    border-radius: calc(var(--font-size) * 0.125);

    &:hover {
      border-color: var(--pdoc-primary-color);
    }

    &:checked {
      background-color: var(--pdoc-primary-color);
      border-color: var(--pdoc-primary-color);

      &::after {
        content: '';
        width: 60%;
        height: 35%;
        border: 2px solid #fff;
        border-top: 0;
        border-right: 0;
        position: absolute;
        top: 42%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
      }
    }

    &:disabled {
      cursor: default;
    }
  }

  &.is-ordered-list {
    &.is-current-item,
    &.is-selected,
    &.is-marker-menu-active {
      .pdoc-list-item-marker {
        background-color: var(--pdoc-content-table-selected-background);
      }
    }
  }

  &.is-task-checked {
    .pdoc-list-item-content > p {
      opacity: 0.5;
      text-decoration: line-through;
      margin: 0;

      &:has([style]) {
        text-decoration: inherit;
      }

      * {
        text-decoration: line-through;
      }
    }
  }
  &-overlay {
    .pdoc-popup__content {
      min-width: unset;
      .pdoc-dropdown__item-text {
        padding-right: 30px;
      }
    }
  }
  &-submenu-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    flex: 1;
  }
}

.pdoc-list-item-template-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pdoc-text-color-light, #8c8c8c);
}

.pdoc-list-item-template-preview {
  margin-top: 8px;
  font-size: 13px;
  color: var(--pdoc-text-color, #1f1f1f);
}

.pdoc-list-item-start-dialog {
  padding-top: 8px;

  .pdoc-input-number {
    width: 100%;
  }
}
</style>
