<template>
  <div v-if="$toolbar.show" class="umo-toolbar-container">
    <toolbar-ribbon
      v-if="$toolbar.mode === 'ribbon'"
      :menus="toolbarMenus"
      :current-menu="toolbarActive"
      @menu-change="menuChange"
    >
      <template
        v-for="item in options.toolbar?.menus"
        :key="item"
        #[`toolbar_${item}`]="props"
      >
        <slot :name="`toolbar_${item}`" v-bind="props" />
      </template>
    </toolbar-ribbon>
    <toolbar-classic
      v-if="$toolbar.mode === 'classic'"
      :menus="toolbarMenus"
      :current-menu="toolbarActive"
      @menu-change="menuChange"
    >
      <template
        v-for="item in options.toolbar?.menus"
        :key="item"
        #[`toolbar_${item}`]="props"
      >
        <slot :name="`toolbar_${item}`" v-bind="props" />
      </template>
    </toolbar-classic>
    <div
      class="umo-toolbar-actions"
      :class="`umo-toolbar-actions-${$toolbar.mode}`"
    >
      <t-button
        class="umo-toolbar-actions-button"
        variant="text"
        size="small"
        @click="triggerLoadModal"
      >
        <icon name="file-view" />
        <span class="button-text">Buka / Load</span>
      </t-button>
      <t-popup
        v-if="
          options.toolbar.showSaveLabel && options.document.readOnly !== true
        "
        v-model="statusPopup"
        :attach="container"
        trigger="click"
        placement="bottom-right"
        @visible-change="(visible) => (statusPopup = visible)"
      >
        <t-button
          class="umo-toolbar-actions-button"
          variant="text"
          size="small"
          :class="{ active: statusPopup }"
        >
          <span class="umo-status">
            <span
              class="umo-status-online"
              :class="{ offline: !online }"
            ></span>
            <span class="umo-status-saved button-text">
              <span
                v-if="savedAt"
                v-text="t('save.savedAtText', { time: timeAgo(savedAt) })"
              ></span>
              <span v-else class="unsaved" v-text="t('save.unsaved')"></span>
            </span>
          </span>
        </t-button>
        <template #content>
          <div class="umo-document-status-container umo-status">
            <div>
              {{ t('save.network') }}
              {{ online ? t('save.online') : t('save.offline') }}
            </div>
            <div>
              {{ t('save.savedAt') }}
              <span
                v-if="savedAt"
                v-text="t('save.savedAtText', { time: timeAgo(savedAt) })"
              ></span>
              <span v-else v-text="t('save.unsaved')"></span>
            </div>
            <div class="umo-document-button-container" style="display: flex; gap: 6px;">
              <t-button
                size="small"
                theme="primary"
                @click="saveContent"
                v-text="t('save.text')"
              ></t-button>
              <t-button
                size="small"
                theme="default"
                variant="outline"
                @click="triggerLoadModal"
              >
                Open Document...
              </t-button>
              <t-button
                size="small"
                theme="danger"
                variant="outline"
                @click="confirmNewDocument"
              >
                New Document
              </t-button>
            </div>
            <div class="umo-save-target-container">
              <div class="umo-save-target-title">Save Destination:</div>
              <t-radio-group v-model="saveTarget" size="small" class="umo-save-target-group">
                <t-radio value="practical-umodoc-server">practical-umodoc-server (Encrypted)</t-radio>
                <t-radio value="local-storage">Local Storage</t-radio>
                <t-radio value="google-drive" disabled>Google Drive (Coming Soon)</t-radio>
              </t-radio-group>
              <div class="umo-server-url-field">
                <div class="umo-server-url-label">File Name / Document Title:</div>
                <t-input v-model="documentTitle" placeholder="e.g. report_chapter1" size="small" />
              </div>
              <div v-if="saveTarget === 'practical-umodoc-server'" class="umo-server-url-field">
                <div class="umo-server-url-label">Server API URL:</div>
                <t-input v-model="serverUrl" placeholder="http://localhost:3001/api/documents/save" size="small" />
              </div>
            </div>
          </div>
        </template>
      </t-popup>
      <t-dropdown
        trigger="click"
        size="small"
        placement="bottom-right"
        :popup-props="{
          destroyOnClose: true,
          attach: container,
        }"
        @click="toggleToolbarMode"
      >
        <t-button
          class="umo-toolbar-actions-button"
          variant="text"
          size="small"
        >
          <icon name="expand-down" />
          <span class="umo-button-text">{{ t('toolbar.toggle') }}</span>
        </t-button>
        <template #dropdown>
          <t-dropdown-menu
            v-for="item in editorModeOptions"
            :key="item.value"
            :content="item.label"
            :value="item.value"
            :divider="item.divider"
            :active="item.value === $toolbar.mode"
          >
            <template #prefixIcon>
              <icon :name="item.prefixIcon" />
            </template>
          </t-dropdown-menu>
        </template>
      </t-dropdown>
    </div>
  </div>
  <tooltip v-else :content="t('toolbar.show')" placement="bottom-right">
    <div class="umo-show-toolbar" @click="$toolbar.show = true">
      <icon name="arrow-down" />
    </div>
  </tooltip>
