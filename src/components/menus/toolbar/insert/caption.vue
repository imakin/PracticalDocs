<template>
  <menus-button
    ico="tag"
    :text="t('references.caption.text')"
    :tooltip="t('references.caption.tip')"
    :disabled="!canCaption"
    huge
    @menu-click="openDialog"
  />
  <modal
    :visible="dialogVisible"
    width="440px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.caption.save')"
    @confirm="saveCaption"
    @close="dialogVisible = false"
  >
    <template #header>
      <icon name="tag" />
      {{ t('references.caption.text') }}
    </template>
    <t-form label-align="top">
      <t-form-item :label="t('references.caption.field')">
        <t-input
          v-model="caption"
          :placeholder="t('references.caption.placeholder')"
          clearable
          autofocus
          @enter="saveCaption"
        />
      </t-form-item>
    </t-form>
  </modal>
</template>

<script setup>
import {
  findActiveTarget,
  getTargetCaption,
} from '@/extensions/document-references'

const editor = inject('editor')

let dialogVisible = $ref(false)
let caption = $ref('')

const activeTarget = $computed(() =>
  findActiveTarget(editor.value?.state),
)
const canCaption = $computed(() => !!activeTarget)

const openDialog = () => {
  if (!activeTarget) {
    return
  }
  caption = getTargetCaption(activeTarget)
  dialogVisible = true
}

const saveCaption = () => {
  if (editor.value?.commands.setReferenceCaption(caption)) {
    dialogVisible = false
    editor.value?.commands.focus()
  }
}
</script>
