<template>
  <bubble-menu v-if="editor" class="pdoc-editor-bubble-menu" :editor="editor">
    <menus-bubble-menus v-if="options?.document?.enableBubbleMenu">
      <template #bubble_menu="props">
        <slot name="bubble_menu" v-bind="props" />
      </template>
    </menus-bubble-menus>
  </bubble-menu>
</template>

<script setup>
import { BubbleMenu } from '@tiptap/vue-3/menus'

const editor = inject('editor')
const options = inject('options')
</script>

<style lang="less">
.pdoc-editor-bubble-menu {
  max-width: 620px;
  z-index: 110;
  border-radius: var(--pdoc-radius);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 10px !important;
  box-shadow: var(--pdoc-shadow);
  border: 1px solid var(--pdoc-border-color);
  background-color: var(--pdoc-color-white);

  &:empty {
    display: none;
  }

  .pdoc-menu-button.show-text .pdoc-button-content .pdoc-button-text {
    display: none !important;
  }

  .pdoc-menu-button.huge {
    height: var(--td-comp-size-xs);
    min-width: unset;

    .pdoc-button-content {
      min-width: unset !important;

      .pdoc-icon {
        font-size: 16px;
        margin-top: 0;
      }
    }
  }
}
</style>
