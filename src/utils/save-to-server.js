import {
  collectAssets,
  findUnresolvedMedia,
} from '@/utils/document-assets'
import { composeDocumentHtml } from '@/utils/profile-stylesheet'

/**
 * Saving, done by the editor rather than by whoever embeds it.
 *
 * The toolbar already asks where a document should go - Save Destination, File Name, Server API URL,
 * all of it drawn by this package - and the Open dialog already reads documents back from that same
 * server. Saving was the one half of that pair the host application had to implement, so an app that
 * embedded `<practical-docs />` without writing an `onSave` could open a document and then be told
 * `Key "onSave": Please set the save method` when the writer pressed Ctrl+S. Reported from a build
 * served on another host, where opening worked and saving did not.
 *
 * A host that wants somewhere else to save to still passes its own `onSave` and this is never
 * reached. This is the default, not a rule.
 */

const TRIMMED_SUFFIXES = ['.enc', '.json', '.practicaldocs', '.umodoc']

/**
 * The name a document is stored under, from the title the writer gave it.
 *
 * The suffixes go because the title is a name, not a file name: a document opened from `thesis.enc`
 * and saved again would otherwise become `thesis.enc.enc`. `.umodoc` is still trimmed even though
 * nothing writes it any more, because files written before the rename are still opened.
 */
export const storedFilename = (title) => {
  let base = String(title || '').trim()
  for (const suffix of TRIMMED_SUFFIXES) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length)
      break
    }
  }
  const cleaned = base
    .replaceAll(/[^a-zA-Z0-9_\-.]/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  return cleaned || 'file-identifier'
}

// Where the toolbar's own fields keep what the writer chose. Read here rather than passed in,
// because the writer sets them in this editor and they belong to this browser, not to the document.
const readSetting = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const mirrorLocally = (content) => {
  // A copy in this browser, whatever the destination is. It is what survives a crash between saves.
  try {
    if (content.html) {
      localStorage.setItem('document.content', content.html)
    }
    if (content.json) {
      localStorage.setItem('document.json', JSON.stringify(content.json))
    }
    if (content.snapshot) {
      localStorage.setItem('document.snapshot', JSON.stringify(content.snapshot))
    }
    if (content.profiles?.length > 0) {
      localStorage.setItem(
        'practicaldocs:profiles',
        JSON.stringify(content.profiles),
      )
    }
  } catch {}
}

export const saveDocumentToServer = async (content, page, document) => {
  mirrorLocally(content)

  const saveTarget = readSetting(
    'practicaldocs:save-target',
    'practicaldocs-server',
  )
  const serverUrl = readSetting(
    'practicaldocs:server-url',
    'http://localhost:3001/api/documents/save',
  )

  if (saveTarget === 'google-drive') {
    return {
      status: 'error',
      message: 'Google Drive integration is coming soon',
    }
  }
  if (saveTarget !== 'practicaldocs-server') {
    return 'Document saved to Local Storage successfully!'
  }

  try {
    const title =
      String(document?.title || '').trim() ||
      content?.snapshot?.document?.title ||
      'file-identifier'
    const filename = storedFilename(title)

    // Media sources are folded back to portable markers, and the bytes travel with them unless this
    // very folder, on this very server, already holds them. Saving under a second name or to a
    // second server has to copy the images into it; pointing at the first folder is how they used
    // to be lost.
    const packed = await collectAssets(content, { documentId: filename, serverUrl })
    // The stored file carries its own stylesheet, so it renders correctly opened straight from the
    // folder with no editor and no server.
    const documentHtml = composeDocumentHtml(packed.html, content.profiles || [])
    const stranded = findUnresolvedMedia(packed)
    if (stranded.length > 0) {
      return {
        status: 'error',
        message: `${stranded.length} media file(s) could not be prepared for saving. Re-insert them and try again.`,
      }
    }

    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: filename,
        filename,
        title,
        html: documentHtml,
        json: packed.json,
        snapshot: packed.snapshot,
        profiles: content.profiles || [],
        // Beside the profiles, not inside them: the snapshot carries the markdown styling and it has
        // to reach the server, or the Markdown Styles dialog is a dialog whose settings last until
        // the page is reloaded.
        markdownStyles: packed.snapshot?.markdownStyles || null,
        pageSettings: page,
        assets: packed.assets,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const result = await response.json()
    if (result.missingAssets?.length > 0) {
      return {
        status: 'error',
        message: `Saved, but ${result.missingAssets.length} image(s) could not be stored. Re-insert them and save again.`,
      }
    }
    if (result.success === false) {
      return {
        status: 'error',
        message: result.message || 'Failed to save document to server.',
      }
    }
    return (
      result.message ||
      `Document '${filename}' encrypted & saved to practicaldocs-server successfully!`
    )
  } catch (error) {
    // The address is in the message on purpose. The commonest failure is a server URL that points at
    // somewhere this page cannot reach, and a bare "failed to save" leaves the writer guessing.
    return {
      status: 'error',
      message: `Failed to save to server (${serverUrl}): ${error.message}`,
    }
  }
}
