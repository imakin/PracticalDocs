<template>
  <node-view-wrapper
    :id="attrs.id"
    ref="containerRef"
    class="pdoc-node-view"
    :style="nodeStyle"
    @click.capture="editor?.commands.setNodeSelection(getPos())"
  >
    <div
      class="pdoc-node-container pdoc-select-outline pdoc-node-iframe"
      :class="{
        'pdoc-hover-shadow': !options.document?.readOnly,
      }"
    >
      <drager
        :selected="selected"
        :rotatable="false"
        :width="attrs.width"
        :height="attrs.height"
        :min-width="400"
        :min-height="200"
        :max-width="maxWidth"
        :disabled="!editor?.isEditable"
        @resize="onResize"
        @focus="selected = true"
      >
        <iframe
          :src="attrs.src"
          :style="{ pointerEvents: attrs.clickable ? 'auto' : 'none' }"
        ></iframe>
      </drager>
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import Drager from 'es-drager'
const options = inject('options')
const editor = inject('editor')

const props = defineProps(nodeViewProps)
const attrs = $computed(() => props.node.attrs)
const { updateAttributes, getPos } = props
const containerRef = ref(null)
let selected = $ref(false)
let maxWidth = $ref(0)

const nodeStyle = $computed(() => {
  const { nodeAlign, margin } = attrs
  const marginTop =
    margin?.top && margin?.top !== '' ? `${margin.top}px` : undefined
  const marginBottom =
    margin?.bottom && margin?.bottom !== '' ? `${margin.bottom}px` : undefined
  return {
    'justify-content': nodeAlign,
    marginTop,
    marginBottom,
  }
})

onMounted(async () => {
  await nextTick()
  if (containerRef.value) {
    const { offsetWidth } = containerRef.value.$el

    maxWidth = offsetWidth
    if (attrs.width === null) {
      updateAttributes({ width: offsetWidth })
    }
  }
})
const onResize = ({ width, height }) => {
  updateAttributes({ width, height })
}
onClickOutside(containerRef, () => {
  selected = false
  // updateAttributes({ clickable: false })
})
</script>

<style lang="less">
.pdoc-node-view {
  .pdoc-node-iframe {
    max-width: 100%;
    .es-drager {
      &:not(.selected) {
        outline: solid 1px var(--pdoc-content-node-border);
      }
    }
    iframe {
      display: block;
      min-width: 200px;
      min-height: 200px;
      width: 100%;
      height: 100%;
      border: none;
      background-color: #fff;
    }
  }
}
</style>
