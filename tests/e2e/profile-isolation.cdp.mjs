/**
 * Editing one profile must leave every other profile's blocks alone.
 *
 * The profile assignment was matched by node type and level as well as by id, in three places: the
 * command that saves a profile edit, the dialog that seeds the edit form, and the sync that resolves
 * a block to its profile. Between them, editing any paragraph profile moved every paragraph in the
 * document onto it, editing a level-1 heading profile took every h1, and a profile list that was
 * momentarily incomplete reassigned blocks permanently. Since the profile is now the block's CSS
 * class, one edit restyled the whole document.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, '..', 'screenshots')
const required = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(`FAIL: ${name} is not set. Runtime endpoints are per-session configuration (adr/0006).`)
    process.exit(1)
  }
  return value
}
const CDP = required('CDP_URL').replace(/\/$/, '')
const EDITOR_URL = required('EDITOR_URL')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const version = await fetch(`${CDP}/json/version`).catch(() => null)
if (!version?.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await version.json()
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 })
const pending = new Map()
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})
let nextId = 0
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    ws.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)

const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']
let persistedBefore = null
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}
const finish = async (code) => {
  if (persistedBefore) {
    await evaluate(`(() => {
      const frozen = ${JSON.stringify(PERSISTED_KEYS)}
      const si = localStorage.setItem.bind(localStorage), ri = localStorage.removeItem.bind(localStorage)
      localStorage.setItem = (k, v) => { if (!frozen.includes(k)) si(k, v) }
      localStorage.removeItem = (k) => { if (!frozen.includes(k)) ri(k) }
      const saved = ${JSON.stringify(persistedBefore)}
      for (const [k, v] of Object.entries(saved)) { if (v === null) ri(k); else si(k, v) }
      return true
    })()`).catch(() => {})
  }
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) }
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2000)
const wired = await evaluate(`(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  if (!el) return 'NO_VUE_COMPONENT'
  let inst = el.__vueParentComponent
  while (inst) {
    const p = inst.provides || {}
    if (p.editor?.value?.state) { window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const assignments = () => evaluate(`(() => {
  const out = []
  window.__ed.state.doc.descendants((n) => {
    if (n.type.name === 'paragraph' || n.type.name === 'heading') {
      out.push({ text: n.textContent.slice(0, 20), id: n.attrs.numberingProfileId })
    }
  })
  return out
})()`)
const idFor = (rows, text) => rows.find((r) => r.text.startsWith(text))?.id
const profileFields = (id) => evaluate(`(() => {
  const p = window.__ed.storage.documentReferences.profiles.find((x) => x.id === '${id}')
  return p ? { textAlign: p.textAlign, fontSize: p.fontSize, fontWeight: p.fontWeight, lineHeight: p.lineHeight } : null
})()`)

const build = () => evaluate(`(async () => {
  window.__ed.commands.addNumberingProfile({ id: 'test-abstract', name: 'Abstract body', targetType: 'paragraph', enabled: false, template: '' })
  window.__ed.commands.addNumberingProfile({ id: 'test-h1-plain', name: 'Chapter, no number', targetType: 'heading', level: 1, enabled: false, template: '' })
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, numberingProfileId: 'test-h1-plain' }, content: [{ type: 'text', text: 'ABSTRACT' }] },
    { type: 'paragraph', attrs: { numberingProfileId: 'test-abstract', textAlign: 'center' }, content: [{ type: 'text', text: 'Judul abstrak' }] },
    { type: 'heading', attrs: { level: 1, numberingProfileId: 'profile-h1' }, content: [{ type: 'text', text: 'PENDAHULUAN' }] },
    { type: 'paragraph', attrs: { numberingProfileId: 'profile-paragraph' }, content: [{ type: 'text', text: 'Isi bab satu' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf tanpa profil' }] } ] })
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1200))
  return true
})()`)

console.log('\nCase A: a block with no profile takes the default for its type')
await build()
let rows = await assignments()
check('an unassigned paragraph follows Normal', idFor(rows, 'Paragraf tanpa') === 'profile-paragraph', idFor(rows, 'Paragraf tanpa'))

console.log('\nCase B: editing a paragraph profile touches only its own paragraphs')
await evaluate(`(async () => { window.__ed.commands.updateNumberingProfile('test-abstract', { fontSize: '10pt' }); await new Promise((r) => setTimeout(r, 1200)); return true })()`)
rows = await assignments()
check('the chapter paragraph keeps Normal', idFor(rows, 'Isi bab satu') === 'profile-paragraph', idFor(rows, 'Isi bab satu'))
check('the abstract paragraph keeps its own profile', idFor(rows, 'Judul abstrak') === 'test-abstract', idFor(rows, 'Judul abstrak'))

console.log('\nCase C: editing a heading profile touches only its own headings')
await evaluate(`(async () => { window.__ed.commands.updateNumberingProfile('test-h1-plain', { fontSize: '15pt' }); await new Promise((r) => setTimeout(r, 1200)); return true })()`)
rows = await assignments()
check('the numbered chapter keeps Title 1', idFor(rows, 'PENDAHULUAN') === 'profile-h1', idFor(rows, 'PENDAHULUAN'))
check('the unnumbered chapter keeps its own profile', idFor(rows, 'ABSTRACT') === 'test-h1-plain', idFor(rows, 'ABSTRACT'))

console.log("\nCase D: a sync does not copy a block's styling into its profile")
const fields = await profileFields('test-abstract')
check('the profile did not take the block\'s alignment', !fields.textAlign, JSON.stringify(fields))
check('the profile kept the size the user set', fields.fontSize === '10pt', fields.fontSize)

console.log('\nCase E: deleting a profile releases the blocks that followed it')
await evaluate(`(async () => { window.__ed.commands.deleteNumberingProfile('test-abstract'); await new Promise((r) => setTimeout(r, 1200)); return true })()`)
rows = await assignments()
check('its paragraph falls back to Normal', idFor(rows, 'Judul abstrak') === 'profile-paragraph', idFor(rows, 'Judul abstrak'))
check('every other block is untouched', idFor(rows, 'ABSTRACT') === 'test-h1-plain' && idFor(rows, 'PENDAHULUAN') === 'profile-h1')

await mkdir(SHOTS, { recursive: true })
const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await writeFile(path.join(SHOTS, 'profile-isolation.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/profile-isolation.png')

if (failures.length > 0) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join(', ')}`)
  await finish(1)
}
console.log('\nRESULT: PASSED -- a profile edit reaches only the blocks that follow that profile.')
await finish(0)
