/**
 * Columns sit edge to edge, and the divider is still easy to catch.
 *
 * There was a 12px gap between them - empty band nobody had written and nobody could reach, which is
 * the product's first principle broken in the plainest way. The writer met it as an invisible margin
 * while dragging the divider. The gap is gone; the area the pointer may grab is unchanged, because it
 * never came from the gap - it is a band measured around the edge in `findBoundaryPosition`.
 *
 * The columns are inserted from the real menu and the divider is dragged with the mouse, as a writer
 * does it.
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
const pointer = (type, x, y, extra = {}) =>
  call('Input.dispatchMouseEvent', { type, x, y, ...extra }, sessionId)

const moveTo = async (x, y) => {
  await pointer('mouseMoved', x, y, { button: 'none', buttons: 0 })
  await sleep(250)
}
const clickAt = async (x, y) => {
  await moveTo(x, y)
  await pointer('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  await pointer('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(450)
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

// A document with something in it, so the columns land in a real page rather than an empty one.
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Sebelum kolom.' }] },
  ] })
  await new Promise((r) => setTimeout(r, 1200))
  window.__ed.commands.focus('end')
  return true
})()`)

console.log('\nCase A: two columns, inserted from the menu, sit edge to edge')
await clickWhenReady('the Insert tab', `
  [...document.querySelectorAll('div, span, button')]
    .filter((el) => el.textContent.trim() === 'Insert' && el.children.length === 0)[0]
`)
await clickWhenReady('the Columns control', `
  [...document.querySelectorAll('button, .pdoc-button')]
    .filter((el) => el.textContent.includes('Columns'))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]
`)
await clickWhenReady('the entry for two columns', `
  [...document.querySelectorAll('div, span, li, button')]
    .filter((el) => el.textContent.trim() === '2' && el.children.length === 0)
    .filter((el) => el.getBoundingClientRect().width > 20)[0]
`)
await sleep(1200)

const layout = await evaluate(`(() => {
  const container = document.querySelector('.pdoc-node-column-container')
  if (!container) return { error: 'no columns were inserted' }
  const columns = [...container.querySelectorAll('.pdoc-node-column')]
  const boxes = columns.map((column) => {
    const box = column.getBoundingClientRect()
    return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), middle: Math.round(box.top + box.height / 2) }
  })
  return {
    gap: getComputedStyle(container).columnGap,
    count: columns.length,
    boxes,
    between: boxes.length > 1 ? Math.round(boxes[1].left - boxes[0].right) : null,
  }
})()`)
assert.equal(layout.error, undefined, layout.error)

check('two columns were inserted', layout.count === 2, `${layout.count} columns`)
check('the container declares no gap', layout.gap === '0px' || layout.gap === 'normal', `gap ${layout.gap}`)
check(
  'and the second column starts where the first ends',
  Math.abs(layout.between) <= 1,
  `${layout.between}px between them`,
)

console.log('\nCase B: the pointer still catches the divider without hitting a 2px line')
const edge = layout.boxes[0].right
const middle = layout.boxes[0].middle
const handleAt = async (offset) => {
  await moveTo(edge + offset, middle)
  return evaluate(`(() => !!document.querySelector('.grid-resize-handle'))()`)
}
check('a few pixels to the left of the edge catches it', await handleAt(-5), 'offset -5px')
check('and a few pixels to the right', await handleAt(5), 'offset +5px')
check('well clear of it does not', !(await handleAt(40)), 'offset +40px')

console.log('\nCase C: the divider can be dragged, and the first column follows')
// Not to the pixel, and deliberately not asserted to be: every column keeps `flex-grow: 1`, so a
// width written on one of them is a starting size that the row then shares out again. Measured, a
// 60px drag moves the edge by about 40, and merely pressing the divider shifts it by some tens of
// pixels. That is how this feature already behaved and it is not what the gap was about - it is
// written down here so the next reader meets it as a known thing rather than a surprise.
const DRAG = 60
await moveTo(edge - 2, middle)
await pointer('mousePressed', edge - 2, middle, { button: 'left', buttons: 1, clickCount: 1 })
await sleep(150)
await pointer('mouseMoved', edge - 2 + DRAG, middle, { buttons: 1 })
await sleep(250)
await pointer('mouseReleased', edge - 2 + DRAG, middle, { button: 'left', buttons: 0, clickCount: 1 })
await sleep(900)
const afterDrag = await evaluate(`(() => {
  const columns = [...document.querySelectorAll('.pdoc-node-column')]
  const boxes = columns.map((c) => c.getBoundingClientRect())
  return {
    first: Math.round(boxes[0].width),
    between: Math.round(boxes[1].left - boxes[0].right),
  }
})()`)
check(
  'dragging to the right makes the first column wider',
  afterDrag.first > layout.boxes[0].width,
  `${layout.boxes[0].width}px before, ${afterDrag.first}px after`,
)
check(
  'and the columns still touch after the drag',
  Math.abs(afterDrag.between) <= 1,
  `${afterDrag.between}px between them`,
)

console.log('\nCase D: columns on a portrait page are the width of that page')
// The writer's own reproduction: a portrait page, a landscape one, then a portrait one again, and
// columns inserted on the last. A document whose sections differ is drawn on a canvas as wide as the
// **widest** sheet, and the engine brings a block on a narrower page in with a margin - which does
// nothing to a width of `100%`. The columns came out as wide as the landscape page, running off the
// paper they were on.
await evaluate(`(async () => {
  const line = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  window.__ed.commands.setContent({ type: 'doc', content: [
    line('Halaman satu, tegak.'),
    { type: 'pageBreak', attrs: { sectionOrientation: 'landscape' } },
    line('Halaman dua, melintang.'),
    { type: 'pageBreak', attrs: { sectionOrientation: 'portrait' } },
    line('Halaman tiga, tegak lagi.'),
  ] })
  await new Promise((r) => setTimeout(r, 5000))
  return true
})()`)

const paragraphAt = (text) => evaluate(`(() => {
  const found = [...document.querySelectorAll('.ProseMirror p')]
    .find((p) => p.textContent.includes(${JSON.stringify(text)}))
  if (!found) return null
  const box = found.getBoundingClientRect()
  return { width: Math.round(box.width), right: Math.round(box.right) - 6, middle: Math.round(box.top + box.height / 2) }
})()`)

const portrait = await paragraphAt('Halaman tiga')
const landscape = await paragraphAt('Halaman dua')
check(
  'the two pages really are different widths',
  portrait && landscape && landscape.width - portrait.width > 100,
  `portrait ${portrait?.width}px, landscape ${landscape?.width}px`,
)

// The cursor goes on the third page, with the mouse, before the menu is touched.
await clickAt(portrait.right, portrait.middle)
await clickWhenReady('the Insert tab', `
  [...document.querySelectorAll('div, span, button')]
    .filter((el) => el.textContent.trim() === 'Insert' && el.children.length === 0)[0]
`)
await clickWhenReady('the Columns control', `
  [...document.querySelectorAll('button, .pdoc-button')]
    .filter((el) => el.textContent.includes('Columns'))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]
`)
await clickWhenReady('the entry for two columns', `
  [...document.querySelectorAll('div, span, li, button')]
    .filter((el) => el.textContent.trim() === '2' && el.children.length === 0)
    .filter((el) => el.getBoundingClientRect().width > 20)[0]
`)
await sleep(2500)

const inserted = await evaluate(`(() => {
  const container = document.querySelector('.pdoc-node-column-container')
  if (!container) return null
  const box = container.getBoundingClientRect()
  return { width: Math.round(box.width), left: Math.round(box.left), right: Math.round(box.right) }
})()`)
check('the columns were inserted', Boolean(inserted), JSON.stringify(inserted))
check(
  'and they are the width of the portrait page they sit on',
  inserted && Math.abs(inserted.width - (portrait.width + 16)) <= 4,
  `columns ${inserted?.width}px against a portrait text column of ${portrait.width}px`,
)
check(
  'not the width of the landscape page elsewhere in the document',
  inserted && inserted.width < landscape.width - 50,
  `columns ${inserted?.width}px, landscape ${landscape.width}px`,
)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'column-divider.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/column-divider.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- columns sit edge to edge and the divider is still easy to catch.')
await finish(0)
