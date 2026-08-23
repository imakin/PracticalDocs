<template>
  <div class="umo-main-container">
    <container-toc
      v-if="pageOptions.showToc"
      @close="pageOptions.showToc = false"
    />
    <div
      :class="`umo-zoomable-container umo-${pageOptions.layout}-container umo-scrollbar`"
    >
      <div
        class="umo-zoomable-content"
        :style="{
          width: pageZoomWidth,
          height: pageZoomHeight,
        }"
      >
        <t-watermark
          class="umo-page-content"
          :class="{ 'umo-pagination-off': !paginationEngineEnabled }"
          :style="{
            '--umo-page-orientation': pageOptions.orientation,
            '--umo-page-background': pageOptions.background,
            '--umo-page-margin-top': pageOptions.margin?.top + 'cm',
            '--umo-page-margin-bottom': pageOptions.margin?.bottom + 'cm',
            '--umo-page-margin-left': pageOptions.margin?.left + 'cm',
            '--umo-page-margin-right': pageOptions.margin?.right + 'cm',
            '--umo-page-width':
              pageOptions.layout === 'page' ? pageSize.width + 'cm' : 'auto',
            '--umo-page-height':
              pageOptions.layout === 'page' ? pageSize.height + 'cm' : '100%',
            '--umo-page-content-height':
              pageOptions.layout === 'page'
                ? `calc(${pageSize.height}cm - ${pageOptions.margin?.top || 0}cm - ${pageOptions.margin?.bottom || 0}cm)`
                : 'auto',
            width:
              pageOptions.layout === 'page' ? pageSize.width + 'cm' : '100%',
            transform: `scale(${pageOptions.zoomLevel ? pageOptions.zoomLevel / 100 : 1})`,
          }"
          :alpha="pageOptions.watermark.alpha"
          v-bind="watermarkOptions"
          :watermark-content="pageOptions.watermark"
        >
          <div class="umo-page-node-header" contenteditable="false">
            <div
              class="umo-page-corner corner-tl"
              style="width: var(--umo-page-margin-left)"
            ></div>

            <div class="umo-page-node-header-content"></div>
            <div
              class="umo-page-corner corner-tr"
              style="width: var(--umo-page-margin-right)"
            ></div>
          </div>
          <div class="umo-page-node-content">
            <editor>
              <template #bubble_menu="props">
                <slot name="bubble_menu" v-bind="props" />
              </template>
            </editor>
          </div>
          <div class="umo-page-node-footer" contenteditable="false">
            <div
              class="umo-page-corner corner-bl"
              style="width: var(--umo-page-margin-left)"
            ></div>
            <div class="umo-page-node-footer-content"></div>
            <div
              class="umo-page-corner corner-br"
              style="width: var(--umo-page-margin-right)"
            ></div>
          </div>
        </t-watermark>
      </div>
    </div>
    <div class="umo-main-floating-actions">
      <t-back-top
        style="position: relative"
        :container="`${container} .umo-zoomable-container`"
        :visible-height="800"
        size="small"
      />
    </div>
    <t-image-viewer
      :attach="container"
      v-model:visible="imageViewer.visible"
      v-model:index="currentImageIndex"
      :images="previewImages"
      :trigger="() => {}"
      @close="imageViewer.visible = false"
    />
    <container-search-replace />
    <container-print />
  </div>
</template>

<script setup>
const container = inject('container')
const imageViewer = inject('imageViewer')
const pageOptions = inject('page')

// 页面大小
const pageSize = $computed(() => {
  const { width, height } = pageOptions.value.size || { width: 0, height: 0 }
  return {
    width: pageOptions.value.orientation === 'portrait' ? width : height,
    height: pageOptions.value.orientation === 'portrait' ? height : width,
  }
})
// 页面缩放后的大小
const pageZoomWidth = $computed(() => {
  if (pageOptions.value.layout === 'web') {
    return '100%'
  }
  return `calc(${pageSize.width}cm * ${pageOptions.value.zoomLevel ? pageOptions.value.zoomLevel / 100 : 1})`
})

