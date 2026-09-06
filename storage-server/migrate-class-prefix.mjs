/**
 * One-off: rewrite the `umo-` identifiers inside stored documents to `pdoc-`.
 *
 * The editor was renamed to PracticalDocs, and with it the CSS prefix its generated stylesheet
 * uses. That prefix is not only in the source: it is written into every stored `document.html`,
 * both in the `<style>` block and on the blocks it styles. A document left unmigrated opens with
 * its profile rules matching nothing, so every paragraph falls back to the browser's defaults - the
 * text is all there, and none of the styling is.
 *
 * Run from the storage-server directory with the server stopped:
 *   node migrate-class-prefix.mjs            # say what would change, write nothing
 *   node migrate-class-prefix.mjs --write    # do it
 *
 * **A checksum that does not match is a warning, not a stop.** The point of this script is to save
 * the writer's documents; refusing to touch one because a file was edited by hand since it was
 * saved would abandon it for a reason that has nothing to do with the rename. Checksums are
 * recomputed for what is written, so a document leaves this script consistent even if it did not
 * arrive that way.
 *
 * Safe to run twice: a document with no `umo-` left in it is reported as already done and skipped.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const WRITE = process.argv.includes('--write')

const DOCUMENT_FILE = 'document.html'
const SETTINGS_FILE = 'settings.json'
const CHECKSUM_FILE = 'checksums.txt'

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

// Exactly the identifiers the editor writes into a stored document. Ordered longest first so a
// specific form is never eaten by a general one.
const RULES = [
  ['data-umo-profiles', 'data-pdoc-profiles'],
  ['--umo-', '--pdoc-'],
  ['umo-', 'pdoc-'],
]

const rewrite = (text) => RULES.reduce((out, [from, to]) => out.split(from).join(to), text)

const readChecksums = async (dir) => {
  try {
    const text = await fs.readFile(path.join(dir, CHECKSUM_FILE), 'utf8')
    const map = new Map()
    for (const line of text.split('\n')) {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/)
      if (match) map.set(match[2], match[1])
    }
    return map
  } catch {
    return null
  }
}

const listFiles = async (dir, prefix = '') => {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === CHECKSUM_FILE) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)))
    else out.push(rel)
  }
  return out.sort()
}

const names = (await fs.readdir(DATA_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

let changed = 0
let skipped = 0
let warned = 0

for (const name of names) {
  const dir = path.join(DATA_DIR, name)
  const documentPath = path.join(dir, DOCUMENT_FILE)

  let html
  try {
    html = await fs.readFile(documentPath, 'utf8')
  } catch {
    console.log(`${name.padEnd(24)} no ${DOCUMENT_FILE}, skipped`)
    skipped += 1
    continue
  }

  // Checked, and only reported. A document that has drifted from its checksums is still a document
  // the writer wants to keep, and it will be consistent again when this script rewrites them.
  const recorded = await readChecksums(dir)
  if (recorded) {
    for (const [file, digest] of recorded) {
      try {
        const actual = sha256(await fs.readFile(path.join(dir, file)))
        if (actual !== digest) {
          console.log(`${name.padEnd(24)} WARNING: ${file} does not match its recorded checksum`)
          warned += 1
        }
      } catch {
        console.log(`${name.padEnd(24)} WARNING: ${file} is recorded but missing`)
        warned += 1
      }
    }
  } else {
    console.log(`${name.padEnd(24)} WARNING: no ${CHECKSUM_FILE}`)
    warned += 1
  }

  const settingsPath = path.join(dir, SETTINGS_FILE)
  let settings = null
  try {
    settings = await fs.readFile(settingsPath, 'utf8')
  } catch {}

  const nextHtml = rewrite(html)
  const nextSettings = settings === null ? null : rewrite(settings)
  if (nextHtml === html && nextSettings === settings) {
    console.log(`${name.padEnd(24)} already migrated`)
    skipped += 1
    continue
  }

  const hits = (html.match(/umo-/g) || []).length + ((settings || '').match(/umo-/g) || []).length
  if (!WRITE) {
    console.log(`${name.padEnd(24)} would rewrite ${hits} identifier(s)`)
    changed += 1
    continue
  }

  await fs.writeFile(documentPath, nextHtml, 'utf8')
  if (nextSettings !== null) await fs.writeFile(settingsPath, nextSettings, 'utf8')

  // Recomputed for everything in the folder, so the document is internally consistent afterwards
  // whether or not it was before.
  const lines = []
  for (const file of await listFiles(dir)) {
    lines.push(`${sha256(await fs.readFile(path.join(dir, file)))}  ${file}`)
  }
  await fs.writeFile(path.join(dir, CHECKSUM_FILE), `${lines.join('\n')}\n`, 'utf8')
  console.log(`${name.padEnd(24)} rewrote ${hits} identifier(s), checksums recomputed`)
  changed += 1
}

console.log(
  `\n${WRITE ? 'Migrated' : 'Would migrate'} ${changed}, skipped ${skipped}, ${warned} warning(s).`,
)
if (!WRITE && changed > 0) console.log('Nothing was written. Run again with --write.')
