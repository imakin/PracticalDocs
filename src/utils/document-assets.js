/**
 * Media lives beside the document as ordinary files. See AGENT/adr/0005-plain-document-folders.md.
 *
 * A document references an image as `./assets/gambar1.1.png`, which is a real relative path: opening
 * `document.html` straight from its folder in a browser renders it. The editor talks to the storage
 * server over HTTP, so the path is expanded to a URL on load and folded back on save.
 */
const MEDIA_ATTRIBUTES = ['src', 'poster', 'url']
export const ASSETS_PREFIX = './assets/'

// Bytes of everything uploaded this session, so a save can carry what the folder does not yet hold.
const uploaded = new Map()

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const hashBytes = async (bytes) =>
  toHex(await crypto.subtle.digest('SHA-256', bytes))

/** Keeps a name usable as a filename without making it unrecognisable to a person. */
export const safeAssetName = (input, fallback = 'asset') => {
  const base = String(input || '')
    .split(/[\\/]/)
    .pop()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '_')
    .replaceAll(/_+/g, '_')
    .replace(/^[._]+/, '')
  return base || fallback
}

export const assetPath = (name) => `${ASSETS_PREFIX}${encodeURIComponent(name)}`

export const parseAssetPath = (value) => {
  const match = String(value || '').match(/^\.?\/?assets\/([^/?#]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

export const assetUrl = (baseUrl, documentId, name) =>
  `${baseUrl}/api/documents/${encodeURIComponent(documentId)}/assets/${encodeURIComponent(name)}`

const parseAssetUrl = (value) => {
  const match = String(value || '').match(/\/api\/documents\/[^/]+\/assets\/([^/?#]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

/** Reads an uploaded file once and remembers it under the object URL the editor will carry. */
export const registerUpload = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const url = URL.createObjectURL(file)
  uploaded.set(url, {
    sha256: await hashBytes(bytes),
    bytes,
    name: safeAssetName(file.name, `asset-${Date.now()}`),
    type: file.type || 'application/octet-stream',
  })
  return { url, name: file.name, type: file.type, size: file.size }
}

export const forgetUploads = () => uploaded.clear()

const toBase64 = (bytes) => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Bytes for a blob URL this session never registered.
 *
 * Documents written before media was stored carry blob URLs from an older session. While that tab is
 * still open the object is still readable, so a save can rescue the image instead of writing another
 * dead reference. If the object is gone the fetch fails and the guard reports it.
 */
const rescueBlob = async (url) => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0) {
      return null
    }
    const type = response.headers.get('content-type') || 'application/octet-stream'
    const extension = type.split('/')[1]?.split(';')[0] || 'bin'
    return {
      sha256: await hashBytes(bytes),
      bytes,
      name: `rescued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extension}`,
      type,
    }
  } catch {
    return null
  }
}

const eachString = (value, visit) => {
  if (typeof value === 'string') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => eachString(item, visit))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => eachString(item, visit))
  }
}

const mapStrings = (value, transform) => {
  if (typeof value === 'string') {
    return transform(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapStrings(item, transform))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const next = {}
  for (const [key, item] of Object.entries(value)) {
    next[key] = mapStrings(item, transform)
  }
  return next
}

const describeSource = (value) => {
  const raw = String(value || '')
  if (!raw) {
    return null
  }
  const relative = parseAssetPath(raw)
  if (relative) {
    return { name: relative, bytes: null }
  }
  const held = uploaded.get(raw)
  if (held) {
    return { name: held.name, type: held.type, bytes: held.bytes, sha256: held.sha256 }
  }
  const fromUrl = parseAssetUrl(raw)
  return fromUrl ? { name: fromUrl, bytes: null } : null
}

const collectMediaSources = (payload) => {
  const sources = new Set()
  const fromAttributes = (value) => {
    if (Array.isArray(value)) {
      value.forEach(fromAttributes)
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (MEDIA_ATTRIBUTES.includes(key) && typeof item === 'string') {
        sources.add(item)
      } else {
        fromAttributes(item)
      }
    }
  }
  fromAttributes(payload.json)
  fromAttributes(payload.snapshot)
  for (const match of String(payload.html || '').matchAll(
    /\s(?:src|poster|url)="([^"]*)"/g,
  )) {
    sources.add(match[1])
  }
  return [...sources]
}

const collectBlobUrls = (payload) => {
  const urls = new Set()
  const scan = (text) => {
    for (const match of text.matchAll(/blob:[^"'\s\\]+/g)) {
      urls.add(match[0])
    }
  }
  eachString(payload.json, scan)
  eachString(payload.snapshot, scan)
  eachString(payload.html, scan)
  return [...urls]
}

/**
 * Folds every media source back to `./assets/<name>` and lists what the save has to carry. Bytes are
 * attached only for sources this session holds; anything already in the folder is named so the server
 * can keep the file it has.
 */
export const collectAssets = async (payload) => {
  for (const url of collectBlobUrls(payload)) {
    if (uploaded.has(url)) {
      continue
    }
    const rescued = await rescueBlob(url)
    if (rescued) {
      uploaded.set(url, rescued)
    }
  }

  const assets = new Map()
  const replacements = new Map()
  const takenBy = new Map()

  for (const source of collectMediaSources(payload)) {
    const found = describeSource(source)
    if (!found) {
      continue
    }
    // Two different images can arrive under one name; the second gets a suffix so neither is lost.
    let name = safeAssetName(found.name)
    const identity = found.sha256 || name
    if (takenBy.has(name) && takenBy.get(name) !== identity) {
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const extension = dot > 0 ? name.slice(dot) : ''
      let attempt = 2
      while (takenBy.has(`${stem}-${attempt}${extension}`)) {
        attempt += 1
      }
      name = `${stem}-${attempt}${extension}`
    }
    takenBy.set(name, identity)

    const existing = assets.get(name)
    if (!existing) {
      assets.set(name, {
        name,
        type: found.type,
        sha256: found.sha256,
        data: found.bytes ? toBase64(found.bytes) : undefined,
      })
    } else if (found.bytes && !existing.data) {
      existing.data = toBase64(found.bytes)
    }
    replacements.set(source, assetPath(name))
  }

  const fold = (text) => {
    let next = text
    for (const [source, target] of replacements) {
      if (next.includes(source)) {
        next = next.split(source).join(target)
      }
    }
    return next
  }

  return {
    json: mapStrings(payload.json, fold),
    snapshot: mapStrings(payload.snapshot, fold),
    html: typeof payload.html === 'string' ? fold(payload.html) : payload.html,
    assets: [...assets.values()],
  }
}

/** Expands relative asset paths into URLs this editor can fetch from the server it loaded from. */
export const resolveAssets = (value, baseUrl, documentId) =>
  mapStrings(value, (text) =>
    text.replace(/\.?\/?assets\/([^"'?#\s\\)]+)/g, (whole, name) =>
      whole.startsWith('./assets/') || whole.startsWith('assets/') || whole.startsWith('/assets/')
        ? assetUrl(baseUrl, documentId, decodeURIComponent(name))
        : whole,
    ),
  )

/** A blob url reaching a save means the asset pipeline failed and bytes are about to be lost. */
export const findUnresolvedMedia = (payload) => {
  const found = new Set()
  const scan = (text) => {
    for (const match of text.matchAll(/blob:[^"'\s\\]+/g)) {
      found.add(match[0])
    }
  }
  eachString(payload.json, scan)
  eachString(payload.snapshot, scan)
  eachString(payload.html, scan)
  return [...found]
}
