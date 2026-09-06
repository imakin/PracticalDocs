<template>
  <node-view-wrapper class="pdoc-node-view">
    <t-popup
      :attach="`${container} .pdoc-zoomable-container`"
      overlay-inner-class-name="pdoc-editor-bubble-menu"
      trigger="click"
      :visible="
        editor?.isEditable &&
        bubbleMenu &&
        editor.state.selection.to === editor.state.selection.from
      "
      @visible-change="(visible) => (bubbleMenu = visible)"
    >
      <div
        class="pdoc-node-container hover-shadow pdoc-node-callout"
        :style="{
          color: attrs.fontColor,
          backgroundColor: attrs.backgroundColor,
        }"
        @mousedown="focusCalloutContent"
      >
        <span
          v-if="attrs.icon"
          class="pdoc-node-callout-icon"
          contenteditable="false"
          >{{ attrs.icon }}</span
        >
        <node-view-content
          class="pdoc-node-callout-content"
          :class="{
            'pdoc-node-callout-empty': node.content.size <= 2,
          }"
          :data-placeholder="t('callout.placeholder')"
        />
      </div>
      <template #content>
        <menus-bubble-callout-builtin />
        <div class="pdoc-bubble-menu-divider"></div>
        <menus-toolbar-insert-emoji @select-emoji="selectEmoji" />
        <menus-bubble-callout-emoji-remove
          v-if="editor.getAttributes('callout').icon"
        />
        <menus-bubble-callout-background />
        <div class="pdoc-bubble-menu-divider"></div>
        <menus-bubble-node-delete />
      </template>
    </t-popup>
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
const props = defineProps(nodeViewProps)
const attrs = $computed(() => props.node.attrs)
const { updateAttributes } = props

const container = inject('container')
const bubbleMenu = $ref(false)

const selectEmoji = (emoji) => {
  updateAttributes({
    icon: emoji,
  })
}

const focusCalloutContent = (event) => {
  if (!props.editor?.isEditable || event.button !== 0) {
    return
  }
  const { target } = event
  if (!(target instanceof HTMLElement)) {
    return
  }
  // 点击文本区域时保留原生定位行为；仅为空白区域提供兜底聚焦。
  if (target.closest('.pdoc-node-callout-content')) {
    return
  }
  const pos = props.getPos?.()
  if (typeof pos !== 'number') {
    return
  }
  props.editor
    .chain()
    .focus()
    .setTextSelection(pos + 1)
    .run()
}
</script>

<style lang="less">
.pdoc-node-callout {
  padding: 8px 12px;
  border-radius: var(--pdoc-radius);
  display: flex;
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.2);
  box-sizing: border-box;
  align-items: flex-start;
  &-icon {
    font-size: 18px;
    margin-right: 10px;
    line-height: 1.25;
  }
  &-content {
    flex: 1;
    min-height: 1em;
    cursor: text;
    white-space: pre-wrap;
    word-break: break-word;

    &.pdoc-node-callout-empty {
      display: flex;
      align-items: center;
      &::after {
        content: attr(data-placeholder);
        opacity: 0.5;
        pointer-events: none;
      }
      .tiptap-invisible-character {
        display: none;
      }
    }
  }
}
</style>
