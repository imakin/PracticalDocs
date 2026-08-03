<template>
  <div
    v-if="$toolbar.mode !== 'classic'"
    class="umo-toolbar-headding"
    :class="{ unfold: popupVisible }"
    :disabled="!editor?.isEditable"
  >
    <div class="umo-heading-container">
      <template v-for="(item, index) in headingCards" :key="item.key">
        <div
          v-if="index < 4"
          class="card"
          :class="{
            active: isCardActive(item) && editor?.isEditable,
            disabled: !item.enabled,
          }"
          @click="selectHeadingProfile(item)"
        >
          <div class="title" :class="item.desc" :title="item.name">{{ item.name }}</div>
          <div class="subtitle">
            {{ item.desc }}<template v-if="!item.enabled"> (OFF)</template>
          </div>
        </div>
      </template>
      <t-popup
        :attach="container"
        trigger="click"
        placement="bottom-right"
        overlay-class-name="umo-heading-container-popup"
        destroy-on-close
        :visible="popupVisible"
      >
        <div class="arrow" @click="popupVisible = !popupVisible">
          <icon name="arrow-down" />
        </div>
        <template #content>
          <div ref="popupContentRef" class="umo-heading-container popup-content">
            <template v-for="(item, index) in headingCards" :key="item.key">
              <div
                v-if="index >= 4"
                class="card"
                :class="{
                  active: isCardActive(item) && editor?.isEditable,
                  disabled: !item.enabled,
                }"
                @click="selectHeadingProfile(item)"
              >
                <div class="title" :class="item.desc" :title="item.name">{{ item.name }}</div>
                <div class="subtitle">
                  {{ item.desc }}<template v-if="!item.enabled"> (OFF)</template>
                </div>
              </div>
            </template>

            <div v-if="customProfileCards.length > 0" class="block-profiles-section">
              <div class="section-title">{{ t('references.numbering.manageProfiles') }}</div>
              <div class="block-cards-list">
                <div
                  v-for="item in customProfileCards"
                  :key="item.key"
                  class="card"
                  :class="{
                    active: isCardActive(item) && editor?.isEditable,
                    disabled: !item.enabled,
                  }"
                  @click="selectHeadingProfile(item)"
                >
                  <div class="title" :class="item.desc" :title="item.name">{{ item.name }}</div>
                  <div class="subtitle">
                    {{ item.desc }}<template v-if="!item.enabled"> (OFF)</template>
                  </div>
                </div>
              </div>
            </div>

            <div class="profile-action-bar" @click="openProfileModal">
              <icon name="setting" />
              <span>{{ t('references.numbering.manageProfiles') }}</span>
            </div>
          </div>
        </template>
      </t-popup>
    </div>
  </div>
  <div v-else class="umo-heading-classic-wrap">
    <menus-button
      :text="t('base.heading.tip')"
      hide-text
      menu-type="select"
      :style="{ width: '120px' }"
      :placeholder="t('base.heading.text')"
      borderless
      :select-value="currentValue"
      @menu-click="setHeading"
    >
      <t-option
        v-for="item in allCards"
        :key="item.key"
        class="umo-heading-select-option"
        :value="item.value"
        :label="item.name"
      >
        <div class="heading-size" :class="item.desc">
          {{ item.name }}
          <span v-if="!item.enabled" class="off-badge">(OFF)</span>
        </div>
      </t-option>
    </menus-button>
    <t-button variant="text" shape="square" size="small" @click="openProfileModal">
      <icon name="setting" />
    </t-button>
  </div>

  <modal
    :visible="profileModalVisible"
    width="640px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.numbering.close')"
    @confirm="profileModalVisible = false"
    @close="profileModalVisible = false"
  >
    <template #header>
      <icon name="list-ordered" />
      {{ t('references.numbering.manageProfiles') }}
    </template>
    <div class="umo-profiles-manager">
      <div class="profile-list-header">
        <div class="profile-title">{{ t('references.numbering.profilesList') }}</div>
        <t-button size="small" theme="primary" @click="openCreateProfile">
          + {{ t('references.numbering.addProfile') }}
        </t-button>
      </div>

      <div class="profile-cards">
        <div v-for="profile in profiles" :key="profile.id" class="profile-card">
          <div class="profile-info">
            <div class="profile-name">{{ profile.name }}</div>
            <div class="profile-details">
              <span>{{ profile.targetType }}</span>
              <span v-if="profile.level"> (H{{ profile.level }})</span>
              <span> &bull; {{ profile.style }}</span>
              <span> &bull; {{ profile.template }}</span>
            </div>
          </div>
          <div class="profile-actions">
            <t-switch
              :value="profile.enabled !== false"
              size="small"
              @change="(val) => toggleProfileEnabled(profile.id, val)"
            />
            <t-button size="small" variant="outline" @click="applyProfile(profile.id)">
              {{ t('references.numbering.applyToBlock') }}
            </t-button>
            <t-button size="small" variant="text" @click="editProfile(profile)">
              <icon name="edit" />
            </t-button>
          </div>
        </div>
      </div>
    </div>
  </modal>

  <modal
    :visible="editModalVisible"
    width="480px"
    draggable
    destroy-on-close
    :confirm-btn="t('references.numbering.saveProfile')"
    :cancel-btn="t('references.numbering.cancel')"
    @confirm="saveEditingProfile"
    @close="editModalVisible = false"
  >
    <template #header>
      <icon name="edit" />
      {{ activeEditingProfile?.id ? t('references.numbering.editProfile') : t('references.numbering.addProfile') }}
    </template>
    <t-form v-if="activeEditingProfile" label-align="top">
      <t-form-item :label="t('references.numbering.profileName')">
        <t-input v-model="activeEditingProfile.name" />
      </t-form-item>
      <t-form-item :label="t('references.numbering.toggleLabel')">
        <t-switch v-model="activeEditingProfile.enabled" />
      </t-form-item>
      <t-form-item :label="t('references.numbering.targetType')">
        <t-select v-model="activeEditingProfile.targetType" :options="targetTypeOptions" :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }" />
      </t-form-item>
      <t-form-item v-if="activeEditingProfile.targetType === 'heading'" :label="t('references.numbering.level')">
        <t-input-number v-model="activeEditingProfile.level" :min="1" :max="6" />
      </t-form-item>
      <t-form-item :label="t('references.numbering.style')">
        <t-select v-model="activeEditingProfile.style" :options="styleOptions" :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }" />
      </t-form-item>
      <t-form-item :label="t('references.numbering.template')">
        <t-textarea v-model="activeEditingProfile.template" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="e.g. BAB {number}&#10;or {number}" />
      </t-form-item>
      <t-form-item label="Font Size">
        <t-select v-model="activeEditingProfile.fontSize" :options="fontSizeOptions" clearable placeholder="Default" :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }" />
      </t-form-item>
      <t-form-item label="Line Height">
        <t-select v-model="activeEditingProfile.lineHeight" :options="lineHeightOptions" clearable placeholder="Default" :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }" />
      </t-form-item>
      <t-form-item label="Bottom Margin">
        <t-select v-model="activeEditingProfile.marginBottom" :options="marginBottomOptions" clearable placeholder="Default" :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }" />
      </t-form-item>
    </t-form>
  </modal>
