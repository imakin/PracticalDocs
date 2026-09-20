/**
 * A cross-reference can be written inside a markdown block, and it keeps up with the numbering.
 *
 * The block's source is the truth (ADR 0012), so the rendered half is thrown away and built again on
 * every edit. A cross-reference node inserted straight into that half would survive exactly until
 * the next keystroke in the source. The reference therefore has to live in the markdown, as
 * `[[ref:id]]`, and become a real `crossReference` node when the source renders - which is the only
 * way the same sync that renumbers every other reference reaches this one too.
 *
 * Driven by the mouse and the keyboard throughout: the toolbar button, the block, the caret in the
 * source, the dialog's dropdown, the Insert button. Nothing here calls an editor command, because
 * the fault this guards against is a reference that works when a command inserts it and does not
 * when a writer does.
 *
 * Its own fixture. It never opens a stored document, and it puts back the two localStorage keys the
 * editor persists into.
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

// The window itself is made big enough for the ribbon, rather than the rendering being overridden.
// A device metrics override makes the page lay out for a viewport the window does not have, and a
// control measured at an x the window cannot show is a control no dispatched click can reach.
const { windowId } = await call('Browser.getWindowForTarget', { targetId }).catch(() => ({}))
if (windowId !== undefined) {
  await call('Browser.setWindowBounds', {
    windowId, bounds: { windowState: 'normal', left: 0, top: 0, width: 1680, height: 1050 },
  }).catch(() => {})
}

const PERSISTED_KEYS = ['practicaldocs:default:document', 'practicaldocs:profiles']
let persistedBefore = null
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}
const shoot = async (name) => {
  const { data } = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, name), Buffer.from(data, 'base64'))
}
const finish = async (code) => {
  if (persistedBefore) {
    await evaluate(`(() => {
      const saved = ${JSON.stringify(persistedBefore)}
      for (const [k, v] of Object.entries(saved)) {
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v)
      }
      return true
    })()`).catch(() => {})
  }
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await shoot('markdown-cross-reference-failure.png').catch(() => {})
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2500)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

// A blank page to write the fixture on. The editor keeps the default document in localStorage, so a
// tab opened after any previous session starts with whatever that session left behind - and a test
// that types into someone else's paragraphs is measuring a document it did not build.
//
// The keys are put back in `finish`, and the browser's leave-site prompt is answered rather than
// left to block the reload, which is how an earlier run of this kind hung to a timeout.
await call('Page.setBypassCSP', { enabled: true }, sessionId).catch(() => {})
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.method === 'Page.javascriptDialogOpening') {
    call('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {})
  }
})
await evaluate(`(() => {
  for (const k of ${JSON.stringify(PERSISTED_KEYS)}) localStorage.removeItem(k)
  return true
})()`)
await call('Page.reload', { ignoreCache: false }, sessionId)
for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`).catch(() => false)) break
  await sleep(200)
}
await sleep(3000)
const startedEmpty = await evaluate(`(document.querySelector('.ProseMirror')?.textContent || '').trim()`)
assert.equal(startedEmpty, '', `the document did not start empty: ${JSON.stringify(startedEmpty)}`)

// ---------------------------------------------------------------------------------------------
// Input. Real events only: the DragHandle, the ribbon and TDesign's dropdown all listen for the
// pointer, and a dispatched click on an element reference would prove nothing about any of them.
// ---------------------------------------------------------------------------------------------
const mouse = (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount,
    buttons: button === 'left' && type === 'mousePressed' ? 1 : 0,
  }, sessionId)
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', 1)
  await mouse('mouseReleased', x, y, 'left', 1)
  await sleep(300)
}
const key = async (name, keyCode) =>
  call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  }, sessionId).then(() =>
    call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    }, sessionId))
const typeText = async (text) => {
  for (const char of text) {
    if (char === '\n') {
      await key('Enter', 13)
    } else {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char }, sessionId)
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char }, sessionId)
    }
    await sleep(25)
  }
}

/**
 * The centre of an element, once it is on screen, with a check that the click will actually land on
 * it. Without the check a control scrolled under the ribbon takes every click silently and the test
 * reports a feature working that nobody can reach.
 */