// 页面内容变化后更新页面高度
let pageZoomHeight = $ref('')
let pageContentEl = $ref(null)
let pageHeightRaf = 0
let pageHeightObserver = $ref(null)
const updatePageZoomHeight = () => {
  if (pageOptions.value.layout === 'web') {
    pageZoomHeight = 'auto'
    return
  }
  if (!pageContentEl) {
    console.warn('The element <.umo-page-content> does not exist.')
    return
  }
  const height = `${(pageContentEl.clientHeight * (pageOptions.value.zoomLevel || 1)) / 100}px`
  if (pageZoomHeight !== height) {
    pageZoomHeight = height
  }
}
// 分页引擎开关：等待 ADR 0002 的装饰器方案落地前先关闭
// The pagination engine is switched off pending ADR 0002 (decoration-based pagination).
//
// `updatePagination()` rewrites the very DOM that `pmMutationObserver` watches, so the two feed each
// other at animation-frame rate and never settle: measured at about 50 scheduled frames and 195
// observer callbacks per second on an idle document. `updatePageZoomHeight()` then samples
// `clientHeight` in that same frame, right after the engine has inflated the content with `marginTop`
// pushes, so the scroll container is left taller than what it holds - 6299px of container around
// 4904px of content on a five-sheet document, leaving over a sheet of empty scroll the user cannot
// escape from.
//
// The engine's code is kept in place rather than deleted: its line-level geometry (TreeWalker plus
// Range.getClientRects to find the first line crossing a page boundary) is the part worth carrying
// into the decoration-based engine. Only the DOM mutation it performs is rejected.
const paginationEngineEnabled = false

const removeLineSpacers = (containerEl) => {
  const spacers = containerEl.querySelectorAll('.umo-page-line-spacer')
  spacers.forEach((spacer) => {
    const parent = spacer.parentNode
    if (parent) {
      parent.removeChild(spacer)
      parent.normalize()
    }
  })
}

const updatePagination = () => {
  if (!paginationEngineEnabled) return
  if (pageOptions.value.layout !== 'page') return
  const pmEl = document.querySelector(`${container} .ProseMirror`)
  if (!pmEl) return

  const nodeContentEl = pmEl.closest('.umo-page-node-content')
  if (!nodeContentEl) return

  const CM_TO_PX = 37.7952755906
  const h = pageSize.height || (pageOptions.value.orientation === 'landscape' ? 21 : 29.7)
  const mt = pageOptions.value.margin?.top ?? 2.5
  const mb = pageOptions.value.margin?.bottom ?? 2.5

  const contentHeight = (h - mt - mb) * CM_TO_PX
  const gap = (mb + mt) * CM_TO_PX + 16

  if (contentHeight <= 0) return

  const children = Array.from(pmEl.children)
  if (children.length === 0) return

  // Pass 1: Clear all previous auto page breaks and line spacers
  removeLineSpacers(pmEl)
  children.forEach((child) => {
    if (child.dataset.autoPageBreak) {
      child.style.marginTop = ''
      delete child.dataset.autoPageBreak
    }
  })

  // Force layout recalculation
  void pmEl.offsetHeight
  const nodeContentRect = nodeContentEl.getBoundingClientRect()

  // Pass 2: Line-level pagination breaking across pages
  let pageIndex = 1
  children.forEach((child) => {
    const childRect = child.getBoundingClientRect()
    const rawTop = childRect.top - nodeContentRect.top
    const rawBottom = childRect.bottom - nodeContentRect.top

    let pageStart = (pageIndex - 1) * (contentHeight + gap)
    let pageEnd = pageStart + contentHeight

    while (rawTop >= pageEnd + gap) {
      pageIndex++
      pageStart = (pageIndex - 1) * (contentHeight + gap)
      pageEnd = pageStart + contentHeight
    }

    // If block starts in or past the gap zone (e.g. heading or image)
    if (rawTop >= pageEnd && rawTop < pageEnd + gap) {
      const nextPageStart = pageIndex * (contentHeight + gap)
      const pushMargin = nextPageStart - rawTop
      if (pushMargin > 0) {
        child.style.marginTop = `${pushMargin}px`
        child.dataset.autoPageBreak = 'true'
        pageIndex++
      }
      return
    }

    // If block crosses pageEnd (e.g. a paragraph with multiple text lines)
    if (rawTop < pageEnd && rawBottom > pageEnd) {
      const textNodes = []
      const walk = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null)
      let n
      while ((n = walk.nextNode())) {
        if (n.textContent && n.textContent.trim().length > 0) {
          textNodes.push(n)
        }
      }

      let breakTargetNode = null
      let breakOffset = 0

      for (const textNode of textNodes) {
        const text = textNode.textContent
        const range = document.createRange()

        for (let i = 0; i < text.length; i++) {
          range.setStart(textNode, i)
          range.setEnd(textNode, i + 1)
          const rects = range.getClientRects()
          if (rects.length > 0) {
            const lineTop = rects[0].top - nodeContentRect.top
            if (lineTop >= pageEnd) {
              breakTargetNode = textNode
              breakOffset = i
              break
            }
          }
        }
        if (breakTargetNode) break
      }

      if (breakTargetNode) {
        const range = document.createRange()
        range.setStart(breakTargetNode, breakOffset)
        range.collapse(true)

        const spacer = document.createElement('span')
        spacer.className = 'umo-page-line-spacer'
        spacer.style.display = 'block'
        spacer.style.height = `${gap}px`
        spacer.style.width = '100%'
        spacer.style.margin = '0'
        spacer.style.padding = '0'
        spacer.style.clear = 'both'
        spacer.contentEditable = 'false'

        range.insertNode(spacer)
        pageIndex++
      } else {
        const nextPageStart = pageIndex * (contentHeight + gap)
        const pushMargin = nextPageStart - rawTop
        if (pushMargin > 0) {
          child.style.marginTop = `${pushMargin}px`
          child.dataset.autoPageBreak = 'true'
          pageIndex++
        }
      }
    }
  })
}

