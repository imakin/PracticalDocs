/**
 * A cell draws the sides the writer chose, and only those.
 *
 * Every table came out as the same full grid. A thesis rarely wants one: the house rule is a line
 * above and below and nothing else, and an equation written as a table wants no lines at all, with
 * the number in a cell of its own. The Border Color entry that stood in the menu set an attribute
 * the cell schema never declared, so it did nothing, and it had been commented out of both toolbars.
 *
 * The fixture is built by setting content, which is setup. Everything the test is actually about -
 * selecting the cells and choosing the borders - is done with the mouse, on the real controls, the
 * way a writer does it.
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
// ---- the pointer ------------------------------------------------------------------------------
const pointer = async (type, x, y, extra = {}) =>
  call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }, sessionId)

const clickAt = async (x, y) => {
  await pointer('mouseMoved', x, y, { button: 'none', buttons: 0 })
  await sleep(100)
  await pointer('mousePressed', x, y, { buttons: 1 })
  await sleep(60)
  await pointer('mouseReleased', x, y, { buttons: 0 })
  await sleep(400)
}

const locate = (expression) => evaluate(`(() => {
  const found = (${expression})
  if (!found) return null
  const box = found.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
})()`)

const clickWhenReady = async (label, expression, tries = 30) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const at = await locate(expression)
    if (at) {
      await clickAt(at.x, at.y)
      return at
    }
    await sleep(400)
  }
  throw new Error(`could not find ${label} to click`)
}

// ---- the fixture ------------------------------------------------------------------------------
await evaluate(`(async () => {
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const row = (a, b) => ({ type: 'tableRow', content: [cell(a), cell(b)] })
  window.__ed.commands.setContent({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Sebelum tabel.' }] },
      { type: 'table', content: [row('kiri atas', 'kanan atas'), row('kiri bawah', 'kanan bawah')] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Sesudah tabel.' }] },
    ],
  })
  await new Promise((r) => setTimeout(r, 2500))
  return true
})()`)

const cellBoxes = () => evaluate(`(() => {
  return [...document.querySelectorAll('.ProseMirror table td')].map((td) => {
    const r = td.getBoundingClientRect()
    const style = getComputedStyle(td)
    return {
      text: td.textContent.trim().slice(0, 12),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      top: style.borderTopWidth, right: style.borderRightWidth,
      bottom: style.borderBottomWidth, left: style.borderLeftWidth,
    }
  })
})()`)

const before = await cellBoxes()
console.log('\nCase A: a fresh table is the full grid it always was')
check('the table has four cells', before.length === 4, `${before.length} cells`)
check(
  'and every side of every cell draws a line',
  before.every((c) => [c.top, c.right, c.bottom, c.left].every((w) => Number.parseFloat(w) > 0)),
  JSON.stringify(before.map((c) => [c.top, c.right, c.bottom, c.left].join('/'))),
)

// Select every cell the way a writer does: press in the first and drag to the last.
const dragAcross = async () => {
  const cells = await cellBoxes()
  const first = cells[0]
  const last = cells[cells.length - 1]
  await pointer('mouseMoved', first.x, first.y, { button: 'none', buttons: 0 })
  await pointer('mousePressed', first.x, first.y, { buttons: 1 })
  await sleep(120)
  await pointer('mouseMoved', last.x, last.y, { buttons: 1 })
  await sleep(120)
  await pointer('mouseReleased', last.x, last.y, { buttons: 0 })
  await sleep(500)
  return evaluate(`(() => document.querySelectorAll('.ProseMirror td.selectedCell, .ProseMirror th.selectedCell').length)()`)
}
const selected = await dragAcross()
check('dragging across the table selects every cell', selected === 4, `${selected} selected`)

// ---- the control ------------------------------------------------------------------------------
const openBordersMenu = async () => {
  await clickWhenReady('the Table tab', `
    [...document.querySelectorAll('div, span, button')]
      .filter((el) => el.textContent.trim() === 'Table' && el.children.length === 0)[0]
  `)
  await clickWhenReady('the Cell Borders control', `
    [...document.querySelectorAll('button, .pdoc-button, [class*=menus-button]')]
      .filter((el) => el.textContent.includes('Cell Borders'))
      .sort((a, b) => a.textContent.length - b.textContent.length)[0]
  `)
}
const chooseBorder = async (label) => {
  await openBordersMenu()
  await clickWhenReady(`the ${label} entry`, `
    [...document.querySelectorAll('li, .pdoc-dropdown__item, div')]
      .filter((el) => el.textContent.trim() === ${JSON.stringify(label)})
      .sort((a, b) => a.textContent.length - b.textContent.length)[0]
  `)
  await sleep(700)
}

console.log('\nCase B: No Borders leaves a table with no lines at all')
await chooseBorder('No Borders')
const bare = await cellBoxes()
check(
  'no cell draws a line on any side',
  bare.every((c) => [c.top, c.right, c.bottom, c.left].every((w) => Number.parseFloat(w) === 0)),
  JSON.stringify(bare.map((c) => [c.top, c.right, c.bottom, c.left].join('/'))),
)
// Saved and opened again. Asserting on the markup would be asserting on a spelling: four sides all
// set to none come back out of the browser as the shorthand, with not one longhand left to match.
// What matters is that the table is still bare when the writer opens the file tomorrow.
const roundTrip = await evaluate(`(async () => {
  const html = window.__ed.getHTML()
  window.__ed.commands.setContent('<p>kosong</p>')
  await new Promise((r) => setTimeout(r, 400))
  window.__ed.commands.setContent(html)
  await new Promise((r) => setTimeout(r, 1200))
  return [...document.querySelectorAll('.ProseMirror table td')].map((td) => {
    const style = getComputedStyle(td)
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join('/')
  })
})()`)
check(
  'and it is still bare after the document is saved and opened again',
  roundTrip.length === 4 && roundTrip.every((sides) => sides === '0px/0px/0px/0px'),
  JSON.stringify(roundTrip),
)

console.log('\nCase C: Top and Bottom Only is the rule a thesis asks for')
await dragAcross()
await chooseBorder('Top and Bottom Only')
const ruled = await cellBoxes()
check(
  'the lines above and below are back',
  ruled.every((c) => Number.parseFloat(c.top) > 0 && Number.parseFloat(c.bottom) > 0),
  JSON.stringify(ruled.map((c) => `${c.top}/${c.bottom}`)),
)
check(
  'and the sides stay off',
  ruled.every((c) => Number.parseFloat(c.left) === 0 && Number.parseFloat(c.right) === 0),
  JSON.stringify(ruled.map((c) => `${c.left}/${c.right}`)),
)

console.log('\nCase D: All Borders puts the grid back')
await dragAcross()
await chooseBorder('All Borders')
const grid = await cellBoxes()
check(
  'every side draws again',
  grid.every((c) => [c.top, c.right, c.bottom, c.left].every((w) => Number.parseFloat(w) > 0)),
  JSON.stringify(grid.map((c) => [c.top, c.right, c.bottom, c.left].join('/'))),
)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'cell-borders.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/cell-borders.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a cell draws the sides the writer chose.')
await finish(0)
