<template>
  <menus-button
    ico="pdf"
    :text="t('export.bookmarks.text')"
    huge
    :disabled="working"
    @menu-click="addBookmarks"
  />
</template>

<script setup>
import { saveAs } from 'file-saver'

import {
  collectOutlineEntries,
  collectPageRecords,
  documentPageCount,
} from '@/utils/document-outline'
import { writePdfOutline } from '@/utils/pdf-outline'

/**
 * Put the bookmarks, page labels and metadata into a PDF the writer already exported.
 *
 * The editor never sees the bytes of its own export - `print.vue` hands the document to Chrome's
 * print dialog, and Chrome writes the file. So the writer hands it back, and everything a word
 * processor puts in a PDF and Chrome does not is written into it here, in this browser. The file
 * does not travel and no server is involved.
 *
 * This is a second door, not a replacement: Export to PDF is untouched.
 */
const container = inject('container')
const options = inject('options')
const editor = inject('editor')

let working = $ref(false)

const alert = (theme, header, body) => {
  const dialog = useAlert({
    attach: container,
    theme,
    header,
    body,
    // Named, because the dialog's default button text comes from the component library's own
    // locale and would otherwise be Chinese in an English interface.
    confirmBtn: t('export.bookmarks.confirm'),
    onConfirm() {
      dialog.destroy()
    },
  })
}

const documentName = () => {
  const { title } = options.value?.document || {}
  return title && title !== '' ? title : t('document.untitled')
}

/**
 * Ask for the file, and keep the handle when the browser gives us one.
 *
 * With the File System Access API the writer picks the PDF they just saved and it is written back in
 * place - one file, no second copy to tell apart from the first. Without it, the same PDF comes in
 * through a file input and goes out as a download, which is the same work with one more file to tidy
 * up afterwards.
 */
const pickPdf = async () => {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        multiple: false,
      })
      return { handle, file: await handle.getFile() }
    } catch (error) {
      // The writer closed the picker. Not a failure, and not something to report at them.
      if (error?.name === 'AbortError') return null
      throw error
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      resolve(file ? { handle: null, file } : null)
    })
    // A picker the writer closes fires no event at all, so nothing resolves and nothing happens -
    // which is the right outcome, but it means `working` has to be released by the caller.
    input.click()
  })
}

const writeBack = async (handle, bytes) => {
  if (handle && typeof handle.createWritable === 'function') {
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
    return true
  }
  saveAs(new Blob([bytes], { type: 'application/pdf' }), `${documentName()}.pdf`)
  return false
}

const addBookmarks = async () => {
  if (working) return
  const entries = collectOutlineEntries(editor.value)
  const pages = collectPageRecords(editor.value)
  const expectedPageCount = documentPageCount(editor.value)

  if (expectedPageCount === 0) {
    alert('warning', t('export.bookmarks.error.title'), t('export.bookmarks.error.notPaginated'))
    return
  }

  working = true
  try {
    const picked = await pickPdf()
    if (!picked) return

    const bytes = await writePdfOutline(new Uint8Array(await picked.file.arrayBuffer()), {
      entries,
      pages,
      metadata: { title: documentName() },
      expectedPageCount,
    })
    const inPlace = await writeBack(picked.handle, bytes)
    alert(
      'success',
      t('export.bookmarks.done.title'),
      t(inPlace ? 'export.bookmarks.done.inPlace' : 'export.bookmarks.done.downloaded', {
        count: entries.length,
        pages: expectedPageCount,
      }),
    )
  } catch (error) {
    // The guard, reported as the specific thing it is. Every other failure says so plainly rather
    // than claiming to know why.
    if (error?.reason === 'page-count-mismatch') {
      alert(
        'warning',
        t('export.bookmarks.error.title'),
        t('export.bookmarks.error.pageCount', {
          pdf: error.pageCount,
          document: error.expectedPageCount,
        }),
      )
    } else {
      alert('error', t('export.bookmarks.error.title'), String(error?.message || error))
    }
  } finally {
    working = false
  }
}
</script>
