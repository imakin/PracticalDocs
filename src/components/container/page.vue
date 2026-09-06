<template>
  <div class="pdoc-main-container">
    <container-toc
      v-if="pageOptions.showToc"
      @close="pageOptions.showToc = false"
    />
    <div
      :class="`pdoc-zoomable-container pdoc-${pageOptions.layout}-container pdoc-scrollbar`"
    >
      <div
        class="pdoc-zoomable-content"
        :style="{
          width: pageZoomWidth,
          height: pageZoomHeight,
        }"
      >
        <t-watermark
          class="pdoc-page-content"
          :style="{
            '--pdoc-page-orientation': pageOptions.orientation,
            '--pdoc-page-background': pageOptions.background,
            '--pdoc-page-margin-top': pageOptions.margin?.top + 'cm',
            '--pdoc-page-margin-bottom': pageOptions.margin?.bottom + 'cm',
            '--pdoc-page-margin-left': pageOptions.margin?.left + 'cm',
            '--pdoc-page-margin-right': pageOptions.margin?.right + 'cm',
            '--pdoc-page-sheet-gap': sheetGap + 'px',
            '--pdoc-page-width':
              pageOptions.layout === 'page' ? pageSize.width + 'cm' : 'auto',
            '--pdoc-page-height':
              pageOptions.layout === 'page' ? pageSize.height + 'cm' : '100%',
            '--pdoc-page-content-height':
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
          <div class="pdoc-page-node-header" contenteditable="false">
            <div
              class="pdoc-page-corner corner-tl"
              style="width: var(--pdoc-page-margin-left)"
            ></div>

            <div class="pdoc-page-node-header-content"></div>
            <div
              class="pdoc-page-corner corner-tr"
              style="width: var(--pdoc-page-margin-right)"
            ></div>
          </div>
          <div class="pdoc-page-node-content">
            <editor>
              <template #bubble_menu="props">
                <slot name="bubble_menu" v-bind="props" />
              </template>
            </editor>
          </div>
          <div class="pdoc-page-node-footer" contenteditable="false">
            <div
              class="pdoc-page-corner corner-bl"
              style="width: var(--pdoc-page-margin-left)"
            ></div>
            <div class="pdoc-page-node-footer-content"></div>
            <div
              class="pdoc-page-corner corner-br"
              style="width: var(--pdoc-page-margin-right)"
            ></div>
          </div>
        </t-watermark>
      </div>
    </div>
    <div class="pdoc-main-floating-actions">
      <t-back-top
        style="position: relative"
        :container="`${container} .pdoc-zoomable-container`"
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
const editorRef = inject('editor')

// Grey band drawn between two sheets. Shared with the pagination engine through
// --pdoc-page-sheet-gap so the painted gap and the enforced gap can never drift apart.
const sheetGap = 16

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
    console.warn('The element <.pdoc-page-content> does not exist.')
    return
  }
  const height = `${(pageContentEl.clientHeight * (pageOptions.value.zoomLevel || 1)) / 100}px`
  if (pageZoomHeight !== height) {
    pageZoomHeight = height
  }
}
let pmMutationObserver = null