</template>

<script setup>
const { popupVisible } = usePopup()
const container = inject('container')
const editor = inject('editor')
const $toolbar = useState('toolbar', inject('options'))
const popupContentRef = ref(null)

let profileModalVisible = $ref(false)
let editModalVisible = $ref(false)
let profiles = $ref([])
let activeEditingProfile = $ref(null)

const headingCards = computed(() => {
  const items = [
    {
      key: 'paragraph',
      name: t('base.heading.paragraph'),
      desc: 'text',
      value: 'paragraph',
      targetType: 'paragraph',
      enabled: true,
    },
  ]
  for (let level = 1; level <= 6; level += 1) {
    items.push({
      key: `std-h${level}`,
      name: t('base.heading.text', { level }),
      desc: `h${level}`,
      value: level,
      targetType: 'heading',
      level,
      enabled: true,
    })
  }
  return items
})

const customProfileCards = computed(() => {
  if (!Array.isArray(profiles)) return []
  return profiles.map((p) => ({
    key: p.id,
    id: p.id,
    name: p.name || p.id,
    desc: p.targetType === 'heading' ? `h${p.level || 1}` : p.targetType,
    value: p.level || p.targetType,
    targetType: p.targetType,
    level: p.level,
    enabled: p.enabled !== false,
    style: p.style,
    template: p.template,
  }))
})

const allCards = computed(() => [...headingCards.value, ...customProfileCards.value])

const isCardActive = (item) => {
  if (!editor.value) return false
  if (item.value === 'paragraph') return editor.value.isActive('paragraph')

  const { $from } = editor.value.state.selection
  let currentProfileId = null
  for (let d = $from.depth; d >= 0; d -= 1) {
    const node = $from.node(d)
    if (['heading', 'image', 'table'].includes(node.type.name)) {
      currentProfileId = node.attrs.numberingProfileId || null
      break
    }
  }

  if (item.id) {
    return item.id === currentProfileId
  }

  if (item.targetType === 'heading' && item.level) {
    return (
      editor.value.isActive('heading', { level: item.level }) &&
      !currentProfileId
    )
  }

  return editor.value.isActive(item.targetType) && !currentProfileId
}