const centreOf = async (expression) => {
  // Two steps, and a wait between them. The editor scrolls smoothly, so a rect read in the same
  // call as the scroll request is the position the element is leaving, not the one it arrives at -
  // measured at y=144, under the ribbon, for a paragraph that ended up in the middle of the page.
  await evaluate(`(() => {
    const el = ${expression}
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
    return true
  })()`)
  await sleep(300)
  return evaluate(`(() => {
    const el = ${expression}
    if (!el) return null
    const box = el.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return { hidden: true }
    // On the words, not on the middle of the box. A paragraph's box spans the whole column, so its
    // centre can sit past the end of the text, over a widget or an empty stretch that belongs to
    // some other element - and a click there lands somewhere the writer would never click.
    let r = box
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let textNode
    while ((textNode = walker.nextNode())) {
      if (!textNode.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const rect = [...range.getClientRects()].find((c) => c.width > 0 && c.height > 0)
      if (rect) { r = rect; break }
    }
    const x = Math.round(r.left + Math.min(r.width / 2, 40))
    const y = Math.round(r.top + r.height / 2)
    const at = document.elementFromPoint(x, y)
    return {
      x, y,
      covered: !(at === el || el.contains(at) || at?.contains(el)),
      at: at ? at.tagName + '.' + String(at.className).slice(0, 40) : null,
    }
  })()`)
}

const clickElement = async (label, expression) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const spot = await centreOf(expression)
    if (spot && !spot.hidden && !spot.covered) {
      await clickAt(spot.x, spot.y)
      return spot
    }
    await sleep(400)
  }
  const spot = await centreOf(expression)
  throw new Error(`${label}: nothing clickable (${JSON.stringify(spot)}) for ${expression}`)
}

// A control named by the words on it, the way the writer finds it.
const buttonByText = (text) =>
  `[...document.querySelectorAll('.pdoc-menu-button, .pdoc-ribbon button, button')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})`

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const docState = () => evaluate(`(() => {
  const block = document.querySelector('.pdoc-node-markdown-block')
  const anchors = [...document.querySelectorAll('.pdoc-node-markdown-block a[data-type="cross-reference"]')]
  // The number a heading wears is a widget, drawn beside the text rather than typed into it, so it
  // is read on its own. It is what the reference has to agree with.
  const headings = [...document.querySelectorAll('.pdoc-page-content h1')].map((h) => ({
    number: h.querySelector('.pdoc-heading-number')?.textContent.trim() ?? '',
    text: [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
  }))
  return {
    source: block?.querySelector('textarea')?.value ?? null,
    stored: block?.querySelector('pre[data-markdown-source]')?.textContent ?? null,
    headings,
    anchors: anchors.map((a) => ({
      text: a.textContent.trim(),
      targetId: a.getAttribute('data-target-id'),
      missing: a.getAttribute('data-missing'),
    })),
  }
})()`)

const profileCard = (name) =>
  `[...document.querySelectorAll('.pdoc-heading-container .card')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim().startsWith(${JSON.stringify(name)}))`

const ribbonTab = (name) =>
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')]` +
  `.find((el) => (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(name)})`

const paragraphByText = (text) =>
  `[...document.querySelectorAll('.pdoc-page-content p, .pdoc-page-content h1')]` +
  `.find((el) => (el.textContent || '').includes(${JSON.stringify(text)}))`

// ---------------------------------------------------------------------------------------------
// The fixture, typed into an empty document and styled with the profile strip - the same two
// controls a writer uses. Nothing here is a command.
// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a paragraph typed by hand becomes a numbered heading and a markdown block')

const body = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(body && !body.hidden, 'the editor body was not on screen')
await clickAt(body.x, body.y - 200)
await sleep(300)

await typeText('Pendahuluan\n')
await sleep(400)
await typeText('Metodologi Penelitian\n')
await sleep(400)
await typeText('Rinciannya ada di \n')
await sleep(400)
await typeText('Lihat juga ')
await sleep(1200)

// The middle paragraph becomes the heading this test points at.
await clickElement('the paragraph to be made a heading', paragraphByText('Metodologi Penelitian'))
await sleep(300)
await clickElement('the Title 1 profile card', profileCard('Title 1 (H1)'))
await sleep(1800)

