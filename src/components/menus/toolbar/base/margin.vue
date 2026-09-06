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
      <div class="pdoc-node-margin-input">
        <t-input
          v-model="marginTop"
          size="small"
          :label="`↥${t('base.margin.top')}:`"
          :placeholder="profileMarginTop ? `profile: ${profileMarginTop}` : 'e.g. 0.25em, 12px'"
          clearable
          @change="setMargin"
        />
        <t-input
          v-model="marginBottom"
          size="small"
          :label="`↧${t('base.margin.bottom')}:`"
          :placeholder="profileMarginBottom ? `profile: ${profileMarginBottom}` : 'e.g. 0.25em, 12px'"
          clearable
          @change="setMargin"
        />
        <div class="pdoc-margin-presets">
          <span class="pdoc-preset-title">Bottom Margin:</span>
          <div class="pdoc-preset-buttons">
            <t-button
              v-for="preset in [0, 4, 8, 12, 16, 24]"
              :key="preset"
              size="small"
              variant="outline"
              :theme="effectiveMarginBottom === `${preset}px` || effectiveMarginBottom === String(preset) ? 'primary' : 'default'"
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
// What the block's profile says, for when the block itself says nothing. Since a profile became a
// CSS class the block carries no margin attribute of its own, so reading only the attribute left the
// panel empty for a block that plainly had spacing. These are shown as the placeholder, not as the
// value: the field means "an override this block carries", and seeding it with the profile's value
// would turn styling the profile owns into a per-block override on the next keystroke.
let profileMarginTop = $ref('')
let profileMarginBottom = $ref('')

const effectiveMarginBottom = $computed(() => marginBottom || profileMarginBottom)

const asText = (value) =>
  value !== undefined && value !== null && value !== '' ? String(value) : ''

const profileOf = (node) => {
  const id = node?.attrs?.numberingProfileId
  if (!id || !editor.value) return null
  let profiles = []
  editor.value.commands.getNumberingProfiles?.((list) => {
    profiles = Array.isArray(list) ? list : []
  })
  return profiles.find((profile) => profile.id === id) || null
}

const setMarginValue = () => {
  if (!popupVisible.value) {
    marginTop = ''
    marginBottom = ''
    profileMarginTop = ''
    profileMarginBottom = ''
    return
  }
  const node = editor.value ? getSelectionNode(editor.value) : null
  const profile = profileOf(node)
  profileMarginTop = asText(profile?.marginTop)
  profileMarginBottom = asText(profile?.marginBottom)
  const margin = node?.attrs?.margin
  marginTop = asText(margin?.top)
  marginBottom = asText(margin?.bottom)
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
.pdoc-node-margin-input {
  display: flex;
  flex-direction: column;
  gap: 10px;
  --td-comp-size-xs: 26px;
  width: 170px;
  :deep(.t-input) {
    width: 100%;
  }

  .pdoc-margin-presets {
    display: flex;
    flex-direction: column;
    gap: 4px;
    .pdoc-preset-title {
      font-size: 11px;
      color: var(--pdoc-text-color-light);
    }
    .pdoc-preset-buttons {
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