const currentValue = computed(() => {
  if (editor.value) {
    if (editor.value.isActive('paragraph')) return 'paragraph'
    for (let l = 1; l <= 6; l += 1) {
      if (editor.value.isActive('heading', { level: l })) return l
    }
  }
  return ''
})

const setHeading = (value) => {
  if (!editor.value) return
  if (value === 'paragraph') {
    editor.value.chain().focus().setParagraph().run()
  } else if (typeof value === 'number') {
    editor.value.chain().focus().toggleHeading({ level: value }).run()
  }
  popupVisible.value = false
}

const selectHeadingProfile = (item) => {
  if (!editor.value) return
  if (item.value === 'paragraph') {
    editor.value.chain().focus().setParagraph().run()
    editor.value.commands.applyNumberingProfile(null)
  } else {
    if (item.targetType === 'heading' && item.level) {
      editor.value.chain().focus().toggleHeading({ level: item.level }).run()
    }
    editor.value.commands.applyNumberingProfile(item.id || null)
  }
  popupVisible.value = false
}

const styleOptions = $computed(() => [
  { label: t('references.numbering.styles.numeric'), value: 'numeric' },
  { label: t('references.numbering.styles.romanUpper'), value: 'roman-upper' },
  { label: t('references.numbering.styles.romanLower'), value: 'roman-lower' },
  { label: t('references.numbering.styles.alphaUpper'), value: 'alpha-upper' },
  { label: t('references.numbering.styles.alphaLower'), value: 'alpha-lower' },
])

const targetTypeOptions = $computed(() => [
  { label: t('references.labels.section'), value: 'heading' },
  { label: t('references.labels.table'), value: 'table' },
  { label: t('references.labels.figure'), value: 'figure' },
])

const fontSizeOptions = [
  { label: 'Default', value: '' },
  { label: '8px', value: '8px' },
  { label: '9px', value: '9px' },
  { label: '10px', value: '10px' },
  { label: '11px', value: '11px' },
  { label: '12px', value: '12px' },
  { label: '13px', value: '13px' },
  { label: '14px', value: '14px' },
  { label: '15px', value: '15px' },
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '20px', value: '20px' },
  { label: '22px', value: '22px' },
  { label: '24px', value: '24px' },
  { label: '26px', value: '26px' },
  { label: '28px', value: '28px' },
  { label: '32px', value: '32px' },
  { label: '36px', value: '36px' },
  { label: '42px', value: '42px' },
  { label: '48px', value: '48px' },
  { label: '72px', value: '72px' },
  { label: '12pt', value: '12pt' },
  { label: '14pt', value: '14pt' },
  { label: '16pt', value: '16pt' },
  { label: '18pt', value: '18pt' },
  { label: '24pt', value: '24pt' },
  { label: '36pt', value: '36pt' },
]

const lineHeightOptions = [
  { label: 'Default', value: '' },
  { label: '1.0 (Single)', value: '1' },
  { label: '1.25', value: '1.25' },
  { label: '1.5', value: '1.5' },
  { label: '1.75', value: '1.75' },
  { label: '2.0 (Double)', value: '2' },
]

const marginBottomOptions = [
  { label: 'Default (0px)', value: '' },
  { label: '0px', value: '0px' },
  { label: '4px', value: '4px' },
  { label: '8px', value: '8px' },
  { label: '12px', value: '12px' },
  { label: '16px', value: '16px' },
  { label: '24px', value: '24px' },
]

const loadProfiles = () => {
  editor.value?.commands.getNumberingProfiles((data) => {
    profiles = Array.isArray(data) ? [...data] : []
  })
}

const openProfileModal = () => {
  loadProfiles()
  popupVisible.value = false
  profileModalVisible = true
}

const toggleProfileEnabled = (id, enabled) => {
  editor.value?.commands.updateNumberingProfile(id, { enabled })
  loadProfiles()
}

const applyProfile = (id) => {
  const prof = profiles.find((p) => p.id === id)
  if (prof && prof.targetType === 'heading' && prof.level) {
    editor.value?.chain().focus().toggleHeading({ level: prof.level }).run()
  }
  editor.value?.commands.applyNumberingProfile(id)
  profileModalVisible = false
}

const editProfile = (profile) => {
  activeEditingProfile = { ...profile }
  editModalVisible = true
}

