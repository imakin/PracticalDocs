/**
 * The settings a page break can change, reached the way a writer reaches them.
 *
 * The engine resolved position, chapter-first-page and template per section from the beginning; the
 * panel offered only the count and the numerals, so a break could change how a page was numbered but
 * not where the number sat or what it read. `page-numbering.test.mjs` covers what the engine does
 * with each field. This covers the part no unit test can: that the controls exist, that a page break
 * has to be selected for them to appear, and that turning one actually moves the number on the page.
 *
 * Own fixture. It never opens a stored document.
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

// A viewport this test decides. With the window narrower than the toolbar, a control reported at a
// given x is outside the viewport, nothing is under the pointer, and every click silently does
// nothing while command-driven checks still pass. See the hard rules in AGENT/STATE.md.
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})

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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; window.__page = p.page; break }
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
const clickAt = async (x, y) => {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }, sessionId)
  await sleep(120)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 }, sessionId)
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 }, sessionId)
  await sleep(400)
}

// A document long enough to need several sheets, with a break part way so there is a section.
await evaluate(`(async () => {
  const content = []
  for (let i = 1; i <= 20; i += 1) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Paragraf ' + i + ' dengan isi yang cukup panjang untuk mengisi ruang halaman sehingga dokumen ini melewati batas lembar pertama.' }] })
    if (i === 10) content.push({ type: 'pageBreak' })
  }
  window.__ed.commands.setContent({ type: 'doc', content })
  window.__page.value.pageNumber = { enabled: true, position: 'bottom-center', firstPagePosition: null, format: 'numeric', startAt: 1, template: '{number}' }
  await new Promise((r) => setTimeout(r, 4000))
  return true
})()`)

console.log('\nCase A: the panel says nothing about a section until a page break is selected')

// The control lives on the Page tab of the ribbon, which is not the one open at startup. Reaching
// it the way a writer does means pressing that tab first.
const pageTab = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.umo-ribbon-tabs-item')].find((t) => t.textContent.trim() === 'Page')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('the ribbon has a Page tab', !!pageTab, JSON.stringify(pageTab))
if (pageTab) { await clickAt(pageTab.x, pageTab.y); await sleep(700) }

const panelButton = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.umo-toolbar .umo-button, .umo-toolbar button')]
    .find((b) => b.textContent.trim() === 'Page Numbers')
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('Page > Page Numbers is on that tab', !!panelButton, JSON.stringify(panelButton))

if (panelButton) { await clickAt(panelButton.x, panelButton.y); await sleep(700) }
const noSection = await evaluate(`(() => {
  const panel = document.querySelector('.umo-page-number-panel')
  return { open: !!panel, labels: panel ? [...panel.querySelectorAll('label')].map((l) => l.textContent.trim()) : [] }
})()`)
check('the panel opens on a real click', noSection.open === true)
// With nothing selected there is no section to describe, so the section controls must not be there.
check('no section controls while no break is selected',
  !noSection.labels.includes('Chapter first page') || noSection.labels.filter((l) => l === 'Chapter first page').length === 1,
  JSON.stringify(noSection.labels))

console.log('\nCase B: selecting the break reveals every setting a section can carry')

const revealed = await evaluate(`(async () => {
  let pos = null
  window.__ed.state.doc.descendants((node, at) => { if (node.type.name === 'pageBreak' && pos === null) pos = at; return true })
  window.__ed.commands.setNodeSelection(pos)
  await new Promise((r) => setTimeout(r, 700))
  const panel = document.querySelector('.umo-page-number-panel')
  const labels = panel ? [...panel.querySelectorAll('label')].map((l) => l.textContent.trim()) : []
  const checkboxes = panel ? [...panel.querySelectorAll('.umo-checkbox__label, label')].map((l) => l.textContent.trim()) : []
  return { pos, labels, checkboxes }
})()`)
// Position, chapter first page and template were resolved by the engine all along and had no control.
check('the section offers a position', revealed.labels.filter((l) => l === 'Position').length >= 2,
  JSON.stringify(revealed.labels))
check('the section offers a chapter first page',
  revealed.labels.filter((l) => l === 'Chapter first page').length >= 2, JSON.stringify(revealed.labels))
check('the section offers a template of its own',
  revealed.checkboxes.some((l) => l.includes('Use its own template')), JSON.stringify(revealed.checkboxes))

console.log('\nCase C: a section setting reaches the page')

const moved = await evaluate(`(async () => {
  const read = () => [...document.querySelectorAll('.umo-page-content > .umo-page-number')]
    .map((el) => ({ text: el.textContent.trim(), align: el.style.textAlign, top: Math.round(Number.parseFloat(el.style.top)) }))
  const before = read()
  window.__ed.commands.setPageBreakSection({ sectionPosition: 'top-right' })
  await new Promise((r) => setTimeout(r, 2500))
  const after = read()
  window.__ed.commands.setPageBreakSection({ sectionPosition: null, sectionTemplate: '' })
  await new Promise((r) => setTimeout(r, 2500))
  const blank = read()
  window.__ed.commands.setPageBreakSection({ sectionTemplate: null })
  await new Promise((r) => setTimeout(r, 2000))
  return { before, after, blank, sheets: window.__ed.extensionStorage.pagination.pages.map((p) => p.text) }
})()`)

check('the document draws page numbers to begin with', moved.before.length >= 2,
  `${moved.before.length} drawn: ${JSON.stringify(moved.before.map((n) => n.text))}`)
// Position moves the number without touching the count, which is the point of separating them.
check('setting the section position moves the later numbers',
  moved.after.some((n) => n.align === 'right') && moved.after.length === moved.before.length,
  JSON.stringify(moved.after.map((n) => [n.text, n.align])))
check('and it leaves the numbers themselves alone',
  JSON.stringify(moved.after.map((n) => n.text)) === JSON.stringify(moved.before.map((n) => n.text)),
  `${JSON.stringify(moved.before.map((n) => n.text))} -> ${JSON.stringify(moved.after.map((n) => n.text))}`)
// The thing asked for by name: an empty template hides the folio and the count carries on beneath.
check('an empty template draws fewer numbers than the document has sheets',
  moved.blank.length < moved.before.length,
  `${moved.blank.length} drawn against ${moved.before.length} before`)
check('and the count underneath never stopped',
  moved.sheets.length >= moved.before.length,
  `${moved.sheets.length} sheets counted`)

console.log(`\n${failures.length === 0 ? 'RESULT: PASSED -- a page break can change where a number sits and what it reads.' : `RESULT: FAILED -- ${failures.length} check(s)`}`)
for (const f of failures) console.log(`  - ${f}`)
await finish(failures.length === 0 ? 0 : 1)
