<template>
  <menus-button
    ico="link"
    :text="t('references.crossReference.text')"
    :tooltip="t('references.crossReference.tip')"
    huge
    @menu-click="openDialog"
  />
  <modal
    :visible="dialogVisible"
    width="480px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.crossReference.insert')"
    @confirm="insertReference"
    @close="dialogVisible = false"
  >
    <template #header>
      <icon name="link" />
      {{ t('references.crossReference.text') }}
    </template>
    <div class="umo-cross-reference-form">
      <t-form label-align="top">
        <t-form-item :label="t('references.crossReference.target')">
          <t-select
            v-model="targetId"
            :options="targetOptions"
            :placeholder="t('references.crossReference.targetPlaceholder')"
            filterable
          />
        </t-form-item>
        <t-form-item :label="t('references.crossReference.display')">
          <t-select v-model="displayMode" :options="displayOptions" />
        </t-form-item>
      </t-form>
      <p v-if="targets.length === 0" class="umo-cross-reference-empty">
        {{ t('references.crossReference.empty') }}
      </p>
    </div>
  </modal>
</template>

<script setup>
const editor = inject('editor')

let dialogVisible = $ref(false)
let targets = $ref([])
let targetId = $ref('')
let displayMode = $ref('label')

const targetOptions = $computed(() =>
  targets.map((target) => ({
    label: target.optionLabel,
    value: target.targetId,
  })),
)

const displayOptions = $computed(() => [
  {
    label: t('references.crossReference.modes.label'),
    value: 'label',
  },
  {
    label: t('references.crossReference.modes.title'),
    value: 'title',
  },
  {
    label: t('references.crossReference.modes.labelTitle'),
    value: 'label-title',
  },
])

const openDialog = () => {
  editor.value?.commands.getReferenceTargets((items) => {
    targets = items
  })
  targetId = targets[0]?.targetId || ''
  displayMode = 'label'
  dialogVisible = true
}

const insertReference = () => {
  if (!targetId) {
    return
  }
  const inserted = editor.value
    ?.chain()
    .focus()
    .insertCrossReference({ targetId, displayMode })
    .run()
  if (inserted) {
    dialogVisible = false
  }
}
</script>

<style lang="less" scoped>
.umo-cross-reference-form {
  min-height: 148px;
}

.umo-cross-reference-empty {
  margin: 4px 0 0;
  color: var(--umo-text-color-secondary);
  font-size: 12px;
}
</style>