const openCreateProfile = () => {
  activeEditingProfile = {
    name: 'Profil Baru',
    enabled: true,
    targetType: 'heading',
    level: 1,
    style: 'numeric',
    template: '{number}',
  }
  editModalVisible = true
}

const saveEditingProfile = () => {
  if (!activeEditingProfile) return
  if (activeEditingProfile.id) {
    editor.value?.commands.updateNumberingProfile(
      activeEditingProfile.id,
      activeEditingProfile,
    )
  } else {
    editor.value?.commands.addNumberingProfile(activeEditingProfile)
  }
  editModalVisible = false
  loadProfiles()
}

onMounted(() => {
  loadProfiles()
})

onClickOutside(
  popupContentRef,
  () => {
    popupVisible.value = false
  },
  {
    ignore: ['.umo-popup'],
  },
)
</script>

<style lang="less" scoped>
.umo-toolbar-headding {
  width: 318px;
  height: 56px;
  position: relative;
  z-index: 10;
  overflow: hidden;
  border-radius: 3px;
  box-sizing: border-box;
  &[disabled='true'] {
    pointer-events: none;
    opacity: 0.5;
    cursor: not-allowed;
  }
  &.unfold {
    overflow: visible;
    .umo-heading-container {
      border-color: var(--umo-border-color-light);
      border-bottom: none;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }
  }
}
.umo-heading-container {
  display: flex;
  background-color: var(--umo-button-hover-background);
  padding: 2px 5px;
  flex-flow: row wrap;
  align-content: flex-start;
  border-radius: var(--umo-radius);
  box-sizing: border-box;
  border: solid 1px transparent;
  white-space: nowrap;
  &.popup-content {
    flex-direction: column;
  }
  .card {
    background-color: var(--umo-color-white);
    border: solid 1px var(--umo-border-color-light);
    border-radius: var(--umo-radius);
    margin: 4px 2px;
    text-align: center;
    padding: 5px 6px;
    box-sizing: border-box;
    cursor: pointer;
    flex: 0 0 68px;
    width: 68px;
    max-width: 68px;
    height: 42px;
    overflow: hidden;
    &:hover,
    &.active {
      border-color: var(--umo-primary-color);
    }
    &.disabled {
      opacity: 0.7;
    }
    .title {
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      max-width: 54px;
      margin: 0 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      &.text {
        font-size: 12px;
        font-weight: 400;
      }
      &.h1 {
        font-size: 14px;
      }
      &.h2 {
        font-size: 13px;
      }
      &.h3 {
        font-size: 12px;
      }
      &.h4 {
        font-size: 11px;
      }
      &.h5 {
        font-size: 10px;
      }
      &.h6 {
        font-size: 10px;
      }
    }
    .subtitle {
      font-size: 8px;
      color: var(--umo-text-color-light);
      text-transform: capitalize;
      margin-top: 3px;
      line-height: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    right: 8px;
    top: 8px;
    height: 40px;
    border-radius: 3px;
    cursor: pointer;
    z-index: 20;
    &:hover {
      background-color: rgba(0, 0, 0, 0.05);
    }
    .umo-icon {
      font-size: 12px;
      color: var(--umo-text-color-light);
    }
  }
  .block-profiles-section {
    width: 100%;
    margin-top: 6px;
    padding-top: 6px;
    border-top: solid 1px var(--umo-border-color-light);
    .section-title {
      font-size: 10px;
      font-weight: 600;
      color: var(--umo-text-color-light);
      margin-bottom: 4px;
      padding-left: 4px;
      text-transform: uppercase;
    }
    .block-cards-list {
      display: flex;
      flex-wrap: wrap;
    }
  }
  .profile-action-bar {
    width: 100%;
    margin-top: 6px;
    padding: 6px 12px;
    background-color: var(--umo-color-white);
    border: dashed 1px var(--umo-primary-color);
    border-radius: var(--umo-radius);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--umo-primary-color);
    &:hover {
      background-color: rgba(0, 0, 0, 0.02);
    }
  }
}
.umo-heading-classic-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.umo-profiles-manager {
  .profile-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    .profile-title {
      font-weight: 600;
      font-size: 14px;
    }
  }
  .profile-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 360px;
    overflow-y: auto;
  }
  .profile-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background-color: var(--umo-button-hover-background);
    border-radius: var(--umo-radius);
    border: solid 1px var(--umo-border-color-light);
    .profile-name {
      font-weight: 600;
      font-size: 13px;
    }
    .profile-details {
      font-size: 11px;
      color: var(--umo-text-color-light);
      margin-top: 2px;
    }
    .profile-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }
}
.off-badge {
  font-size: 10px;
  color: var(--umo-text-color-light);
  margin-left: 4px;
}
</style>
