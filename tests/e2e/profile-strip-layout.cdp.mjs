/**
 * The profile strip can be scrolled, and the profile popup is a grid.
 *
 * The strip stood 66px tall - 54 of content and a 12px scrollbar - inside a wrapper locked to 56px
 * with `overflow: hidden`, so the bar was drawn and then clipped away and there was no way to reach
 * the profiles further along. The popup's card list had no styling at all, because the rule for it is
 * nested under a section that is not its parent, so every card took a row of its own.
 *
 * This test needs no document: it asserts on the toolbar, in an editor left as it opens.
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
const FOUR_ACROSS = 4

console.log('\nCase A: the strip scrolls sideways, and its scrollbar is inside the row')
const strip = await evaluate(`(() => {
  const wrap = document.querySelector('.pdoc-toolbar-headding')
  const el = wrap?.querySelector('.pdoc-heading-container')
  if (!el) return { error: 'the profile strip was not found' }
  return {
    wrapHeight: wrap.clientHeight,
    stripHeight: el.offsetHeight,
    // What the bar occupies: clientHeight excludes it, so the difference is the bar itself.
    scrollbar: el.offsetHeight - el.clientHeight,
    overflows: el.scrollWidth > el.clientWidth,
    cards: el.querySelectorAll('.card').length,
  }
})()`)
assert.equal(strip.error, undefined, strip.error)

check(
  'there are more profiles than the strip can show',
  strip.overflows,
  `${strip.cards} cards`,
)
check('so the strip draws a scrollbar', strip.scrollbar > 0, `${strip.scrollbar}px`)
check(
  'and the scrollbar is not clipped by the row',
  strip.stripHeight <= strip.wrapHeight,
  `strip ${strip.stripHeight}px inside a row of ${strip.wrapHeight}px`,
)

console.log('\nCase B: it can actually be dragged, and the strip follows')
const scrolled = await evaluate(`(async () => {
  const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container')
  const before = el.scrollLeft
  el.scrollLeft = 120
  await new Promise((r) => setTimeout(r, 200))
  const after = el.scrollLeft
  el.scrollLeft = before
  return { before, after }
})()`)
check(
  'scrolling the strip moves it',
  scrolled.after > scrolled.before,
  `${scrolled.before} -> ${scrolled.after}`,
)

console.log('\nCase C: the popup lays the profiles out four to a row')
await evaluate(`document.querySelector('.pdoc-toolbar-headding .arrow').click()`)
await sleep(900)
const popup = await evaluate(`(() => {
  const list = document.querySelector('.pdoc-heading-container-popup .block-cards-list')
  if (!list) return { error: 'the popup card list was not found' }
  const cards = [...list.querySelectorAll('.card')]
  const rows = new Map()
  for (const card of cards) {
    const top = Math.round(card.getBoundingClientRect().top)
    rows.set(top, (rows.get(top) || 0) + 1)
  }
  const perRow = [...rows.values()]
  return {
    cards: cards.length,
    perRow,
    // The last row is whatever is left over; every row before it should be full.
    full: perRow.slice(0, -1),
    listWidth: list.offsetWidth,
    cardPitch: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) + 4 : null,
  }
})()`)
assert.equal(popup.error, undefined, popup.error)

check(
  'there are enough profiles for this to be worth asserting',
  popup.cards > FOUR_ACROSS,
  `${popup.cards} cards`,
)
check(
  'every full row holds four',
  popup.full.length > 0 && popup.full.every((count) => count === FOUR_ACROSS),
  JSON.stringify(popup.perRow),
)
check(
  'and no row holds more',
  popup.perRow.every((count) => count <= FOUR_ACROSS),
  JSON.stringify(popup.perRow),
)
check(
  'because the list is exactly four cards wide',
  popup.listWidth === FOUR_ACROSS * popup.cardPitch,
  `${popup.listWidth}px for a pitch of ${popup.cardPitch}px`,
)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'profile-strip-layout.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/profile-strip-layout.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the profile strip scrolls and the popup is a grid of four.')
await finish(0)
