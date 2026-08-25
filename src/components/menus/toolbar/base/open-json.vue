<template>
  <menus-button
    :text="t('documentFile.open')"
    :tooltip="t('documentFile.openTip')"
    ico="file-view"
    data-testid="open-json"
    force-enabled
    huge
    @menu-click="openLoadModal"
  />

  <modal
    :visible="modalVisible"
    header="Open & Load Document"
    width="680px"
    :confirm-btn="null"
    cancel-btn="Close"
    @confirm="modalVisible = false"
    @close="modalVisible = false"
  >
    <t-tabs v-model="activeTab">
      <t-tab-panel value="server" label="From Server (practical-umodoc-server)">
        <div style="margin-top: 16px;">
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <t-input v-model="searchQuery" placeholder="Search filename or title..." clearable />
            <t-button theme="default" variant="outline" @click="fetchServerDocuments">
              Refresh List
            </t-button>
          </div>

          <div v-if="loadingServerDocs" style="padding: 24px; text-align: center;">
            <t-loading text="Loading server document list..." size="small" />
          </div>

          <div v-else-if="filteredDocuments.length === 0" style="padding: 24px; text-align: center; color: var(--umo-text-color-muted, #999);">
            No documents stored on the server yet.
          </div>

          <t-list v-else stripe size="small" style="max-height: 320px; overflow-y: auto;">
            <t-list-item v-for="doc in filteredDocuments" :key="doc.id">
              <template #content>
                <div style="display: flex; flex-direction: column;">
                  <strong style="font-size: 14px;">{{ doc.title || doc.filename }}</strong>
                  <span style="font-size: 12px; color: var(--umo-text-color-muted, #888);">
                    File: <code>{{ doc.filename }}.enc</code> &bull; Saved: {{ formatDate(doc.savedAt) }}
                  </span>
                </div>
              </template>
              <template #action>
                <div style="display: flex; gap: 8px;">
                  <t-button theme="primary" size="small" @click="loadDocumentFromServer(doc)">
                    Open Document
                  </t-button>
                  <t-button theme="danger" variant="text" size="small" @click="deleteDocumentFromServer(doc)">
                    Delete
                  </t-button>
                </div>
              </template>
            </t-list-item>
          </t-list>
        </div>
      </t-tab-panel>

      <t-tab-panel value="local" label="From Local File (.json / .umodoc)">
        <div style="padding: 24px; text-align: center;">
          <p style="margin-bottom: 16px; color: var(--umo-text-color-muted, #666);">
            Select a document file <code>.umodoc.json</code> from your computer to open.
          </p>
          <t-button theme="primary" size="large" @click="fileInput?.click()">
            Choose Document File...
          </t-button>
        </div>
      </t-tab-panel>
    </t-tabs>

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json,.umodoc"
      hidden
      data-testid="open-json-input"
      @change="openSelectedFile"
    />
  </modal>
</template>

<script setup>
import { resolveAssets } from '@/utils/document-assets'

const openDocumentFile = inject('openDocumentFile')
const pageOptions = inject('page')
const container = inject('container')
const fileInput = ref(null)

let modalVisible = $ref(false)
let activeTab = $ref('server')
let searchQuery = $ref('')
let loadingServerDocs = $ref(false)
let serverDocuments = $ref([])

const getServerBaseUrl = () => {
  const fullUrl = localStorage.getItem('umo-editor:server-url') || 'http://localhost:3001/api/documents/save'
  return fullUrl.replace(/\/api\/documents\/save\/?$/, '')
}

const formatDate = (isoString) => {
  if (!isoString) return '-'
  try {
    return new Date(isoString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return isoString
  }
}

const filteredDocuments = computed(() => {
  if (!searchQuery) return serverDocuments
  const q = searchQuery.toLowerCase()
  return serverDocuments.filter(
    (d) =>
      (d.title && d.title.toLowerCase().includes(q)) ||
      (d.filename && d.filename.toLowerCase().includes(q)),
  )
})

const fetchServerDocuments = async () => {
  loadingServerDocs = true
  try {
    const baseUrl = getServerBaseUrl()
    const response = await fetch(`${baseUrl}/api/documents/list`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.success && Array.isArray(data.documents)) {
      serverDocuments = data.documents
    } else {
      serverDocuments = []
    }
  } catch (err) {
    console.error('Failed to list server documents:', err)
    serverDocuments = []
  } finally {
    loadingServerDocs = false
  }
}

const openLoadModal = () => {
  modalVisible = true
  fetchServerDocuments()
}

const loadDocumentFromServer = async (doc) => {
  try {
    const baseUrl = getServerBaseUrl()
    const name = doc.filename || doc.id
    const response = await fetch(`${baseUrl}/api/documents/load?id=${encodeURIComponent(name)}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!data.success || !data.document) {
      throw new Error(data.message || 'Failed to load the document.')
    }
    const payload = data.document

    // Documents stored before this format carry a snapshot; the current one stores HTML and settings.
    const content = payload.snapshot?.content || payload.json || payload.html || ''
    // Stored page settings can be incomplete, and older files carry none at all. Fill the gaps from
    // the settings already in effect rather than refusing to open the document.
    const storedPage = payload.pageSettings || payload.snapshot?.page || {}
    const current = JSON.parse(JSON.stringify(pageOptions.value))
    const page = {
      ...current,
      ...storedPage,
      size: { ...current.size, ...(storedPage.size || {}) },
      margin: { ...current.margin, ...(storedPage.margin || {}) },
      watermark: { ...current.watermark, ...(storedPage.watermark || {}) },
    }
    const profiles =
      (Array.isArray(payload.profiles) && payload.profiles.length > 0
        ? payload.profiles
        : payload.snapshot?.profiles) || []

    let snapshot = {
      format: 'umodoc',
      formatVersion: 1,
      editorVersion: '11.0.4',
      savedAt: payload.savedAt || new Date().toISOString(),
      document: { title: payload.title || name },
      content,
      page,
      profiles,
    }
    // Media sits beside the document as ordinary files, referenced by a relative path. Point those at
    // the server this document just came from so the editor can fetch them.
    snapshot = resolveAssets(snapshot, baseUrl, payload.filename || name)

    await openDocumentFile(snapshot)
    modalVisible = false
  } catch (err) {
    console.error('Failed to load document from server:', err)
    useMessage('error', {
      attach: container,
      content: `Failed to load the document: ${err.message}`,
      placement: 'bottom',
    })
  }
}

const deleteDocumentFromServer = async (doc) => {
  try {
    const baseUrl = getServerBaseUrl()
    const response = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(doc.filename || doc.id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await fetchServerDocuments()
  } catch (err) {
    console.error('Failed to delete document:', err)
  }
}

const openSelectedFile = async (event) => {
  const input = event.target
  const file = input.files?.[0]
  if (file) {
    await openDocumentFile(file)
    modalVisible = false
  }
  input.value = ''
}
</script>
