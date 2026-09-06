/**
 * Switching a block between two profiles of the same kind changes how it looks.
 *
 * The user reported that clicking their own `Normal-noindent` on a paragraph already under `Normal`
 * changed nothing, and that the card looked greyed out. Two separate faults, and neither was in the
 * command:
 *
 *   - `Normal` stored its indent as the string `2em`. The generator read the field as a level with
 *     `Number()`, which is `NaN` for a length, so **no `text-indent` rule was emitted at all** and
 *     `Normal` had no indent on screen. Switching to and from it therefore looked like nothing.
 *   - A profile with numbering off carried a `disabled` class that dimmed the whole card, which
 *     says "unusable" about something that works. Body text is the common case for numbering off.
 *
 * The fixture is the user's real profile shapes - a length string on one, and the stray `level` the
 * create path used to put on a paragraph profile - because those shapes are what the faults needed.
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
// A viewport this test decides, not the one the writer's window happens to have.
//
// Measured the hard way: with the browser window at 978px, a toolbar card reported by
// `getBoundingClientRect` at x=1089 is **outside the viewport**, `document.elementFromPoint` there
// returns nothing, and every dispatched click and wheel silently does nothing while every
// command-driven check still passes. A test whose verdict depends on how wide someone left their
// window is not a verdict.
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})

// Bring the test's own tab to the front. A background tab is throttled by Chrome: its renderer
// falls behind, hit testing runs against stale layout, and dispatched mouse input silently does
// nothing - measured, every click and wheel check in this file failed while every command-driven
// check passed. It activates the tab this test made, never the one the writer is in.
await call('Page.bringToFront', {}, sessionId).catch(() => {})

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

const mouse = async (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' && type === 'mousePressed' ? 1 : 0 }, sessionId)
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', 1)
  await mouse('mouseReleased', x, y, 'left', 1)
  await sleep(400)
}

console.log('\nCase A: two paragraph profiles that differ only in their indent')

const setup = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf uji indentasi baris pertama.' }] },
  ] })
  window.__ed.commands.setNumberingConfig({ profiles: [
    { id: 'profile-paragraph', name: 'Normal (Text)', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: '2em', textAlign: 'justify', fontSize: '12pt' },
    { id: 'profile-noindent', name: 'Normal-noindent', enabled: false, targetType: 'paragraph', level: 1, style: 'numeric', template: '', indent: 0, textAlign: 'justify', fontSize: '12pt' },
    { id: 'profile-h1', name: 'Title 1 (H1)', enabled: true, targetType: 'heading', level: 1, style: 'roman-upper', template: 'BAB {number}', indent: 0, textAlign: 'center', fontSize: '14pt' },
  ] })
  await new Promise((r) => setTimeout(r, 1600))
  window.__ed.commands.setTextSelection(3)
  await new Promise((r) => setTimeout(r, 300))
  const p = document.querySelector('.ProseMirror > p')
  return { indent: Math.round(Number.parseFloat(getComputedStyle(p).textIndent)), profile: window.__ed.getJSON().content[0].attrs.numberingProfileId }
})()`)

// The fault the user hit: an indent stored as a length was read as a level, so the rule was never
// written and Normal had no indent at all. Both directions then looked like nothing happening.
check('a profile storing its indent as a length actually indents',
  setup.indent >= 24, `${setup.indent}px`)
check('the paragraph starts under Normal', setup.profile === 'profile-paragraph')

const cards = await evaluate(`(() => [...document.querySelectorAll('.pdoc-heading-container .card')].map((el) => {
  const r = el.getBoundingClientRect()
  return {
    name: (el.querySelector('.title') || {}).textContent.trim(),
    opacity: getComputedStyle(el).opacity,
    pointerEvents: getComputedStyle(el).pointerEvents,
    subtitle: (el.querySelector('.subtitle') || {}).textContent.trim(),
    x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width),
  }
}))()`)
const noIndentCard = cards.find((c) => c.name === 'Normal-noindent')
const headingCard = cards.find((c) => c.name.startsWith('Title 1'))

check('the custom paragraph profile has a card', !!noIndentCard,
  JSON.stringify(cards.map((c) => c.name)))
// It says numbering is off - that fact has to survive - but it must not look unusable.
check('its card still says numbering is off',
  (noIndentCard?.subtitle || '').includes('OFF'), `subtitle ${JSON.stringify(noIndentCard?.subtitle)}`)
check('a profile with numbering off is not dimmed like an unusable one',
  noIndentCard?.opacity === headingCard?.opacity,
  `numbering off ${noIndentCard?.opacity} against numbered ${headingCard?.opacity}`)
check('and it can be clicked', noIndentCard?.pointerEvents !== 'none',
  `pointer-events ${noIndentCard?.pointerEvents}`)

console.log('\nCase B: switching between them, by clicking the cards')

if (noIndentCard && noIndentCard.w > 0) {
  await clickAt(noIndentCard.x, noIndentCard.y)
  await sleep(1200)
}
const after = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror > p')
  return { indent: Math.round(Number.parseFloat(getComputedStyle(p).textIndent)), profile: window.__ed.getJSON().content[0].attrs.numberingProfileId }
})()`)
check('clicking the no-indent profile assigns it', after.profile === 'profile-noindent',
  `profile ${JSON.stringify(after.profile)}`)
// Assert on the element that uses the setting, not on the stored setting.
check('and the paragraph actually loses its indent', after.indent === 0, `${after.indent}px`)

const normalCard = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.pdoc-heading-container .card')].find((c) => (c.querySelector('.title') || {}).textContent.trim() === 'Normal (Text)')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
})()`)
if (normalCard && normalCard.w > 0) {
  await clickAt(normalCard.x, normalCard.y)
  await sleep(1200)
}
const back = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror > p')
  return { indent: Math.round(Number.parseFloat(getComputedStyle(p).textIndent)), profile: window.__ed.getJSON().content[0].attrs.numberingProfileId }
})()`)
check('clicking back assigns the first profile again', back.profile === 'profile-paragraph',
  `profile ${JSON.stringify(back.profile)}`)
// The direction the user reported second, and the one a one-way test would miss.
check('and the indent comes back', back.indent >= 24, `${back.indent}px`)

console.log('\nCase C: the user\'s own steps - an empty document, a block, Enter, a second block')

// Typed and pressed for real. The fault this case exists for lived between the click handler and the
// command, so nothing that starts from a command can see it.
const typeText = async (text) => {
  for (const char of text) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char }, sessionId)
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char }, sessionId)
    await sleep(12)
  }
}
const pressEnter = async () => {
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  await sleep(400)
}

await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  await new Promise((r) => setTimeout(r, 1000))
  // Anything thrown out of a click handler stops the rest of it, so watch for it.
  window.__errors = []
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)))
  return true
})()`)

const firstBlock = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror > p')
  const r = p.getBoundingClientRect()
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }
})()`)
await clickAt(firstBlock.x, firstBlock.y)
await typeText('Blok pertama.')
await sleep(400)

const cardAt = async () => evaluate(`(() => {
  const el = [...document.querySelectorAll('.pdoc-heading-container .card')]
    .find((c) => (c.querySelector('.title') || {}).textContent.trim() === 'Normal-noindent')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
const readAll = async () => evaluate(`(() => [...document.querySelectorAll('.ProseMirror > p')].map((p, i) => ({
  indent: Math.round(Number.parseFloat(getComputedStyle(p).textIndent)),
  profile: (window.__ed.getJSON().content[i].attrs || {}).numberingProfileId,
})))()`)

let card = await cardAt()
if (card) { await clickAt(card.x, card.y); await sleep(1200) }
const firstApplied = await readAll()
check('the first block takes the profile', firstApplied[0]?.profile === 'profile-noindent',
  JSON.stringify(firstApplied))

// Back into the text, Enter, and a second block - which is where it failed.
const endOfFirst = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror > p')
  const r = p.getBoundingClientRect()
  return { x: Math.round(r.right - 8), y: Math.round(r.top + r.height / 2) }
})()`)
await clickAt(endOfFirst.x, endOfFirst.y)
await pressEnter()
await typeText('Blok kedua.')
await sleep(500)
const beforeSecond = await readAll()
check('Enter makes a second block, under the default profile',
  beforeSecond.length === 2 && beforeSecond[1]?.profile === 'profile-paragraph',
  JSON.stringify(beforeSecond))

card = await cardAt()
if (card) { await clickAt(card.x, card.y); await sleep(1400) }
const errors = await evaluate(`window.__errors`)
const afterSecond = await readAll()

// The fault: converting a paragraph to a paragraph runs `clearNodes` over the selection, which at the
// end of a document reaches the footnotes node and throws. The exception left the click handler
// before the profile was applied.
check('the click throws nothing', errors.length === 0, JSON.stringify(errors))
check('the second block takes the profile too', afterSecond[1]?.profile === 'profile-noindent',
  JSON.stringify(afterSecond))
check('and it actually loses its indent on screen', afterSecond[1]?.indent === 0,
  `${afterSecond[1]?.indent}px`)
check('while the first block is left where it was', afterSecond[0]?.profile === 'profile-noindent')

console.log('\nCase D: every profile is reachable in a strip that scrolls and stays where it is put')

await evaluate(`(async () => {
  // Enough profiles that they cannot all fit at once, which is the situation the strip exists for.
  const profiles = [
    { id: 'profile-paragraph', name: 'Normal (Text)', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: '2em' },
    { id: 'profile-noindent', name: 'Normal-noindent', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: 0 },
  ]
  for (let level = 1; level <= 6; level += 1) {
    profiles.push({ id: 'profile-h' + level, name: 'Title ' + level + ' (H' + level + ')', enabled: true, targetType: 'heading', level, style: 'numeric', template: '{number}', indent: 0 })
  }
  profiles.push({ id: 'profile-table', name: 'Tabel', enabled: true, targetType: 'table', style: 'numeric', template: 'Tabel {number}' })
  profiles.push({ id: 'profile-figure', name: 'Gambar', enabled: true, targetType: 'figure', style: 'numeric', template: 'Gambar {number}' })
  profiles.push({ id: 'profile-last', name: 'Paling Akhir', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: '4em' })
  window.__ed.commands.setNumberingConfig({ profiles })
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paragraf uji.' }] }] })
  await new Promise((r) => setTimeout(r, 1500))
  window.__ed.commands.setTextSelection(3)
  return true
})()`)

const strip = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container')
  if (!el) return null
  const names = [...el.querySelectorAll('.card')].map((c) => (c.querySelector('.title') || {}).textContent.trim())
  // Compared against the list the editor actually holds, not a number written here. The built-ins
  // are merged back in on every change, so a hardcoded count says more about this test than about
  // the strip.
  const stored = (window.__ed.extensionStorage.documentReferences.profiles || []).map((p) => p.name)
  return {
    cards: names.length,
    names,
    stored,
    missing: stored.filter((n) => !names.includes(n)),
    scrollWidth: Math.round(el.scrollWidth),
    clientWidth: Math.round(el.clientWidth),
    overflowX: getComputedStyle(el).overflowX,
    wrap: getComputedStyle(el).flexWrap,
  }
})()`)

// Four at a time meant a profile the writer uses constantly could sit behind the dropdown.
check('every profile the editor holds is in the strip',
  strip?.missing.length === 0 && strip?.cards === strip?.stored.length,
  `${strip?.cards} cards against ${strip?.stored.length} profiles, missing ${JSON.stringify(strip?.missing)}`)
check('the strip really does overflow, so scrolling is what reaches the rest',
  strip?.scrollWidth > strip?.clientWidth,
  `content ${strip?.scrollWidth}px in a box of ${strip?.clientWidth}px`)
check('it scrolls sideways rather than wrapping',
  strip?.overflowX === 'auto' && strip?.wrap === 'nowrap',
  `overflow-x ${strip?.overflowX}, flex-wrap ${strip?.wrap}`)

const arrow = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-toolbar-headding .arrow')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { width: Math.round(r.width), height: Math.round(r.height) }
})()`)
check('the dropdown button is wide enough to aim at', arrow?.width >= 28,
  `${arrow?.width}x${arrow?.height}px`)

// Which gestures actually move it, measured rather than assumed. I expected a plain vertical wheel
// to be mapped onto a container that only overflows horizontally; **it is not**, and finding that out
// by measuring is the difference between a strip the writer can reach and one they cannot.
const wheelTarget = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container')
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
const wheelBy = async (params) => {
  await evaluate(`(() => { document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container').scrollLeft = 0; return true })()`)
  await mouse('mouseMoved', wheelTarget.x, wheelTarget.y)
  // Let the reset settle before the wheel and the wheel settle before reading. Measured: back to
  // back wheel events with a scroll reset between them are coalesced, and one of them reads as
  // having done nothing when on its own it works.
  await sleep(250)
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelTarget.x, y: wheelTarget.y, deltaX: 0, deltaY: 0, ...params }, sessionId)
  await sleep(700)
  return evaluate(`Math.round(document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container').scrollLeft)`)
}
// **Only one wheel gesture can be asserted here.** Measured twice, both orders: whichever wheel
// event is dispatched second reads as having done nothing, because Chrome coalesces synthesized
// wheel events that arrive close together. Asserting on the second one would be asserting on the
// synthesizer.
//
// So one gesture is the check, and the other two are facts gathered from isolated probes and written
// down rather than tested:
//   shift with the wheel   scrolls it (measured alone: scrollLeft 200)
//   a plain vertical wheel does NOT scroll it - Chrome does not map a vertical wheel onto a
//                          container that only overflows horizontally, which is what I had assumed
//                          before measuring
const sideWheel = await wheelBy({ deltaX: 200 })
check('a sideways wheel or trackpad gesture scrolls the strip', sideWheel > 0,
  `scrollLeft ${sideWheel}`)
console.log('  NOTE  shift with the wheel also scrolls it, and a plain vertical wheel does not; both')
console.log('  NOTE  measured in isolated probes, because consecutive synthesized wheels coalesce')

const bar = await evaluate(`(() => { const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container'); return el.offsetHeight - el.clientHeight })()`)
check('there is a real scrollbar to drag', bar >= 8, `${bar}px of chrome below the cards`)

// Scrolled by hand, and left there. Nothing in the component may put it back.
const scrolled = await evaluate(`(async () => {
  const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container')
  el.scrollLeft = el.scrollWidth
  await new Promise((r) => setTimeout(r, 400))
  const atEnd = Math.round(el.scrollLeft)
  const last = [...el.querySelectorAll('.card')].pop()
  const lastRect = last.getBoundingClientRect()
  const stripRect = el.getBoundingClientRect()
  return {
    atEnd,
    lastName: (last.querySelector('.title') || {}).textContent.trim(),
    // The last card must be clear of the dropdown button, or it cannot be clicked.
    lastRight: Math.round(lastRect.right),
    stripRight: Math.round(stripRect.right),
    lastVisible: lastRect.left >= stripRect.left - 1 && lastRect.right <= stripRect.right + 1,
  }
})()`)
check('scrolling to the end brings the last profile into view',
  scrolled.atEnd > 0 && scrolled.lastVisible === true,
  `scrollLeft ${scrolled.atEnd}, last card ${JSON.stringify(scrolled.lastName)}`)

// Type into the document, which re-renders the toolbar, and check the strip did not jump back.
await evaluate(`(async () => {
  window.__ed.commands.insertContent(' lagi')
  await new Promise((r) => setTimeout(r, 900))
  return true
})()`)
const held = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-toolbar-headding .pdoc-heading-container')
  return Math.round(el.scrollLeft)
})()`)
check('and the strip stays where it was left, after the document changes',
  held === scrolled.atEnd, `${held} against ${scrolled.atEnd}`)

const lastCard = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.pdoc-toolbar-headding .pdoc-heading-container .card')]
    .find((c) => (c.querySelector('.title') || {}).textContent.trim() === 'Paling Akhir')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (lastCard) { await clickAt(lastCard.x, lastCard.y); await sleep(1200) }
const applied = await evaluate(`(() => {
  const p = document.querySelector('.ProseMirror > p')
  return { profile: window.__ed.getJSON().content[0].attrs.numberingProfileId, indent: Math.round(Number.parseFloat(getComputedStyle(p).textIndent)) }
})()`)
// Reachable is the point: a card scrolled into view has to work like any other.
check('a profile reached by scrolling can be applied', applied.profile === 'profile-last',
  `profile ${JSON.stringify(applied.profile)}`)
check('and it styles the block', applied.indent >= 50, `${applied.indent}px`)

console.log('\nCase E: a profile lands on every block the selection covers, cells included')

// What a block is, for a profile: a node of type paragraph, heading, image or table, wherever it
// sits. Not "a direct child of the document" - a paragraph inside a table cell is a paragraph like
// any other, which is why the class comes out on the `p` in the saved file and not on the cell.
const caseE = await evaluate(`(async () => {
  window.__ed.commands.setNumberingConfig({ profiles: [
    { id: 'profile-paragraph', name: 'Normal (Text)', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: '2em' },
    { id: 'profile-noindent', name: 'Normal-noindent', enabled: false, targetType: 'paragraph', style: 'numeric', template: '', indent: 0 },
    { id: 'profile-h1', name: 'Title 1 (H1)', enabled: true, targetType: 'heading', level: 1, style: 'numeric', template: '{number}', indent: 0 },
  ] })
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf satu.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf dua.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf tiga.' }] },
  ] })
  await new Promise((r) => setTimeout(r, 1500))
  const profiles = () => window.__ed.getJSON().content.map((n) => (n.attrs || {}).numberingProfileId)
  const before = profiles()
  // Select from inside the first paragraph to inside the third.
  const size = window.__ed.state.doc.content.size
  window.__ed.commands.setTextSelection({ from: 2, to: size - 2 })
  await new Promise((r) => setTimeout(r, 300))
  const ok = window.__ed.commands.applyNumberingProfile('profile-noindent')
  await new Promise((r) => setTimeout(r, 1000))
  const after = profiles()
  const indents = [...document.querySelectorAll('.ProseMirror > p')].map((p) => Math.round(Number.parseFloat(getComputedStyle(p).textIndent)))
  return { before, ok, after, indents }
})()`)

check('all three paragraphs start on the default profile',
  caseE.before.every((p) => p === 'profile-paragraph'), JSON.stringify(caseE.before))
// The fault reported: only the block under the cursor was touched, so a selection styled one block.
check('a selection across three paragraphs styles all three',
  caseE.after.every((p) => p === 'profile-noindent'), JSON.stringify(caseE.after))
check('and all three actually lose their indent on screen',
  caseE.indents.every((i) => i === 0), JSON.stringify(caseE.indents))

const caseTable = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sebelum tabel.' }] }] })
  await new Promise((r) => setTimeout(r, 800))
  window.__ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
  await new Promise((r) => setTimeout(r, 1200))

  // Every paragraph that lives inside the table.
  const cellParas = []
  window.__ed.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && parent && parent.type.name.startsWith('table')) cellParas.push(pos)
    return true
  })
  if (cellParas.length < 4) return { skipped: true, cellParas: cellParas.length }

  // A real cell selection, which is what dragging across cells produces: one range per cell. The
  // table extension builds it, so the test does not have to reach for ProseMirror internals.
  const cells = []
  window.__ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(pos)
    return true
  })
  let usedCellSelection = false
  if (cells.length >= 2 && window.__ed.commands.setCellSelection) {
    usedCellSelection = window.__ed.commands.setCellSelection({
      anchorCell: cells[0],
      headCell: cells[cells.length - 1],
    })
  }
  if (!usedCellSelection) {
    window.__ed.commands.setTextSelection({ from: cellParas[0], to: cellParas[cellParas.length - 1] + 2 })
  }
  await new Promise((r) => setTimeout(r, 300))
  const ok = window.__ed.commands.applyNumberingProfile('profile-noindent')
  await new Promise((r) => setTimeout(r, 1000))

  const applied = []
  window.__ed.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && parent && parent.type.name.startsWith('table')) applied.push(node.attrs.numberingProfileId)
    return true
  })
  const tableNode = window.__ed.getJSON().content.find((n) => n.type === 'table')
  return { skipped: false, usedCellSelection, ok, applied, cells: applied.length, tableProfile: (tableNode?.attrs || {}).numberingProfileId }
})()`)

check('the table fixture has four cells', caseTable.skipped === false,
  caseTable.skipped ? `only ${caseTable.cellParas} cell paragraphs` : `${caseTable.cells} cells`)
// The user's report: applying a profile with a table selected reached one cell.
check('a selection across the table styles every cell',
  caseTable.applied?.length > 0 && caseTable.applied.every((p) => p === 'profile-noindent'),
  JSON.stringify(caseTable.applied))
// A paragraph profile must not land on the table node, which has a profile of its own.
check('the table node itself is left alone',
  caseTable.tableProfile !== 'profile-noindent',
  `table profile ${JSON.stringify(caseTable.tableProfile)}`)

const caseMixed = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Judul.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Isi satu.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Isi dua.' }] },
  ] })
  await new Promise((r) => setTimeout(r, 1200))
  const size = window.__ed.state.doc.content.size
  window.__ed.commands.setTextSelection({ from: 2, to: size - 2 })
  await new Promise((r) => setTimeout(r, 300))
  window.__ed.commands.applyNumberingProfile('profile-noindent')
  await new Promise((r) => setTimeout(r, 1000))
  return window.__ed.getJSON().content.map((n) => ({ type: n.type, profile: (n.attrs || {}).numberingProfileId }))
})()`)
// A mixed run must not leave half of itself behind.
check('a selection mixing a heading with paragraphs reaches all of them',
  caseMixed.every((n) => n.profile === 'profile-noindent'), JSON.stringify(caseMixed))

// A plain cursor must still behave as it did: one block, the one it is in.
const caseCursor = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Satu.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Dua.' }] },
  ] })
  await new Promise((r) => setTimeout(r, 1000))
  window.__ed.commands.setTextSelection(3)
  window.__ed.commands.applyNumberingProfile('profile-noindent')
  await new Promise((r) => setTimeout(r, 900))
  return window.__ed.getJSON().content.map((n) => (n.attrs || {}).numberingProfileId)
})()`)
check('a cursor with nothing selected still styles only its own block',
  caseCursor[0] === 'profile-noindent' && caseCursor[1] === 'profile-paragraph',
  JSON.stringify(caseCursor))

console.log(`\n${failures.length === 0 ? 'RESULT: PASSED -- a block can be moved between two profiles of the same kind.' : `RESULT: FAILED -- ${failures.length} check(s)`}`)
for (const f of failures) console.log(`  - ${f}`)
await finish(failures.length === 0 ? 0 : 1)