let state = await docState()
const target = state.headings.find((h) => h.text.includes('Metodologi'))
check('the middle paragraph is a numbered heading', !!target?.number, JSON.stringify(state.headings))

await clickElement('the last paragraph', paragraphByText('Rinciannya ada di'))
await sleep(300)
await clickElement('the Markdown Block button in the ribbon', buttonByText('Markdown Block'))
await sleep(1500)

state = await docState()
check('the paragraph is now a markdown block carrying what was typed',
  state.source !== null && state.source.includes('Rinciannya ada di'),
  `source: ${JSON.stringify(state.source)}`)

// ---------------------------------------------------------------------------------------------
// The caret goes to the end of the source by clicking there, and the dialog is driven by mouse.
// ---------------------------------------------------------------------------------------------
console.log('\nCase B: the Cross-reference dialog writes into the markdown at the caret')

// Clicking the block is how its source opens: the rendered half is a view, and a press on it selects
// the node. Converting a paragraph does not open anything, so this is the writer's next move too.
await clickElement('the markdown block, to open its source',
  `document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')`)
await sleep(800)

// Click past the last character on that line: a click inside a textarea puts the caret at the
// nearest offset, which for a click to the right of the text is the end of the line.
const sourceBox = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-node-markdown-block textarea')
  if (!el || !el.offsetParent) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.right - 8), y: Math.round(r.top + 10) }
})()`)
assert.ok(sourceBox, 'the markdown source panel did not open when the block was made')
await clickAt(sourceBox.x, sourceBox.y)
await sleep(400)
const caret = await evaluate(`document.querySelector('.pdoc-node-markdown-block textarea')?.selectionStart ?? -1`)
check('the caret is at the end of the markdown the writer typed', caret === 18, `offset ${caret}`)

await clickElement('the Insert tab of the ribbon', ribbonTab('insert'))
await sleep(700)
await clickElement('the Cross-reference button', buttonByText('Cross-reference'))
await sleep(1000)

const dialogOpen = await evaluate(`!!document.querySelector('.pdoc-cross-reference-form')`)
check('the dialog opened', dialogOpen === true)

const hint = await evaluate(`(document.querySelector('.pdoc-cross-reference-empty')?.textContent || '').trim()`)
check('the dialog says the reference will be written as markdown, before it is written',
  /\[\[ref:/.test(hint), JSON.stringify(hint))

await clickElement('the target dropdown', `document.querySelector('.pdoc-cross-reference-form input')`)
await sleep(800)
const optionLabels = await evaluate(`JSON.stringify(
  [...document.querySelectorAll('[class*="select-option"]')].filter((el) => el.offsetParent)
    .map((el) => el.textContent.trim()))`)
check('the heading is offered as a target', /Metodologi/.test(optionLabels), optionLabels)

await clickElement('the heading in the target list',
  `[...document.querySelectorAll('[class*="select-option"]')]` +
  `.filter((el) => el.offsetParent).find((el) => (el.textContent || '').includes('Metodologi'))`)
await sleep(600)
await clickElement('the Insert Reference button', buttonByText('Insert Reference'))
await sleep(2000)

const dialogAfter = await evaluate(`(() => {
  const form = document.querySelector('.pdoc-cross-reference-form')
  const holder = document.querySelector('.t-dialog__position, [class*="dialog__position"]')
  return {
    formVisible: !!(form && form.offsetParent),
    holderVisible: !!(holder && holder.offsetParent),
    holderStyle: holder ? getComputedStyle(holder).pointerEvents + '/' + getComputedStyle(holder).display : null,
  }
})()`)
check('the dialog closed once the reference was inserted',
  dialogAfter.formVisible === false && dialogAfter.holderVisible === false,
  JSON.stringify(dialogAfter))

state = await docState()
check('the markdown gained a reference token', /\[\[ref:[^\]]+\]\]/.test(state.source || ''),
  `source: ${JSON.stringify(state.source)}`)
check('it was written where the caret was, at the end of the line',
  /Rinciannya ada di \[\[ref:/.test(state.source || ''),
  `source: ${JSON.stringify(state.source)}`)
check('the token rendered into a real cross-reference node', state.anchors.length === 1,
  `${state.anchors.length} anchors`)
check('the reference found its target', state.anchors[0]?.missing === 'false',
  JSON.stringify(state.anchors[0]))

const numberNow = state.headings.find((h) => h.text.includes('Metodologi'))?.number
check('the reference shows the number the heading is wearing',
  !!numberNow && state.anchors[0]?.text === numberNow,
  `reference ${JSON.stringify(state.anchors[0]?.text)} against heading ${JSON.stringify(numberNow)}`)

await shoot('markdown-cross-reference-inserted.png')
const before = state.anchors[0]?.text

// ---------------------------------------------------------------------------------------------
// The whole point: the number moves when the document does.
// ---------------------------------------------------------------------------------------------
console.log('\nCase C: promoting an earlier paragraph renumbers the reference inside the markdown')

// The profile strip lives on the Home tab, and the ribbon is still showing Insert.
await clickElement('the Home tab of the ribbon', ribbonTab('home'))
await sleep(600)
await clickElement('the first paragraph', paragraphByText('Pendahuluan'))
await sleep(300)
await clickElement('the Title 1 profile card again', profileCard('Title 1 (H1)'))
await sleep(2500)

state = await docState()
const promoted = state.headings.find((h) => h.text.includes('Pendahuluan'))
const targetAfter = state.headings.find((h) => h.text.includes('Metodologi'))
check('there are two numbered headings now', !!promoted?.number && !!targetAfter?.number,
  JSON.stringify(state.headings))
check('the target took the second number', targetAfter?.number !== before,
  `${JSON.stringify(before)} -> ${JSON.stringify(targetAfter?.number)}`)
check('the reference inside the markdown followed it',
  state.anchors[0]?.text === targetAfter?.number,
  `reference ${JSON.stringify(state.anchors[0]?.text)} against heading ${JSON.stringify(targetAfter?.number)}`)
check('the markdown source still holds the token and no number',
  /\[\[ref:[^\]]+\]\]/.test(state.source || '') &&
    !(state.source || '').includes(String(targetAfter?.number)),
  `source: ${JSON.stringify(state.source)}`)

await shoot('markdown-cross-reference-renumbered.png')

// ---------------------------------------------------------------------------------------------
// The ordinary route has to keep working. Everything above changed how a reference is inserted and
// how the anchor it produces is parsed, and the route most documents use is the one that was here
// first: the cursor in a paragraph, the same dialog, the node inserted directly.
// ---------------------------------------------------------------------------------------------
console.log('\nCase D: a reference inserted outside a markdown block is unaffected')

const plainAnchors = () => evaluate(`(() => {
  const inMarkdown = document.querySelector('.pdoc-node-markdown-block')
  return [...document.querySelectorAll('.pdoc-page-content a[data-type="cross-reference"]')]
    .filter((a) => !inMarkdown || !inMarkdown.contains(a))
    .map((a) => ({ text: a.textContent.trim(), missing: a.getAttribute('data-missing') }))
})()`)

await clickElement('the plain paragraph at the end', paragraphByText('Lihat juga'))
await sleep(300)
await key('End', 35)
await clickElement('the Insert tab of the ribbon', ribbonTab('insert'))
await sleep(600)
await clickElement('the Cross-reference button', buttonByText('Cross-reference'))
await sleep(1000)
const hintOutside = await evaluate(`document.querySelector('.pdoc-cross-reference-empty') === null`)
check('outside a markdown block the dialog says nothing about markdown', hintOutside === true)
await clickElement('the target dropdown', `document.querySelector('.pdoc-cross-reference-form input')`)
await sleep(800)
await clickElement('the heading in the target list',
  `[...document.querySelectorAll('[class*="select-option"]')]` +
  `.filter((el) => el.offsetParent).find((el) => (el.textContent || '').includes('Metodologi'))`)
await sleep(600)
await clickElement('the Insert Reference button', buttonByText('Insert Reference'))
await sleep(1500)

let plain = await plainAnchors()
check('the ordinary insert still puts a live reference in the paragraph',
  plain.length === 1 && plain[0].missing === 'false' && plain[0].text === state.anchors[0]?.text,
  JSON.stringify(plain))

await shoot('markdown-cross-reference-plain.png')

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a cross-reference written in markdown is a real reference and keeps up with the numbering.')
await finish(0)
