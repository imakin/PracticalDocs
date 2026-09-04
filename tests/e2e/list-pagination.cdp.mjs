/**
 * A list longer than a page is paginated all the way down, and a page break inside one works.
 *
 * The user reported the second half: a numbered list running past the end of a page, a page break
 * added on the second page to make a third, and nothing happening. The break was the symptom. The
 * fault was that **the solve gave up at the first break inside a list**, so everything below that
 * point stopped being paginated and the break was never reached.
 *
 * Why it gave up: `posAtDOM` on a text node inside a list item's node view returns the position
 * before the paragraph rather than inside it, so the anchor was not a text block start and the
 * spacer landed inside the item. A list item's marker is drawn beside its content rather than in
 * it, so the text moved and the marker did not - and the marker is a text node the engine counts as
 * a line. That line could never move, so the same line overflowed every round, the anchor was never
 * beyond the previous one, and the loop stopped.
 *
 * What is measured is the invariant rather than the spacers: no line of text may sit below the
 * bottom of the column it is on.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'

import WebSocket from 'ws'

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
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})
await call('Page.bringToFront', {}, sessionId).catch(() => {})

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
let total = 0
const check = (label, condition, detail) => {
  total += 1
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// Enough items to need three sheets, each long enough to be an ordinary line of prose.
const ITEMS = Array.from({ length: 40 }, (_, i) =>
  `<li><p>baris nomor ${i + 1} dengan teks secukupnya supaya baris ini punya tinggi yang normal</p></li>`).join('')

const settle = async (ms = 2600) => sleep(ms)

/**
 * Every line of text, against the column it sits on.
 *
 * The engine's own geometry is read rather than measured again - `stride` is the sheet pitch and the
 * page content box is the origin - so this asks the same question the engine answers and cannot
 * drift from it.
 */
const overflowing = async () => evaluate(`(() => {
  const storage = window.__ed.extensionStorage.pagination || window.__ed.storage.pagination
  const stride = storage.stride
  const host = window.__ed.view.dom.closest('.umo-page-content')
  if (!(stride > 0) || !host) return { error: 'no geometry', stride, pages: (storage.pages || []).length }
  // Measured the way the engine measures them: a hidden ruler inside the page, sized from the custom
  // property. Reading the property off the document element returns nothing, because that is not
  // where the page defines it.
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px;top:0;left:0'
  host.appendChild(ruler)
  const read = (name, fallback) => {
    ruler.style.height = 'var(' + name + ', ' + fallback + ')'
    return ruler.getBoundingClientRect().height
  }
  const originTop = host.getBoundingClientRect().top
  const pageHeight = read('--umo-page-height', '29.7cm')
  const marginBottom = read('--umo-page-margin-bottom', '0cm')
  ruler.remove()
  const out = []
  const walker = document.createTreeWalker(window.__ed.view.dom, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) continue
    if (node.parentElement && node.parentElement.closest('.umo-page-spacer')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (rect.height <= 0 || rect.width <= 0) continue
      const top = rect.top - originTop
      const sheet = Math.floor(top / stride)
      const columnBottom = sheet * stride + pageHeight - marginBottom
      if (rect.bottom - originTop > columnBottom + 2) {
        out.push({ text: node.textContent.slice(0, 26), bottom: Math.round(rect.bottom - originTop), columnBottom: Math.round(columnBottom) })
      }
    }
  }
  return { count: out.length, first: out.slice(0, 3), sheets: (storage.pages || []).length, stride: Math.round(stride) }
})()`)

console.log('\nCase A: a list longer than two pages is paginated all the way down')
await evaluate(`(async () => {
  window.__ed.commands.setContent('<p>pembuka</p><ol>${ITEMS}</ol><p>penutup</p>')
  return true
})()`)
await settle()
const listOnly = await overflowing()
check('the engine has geometry to answer with', !listOnly.error, JSON.stringify(listOnly))
check('the list needs more than two sheets', listOnly.sheets >= 3, `${listOnly.sheets} sheets`)
// The fault: the solve stopped at the first break, so everything below ran off the sheet.
check('no line runs past the bottom of its column',
  listOnly.count === 0, JSON.stringify(listOnly.first))

console.log('\nCase B: a page break on the second page of that list opens a third')
const sheetsBefore = listOnly.sheets
const placed = await evaluate(`(async () => {
  const spacer = document.querySelector('.umo-page-spacer')
  const y = spacer ? spacer.getBoundingClientRect().bottom : 0
  const li = [...document.querySelectorAll('.ProseMirror li')].find((l) => l.getBoundingClientRect().top > y + 40)
  if (!li) return null
  const p = li.querySelector(':scope > .umo-list-item-content > p')
  let pos = null
  window.__ed.state.doc.descendants((n, at) => {
    if (n.type.name === 'paragraph' && n.textContent === p.textContent && pos === null) pos = at + 1
  })
  if (pos === null) return null
  window.__ed.commands.setTextSelection(pos + 1)
  window.__ed.commands.focus()
  window.__ed.commands.setPageBreak()
  return p.textContent.slice(0, 24)
})()`)
check('a break was inserted on the second page', !!placed, String(placed))
await settle()
const withBreak = await overflowing()
check('the document gains a sheet',
  withBreak.sheets > sheetsBefore, `${sheetsBefore} -> ${withBreak.sheets}`)
check('and still no line runs past its column',
  withBreak.count === 0, JSON.stringify(withBreak.first))

console.log(`\nRESULT: ${failures.length === 0 ? 'PASSED' : 'FAILED'} -- ${total} checks, ${failures.length} failed`)
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`))
await finish(failures.length === 0 ? 0 : 1)
