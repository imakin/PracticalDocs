<template>
  <menus-button
    ico="margin"
    :text="t('base.margin.text')"
    menu-type="popup"
    popup-handle="arrow"
    hide-text
    :popup-visible="popupVisible"
    @toggle-popup="togglePopup"
    @menu-click="resetMargin()"
  >
    <template #content>
      <div class="umo-node-margin-input">
        <t-input
          v-model="marginTop"
          size="small"
          :label="`↥${t('base.margin.top')}:`"
          placeholder="e.g. 0.25em, 12px"
          clearable
          @change="setMargin"
        />
        <t-input
          v-model="marginBottom"
          size="small"
          :label="`↧${t('base.margin.bottom')}:`"
          placeholder="e.g. 0.25em, 12px"
          clearable
          @change="setMargin"
        />
        <div class="umo-margin-presets">
          <span class="umo-preset-title">Bottom Margin:</span>
          <div class="umo-preset-buttons">
            <t-button
              v-for="preset in [0, 4, 8, 12, 16, 24]"
              :key="preset"
              size="small"
              variant="outline"
              :theme="marginBottom === `${preset}px` || marginBottom === String(preset) ? 'primary' : 'default'"
              @click="applyBottomMarginPreset(preset)"
            >
              {{ preset }}px
            </t-button>
          </div>
        </div>
        <t-button variant="outline" size="small" @click="resetMargin">
          {{ t('base.margin.reset') }}
        </t-button>
      </div>
    </template>
  </menus-button>
</template>

<script setup>
import { getSelectionNode } from '@/utils/selection'

const { popupVisible, togglePopup } = usePopup()
const editor = inject('editor')

let marginTop = $ref('')
let marginBottom = $ref('')

const setMarginValue = () => {
  if (popupVisible.value) {
    const node = editor.value ? getSelectionNode(editor.value) : null
    if (!node?.attrs?.margin) {
      marginTop = ''
      marginBottom = ''
      return
    }
    const { margin } = node.attrs
    marginTop =
      margin?.top !== undefined && margin?.top !== null
        ? String(margin.top)
        : ''
    marginBottom =
      margin?.bottom !== undefined && margin?.bottom !== null
        ? String(margin.bottom)
        : ''
  } else {
    marginTop = ''
    marginBottom = ''
  }
}

const setMargin = () => {
  editor.value?.commands.setMargin({
    top: marginTop !== undefined && marginTop !== '' ? marginTop?.toString() : undefined,
    bottom:
      marginBottom !== undefined && marginBottom !== ''
        ? marginBottom?.toString()
        : undefined,
  })
}

const applyBottomMarginPreset = (value) => {
  marginBottom = `${value}px`
  setMargin()
}

watch(
  () => popupVisible.value,
  (visible) => {
    if (visible) {
      setMarginValue()
    } else if (editor.value) {
      editor.value.commands.focus()
    }
  },
  { immediate: true },
)

const resetMargin = () => {
  editor.value?.commands.unsetMargin()
  popupVisible.value = false
}
</script>

<style lang="less" scoped>
.umo-node-margin-input {
  display: flex;
  flex-direction: column;
  gap: 10px;
  --td-comp-size-xs: 26px;
  width: 170px;
  :deep(.t-input) {
    width: 100%;
  }

  .umo-margin-presets {
    display: flex;
    flex-direction: column;
    gap: 4px;
    .umo-preset-title {
      font-size: 11px;
      color: var(--umo-text-color-light);
    }
    .umo-preset-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      :deep(.t-button) {
        padding: 0 4px;
        font-size: 11px;
        height: 22px;
      }
    }
  }
}
</style>
