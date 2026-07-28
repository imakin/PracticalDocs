<template>
  <menus-button
    :text="t('documentFile.save')"
    :tooltip="t('documentFile.saveTip')"
    ico="download"
    data-testid="save-json"
    force-enabled
    huge
    @menu-click="saveDocumentFile"
  />
</template>

<script setup>
const saveDocumentFile = inject('saveDocumentFile')
</script>
