<template>
  <menus-button
    ico="list-ordered"
    :text="t('references.numbering.text')"
    :tooltip="t('references.numbering.tip')"
    :menu-active="enabled"
    huge
    @menu-click="openDialog"
  />
  <modal
    :visible="dialogVisible"
    width="520px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.numbering.apply')"
    @confirm="applySettings"
    @close="dialogVisible = false"
  >
    <template #header>
      <icon name="list-ordered" />
      {{ t('references.numbering.text') }}
    </template>
    <t-form label-align="top">
      <t-form-item :label="t('references.numbering.toggleLabel')">
        <t-switch v-model="enabled" />
      </t-form-item>
      <template v-if="enabled">
        <t-form-item :label="t('references.numbering.headingStyle')">
          <t-select v-model="styles.heading" :options="styleOptions" />
        </t-form-item>
        <t-form-item :label="t('references.numbering.headingTemplate')">
          <t-input
            v-model="templates.heading"
            :placeholder="t('references.numbering.headingTemplatePlaceholder')"
          />
        </t-form-item>
        <t-form-item :label="t('references.numbering.figureStyle')">
          <t-select v-model="styles.figure" :options="styleOptions" />
        </t-form-item>
        <t-form-item :label="t('references.numbering.figureTemplate')">
          <t-input
            v-model="templates.figure"
            :placeholder="t('references.numbering.figureTemplatePlaceholder')"
          />
        </t-form-item>
        <t-form-item :label="t('references.numbering.tableStyle')">
          <t-select v-model="styles.table" :options="styleOptions" />
        </t-form-item>
        <t-form-item :label="t('references.numbering.tableTemplate')">
          <t-input
            v-model="templates.table"
            :placeholder="t('references.numbering.tableTemplatePlaceholder')"
          />
        </t-form-item>
      </template>
    </t-form>
  </modal>
</template>

<script setup>
const editor = inject('editor')

let dialogVisible = $ref(false)
let enabled = $ref(true)
let styles = $ref({
  heading: 'numeric',
  figure: 'numeric',
  table: 'numeric',
})
let templates = $ref({
  heading: '{number}',
  figure: '{label} {number}',
  table: '{label} {number}',
})

const styleOptions = $computed(() => [
  { label: t('references.numbering.styles.numeric'), value: 'numeric' },
  { label: t('references.numbering.styles.romanUpper'), value: 'roman-upper' },
  { label: t('references.numbering.styles.romanLower'), value: 'roman-lower' },
  { label: t('references.numbering.styles.alphaUpper'), value: 'alpha-upper' },
  { label: t('references.numbering.styles.alphaLower'), value: 'alpha-lower' },
])

const refreshConfig = () => {
  editor.value?.commands.getNumberingConfig((config) => {
    enabled = config.enabled !== false
    styles = { ...styles, ...config.styles }
    templates = { ...templates, ...config.templates }
  })
}

const openDialog = () => {
  refreshConfig()
  dialogVisible = true
}

const applySettings = () => {
  editor.value?.commands.setNumberingConfig({
    enabled,
    styles,
    templates,
  })
  dialogVisible = false
}

onMounted(() => {
  refreshConfig()
})
</script>

<style lang="less" scoped>
:deep(.t-form__item) {
  margin-bottom: 12px;
}
</style>
