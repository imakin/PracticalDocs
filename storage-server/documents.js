import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { readAsset as readArchiveAsset, readDocument as readLegacy } from './archive.js'

/**
 * A document is a folder of ordinary files. See AGENT/adr/0005-plain-document-folders.md.
 *
 *   data/tesis4/
 *     document.html     the document, and the source of truth
 *     settings.json     page settings, profiles, title, savedAt
 *     assets/           the original image bytes under their original names
 *     checksums.txt     sha256 per file, in sha256sum format
 *
 * `document.html` references an image as `./assets/gambar1.1.png`, which is a real relative path:
 * opening the file straight from the folder in a browser renders it. Nothing here is encoded,
 * encrypted or renamed, so every part of a document can be read and edited with ordinary tools.
 */
export const DOCUMENT_FILE = 'document.html'
export const SETTINGS_FILE = 'settings.json'
export const CHECKSUM_FILE = 'checksums.txt'
export const ASSETS_DIR = 'assets'

export const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

/** Keeps a name usable as a filename without turning it into something a person cannot recognise. */
export const safeAssetName = (input, fallback = 'asset') => {
  const base = path
    .basename(String(input || ''))
    .replaceAll(/[^a-zA-Z0-9._-]/g, '_')
    .replaceAll(/_+/g, '_')
    .replace(/^[._]+/, '')
  return base || fallback
}

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

export const documentDir = (dataDir, name) => path.join(dataDir, name)

export const isDocumentFolder = async (dataDir, name) => {
  try {
    return (await fs.stat(path.join(documentDir(dataDir, name), DOCUMENT_FILE))).isFile()
  } catch {
    return false
  }
}

const writeChecksums = async (dir) => {
  const lines = []
  const walk = async (current, prefix) => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === CHECKSUM_FILE) {
        continue
      }
      const full = path.join(current, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, relative)
      } else {
        lines.push(`${sha256(await fs.readFile(full))}  ${relative}`)
      }
    }
  }
  await walk(dir, '')
  // sha256sum format, so it can be checked with the standard tool and not only by this application
  await fs.writeFile(path.join(dir, CHECKSUM_FILE), `${lines.join('\n')}\n`, 'utf8')
}

/**
 * @param {Array<{name: string, type: string, sha256?: string, data?: string}>} assets
 *   `data` is base64 and may be omitted when the folder already holds that file unchanged.
 */
export const writeDocument = async (dataDir, name, payload, assets = []) => {
  const dir = documentDir(dataDir, name)
  const assetsDir = path.join(dir, ASSETS_DIR)
  await fs.mkdir(assetsDir, { recursive: true })

  const written = []
  const missing = []
  const keep = new Set()
  for (const asset of assets) {
    const filename = safeAssetName(asset.name)
    keep.add(filename)
    const target = path.join(assetsDir, filename)
    if (asset.data) {
      const bytes = Buffer.from(asset.data, 'base64')
      // Only rewrite when the bytes actually differ, so an unchanged image survives autosave untouched.
      let current = null
      try {
        current = await fs.readFile(target)
      } catch {}
      if (!current || sha256(current) !== sha256(bytes)) {
        await fs.writeFile(target, bytes)
      }
      written.push({ name: filename, type: asset.type, sha256: sha256(bytes), length: bytes.length })
      continue
    }
    try {
      const current = await fs.readFile(target)
      written.push({
        name: filename,
        type: asset.type,
        sha256: sha256(current),
        length: current.length,
      })
    } catch {
      missing.push(filename)
    }
  }

  // Images the document no longer uses are dropped, or the folder grows forever.
  for (const entry of await fs.readdir(assetsDir).catch(() => [])) {
    if (!keep.has(entry)) {
      await fs.rm(path.join(assetsDir, entry), { force: true })
    }
  }

  await fs.writeFile(path.join(dir, DOCUMENT_FILE), payload.html || '', 'utf8')
  await fs.writeFile(
    path.join(dir, SETTINGS_FILE),
    `${JSON.stringify(
      {
        id: payload.id,
        filename: payload.filename,
        title: payload.title,
        savedAt: payload.savedAt,
        pageSettings: payload.pageSettings || null,
        profiles: payload.profiles || [],
        assets: written,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeChecksums(dir)
  return { assets: written, missing }
}

export const readDocumentFolder = async (dataDir, name) => {
  const dir = documentDir(dataDir, name)
  const html = await fs.readFile(path.join(dir, DOCUMENT_FILE), 'utf8')
  const settings = (await readJson(path.join(dir, SETTINGS_FILE), {})) || {}
  return {
    document: {
      id: settings.id || name,
      filename: settings.filename || name,
      title: settings.title || name,
      html,
      pageSettings: settings.pageSettings || null,
      profiles: settings.profiles || [],
      savedAt: settings.savedAt || new Date().toISOString(),
    },
    assets: settings.assets || [],
  }
}

/** Documents written before this format. They convert to a folder the next time they are saved. */
export const readLegacyDocument = async (dataDir, name) => {
  const buffer = await fs.readFile(path.join(dataDir, `${name}.enc`))
  const { document, assets } = readLegacy(buffer)
  return { document, assets, legacy: true }
}

export const readDocumentAsset = async (dataDir, name, assetName) => {
  const file = path.join(documentDir(dataDir, name), ASSETS_DIR, safeAssetName(assetName))
  try {
    return { data: await fs.readFile(file), name: safeAssetName(assetName) }
  } catch {}
  // an asset of a document that has not been converted yet
  try {
    const buffer = await fs.readFile(path.join(dataDir, `${name}.enc`))
    const found = readArchiveAsset(buffer, assetName)
    return found ? { data: found.data, name: found.name, type: found.type } : null
  } catch {
    return null
  }
}

export const removeDocument = async (dataDir, name) => {
  let removed = false
  try {
    await fs.rm(documentDir(dataDir, name), { recursive: true, force: true })
    removed = true
  } catch {}
  for (const suffix of ['.enc', '.json']) {
    try {
      await fs.rm(path.join(dataDir, `${name}${suffix}`), { force: true })
      removed = true
    } catch {}
  }
  return removed
}

export const listDocuments = async (dataDir) => {
  const documents = []
  const seen = new Set()
  for (const entry of await fs.readdir(dataDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!(await isDocumentFolder(dataDir, entry.name))) {
        continue
      }
      const settings =
        (await readJson(path.join(documentDir(dataDir, entry.name), SETTINGS_FILE), {})) || {}
      seen.add(entry.name)
      documents.push({
        id: settings.filename || entry.name,
        filename: settings.filename || entry.name,
        title: settings.title || entry.name,
        savedAt: settings.savedAt || new Date().toISOString(),
        format: 'folder',
      })
    }
  }
  for (const entry of await fs.readdir(dataDir)) {
    if (!entry.endsWith('.enc')) {
      continue
    }
    const name = entry.slice(0, -4)
    if (seen.has(name)) {
      continue
    }
    try {
      const { document } = await readLegacyDocument(dataDir, name)
      documents.push({
        id: document.filename || name,
        filename: document.filename || name,
        title: document.title || name,
        savedAt: document.savedAt || new Date().toISOString(),
        format: 'legacy',
      })
    } catch {}
  }
  documents.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
  return documents
}
