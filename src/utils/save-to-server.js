import {
  collectAssets,
  findUnresolvedMedia,
} from '@/utils/document-assets'
import { composeDocumentHtml } from '@/utils/profile-stylesheet'
import { serverNames } from '@/utils/server-names'

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

// Where the second copy goes. Empty unless the writer filled the second field in the save status popup.
export const SECOND_SERVER_URL_KEY = 'practicaldocs:server-url-2'

/**
 * One server's half of a save. `{ ok, message }`, never a throw: with two servers, one failing must not
 * hide what happened on the other.
 */
const saveToOneServer = async (serverUrl, content, page, title, filename) => {
  try {
    // Media sources are folded back to portable markers, and the bytes travel with them unless this
    // very folder, on this very server, already holds them. Saving under a second name or to a
    // second server has to copy the images into it; pointing at the first folder is how they used
    // to be lost. Asked per server, because the answer differs between them.
    const packed = await collectAssets(content, { documentId: filename, serverUrl })
    // The stored file carries its own stylesheet, so it renders correctly opened straight from the
    // folder with no editor and no server.
    const documentHtml = composeDocumentHtml(packed.html, content.profiles || [])
    const stranded = findUnresolvedMedia(packed)
    if (stranded.length > 0) {
      return {
        ok: false,
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
        ok: false,
        message: `Saved, but ${result.missingAssets.length} image(s) could not be stored. Re-insert them and save again.`,
      }
    }
    if (result.success === false) {
      return {
        ok: false,
        message: result.message || 'Failed to save document to server.',
      }
    }
    return {
      ok: true,
      message:
        result.message ||
        `Document '${filename}' encrypted & saved to practicaldocs-server successfully!`,
    }
  } catch (error) {
    // The address is in the message on purpose. The commonest failure is a server URL that points at
    // somewhere this page cannot reach, and a bare "failed to save" leaves the writer guessing.
    return {
      ok: false,
      message: `Failed to save to server (${serverUrl}): ${error.message}`,
    }
  }
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
  // Asked for by the writer: a second server that every save also writes to, so a copy lives in
  // two places. Opening still reads the first one only.
  const secondUrl = readSetting(SECOND_SERVER_URL_KEY, '').trim()

  if (saveTarget === 'google-drive') {
    return {
      status: 'error',
      message: 'Google Drive integration is coming soon',
    }
  }
  if (saveTarget !== 'practicaldocs-server') {
    return 'Document saved to Local Storage successfully!'
  }

  const title =
    String(document?.title || '').trim() ||
    content?.snapshot?.document?.title ||
    'file-identifier'
  const filename = storedFilename(title)

  const first = await saveToOneServer(serverUrl, content, page, title, filename)
  // The same address twice is one server, and writing it twice proves nothing.
  if (!secondUrl || secondUrl === serverUrl.trim()) {
    return first.ok ? first.message : { status: 'error', message: first.message }
  }
  const second = await saveToOneServer(secondUrl, content, page, title, filename)
  if (first.ok && second.ok) {
    // Asked for by the writer: say which two servers, by name.
    const [firstName, secondName] = serverNames(serverUrl, secondUrl)
    return `Document '${filename}' saved to ${firstName} and ${secondName}.`
  }
  // Either failure is an error, so the document stays unsaved and the next save tries both again:
  // a copy that is meant to be in two places is not saved while it is in one.
  const parts = []
  if (first.ok) {
    parts.push('Saved to the first server only.')
  } else {
    parts.push(`First server: ${first.message}`)
  }
  if (second.ok) {
    parts.push('Saved to the second server only.')
  } else {
    parts.push(`Second server: ${second.message}`)
  }
  return { status: 'error', message: parts.join(' ') }
}
