/**
 * One-off: turn every document still stored as an encrypted `.enc` into a folder.
 *
 * Run from the storage-server directory with the server stopped:
 *   node migrate-legacy.mjs [--delete]
 *
 * Without --delete the originals are left in place so the result can be checked first.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isDocumentFolder, readLegacyDocument, writeDocument } from './documents.js'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const remove = process.argv.includes('--delete')

const entries = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.enc'))
let converted = 0
for (const entry of entries.sort()) {
  const name = entry.slice(0, -4)
  if (await isDocumentFolder(DATA_DIR, name)) {
    console.log(`${name.padEnd(20)} sudah berupa folder, dilewati`)
    continue
  }
  try {
    const { document, assets } = await readLegacyDocument(DATA_DIR, name)
    const html = document.html || document.snapshot?.content || ''
    if (typeof html !== 'string' || !html.trim()) {
      console.log(`${name.padEnd(20)} tidak ada HTML, dilewati`)
      continue
    }
    const written = await writeDocument(
      DATA_DIR,
      name,
      {
        id: name,
        filename: name,
        title: document.title || name,
        savedAt: document.savedAt || new Date().toISOString(),
        html,
        pageSettings: document.pageSettings || document.snapshot?.page || null,
        profiles: document.profiles?.length ? document.profiles : document.snapshot?.profiles || [],
      },
      (assets || []).map((a) => ({ name: a.name, type: a.type, sha256: a.sha256 })),
    )
    converted += 1
    console.log(`${name.padEnd(20)} -> folder, ${written.assets.length} aset${written.missing.length ? `, ${written.missing.length} hilang` : ''}`)
  } catch (error) {
    console.log(`${name.padEnd(20)} GAGAL: ${error.message}`)
  }
}
console.log(`\n${converted} dokumen dikonversi`)

if (remove) {
  for (const entry of entries) {
    const name = entry.slice(0, -4)
    if (!(await isDocumentFolder(DATA_DIR, name))) {
      console.log(`${name}: tidak ada folder, .enc DIPERTAHANKAN`)
      continue
    }
    await fs.rm(path.join(DATA_DIR, entry), { force: true })
    await fs.rm(path.join(DATA_DIR, `${name}.json`), { force: true })
    console.log(`${name}: .enc dan .json dihapus`)
  }
}
