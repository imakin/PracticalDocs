<template>
  <menus-button
    ico="markdown"
    :text="t('base.markdown.toBlock')"
    :tooltip="t('base.markdown.toBlockTip')"
    :menu-active="isMarkdownBlock"
    huge
    @menu-click="editor?.commands.toggleMarkdownBlock()"
  />
</template>

<script setup>
const editor = inject('editor')

// One button, and it reports which mode the block the cursor is in is already in. A pair of buttons
// would ask the writer to work out which one applies to a block they are already looking at.
const isMarkdownBlock = $computed(() => editor.value?.isActive('markdownBlock') ?? false)
</script>
