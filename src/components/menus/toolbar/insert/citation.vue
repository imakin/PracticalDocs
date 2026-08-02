<template>
  <menus-button
    ico="footnote"
    :text="t('references.citation.text')"
    :tooltip="t('references.citation.tip')"
    huge
    @menu-click="dialogVisible = true"
  />
  <modal
    :visible="dialogVisible"
    width="480px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.citation.insert')"
    @confirm="insertCitation"
    @close="closeDialog"
  >
    <template #header>
      <icon name="footnote" />
      {{ t('references.citation.text') }}
    </template>
    <t-form label-align="top">
      <t-form-item
        :label="t('references.citation.source')"
        :help="sourceError ? t('references.citation.empty') : ''"
      >
        <t-textarea
          v-model="source"
          :placeholder="t('references.citation.placeholder')"
          :status="sourceError ? 'error' : 'default'"
          :autosize="{ minRows: 3, maxRows: 6 }"
          autofocus
        />
      </t-form-item>
    </t-form>
  </modal>
</template>

<script setup>
const editor = inject('editor')

let dialogVisible = $ref(false)
let source = $ref('')
let sourceError = $ref(false)

const closeDialog = () => {
  dialogVisible = false
  source = ''
  sourceError = false
}

const insertCitation = () => {
  const normalizedSource = source.replace(/\s+/g, ' ').trim()
  if (!normalizedSource) {
    sourceError = true
    return
  }
  if (editor.value?.chain().focus().addFootnote(normalizedSource).run()) {
    closeDialog()
  }
}
</script>