</template>

<script setup>
import { timeAgo } from '@/utils/time-ago'
const emits = defineEmits(['menu-change'])

const container = inject('container')
const toolbarActive = inject('toolbarActive')
const editor = inject('editor')
const savedAt = inject('savedAt')
const options = inject('options')
const $toolbar = useState('toolbar', options)
let statusPopup = $ref(false)
const online = useOnline()

const $document = useState('document', options)

const documentTitle = computed({
  get() {
    const raw = options.value?.document?.title || $document.value?.title
    return (raw && String(raw).trim() && String(raw).trim() !== '测试文档') ? String(raw).trim() : 'file-identifier'
  },
  set(val) {
    const clean = (val && String(val).trim()) ? String(val).trim() : 'file-identifier'
    if (options.value?.document) {
      options.value.document.title = clean
    }
    if ($document.value) {
      $document.value.title = clean
    }
  },
})

import { useConfirm, useMessage } from '@/composables/dialog'

const saveTarget = useStorage('umo-editor:save-target', 'practical-umodoc-server')
const serverUrl = useStorage('umo-editor:server-url', 'http://localhost:3001/api/documents/save')

const triggerLoadModal = () => {
  statusPopup = false
  const btn = document.querySelector('[data-testid="open-json"]')
  if (btn) btn.click()
}

const confirmNewDocument = () => {
  statusPopup = false
  const confirmDialog = useConfirm({
    header: 'Create New Document?',
    body: 'Are you sure you want to start a new blank document? Any unsaved changes will be lost.',
    confirmBtn: {
      content: 'New Document',
      theme: 'danger',
    },
    cancelBtn: 'Cancel',
    onConfirm: () => {
      if (editor.value) {
        editor.value.chain().focus().setContent('<p></p>').run()
      }
      documentTitle.value = 'file-identifier'
      savedAt.value = null
      confirmDialog.destroy()
      useMessage('success', 'New blank document created successfully.')
    },
  })
}

// 工具栏菜单
const defaultToolbarMenus = [
  { label: t('toolbar.base'), value: 'base' },
  { label: t('toolbar.insert'), value: 'insert' },
  { label: t('toolbar.table'), value: 'table' },
  { label: t('toolbar.tools'), value: 'tools' },
  { label: t('toolbar.page'), value: 'page' },
  { label: t('toolbar.view'), value: 'view' },
  { label: t('toolbar.export'), value: 'export' },
]
let toolbarMenus = defaultToolbarMenus
if (options.value.toolbar?.menus) {
  toolbarMenus = options.value.toolbar?.menus.map(
    (item) => defaultToolbarMenus.filter((menu) => menu.value === item)[0],
  )
}
if (!toolbarActive.value) {
  toolbarActive.value = toolbarMenus[0].value
}
const menuChange = (menu) => {
  toolbarActive.value = menu
  emits('menu-change', menu)
}
// 监听如果当前编辑元素为table则切换到table菜单
watch(
  () => editor.value?.isActive('table'),
  (val, oldVal) => {
    if (val) {
      toolbarActive.value = 'table'
    } else if (!val && oldVal) {
      toolbarActive.value = 'base'
    }
  },
)

// 切换编辑器模式
const editorModeOptions = [
  {
    label: t('toolbar.ribbon'),
    value: 'ribbon',
    prefixIcon: 'toolbar-ribbon',
  },
  {
    label: t('toolbar.classic'),
    value: 'classic',
    prefixIcon: 'toolbar-classic',
  },
  {
    label: t('toolbar.hide'),
    value: 'hideToolbar',
    prefixIcon: 'hide-toolbar',
  },
]

