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
    <div class="pdoc-cross-reference-form">
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
      <p v-if="targets.length === 0" class="pdoc-cross-reference-empty">
        {{ t('references.crossReference.empty') }}
      </p>
      <!--
        Said before the writer presses Insert, not after. Inside a markdown block the reference is
        written into the source as markdown, and a writer who did not expect that would go looking
        for a reference that is sitting there in plain sight as text.
      -->
      <p v-else-if="markdownTarget" class="pdoc-cross-reference-empty">
        {{
          t('references.crossReference.markdownHint', { token: previewToken })
        }}
      </p>
    </div>
  </modal>
</template>

<script setup>
import { findMarkdownBlock } from '@/extensions/markdown-block'
import { crossReferenceToken } from '@/utils/markdown'

const editor = inject('editor')

let dialogVisible = $ref(false)
let targets = $ref([])
let targetId = $ref('')
let displayMode = $ref('label')
// The block the writer is in, decided when the dialog opens. Opening the dialog takes the focus out
// of the editor, so it cannot be decided again at the moment Insert is pressed.
let markdownTarget = $ref(null)

const previewToken = $computed(() =>
  crossReferenceToken(targetId || 'id', displayMode),
)

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
  markdownTarget = findMarkdownBlock(editor.value?.state, editor.value)
  dialogVisible = true
}

const insertReference = () => {
  if (!targetId) {
    return
  }
  // Inside a markdown block the source is the truth (ADR 0012), so the reference is written as
  // markdown and the block renders it into the same node the rest of the document uses. Inserting
  // the node directly would put it in the rendered half, where the next edit to the source would
  // throw it away.
  const inserted = markdownTarget
    ? editor.value?.commands.insertMarkdownSourceText({
        pos: markdownTarget.pos,
        text: crossReferenceToken(targetId, displayMode),
      })
    : editor.value
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
.pdoc-cross-reference-form {
  min-height: 148px;
}

.pdoc-cross-reference-empty {
  margin: 4px 0 0;
  color: var(--pdoc-text-color-secondary);
  font-size: 12px;
}
</style>
