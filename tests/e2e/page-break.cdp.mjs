/**
 * A manual page break must start a new sheet on screen, not only in the export.
 *
 * `.umo-page-break` carries `break-before: page`, which print honours. The pagination engine used to
 * ignore it entirely, so the screen kept flowing where the export started a new page and every sheet
 * after the break inherited the difference - the drift ADR 0002 was written to prevent.
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

// Short document: two paragraphs that comfortably share one sheet, with a break between them. Any
// sheet change can then only come from the break.
const MARKER_A = 'Paragraf sebelum pemisah halaman.'
const MARKER_B = 'Paragraf sesudah pemisah halaman.'
const build = (withBreak) => `(async () => {
  const content = [
    { type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(MARKER_A)} }] },
    ${withBreak ? "{ type: 'pageBreak' }," : ''}
    { type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(MARKER_B)} }] },
  ]
  window.__ed.commands.setContent({ type: 'doc', content })
  await new Promise((r) => setTimeout(r, 2500))
  const root = document.querySelector('.umo-page-content')
  const origin = root.getBoundingClientRect().top
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px;top:0;left:0'
  root.appendChild(ruler)
  const measure = (name, fallback) => { ruler.style.height = 'var(' + name + ', ' + fallback + ')'; return ruler.getBoundingClientRect().height }
  const pageHeight = measure('--umo-page-height', '29.7cm')
  const marginTop = measure('--umo-page-margin-top', '0cm')
  const gap = measure('--umo-page-sheet-gap', '16px')
  ruler.remove()
  const stride = pageHeight + gap
  const sheetOf = (text) => {
    for (const el of document.querySelectorAll('.ProseMirror p')) {
      if (el.textContent.includes(text)) {
        const top = el.getBoundingClientRect().top - origin
        return { sheet: Math.floor(top / stride), top, columnTop: Math.floor(top / stride) * stride + marginTop }
      }
    }
    return null
  }
  return { a: sheetOf(${JSON.stringify(MARKER_A)}), b: sheetOf(${JSON.stringify(MARKER_B)}),
           spacers: document.querySelectorAll('.umo-page-spacer').length }
})()`

console.log('\nCase A: without a break, two short paragraphs share one sheet')
const plain = await evaluate(build(false))
check('both paragraphs are found', Boolean(plain.a && plain.b), JSON.stringify(plain))
check('they sit on the same sheet', plain.a?.sheet === plain.b?.sheet, `sheet ${plain.a?.sheet} vs ${plain.b?.sheet}`)
check('no spacer was needed', plain.spacers === 0, `${plain.spacers} spacer(s)`)

console.log('\nCase B: with a break between them, the second starts the next sheet')
const broken = await evaluate(build(true))
const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'page-break-honoured.png'), Buffer.from(shot.data, 'base64'))

check('both paragraphs are still found', Boolean(broken.a && broken.b), JSON.stringify(broken))
check('the first paragraph stays on its sheet', broken.a?.sheet === plain.a?.sheet, `sheet ${broken.a?.sheet}`)
check('the second paragraph moved to the next sheet', broken.b?.sheet === (broken.a?.sheet ?? 0) + 1, `sheet ${broken.a?.sheet} -> ${broken.b?.sheet}`)
check('the engine inserted exactly one spacer for it', broken.spacers === 1, `${broken.spacers} spacer(s)`)
check(
  'the second paragraph begins at the top of its column, not part way down',
  broken.b && Math.abs(broken.b.top - broken.b.columnTop) <= 2,
  `top ${Math.round(broken.b?.top)} vs column top ${Math.round(broken.b?.columnTop)}`,
)

console.log('\nCase C: a break already at a column top does not insert a blank sheet')
const twice = await evaluate(`(async () => {
  window.__ed.commands.syncDocumentReferences?.()
  await new Promise((r) => setTimeout(r, 800))
  return document.querySelectorAll('.umo-page-spacer').length
})()`)
check('re-solving does not add spacers', twice === 1, `${twice} spacer(s) after a second solve`)

console.log('\nscreenshot written to tests/screenshots/page-break-honoured.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a manual page break starts a new sheet on screen.')
await finish(0)
