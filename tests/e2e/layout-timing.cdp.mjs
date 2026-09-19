/**
 * The status bar says the page is being laid out, and how long it took.
 *
 * The engine holds the main thread for a whole solve - measured at 1764 ms on a 44 sheet thesis - so
 * the writer had no way of telling a slow document from a stuck one. The bar says so now, and the
 * saying has to begin when the solve is **scheduled** rather than when it starts: a message raised at
 * the top of a solve cannot be painted until that solve has finished, which is exactly too late.
 *
 * The typing is real typing. Only the fixture is set up in code.
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
const readTiming = () => evaluate(`(() => {
  const el = document.querySelector('.pdoc-layout-timing')
  if (!el) return null
  return { text: el.textContent.trim(), working: el.classList.contains('working') }
})()`)

// Long enough that a solve takes a moment, so the working state is not gone before it can be seen.
await evaluate(`(async () => {
  const content = []
  for (let i = 0; i < 120; i += 1) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: (i + 1) + '. Kalimat yang cukup panjang untuk membungkus lebih dari satu baris di halaman ini.' }] })
  }
  window.__ed.commands.setContent({ type: 'doc', content })
  await new Promise((r) => setTimeout(r, 6000))
  return true
})()`)

console.log('\nCase A: once the page has settled, the bar carries the measurement')
const settled = await readTiming()
check('the bar shows a layout timing', Boolean(settled), JSON.stringify(settled))
check('it is not still working', settled && !settled.working, JSON.stringify(settled?.text))
check(
  'and it reads as a number of milliseconds',
  settled && /^Layout\s+\d+\s+ms$/.test(settled.text),
  JSON.stringify(settled?.text),
)
const firstMs = Number.parseInt(String(settled.text).replace(/[^0-9]/g, ''), 10)
check('the measurement is a real one', firstMs > 0, `${firstMs} ms`)

console.log('\nCase B: typing sets it working again, and it is visible while the writer waits')
// Click into the document and type, the way a writer does.
const at = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror p')
  const box = p.getBoundingClientRect()
  return { x: Math.round(box.right - 4), y: Math.round(box.top + box.height / 2) }
})()`)
for (const type of ['mousePressed', 'mouseReleased']) {
  await call('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, sessionId)
}
await sleep(300)

let sawWorking = false
let sawText = null
const typing = (async () => {
  for (const text of ['h', 'a', 'l', 'o']) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', text }, sessionId)
    await call('Input.dispatchKeyEvent', { type: 'keyUp' }, sessionId)
    await sleep(120)
  }
})()
// Watch the bar while the typing and the solve are going on.
for (let tick = 0; tick < 80; tick += 1) {
  const now = await readTiming()
  if (now?.working) {
    sawWorking = true
    sawText = now.text
    break
  }
  await sleep(50)
}
await typing
check(
  'the bar says it is laying out while the writer waits',
  sawWorking,
  sawText ? JSON.stringify(sawText) : 'never seen working',
)

console.log('\nCase C: and it settles back to a measurement')
let after = null
for (let tick = 0; tick < 60; tick += 1) {
  after = await readTiming()
  if (after && !after.working) break
  await sleep(250)
}
check(
  'the working state gives way to a measurement',
  after && !after.working && /^Layout\s+\d+\s+ms$/.test(after.text),
  JSON.stringify(after?.text),
)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'layout-timing.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/layout-timing.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the bar says the page is being laid out, and how long it took.')
await finish(0)
