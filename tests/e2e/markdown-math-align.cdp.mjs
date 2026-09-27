/**
 * A display formula in a markdown block sits where Block Math's Alignment puts it, with the space
 * Block Math's margins give it and no other.
 *
 * Reported by the writer: Alignment set to `left` in Markdown Styles, and the formula stayed in the
 * middle. The formula was centred by `justify-content: center` on a flex container, and `text-align`
 * - the property the dialog writes - does nothing to a flex item. A setting that shows in the dialog
 * and does nothing on the page is a control the writer cannot use.
 *
 * The space above and below a formula was padding inside it, which nothing could change. It is Block
 * Math's Top and Bottom Margin now, starting at 0.5em, shown in the dialog and changed there.
 *
 * Driven by the mouse and the keyboard throughout: typing the fixture, the ribbon's Markdown Block
 * button, a click into the source, the Markdown Styles dialog. Nothing here calls an editor command.
 * The source is written with `Input.insertText`, the keyboard as a textarea sees it (ADR 0012,
 * amendment 4).
 *
 * Its own fixture. It never opens a stored document, and it puts back the localStorage keys the
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

// The window itself is made big enough for the ribbon, rather than the rendering being overridden:
// a control measured at an x the window cannot show is a control no dispatched click can reach.
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
  await shoot('markdown-math-align-failure.png').catch(() => {})
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

// A blank page to write the fixture on. The keys are put back in `finish`, and the browser's
// leave-site prompt is answered rather than left to block the reload.
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
// Input. Real events only.
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

// The centre of an element once it is on screen, with a check that a click there lands on it.
const centreOf = async (expression) => {
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

const buttonByText = (text) =>
  `[...document.querySelectorAll('.pdoc-menu-button, .pdoc-ribbon button, button')]` +
  `.filter((el) => el.offsetParent && (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})` +
  `.sort((a, b) => a.textContent.length - b.textContent.length)[0]`
const ribbonTab = (name) =>
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')]` +
  `.find((el) => (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(name)})`
const paragraphByText = (text) =>
  `[...document.querySelectorAll('.pdoc-page-content p')]` +
  `.find((el) => (el.textContent || '').includes(${JSON.stringify(text)}))`
const dialogSection = (name) =>
  `[...document.querySelectorAll('.pdoc-markdown-styles-section')]` +
  `.find((el) => el.offsetParent && el.textContent.trim() === ${JSON.stringify(name)})`
const dialogField = (label) =>
  `[...document.querySelectorAll('.pdoc-markdown-styles-form .t-form__item, .pdoc-markdown-styles-form [class*="form__item"]')]` +
  `.filter((el) => el.offsetParent)` +
  `.find((el) => (el.querySelector('label, [class*="form__label"]')?.textContent || '').trim() === ${JSON.stringify(label)})` +
  `?.querySelector('input')`

// Set one field of the section on show: click the field, type, press Enter - the field commits on
// Enter or blur, and a value left sitting there is not a setting yet.
const setField = async (label, value) => {
  await clickElement(`the ${label} field`, dialogField(label))
  await typeText(value)
  await key('Enter', 13)
  await sleep(900)
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// Where the formula sits inside its own block, read off the box KaTeX draws.
const formulaPlace = () => evaluate(`(() => {
  const block = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered [data-type="block-math"]')
  const drawn = block?.querySelector('.katex')
  if (!block || !drawn) return { error: block ? 'NO_KATEX' : 'NO_BLOCK_MATH' }
  const outer = block.getBoundingClientRect()
  const inner = drawn.getBoundingClientRect()
  const s = getComputedStyle(block)
  const pad = getComputedStyle(block.querySelector('.block-math-inner'))
  const all = [...document.querySelectorAll('.pdoc-node-markdown-block .pdoc-markdown-rendered [data-type="block-math"]')]
  return {
    count: all.length,
    // KaTeX states each formula's height and depth as a strut; a strut reaching past the wrapper is
    // ink its overflow cuts off. The padding that went used to give it room, so a fraction losing its
    // denominator would show here. Not scrollHeight: that counts glyph boxes, which reach 2px further
    // than the ink - measured, and the denominator was whole on the screenshot.
    clipped: all.filter((el) => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('.strut')].some((strut) => {
        const r = strut.getBoundingClientRect()
        return r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5
      })
    }).length,
    padding: [pad.paddingTop, pad.paddingRight, pad.paddingBottom, pad.paddingLeft, s.paddingTop, s.paddingBottom].join(' '),
    marginTop: s.marginTop,
    marginBottom: s.marginBottom,
    halfEm: (Number.parseFloat(s.fontSize) / 2) + 'px',
    width: Math.round(outer.width),
    formula: Math.round(inner.width),
    left: Math.round(inner.left - outer.left),
    right: Math.round(outer.right - inner.right),
  }
})()`)

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a display formula is centred until the writer says otherwise')

const body = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(body && !body.hidden, 'the editor body was not on screen')
await clickAt(body.x, body.y - 200)
await sleep(300)
await typeText('Paragraf pembuka\n')
await sleep(300)
await typeText('Persamaan latensi\n')
await sleep(300)
await typeText('Paragraf penutup')
await sleep(1200)

await clickElement('the paragraph to be made markdown', paragraphByText('Persamaan latensi'))
await sleep(300)
await clickElement('the Markdown Block button in the ribbon', buttonByText('Markdown Block'))
await sleep(1500)
await clickElement('the markdown block, to open its source',
  `document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')`)
await sleep(800)
const sourceBox = await evaluate(`(() => {
  const el = document.querySelector('.pdoc-node-markdown-block textarea')
  if (!el || !el.offsetParent) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.right - 8), y: Math.round(r.top + 10) }
})()`)
assert.ok(sourceBox, 'the markdown source did not open')
await clickAt(sourceBox.x, sourceBox.y)
await sleep(400)
await call('Input.insertText', {
  text: ['', '', '$$ L_{comm} = L_{total} - L_{HW} $$', '', '$$ Throughput = \\frac{1}{L_{total}} $$'].join('\n'),
}, sessionId)
await sleep(600)
// Left by clicking the paragraph above, not the one below: a focused block paints its highlight 5px
// past its own edges, and one right under the formula would cover the formula's last pixels.
await clickElement('the opening paragraph, to leave the block', paragraphByText('Paragraf pembuka'))
await sleep(2000)

let place = await formulaPlace()
check('the markdown block rendered a display formula', !place.error && place.formula > 0,
  place.error || JSON.stringify(place))
check('both formulas rendered', place.count === 2, `${place.count}`)
check('a formula carries no padding of its own', /^(0px ?){6}$/.test(place.padding.trim()), place.padding)
check('it has Block Math\'s default margins, 0.5em above and below',
  place.marginTop === place.halfEm && place.marginBottom === place.halfEm,
  `${place.marginTop} / ${place.marginBottom}, 0.5em is ${place.halfEm}`)
check('nothing KaTeX drew is cut off, the fraction included', place.clipped === 0, `${place.clipped} clipped`)
await shoot('markdown-math-default.png')
check('by default it sits in the middle of its block', !place.error && place.left > 20 &&
  Math.abs(place.left - place.right) <= 2, JSON.stringify(place))

// The Block Math section of the dialog, opened the way the writer opens it.
const openBlockMath = async () => {
  await clickElement('the Home tab of the ribbon', ribbonTab('home'))
  await sleep(500)
  await clickElement('the Markdown Styles button', buttonByText('Markdown Styles'))
  await sleep(900)
  await clickElement('the Block Math section', dialogSection('Block Math'))
  await sleep(400)
}
const closeDialog = async () => {
  await key('Escape', 27)
  await sleep(1000)
}
const fieldValue = (label) => evaluate(`(${dialogField(label)})?.value ?? null`)
// Whatever the field held goes first: select it all, then type over it - or, for an empty value,
// delete it - and press Enter, which is when the field commits.
const replaceField = async (label, value) => {
  await clickElement(`the ${label} field`, dialogField(label))
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, sessionId)
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, sessionId)
  if (value) await typeText(value)
  else await key('Backspace', 8)
  await key('Enter', 13)
  await sleep(900)
}
const setAlignment = async (value) => {
  await openBlockMath()
  await replaceField('Alignment', value)
  await closeDialog()
}

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: Alignment left puts it at the left edge, with nothing in between')
await setAlignment('left')
place = await formulaPlace()
check('the formula starts at the left edge of its block', !place.error && place.left === 0,
  JSON.stringify(place))
await shoot('markdown-math-align-left.png')

// ---------------------------------------------------------------------------------------------
console.log('\nCase C: and right puts it at the right edge')
await setAlignment('right')
place = await formulaPlace()
check('the formula ends at the right edge of its block', !place.error && place.right === 0,
  JSON.stringify(place))

// ---------------------------------------------------------------------------------------------
console.log('\nCase D: the margins are settings - shown, changed, and back to 0.5em when emptied')
await openBlockMath()
const shownTop = await fieldValue('Top Margin')
const shownBottom = await fieldValue('Bottom Margin')
check('the dialog shows the default margins as values', shownTop === '0.5em' && shownBottom === '0.5em',
  `top ${JSON.stringify(shownTop)}, bottom ${JSON.stringify(shownBottom)}`)
const dotBefore = await evaluate(`!!(${dialogSection('Block Math')})?.querySelector('.pdoc-markdown-styles-dot')`)
await replaceField('Top Margin', '0')
await replaceField('Bottom Margin', '')
const afterEmpty = await fieldValue('Bottom Margin')
check('a field emptied goes back to its default, and shows it', afterEmpty === '0.5em', JSON.stringify(afterEmpty))
await closeDialog()
place = await formulaPlace()
check('Top Margin 0 takes the space above away', place.marginTop === '0px', place.marginTop)
check('and the emptied Bottom Margin is 0.5em again', place.marginBottom === place.halfEm,
  `${place.marginBottom}, 0.5em is ${place.halfEm}`)
// The alignment set above is a change of the writer's, so the dot was there already; what matters is
// that defaults alone never put one there, which the unit test covers. Reported for the record.
console.log(`  (Block Math marked as changed before this case: ${dotBefore})`)

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a display formula in markdown sits where Block Math aligns it.')
await finish(0)
