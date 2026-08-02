<template>
  <node-view-wrapper
    :id="node.attrs.id"
    class="umo-node-view"
    @click.capture="editor?.commands.setNodeSelection(getPos())"
  >
    <div class="umo-node-container umo-node-toc">
      <div class="umo-node-toc-body">
        <t-tree
          class="umo-toc-tree"
          :data="tocTreeData"
          :keys="{
            label: 'textContent',
            value: 'id',
          }"
          :empty="t('toc.empty')"
          :transition="false"
          activable
          hover
          expand-all
          line
          @active="headingActive"
        >
          <template #label="{ node: treeNode }">
            <div class="umo-toc-item-row">
              <span class="umo-toc-item-text">{{ treeNode.data.textContent }}</span>
              <span class="umo-toc-item-dots"></span>
              <span class="umo-toc-item-page">{{ treeNode.data.pageNumber || 1 }}</span>
            </div>
          </template>
        </t-tree>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { TextSelection } from '@tiptap/pm/state'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

const { getPos } = defineProps(nodeViewProps)

const container = inject('container')
const editor = inject('editor')

defineEmits(['close'])

let tocTreeData = $ref([])
let watchTreeData = []

const getPageNumber = (id) => {
  if (!id || typeof document === 'undefined') return 1
  const el = editor.value?.view?.dom?.querySelector(`[data-toc-id="${id}"]`)
  if (!el) return 1
  const pageNode = el.closest('.umo-page-node')
  if (pageNode) {
    const allPages = [...document.querySelectorAll('.umo-page-node')]
    const idx = allPages.indexOf(pageNode)
    if (idx !== -1) return idx + 1
  }
  return 1
}

const buildTocTree = (tocArray) => {
  const root = []
  const stack = []
  for (const item of tocArray) {
    const pageNumber = getPageNumber(item.id)
    const node = {
      textContent: item.textContent,
      level: item.originalLevel,
      id: item.id,
      pageNumber,
      actived: false,
      children: [],
    }
    while (
      stack.length > 0 &&
      stack[stack.length - 1].level >= item.originalLevel
    ) {
      stack.pop()
    }
    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }
    stack.push(node)
  }
  return root
}

watch(
  () => editor.value?.storage.tableOfContents.content,
  (toc) => {
    const curTocTreeData = buildTocTree(toc)
    if (JSON.stringify(watchTreeData) !== JSON.stringify(curTocTreeData)) {
      watchTreeData = curTocTreeData
      tocTreeData = JSON.parse(JSON.stringify(curTocTreeData))
    }
  },
  { immediate: true },
)

const headingActive = (value) => {
  if (!editor.value) {
    return
  }
  const nodeElement = editor.value.view.dom.querySelector(
    `[data-toc-id="${value[0]}"]`,
  )
  if (!nodeElement) return
  const pageContainer = document.querySelector(
    `${container} .umo-zoomable-container`,
  )
  const pageHeader = pageContainer?.querySelector('.umo-page-node-header')
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
.umo-node-view {
  .umo-node-toc {
    padding: 8px 0;
    position: relative;
    outline: none;
    border: none;
    background-color: transparent;
    width: 100%;

    &-body {
      --td-bg-color-container-hover: rgba(0, 0, 0, 0.05);
      --td-text-color-primary: #222;
      --td-border-level-1-color: #ddd;
      --td-brand-color-light: rgba(0, 0, 0, 0.05);

      .umo-tree__item {
        width: 100%;
      }

      .umo-tree__label {
        margin-left: 0 !important;
        padding: 4px 0;
        width: 100%;
        &:hover {
          color: var(--umo-primary-color);
        }
      }

      .umo-toc-item-row {
        display: flex;
        align-items: center;
        width: 100%;
        gap: 6px;

        .umo-toc-item-text {
          flex: 0 1 auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .umo-toc-item-dots {
          flex: 1;
          border-bottom: 1px dotted #bbb;
          height: 10px;
          margin: 0 4px;
        }

        .umo-toc-item-page {
          flex: 0 0 auto;
          font-size: 0.9em;
          color: var(--umo-text-color-secondary, #666);
          font-variant-numeric: tabular-nums;
        }
      }

      .umo-tree__empty {
        height: 40px;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #999;
        margin-bottom: 15px;
      }
    }
  }
}
</style>