const toggleToolbarMode = ({ value }) => {
  if (value === 'hideToolbar') {
    $toolbar.value.show = false
  } else {
    $toolbar.value.show = true
    $toolbar.value.mode = value
  }
}

// 保存文档
const saveContentMethod = inject('saveContent')
const saveContent = () => {
  saveContentMethod()
  statusPopup = false
}

// 从缓存中恢复文档
const setContentFromCache = () => {
  const document = useState('document', options)
  const { content } = document.value
  if (!content || content === '' || content === '<p></p>') {
    const dialog = useAlert({
      attach: container,
      theme: 'info',
      header: t('save.cache.error.title'),
      body: t('save.cache.error.message'),
      onConfirm() {
        dialog.destroy()
      },
    })
    return
  }
  statusPopup = false
  editor.value?.chain().setContent(content, true).focus().run()
}
</script>

<style lang="less" scoped>
.umo-toolbar-container {
  display: flex;
  justify-content: space-between;
  user-select: none;
  position: relative;
}
.umo-toolbar-actions {
  padding: 6px 10px;
  display: flex;
  align-items: center;
  &-ribbon {
    position: absolute;
    right: 0;
    top: 1px;
  }
  &-button {
    &.active {
      background-color: var(--umo-button-hover-background);
    }
    &:not(:last-child) {
      margin-right: 3px;
    }
    :deep(.umo-button__text) {
      display: flex;
      align-items: center;
      .umo-icon {
        margin-right: 3px;
      }
    }
  }
  @media screen and (max-width: 640px) {
    padding-left: 0;
    .umo-status-online {
      margin-right: 0;
    }
    .umo-button-text {
      display: none;
    }
  }
}
.umo-show-toolbar {
  cursor: pointer;
  position: absolute;
  right: 20px;
  font-size: 18px;
  padding: 3px 6px;
  z-index: 99;
  background-color: var(--umo-color-white);
  color: var(--umo-text-color-light);
  border-bottom-left-radius: var(--umo-radius);
  border-bottom-right-radius: var(--umo-radius);
  border: solid 1px var(--umo-border-color);
  border-top: none;
  &:hover {
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.08);
    color: var(--umo-primary-color);
  }
}
.umo-status {
  font-size: 12px;
  display: flex;
  align-items: center;
  cursor: pointer;
  &-online {
    width: 10px;
    height: 10px;
    background: rgb(26, 187, 26);
    border-radius: 50%;
    &.offline {
      background: rgb(187, 26, 26);
    }
  }
  &-saved {
    color: var(--umo-text-color-light);
    margin-left: 5px;
    .unsaved {
      color: var(--umo-error-color);
    }
  }
}
.umo-document-status-container {
  flex-direction: column;
  align-items: unset;
  padding: 12px 16px;
  color: var(--umo-text-color);
  min-width: 260px;
  cursor: default;
  .umo-document-button-container {
    margin: 8px 0 4px;
    display: flex;
    gap: 8px;
  }
}
.umo-save-target-container {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--umo-border-color-light);
}
.umo-save-target-title {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 6px;
  color: var(--umo-text-color);
}
.umo-save-target-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.umo-server-url-field {
  margin-top: 8px;
}
.umo-server-url-label {
  font-size: 11px;
  color: var(--umo-text-color-secondary);
  margin-bottom: 4px;
}
</style>

<style lang="less">
.umo-skin-modern {
  &.toolbar-classic {
    .umo-toolbar-actions {
      margin: 15px 15px 2px 0;
      border-radius: 6px;
      background-color: var(--umo-color-white);
      box-shadow:
        0 0 0 1px hsla(0, 0%, 5%, 0.04),
        0 2px 5px hsla(0, 0%, 5%, 0.06);
      &:hover {
        box-shadow:
          0 0 0 1px hsla(0, 0%, 5%, 0.06),
          0 2px 5px hsla(0, 0%, 5%, 0.1);
      }
    }
  }
  &.toolbar-ribbon {
    .umo-toolbar-actions {
      right: 5px !important;
      top: 6px !important;
    }
  }
}
[theme-mode='dark'] .umo-skin-modern {
  &.toolbar-classic {
    .umo-toolbar-actions {
      outline: solid 1px var(--umo-border-color-light);
    }
  }
}
</style>
