<template>
  <menus-button
    ico="chinese-case"
    :text="t('base.textCase.lower')"
    hide-text
    :disabled="!hasSelection"
    @menu-click="editor?.chain().focus().setTextCase('lower').run()"
  />
</template>

<script setup>
const editor = inject('editor')
const hasSelection = computed(() => {
  const selection = editor.value?.state?.selection
  return Boolean(selection) && !selection.empty
})
</script>
