import crypto from 'node:crypto'

import { decryptPayload, encryptPayload } from './crypto-utils.js'

/**
 * A document is one self-contained encrypted archive: the document itself plus the original bytes of
 * every image it uses. See AGENT/adr/0004-document-archive-with-embedded-assets.md.
 *
 *   "UMOARC1\n"   8 bytes magic
 *   iv            16 bytes
 *   authTag       16 bytes
 *   ciphertext    AES-256-GCM, decrypting to:
 *       headerLength  4 bytes little endian
 *       header        JSON, utf8   { document, assets: [{ name, type, sha256, offset, length }] }
 *       payload       asset bytes, concatenated, unmodified
 *
 * Bytes are never re-encoded. Base64 would inflate them by a third and the old envelope hex-encoded
 * the ciphertext on top of that, so the encrypted output here is raw binary.
 */
export const MAGIC = Buffer.from('UMOARC1\n', 'utf8')
const ALGORITHM = 'aes-256-gcm'
const SECRET = process.env.ENCRYPTION_SECRET || 'practical-umodoc-secret-key-2026'
const KEY = crypto.scryptSync(SECRET, 'practical-umodoc-salt', 32)

export const sha256 = (buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex')

export const isArchive = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= MAGIC.length &&
  buffer.subarray(0, MAGIC.length).equals(MAGIC)

/**
 * @param {object} document  the document payload, stored as-is
 * @param {Array<{name: string, type: string, data: Buffer}>} assets
 */
export const packArchive = (document, assets = []) => {
  const table = []
  const chunks = []
  let offset = 0
  for (const asset of assets) {
    const data = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data)
    table.push({
      name: asset.name,
      type: asset.type || 'application/octet-stream',
      sha256: asset.sha256 || sha256(data),
      offset,
      length: data.length,
    })
    chunks.push(data)
    offset += data.length
  }

  const header = Buffer.from(JSON.stringify({ document, assets: table }), 'utf8')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32LE(header.length, 0)
  const plain = Buffer.concat([headerLength, header, ...chunks])

  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext])
}

const openArchive = (buffer) => {
  let cursor = MAGIC.length
  const iv = buffer.subarray(cursor, cursor + 16)
  cursor += 16
  const authTag = buffer.subarray(cursor, cursor + 16)
  cursor += 16
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(authTag)
  const plain = Buffer.concat([
    decipher.update(buffer.subarray(cursor)),
    decipher.final(),
  ])
  const headerLength = plain.readUInt32LE(0)
  const header = JSON.parse(plain.subarray(4, 4 + headerLength).toString('utf8'))
  return { header, payload: plain.subarray(4 + headerLength) }
}

/**
 * Reads either format. Files written before the archive existed are a JSON envelope of hex, and keep
 * loading unchanged; they simply carry no assets and are converted the next time they are saved.
 */
export const readDocument = (buffer) => {
  if (isArchive(buffer)) {
    const { header } = openArchive(buffer)
    return { document: header.document, assets: header.assets || [] }
  }
  return { document: decryptPayload(buffer.toString('utf8')), assets: [], legacy: true }
}

export const readAsset = (buffer, key) => {
  if (!isArchive(buffer)) {
    return null
  }
  const { header, payload } = openArchive(buffer)
  const entry = (header.assets || []).find(
    (a) => a.sha256 === key || a.name === key,
  )
  if (!entry) {
    return null
  }
  return {
    ...entry,
    data: payload.subarray(entry.offset, entry.offset + entry.length),
  }
}

/** Bytes already in the archive, so a save does not have to re-send them. */
export const extractAssets = (buffer) => {
  if (!isArchive(buffer)) {
    return new Map()
  }
  const { header, payload } = openArchive(buffer)
  const map = new Map()
  for (const entry of header.assets || []) {
    map.set(entry.sha256, {
      name: entry.name,
      type: entry.type,
      sha256: entry.sha256,
      data: payload.subarray(entry.offset, entry.offset + entry.length),
    })
  }
  return map
}

export { encryptPayload, decryptPayload }
