<template>
  <menus-button
    :text="t('documentFile.open')"
    :tooltip="t('documentFile.openTip')"
    ico="file-view"
    data-testid="open-json"
    force-enabled
    huge
    @menu-click="fileInput?.click()"
  />
  <input
    ref="fileInput"
    type="file"
    accept=".json,application/json"
    hidden
    data-testid="open-json-input"
    @change="openSelectedFile"
  />
</template>

<script setup>
const openDocumentFile = inject('openDocumentFile')
const fileInput = ref(null)

const openSelectedFile = async (event) => {
  const input = event.target
  const file = input.files?.[0]
  if (file) {
    await openDocumentFile(file)
  }
  input.value = ''
}
</script>
