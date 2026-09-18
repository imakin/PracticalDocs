/**
 * The sheets are drawn where the engine solved them, however long the document is.
 *
 * Every length the engine writes - a spacer's height, a sheet's box - is divided by the canvas scale
 * on the way out, and that scale was measured by dividing a fractional rect width by `offsetWidth`,
 * which is rounded to a whole pixel. On a canvas of 793.695px that made the divisor 794 and the
 * scale 0.9996, while the page's transform was plainly matrix(1, 0, 0, 1, 0, 0). Each length came out
 * 0.04 per cent short, and the error accumulates: measured on a 44 sheet document, the drawn sheets
 * lagged the solved geometry by 3px at sheet 6, 11px at sheet 24 and 21px by the last - the pages
 * drifting further out of step the further down the document you read.
 *
 * This test uses its own synthetic document, so it does not depend on whatever the user is working on.
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

const PERSISTED_KEYS = ['practicaldocs:default:document', 'practicaldocs:profiles']
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
process.on('uncaughtException', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })
process.on('unhandledRejection', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })

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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; window.__p = p; break }
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
// Long enough that a per-sheet error of a fraction of a pixel becomes visible at the end.
const PARAGRAPHS = 260

await evaluate(`(async () => {
  const content = []
  for (let i = 0; i < ${PARAGRAPHS}; i += 1) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: (i + 1) + '. Kalimat percobaan yang cukup panjang untuk membungkus lebih dari satu baris di halaman ini.' }] })
  }
  window.__ed.commands.setContent({ type: 'doc', content })
  await new Promise((r) => setTimeout(r, 8000))
  return true
})()`)

const measured = await evaluate(`(() => {
  const host = window.__ed.view.dom.closest('.pdoc-page-content')
  const hostTop = host.getBoundingClientRect().top
  const storage = window.__ed.extensionStorage?.pagination || window.__ed.storage?.pagination
  const model = storage?.sheets || []
  const drawn = [...host.querySelectorAll(':scope > .pdoc-page-sheet')]
  if (!model.length || !drawn.length) return { error: 'nothing was drawn' }

  // The scale the page really uses. A transform anywhere up the tree scales what the engine
  // measures, so the nearest one is the answer, and none at all means 1.
  let transform = 'none'
  let node = host
  while (node) {
    const value = getComputedStyle(node).transform
    if (value && value !== 'none') { transform = value; break }
    node = node.parentElement
  }
  const real = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a

  const diffs = []
  for (let i = 0; i < Math.min(model.length, drawn.length); i += 1) {
    diffs.push(Math.round(drawn[i].getBoundingClientRect().top - hostTop - model[i].top))
  }
  return {
    sheets: model.length,
    drawn: drawn.length,
    realScale: real,
    engineScale: host.getBoundingClientRect().width / host.offsetWidth,
    worst: diffs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0),
    last: diffs[diffs.length - 1],
    sample: diffs.filter((_, i) => i % 10 === 0),
  }
})()`)
assert.equal(measured.error, undefined, measured.error)

console.log('\nCase A: a long document, so a per-sheet error has somewhere to accumulate')
check(
  'the document really is long',
  measured.sheets >= 12,
  `${measured.sheets} sheets`,
)
check(
  'one sheet is drawn for each the engine solved',
  measured.drawn === measured.sheets,
  `${measured.drawn} drawn against ${measured.sheets} solved`,
)

console.log('\nCase B: every sheet is drawn where it was solved')
check(
  'no sheet is out by more than a pixel',
  Math.abs(measured.worst) <= 1,
  `worst ${measured.worst}px, last ${measured.last}px, sample ${JSON.stringify(measured.sample)}`,
)
check(
  'and the last sheet has not drifted',
  Math.abs(measured.last) <= 1,
  `${measured.last}px`,
)

console.log('\nCase C: because the scale is the one the page actually uses')
// The root of it. Rounding the divisor to a whole pixel is what put the scale out, and this is the
// check that says so in one number rather than leaving it to be inferred from the drift.
check(
  'the scale taken from a rounded width is not the real one',
  Math.abs(measured.engineScale - measured.realScale) > 0.0001,
  `rounded ${measured.engineScale.toFixed(6)} against a real ${measured.realScale}`,
)

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the sheets are drawn where the engine solved them.')
await finish(0)
