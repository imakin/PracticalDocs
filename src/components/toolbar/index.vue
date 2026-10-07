<template>
  <div v-if="$toolbar.show" class="pdoc-toolbar-container">
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
      class="pdoc-toolbar-actions"
      :class="`pdoc-toolbar-actions-${$toolbar.mode}`"
    >
      <!--
        One control, not four. Open JSON and Save to JSON were dropped from the toolbar - a saved
        `.json` carried urls to the images rather than the images, so it was never the full file it
        looked like - and the separate Buka / Load button said the same thing this one's panel
        already offers.
      -->
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
          class="pdoc-toolbar-actions-button"
          variant="text"
          size="medium"
          data-testid="document-status"
          :class="{ active: statusPopup }"
        >
          <span class="pdoc-status">
            <span
              class="pdoc-status-online"
              :class="{ offline: !online }"
            ></span>
            <span class="pdoc-status-saved button-text">
              <span
                v-if="savedAt"
                v-text="t('save.savedAtText', { time: timeAgo(savedAt) })"
              ></span>
              <span v-else class="unsaved" v-text="t('save.unsaved')"></span>
            </span>
          </span>
        </t-button>
        <template #content>
          <div class="pdoc-document-status-container pdoc-status">
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
            <div class="pdoc-document-button-container" style="display: flex; gap: 6px;">
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
            <div class="pdoc-save-target-container">
              <div class="pdoc-save-target-title">Save Destination:</div>
              <t-radio-group v-model="saveTarget" size="small" class="pdoc-save-target-group">
                <t-radio value="practicaldocs-server">practicaldocs-server (Encrypted)</t-radio>
                <t-radio value="local-storage">Local Storage</t-radio>
                <t-radio value="google-drive" disabled>Google Drive (Coming Soon)</t-radio>
              </t-radio-group>
              <div class="pdoc-server-url-field">
                <div class="pdoc-server-url-label">File Name / Document Title:</div>
                <t-input v-model="documentTitle" placeholder="e.g. report_chapter1" size="small" />
              </div>
              <div v-if="saveTarget === 'practicaldocs-server'" class="pdoc-server-url-field">
                <div class="pdoc-server-url-label">Server API URL:</div>
                <t-input v-model="serverUrl" placeholder="http://localhost:3001/api/documents/save" size="small" />
                <div v-if="serverUrlHistory.length" class="pdoc-server-url-history">
                  <t-button
                    v-for="url in serverUrlHistory"
                    :key="url"
                    class="pdoc-server-url-history-item"
                    size="small"
                    theme="default"
                    variant="outline"
                    @click="serverUrl = url"
                  >
                    {{ url }}
                  </t-button>
                </div>
              </div>
              <!--
                Asked for by the writer: every save also writes to this server when it is filled in.
                Opening reads the first server only. Its list is the same list as the first field's;
                a press here fills this field and leaves the first alone.
              -->
              <div v-if="saveTarget === 'practicaldocs-server'" class="pdoc-server-url-field">
                <div class="pdoc-server-url-label">Second Server API URL (optional, saves only):</div>
                <t-input v-model="secondServerUrl" placeholder="Empty: save to the first server only" size="small" clearable />
                <div v-if="serverUrlHistory.length" class="pdoc-server-url-history">
                  <t-button
                    v-for="url in serverUrlHistory"
                    :key="url"
                    class="pdoc-server-url-history-item"
                    size="small"
                    theme="default"
                    variant="outline"
                    @click="secondServerUrl = url"
                  >
                    {{ url }}
                  </t-button>
                </div>
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
          class="pdoc-toolbar-actions-button"
          variant="text"
          size="small"
        >
          <icon name="expand-down" />
          <span class="pdoc-button-text">{{ t('toolbar.toggle') }}</span>
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
    <div class="pdoc-show-toolbar" @click="$toolbar.show = true">
      <icon name="arrow-down" />
    </div>
  </tooltip>
</template>

<script setup>
import {
  rememberServerUrl,
  SERVER_URL_HISTORY_KEY,
} from '@/utils/server-url-history'
import { SECOND_SERVER_URL_KEY } from '@/utils/save-to-server'
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
import { useDocumentDialogs } from '@/composables/document-dialogs'

const { openLoadDialog } = useDocumentDialogs()

const saveTarget = useStorage('practicaldocs:save-target', 'practicaldocs-server')
const serverUrl = useStorage('practicaldocs:server-url', 'http://localhost:3001/api/documents/save')
const secondServerUrl = useStorage(SECOND_SERVER_URL_KEY, '')
const serverUrlHistory = useStorage(SERVER_URL_HISTORY_KEY, [])
const rememberCurrentServerUrl = () => {
  serverUrlHistory.value = rememberServerUrl(serverUrlHistory.value, serverUrl.value)
}