const schedulePageZoomHeight = () => {
  if (pageHeightRaf) {
    cancelAnimationFrame(pageHeightRaf)
  }
  pageHeightRaf = requestAnimationFrame(() => {
    pageHeightRaf = 0
    updatePageZoomHeight()
  })
}
onMounted(async () => {
  await nextTick()
  pageContentEl = document.querySelector(`${container} .pdoc-page-content`)
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
    console.warn('The element <.pdoc-page-content> does not exist.')
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

// 页面变化后，更新页面高度并重新分页
watch(
  () => [
    pageOptions.value.layout,
    pageOptions.value.zoomLevel,
    pageOptions.value.size,
    pageOptions.value.orientation,
    // Margins were missing here, so changing them left the old page breaks in place.
    pageOptions.value.margin,
    pageOptions.value.pageNumber,
  ],
  () => {
    schedulePageZoomHeight()
    // The engine draws the page numbers, so it needs the settings; they are not derivable from the
    // document or from the geometry.
    editorRef.value?.commands.setPageNumberSettings?.(pageOptions.value.pageNumber)
    // Page geometry changed without the document changing, which the engine cannot detect on its own.
    editorRef.value?.commands.refreshPagination?.()
  },
  { deep: true, immediate: true },
)

// The watcher above can fire before the editor exists, so push the settings again once it does.
watch(
  () => editorRef.value,
  (instance) => {
    instance?.commands.setPageNumberSettings?.(pageOptions.value.pageNumber)
  },
  { immediate: true },
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
      `${container} .pdoc-page-node-content img[src][data-preview]`,
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
.pdoc-main-container {
  height: 100%;
  display: flex;
  position: relative;
}

.pdoc-zoomable-container {
  flex: 1;
  scroll-behavior: smooth;
  &.pdoc-page-container {
    padding: 20px 50px;
    box-sizing: border-box;
    .pdoc-zoomable-content {
      margin: 0 auto;
      box-shadow:
        rgba(0, 0, 0, 0.06) 0px 0px 10px 0px,
        rgba(0, 0, 0, 0.04) 0px 0px 0px 1px;
    }
    .pdoc-page-content {
      /* Visual Page Sheets: Header boundary, Footer & Page Numbering zone, and Sheet Separation Gap */
      /* One period is a sheet plus the gap the pagination engine keeps empty. */
      background-image:
        /* Footer & Page Numbering boundary line (dashed/subtle line at top of footer margin) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent calc(var(--pdoc-page-height) - var(--pdoc-page-margin-bottom) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--pdoc-page-height) - var(--pdoc-page-margin-bottom) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--pdoc-page-height) - var(--pdoc-page-margin-bottom)),
          transparent calc(var(--pdoc-page-height) - var(--pdoc-page-margin-bottom)),
          transparent calc(var(--pdoc-page-height) + var(--pdoc-page-sheet-gap, 16px))
        ),
        /* Sheet Separation Gap (16px grey band + sheet edge shadow at bottom of each page sheet) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent var(--pdoc-page-height),
          #cbd5e1 var(--pdoc-page-height),
          #e2e8f0 calc(var(--pdoc-page-height) + var(--pdoc-page-sheet-gap, 16px) / 2),
          #cbd5e1 calc(var(--pdoc-page-height) + var(--pdoc-page-sheet-gap, 16px))
        ),
        /* Header margin boundary line (subtle line at bottom of top margin) */
        repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent calc(var(--pdoc-page-margin-top) - 1px),
          rgba(0, 0, 0, 0.15) calc(var(--pdoc-page-margin-top) - 1px),
          rgba(0, 0, 0, 0.15) var(--pdoc-page-margin-top),
          transparent var(--pdoc-page-margin-top),
          transparent calc(var(--pdoc-page-height) + var(--pdoc-page-sheet-gap, 16px))
        );
    }
  }
  &.pdoc-web-container {
    display: flex;
    .pdoc-zoomable-content {
      flex: 1;
      .pdoc-page-corner {
        display: none;
      }
      .pdoc-page-content {
        min-height: 100%;
        .pdoc-page-node-content {
          min-height: 100px;
        }
      }
    }
  }
  .pdoc-page-content {
    transform-origin: 0 0;
    box-sizing: border-box;
    display: flex;
    position: relative;
    box-sizing: border-box;
    background-color: var(--pdoc-page-background);
    width: var(--pdoc-page-width);
    /* The engine sets --pdoc-page-total-height to a whole number of sheets, so the last sheet is drawn
       complete instead of being cut off wherever the text happens to end. */
    min-height: var(--pdoc-page-total-height, var(--pdoc-page-height));
    overflow: visible !important;
    display: flex;
    flex-direction: column;
    [contenteditable] {
      outline: none;
    }
  }
}

.pdoc-page-node-header {
  height: var(--pdoc-page-margin-top);
  overflow: hidden;
}

.pdoc-page-node-footer {
  height: var(--pdoc-page-margin-bottom);
  overflow: hidden;
}

.pdoc-page-node-header,
.pdoc-page-node-footer {
  display: flex;
  justify-content: space-between;
}

.pdoc-page-corner {
  box-sizing: border-box;
  position: relative;
  z-index: 10;
}

.pdoc-page-corner {
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

.pdoc-page-node-header-content,
.pdoc-page-node-footer-content {
  flex: 1;
}

.pdoc-page-node-content {
  position: relative;
  box-sizing: border-box;
  flex-shrink: 1;
}

.pdoc-main-floating-actions {
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
      background-color: var(--pdoc-color-white) !important;
      border: solid 1px var(--pdoc-primary-color);
    }
  }
}

.pdoc-viewer-container {
  position: absolute;
  inset: 0;
  z-index: 1000;
}
</style>
