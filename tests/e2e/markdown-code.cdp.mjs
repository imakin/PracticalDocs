/**
 * Code inside a markdown block wears nothing the writer did not set, and Markdown Styles sets it.
 *
 * Reported by the writer with a screenshot: a fenced block inside a markdown block came out as the
 * ordinary code block - a toolbar with a language picker, a theme picker, wrap, copy and delete, a
 * border, a padded box - and inline code wore the editor's grey tint, blue colour, padding and
 * margin. Chrome on a line of the page nobody wrote, and spacing nobody could set, in a block whose
 * rendered half is not even typeable (ADR 0012).
 *
 * Driven by the mouse and the keyboard throughout: typing the fixture, the ribbon's Markdown Block
 * button, a click into the source, the Markdown Styles dialog. Nothing here calls an editor command.
 * The source is written with `Input.insertText`, which is the keyboard as a textarea sees it and has
 * no race with the block's Vue draft (ADR 0012, amendment 4).
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
  await shoot('markdown-code-failure.png').catch(() => {})
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

// What the writer sees of the code in the markdown block, read off the elements that carry it.
const codeState = () => evaluate(`(() => {
  const scope = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')
  if (!scope) return { error: 'NO_MARKDOWN_BLOCK' }
  const pre = scope.querySelector('pre')
  const inner = pre?.querySelector('code')
  const inline = [...scope.querySelectorAll('code')].find((el) => !el.closest('pre'))
  const paragraph = inline?.closest('p')
  const box = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      margin: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].join(' '),
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
      border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join(' '),
      background: s.backgroundColor,
      color: s.color,
      family: s.fontFamily,
      size: s.fontSize,
    }
  }
  return {
    // Anything the ordinary code block node view draws, anywhere inside the markdown.
    chrome: scope.querySelectorAll('.pdoc-code-block, .pdoc-node-code-block-toolbar, .pdoc-menu-button, button, select').length,
    preText: pre?.textContent ?? null,
    pre: box(pre),
    inner: box(inner),
    inline: box(inline),
    paragraph: box(paragraph),
  }
})()`)

const ZERO_BOX = '0px 0px 0px 0px'
const CLEAR = 'rgba(0, 0, 0, 0)'
const firstFace = (family) => String(family || '').split(',')[0].replace(/["']/g, '').trim()

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a fence in a markdown block draws as its code and nothing else')

const body = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(body && !body.hidden, 'the editor body was not on screen')
await clickAt(body.x, body.y - 200)
await sleep(300)
await typeText('Paragraf pembuka\n')
await sleep(300)
await typeText('Tahap menghubungkan\n')
await sleep(300)
await typeText('Paragraf penutup')
await sleep(1200)

await clickElement('the paragraph to be made markdown', paragraphByText('menghubungkan'))
await sleep(300)
await clickElement('the Markdown Block button in the ribbon', buttonByText('Markdown Block'))
await sleep(1500)

// Clicking the rendered half selects the block, which opens its source; a click past the end of the
// first line puts the caret at the end of what was typed.
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
// Inline code is written here rather than typed into the paragraph: typing a backtick pair in the
// editor is the Code mark's input rule, which eats the backticks before the paragraph is converted.
const FENCE = [' lewat `DATAFLOW`', '', '```', 'void mc2h(int a) {', '    return a;', '}', '```'].join('\n')
await call('Input.insertText', { text: FENCE }, sessionId)
await sleep(600)

// Leaving the block renders it.
await clickElement('the closing paragraph, to leave the block', paragraphByText('Paragraf penutup'))
await sleep(2000)

let state = await codeState()
check('the markdown block rendered a code block', !state.error && state.preText?.includes('return a;'),
  state.error || JSON.stringify(state.preText))
check('no toolbar, picker or button is drawn inside the markdown', state.chrome === 0, `${state.chrome} elements`)
check('the code block has no margin', state.pre?.margin === ZERO_BOX, state.pre?.margin)
check('no padding', state.pre?.padding === ZERO_BOX && state.inner?.padding === ZERO_BOX,
  `pre ${state.pre?.padding}, code ${state.inner?.padding}`)
check('no border', state.pre?.border === ZERO_BOX && state.inner?.border === ZERO_BOX,
  `pre ${state.pre?.border}, code ${state.inner?.border}`)
check('no background', state.pre?.background === CLEAR && state.inner?.background === CLEAR,
  `pre ${state.pre?.background}, code ${state.inner?.background}`)
check('the code keeps the text colour of the block', state.inner?.color === state.pre?.color &&
  state.pre?.color === state.paragraph?.color,
  `code ${state.inner?.color}, pre ${state.pre?.color}, paragraph ${state.paragraph?.color}`)

check('inline code has no tint', state.inline?.background === CLEAR, state.inline?.background)
check('inline code has no padding or margin',
  state.inline?.padding === ZERO_BOX && state.inline?.margin === ZERO_BOX,
  `padding ${state.inline?.padding}, margin ${state.inline?.margin}`)
check('inline code is in the colour of its sentence', state.inline?.color === state.paragraph?.color,
  `code ${state.inline?.color}, paragraph ${state.paragraph?.color}`)

await shoot('markdown-code-plain.png')

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: Markdown Styles sets the code block and inline code, separately')

await clickElement('the Home tab of the ribbon', ribbonTab('home'))
await sleep(500)
await clickElement('the Markdown Styles button', buttonByText('Markdown Styles'))
await sleep(900)

await clickElement('the Code Block section', dialogSection('Code Block'))
await sleep(400)
await setField('Font Family', 'Courier New')
await setField('Font Size', '10pt')
await setField('Top Margin', '12px')

await clickElement('the Inline Code section', dialogSection('Inline Code'))
await sleep(400)
const inlineFields = await evaluate(`[...document.querySelectorAll('.pdoc-markdown-styles-form label, .pdoc-markdown-styles-form [class*="form__label"]')]
  .filter((el) => el.offsetParent).map((el) => el.textContent.trim())`)
check('Inline Code is not offered margins', !inlineFields.includes('Top Margin') && inlineFields.includes('Font Size'),
  JSON.stringify(inlineFields))
await setField('Font Size', '9pt')

await key('Escape', 27)
await sleep(1000)

state = await codeState()
check('the code block takes the face that was set', firstFace(state.pre?.family) === 'Courier New',
  state.pre?.family)
check('and so does the code inside it', firstFace(state.inner?.family) === 'Courier New', state.inner?.family)
check('the code block takes the size that was set', state.inner?.size === '13.3333px', state.inner?.size)
check('the code block takes the margin that was set', state.pre?.margin.startsWith('12px '), state.pre?.margin)
check('inline code takes its own size', state.inline?.size === '12px', state.inline?.size)
check('and the code block did not take the inline size', state.inner?.size !== state.inline?.size,
  `block ${state.inner?.size}, inline ${state.inline?.size}`)

await shoot('markdown-code-styled.png')

// ---------------------------------------------------------------------------------------------
// The ordinary code block keeps what it had. Only the one inside markdown changed.
// ---------------------------------------------------------------------------------------------
console.log('\nCase C: a code block outside a markdown block is unchanged')

await clickElement('the closing paragraph', paragraphByText('Paragraf penutup'))
await sleep(300)
await key('End', 35)
await clickElement('the Insert tab of the ribbon', ribbonTab('insert'))
await sleep(600)
await clickElement('the Code Block button', buttonByText('Code Block'))
await sleep(1500)
const ordinary = await evaluate(`(() => {
  const inMarkdown = document.querySelector('.pdoc-node-markdown-block')
  const blocks = [...document.querySelectorAll('.pdoc-page-content .pdoc-code-block')]
    .filter((el) => !inMarkdown || !inMarkdown.contains(el))
  return { count: blocks.length, toolbar: !!blocks[0]?.querySelector('.pdoc-node-code-block-toolbar') }
})()`)
check('the ordinary code block still has its toolbar', ordinary.count === 1 && ordinary.toolbar,
  JSON.stringify(ordinary))

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- code in a markdown block is plain, and Markdown Styles sets it.')
await finish(0)