let pmMutationObserver = null

const schedulePageZoomHeight = () => {
  if (pageHeightRaf) {
    cancelAnimationFrame(pageHeightRaf)
  }
  pageHeightRaf = requestAnimationFrame(() => {
    pageHeightRaf = 0
    updatePagination()
    updatePageZoomHeight()
  })
}
onMounted(async () => {
  await nextTick()
  pageContentEl = document.querySelector(`${container} .umo-page-content`)
  if (pageContentEl) {
    pageHeightObserver = new ResizeObserver(() => {
      schedulePageZoomHeight()
    })
    pageHeightObserver.observe(pageContentEl)

    const pmEl = document.querySelector(`${container} .ProseMirror`)
    if (pmEl) {
      pmMutationObserver = new MutationObserver(() => {
        schedulePageZoomHeight()
      })
      pmMutationObserver.observe(pmEl, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }
  } else {
    console.warn('The element <.umo-page-content> does not exist.')
  }
  schedulePageZoomHeight()
})
onUnmounted(() => {
  if (pageHeightObserver) {
    pageHeightObserver.disconnect()
    pageHeightObserver = null
  }
  if (pmMutationObserver) {
    pmMutationObserver.disconnect()
    pmMutationObserver = null
  }
  if (pageHeightRaf) {
    cancelAnimationFrame(pageHeightRaf)
  }
})

// 页面变化后，更新页面高度
watch(
  () => [
    pageOptions.value.layout,
    pageOptions.value.zoomLevel,
    pageOptions.value.size,
    pageOptions.value.orientation,
  ],
  () => {
    schedulePageZoomHeight()
  },
  { deep: true },
)

// 水印
const watermarkOptions = $ref({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  type: undefined,
})
watch(
  () => pageOptions.value.watermark,
  (watermarkObj = { type: '' }) => {
    const { type } = watermarkObj
    if (type === 'compact') {
      watermarkOptions.width = 320
      watermarkOptions.y = 240
    } else {
      watermarkOptions.width = 480
      watermarkOptions.y = 360
    }
  },
  { deep: true, immediate: true },
)

// 图片预览
let previewImages = $ref([])
let currentImageIndex = $ref(0)

watch(
  () => imageViewer.value.visible,
  async (visible) => {
    if (!visible) {
      previewImages = []
      currentImageIndex = 0
      return
    }
    await nextTick()
    const images = document.querySelectorAll(
      `${container} .umo-page-node-content img[src][data-preview]`,
    )
    Array.from(images).forEach((image, index) => {
      const src = image.getAttribute('src')
      const nodeId = image.getAttribute('data-id')
      previewImages.push(src)
      if (nodeId === imageViewer.value.current) {
        currentImageIndex = index
      }
    })
  },
)
</script>

<style lang="less">
.umo-main-container {
  height: 100%;
  display: flex;
  position: relative;
}

.umo-zoomable-container {
  flex: 1;
  scroll-behavior: smooth;
  &.umo-page-container {
    padding: 20px 50px;
    box-sizing: border-box;
    .umo-zoomable-content {
      margin: 0 auto;
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 10px 0px,
        rgba(0, 0, 0, 0.04) 0px 0px 0px 1px;
    }
    /* With the engine off nothing keeps text out of these bands, so painting them would draw
       page boundaries straight across live text. Restored together with the engine. */
    .umo-page-content.umo-pagination-off {
      background-image: none;
    }
    .umo-page-content {
      /* Visual Page Sheets: Header boundary, Footer & Page Numbering zone, and Sheet Separation Gap */
      /* Period is calc(var(--umo-page-height) + 16px) to match 16px DOM sheet gap */
      background-image:
        /* Footer & Page Numbering boundary line (dashed/subtle line at top of footer margin) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent calc(var(--umo-page-height) - var(--umo-page-margin-bottom) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--umo-page-height) - var(--umo-page-margin-bottom) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--umo-page-height) - var(--umo-page-margin-bottom)),
          transparent calc(var(--umo-page-height) - var(--umo-page-margin-bottom)),
          transparent calc(var(--umo-page-height) + 16px)
        ),
        /* Sheet Separation Gap (16px grey band + sheet edge shadow at bottom of each page sheet) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent var(--umo-page-height),
          #cbd5e1 var(--umo-page-height),
          #e2e8f0 calc(var(--umo-page-height) + 8px),
          #cbd5e1 calc(var(--umo-page-height) + 16px)
        ),
        /* Header margin boundary line (subtle line at bottom of top margin) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent calc(var(--umo-page-margin-top) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--umo-page-margin-top) - 1px),
          rgba(0, 0, 0, 0.15) var(--umo-page-margin-top),
          transparent var(--umo-page-margin-top),
          transparent calc(var(--umo-page-height) + 16px)
        );
    }
  }
  &.umo-web-container {
    display: flex;
    .umo-zoomable-content {
      flex: 1;
      .umo-page-corner {
        display: none;
      }
      .umo-page-content {
        min-height: 100%;
        .umo-page-node-content {
          min-height: 100px;
        }
      }
    }
  }
  .umo-page-content {
    transform-origin: 0 0;
    box-sizing: border-box;
    display: flex;
    position: relative;
    box-sizing: border-box;
    background-color: var(--umo-page-background);
    width: var(--umo-page-width);
    min-height: var(--umo-page-height);
    overflow: visible !important;
    display: flex;
    flex-direction: column;
    [contenteditable] {
      outline: none;
    }
  }
}

.umo-page-node-header {
  height: var(--umo-page-margin-top);
  overflow: hidden;
}

.umo-page-node-footer {
  height: var(--umo-page-margin-bottom);
  overflow: hidden;
}

.umo-page-node-header,
.umo-page-node-footer {
  display: flex;
  justify-content: space-between;
}

.umo-page-corner {
  box-sizing: border-box;
  position: relative;
  z-index: 10;
}

.umo-page-corner {
  @media print {
    opacity: 0;
  }

  &::after {
    position: absolute;
    content: '';
    display: block;
    height: 1cm;
    width: 1cm;
    border: solid 1px rgba(0, 0, 0, 0.08);
  }

  &.corner-tl::after {
    border-top: none;
    border-left: none;
    bottom: 0;
    right: 0;
  }

  &.corner-tr::after {
    border-top: none;
    border-right: none;
    bottom: 0;
    left: 0;
  }

  &.corner-bl::after {
    border-bottom: none;
    border-left: none;
    top: 0;
    right: 0;
  }

  &.corner-br::after {
    border-bottom: none;
    border-right: none;
    top: 0;
    left: 0;
  }
}

.umo-page-node-header-content,
.umo-page-node-footer-content {
  flex: 1;
}

.umo-page-node-content {
  position: relative;
  box-sizing: border-box;
  flex-shrink: 1;
}

.umo-main-floating-actions {
  position: absolute;
  bottom: 25px;
  right: 25px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  > * {
    position: relative;
    inset-inline-end: unset !important;
    inset-block-end: unset !important;
    opacity: 0.9;
    &:hover {
      opacity: 1;
      background-color: var(--umo-color-white) !important;
      border: solid 1px var(--umo-primary-color);
    }
  }
}

.umo-viewer-container {
  position: absolute;
  inset: 0;
  z-index: 1000;
}
</style>