// Asks the dialog to open rather than hunting for a button to click. The button it used to click is
// gone, and the old `if (btn)` guard would have made this quietly do nothing.
const triggerLoadModal = () => {
  // The Open dialog always lists the documents of the Server API URL, whatever the save destination.
  rememberCurrentServerUrl()
  statusPopup = false
  openLoadDialog()
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
  if (saveTarget.value === 'practicaldocs-server') {
    // The second first, so the first server, the one Open reads, ends up on top.
    serverUrlHistory.value = rememberServerUrl(serverUrlHistory.value, secondServerUrl.value)
    rememberCurrentServerUrl()
  }
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
.pdoc-toolbar-container {
  display: flex;
  justify-content: space-between;
  user-select: none;
  position: relative;
}
.pdoc-toolbar-actions {
  padding: 6px 10px;
  display: flex;
  align-items: center;
  &-ribbon {
    position: absolute;
    right: 0;
    top: 1px;
  }
  &-button {
    // This is now the only way in to opening, saving and starting a document - four buttons became
    // one - so it is sized as a target rather than as a line of status text.
    min-height: 34px;
    padding: 0 12px;
    .pdoc-status {
      font-size: 14px;
    }
    .pdoc-status-online {
      width: 11px;
      height: 11px;
    }
    &.active {
      background-color: var(--pdoc-button-hover-background);
    }
    &:not(:last-child) {
      margin-right: 3px;
    }
    :deep(.pdoc-button__text) {
      display: flex;
      align-items: center;
      .pdoc-icon {
        margin-right: 3px;
      }
    }
  }
  @media screen and (max-width: 640px) {
    padding-left: 0;
    .pdoc-status-online {
      margin-right: 0;
    }
    .pdoc-button-text {
      display: none;
    }
  }
}
.pdoc-show-toolbar {
  cursor: pointer;
  position: absolute;
  right: 20px;
  font-size: 18px;
  padding: 3px 6px;
  z-index: 99;
  background-color: var(--pdoc-color-white);
  color: var(--pdoc-text-color-light);
  border-bottom-left-radius: var(--pdoc-radius);
  border-bottom-right-radius: var(--pdoc-radius);
  border: solid 1px var(--pdoc-border-color);
  border-top: none;
  &:hover {
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.08);
    color: var(--pdoc-primary-color);
  }
}
.pdoc-status {
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
    color: var(--pdoc-text-color-light);
    margin-left: 5px;
    .unsaved {
      color: var(--pdoc-error-color);
    }
  }
}
.pdoc-document-status-container {
  flex-direction: column;
  align-items: unset;
  padding: 12px 16px;
  color: var(--pdoc-text-color);
  min-width: 260px;
  cursor: default;
  // Asked for by the writer: with two server fields and their lists the popup grew past the bottom of
  // the window. It scrolls instead, never taller than the viewport less the 49px above it (the popup
  // opens 41px down, plus its 8px offset).
  box-sizing: border-box;
  max-height: calc(100vh - 49px);
  overflow-y: auto;
  .pdoc-document-button-container {
    margin: 8px 0 4px;
    display: flex;
    gap: 8px;
  }
  // Asked for by the writer: every button in this popup is a large target, 1em above and below its
  // text, so it is easy to hit.
  .pdoc-document-button-container .pdoc-button,
  .pdoc-server-url-history-item {
    height: auto;
    padding-top: 1em;
    padding-bottom: 1em;
    line-height: 1.4;
  }
}
.pdoc-server-url-history {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
// The text is the URL itself, so all of it is shown, wrapped where it has to be. A light grey ground,
// asked for by the writer, so a remembered URL does not read as a second input field.
.pdoc-server-url-history .pdoc-server-url-history-item {
  background-color: var(--pdoc-container-background);
  width: 100%;
  margin: 0;
  justify-content: flex-start;
  text-align: left;
  white-space: normal;
  word-break: break-all;
  :deep(.pdoc-button__text) {
    white-space: normal;
    word-break: break-all;
  }
}
.pdoc-save-target-container {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--pdoc-border-color-light);
}
.pdoc-save-target-title {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 6px;
  color: var(--pdoc-text-color);
}
.pdoc-save-target-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pdoc-server-url-field {
  margin-top: 8px;
}
.pdoc-server-url-label {
  font-size: 11px;
  color: var(--pdoc-text-color-secondary);
  margin-bottom: 4px;
}
</style>

<style lang="less">
.pdoc-skin-modern {
  &.toolbar-classic {
    .pdoc-toolbar-actions {
      margin: 15px 15px 2px 0;
      border-radius: 6px;
      background-color: var(--pdoc-color-white);
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
    .pdoc-toolbar-actions {
      right: 5px !important;
      top: 6px !important;
    }
  }
}
[theme-mode='dark'] .pdoc-skin-modern {
  &.toolbar-classic {
    .pdoc-toolbar-actions {
      outline: solid 1px var(--pdoc-border-color-light);
    }
  }
}
</style>
