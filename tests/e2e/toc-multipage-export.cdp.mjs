/**
 * A table of contents longer than one page keeps the pages honest, on screen and in the PDF.
 *
 * The contents places its own rows, because the engine has no document position inside it to anchor
 * a break to (adr/0022). It used to do that by putting a top margin on the row that opens the next
 * page - a boundary nothing else in the product could see. Everything downstream of a page boundary
 * is built from the engine's spacers: the export turns each one into the band that closes a page,
 * carries its number, and opens the next page with its top margin. So a contents running onto a
 * second page cost every page after it its number. Measured on this fixture before the fix: twelve
 * sheets on screen, twelve pages in the PDF, the first two carrying no number at all and the rest
 * running one behind - page 3 printed "2" and the last page printed "11".
 *
 * The contents now emits the same spacer element the engine does, so the boundary is an ordinary
 * one. This test builds its own document, turns page numbers on with the toolbar, exports the PDF
 * the way the writer does, and reads the printed folios back out with poppler.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  await shoot('toc-multipage-export-failure.png').catch(() => {})
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


for (const tool of ['pdfinfo', 'pdftotext']) {
  try {
    execFileSync(tool, ['-v'], { stdio: 'ignore' })
  } catch {
    console.error(`FAIL: ${tool} is not installed (poppler-utils).`)
    process.exit(1)
  }
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const ribbonTab = (name) =>
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')]` +
  `.find((el) => (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(name)})`

const HEADINGS = 55

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a contents of 55 headings runs onto a second page')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(300)

const lines = []
for (let i = 1; i <= HEADINGS; i += 1) lines.push(`Bagian ${i}`)
await typeText(lines.join('\n'))
await sleep(1500)

// Select the lot and make them headings, with the profile card the writer uses.
await call('Input.dispatchKeyEvent', {
  type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA',
  windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
}, sessionId)
await call('Input.dispatchKeyEvent', {
  type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA',
  windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
}, sessionId)
await sleep(600)
await clickElement('the Title 1 profile card',
  `[...document.querySelectorAll('.pdoc-heading-container .card')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim().startsWith('Title 1 (H1)'))`)
await sleep(3000)

// The contents goes in front of the first heading.
await clickElement('the first heading',
  `[...document.querySelectorAll('.pdoc-page-content h1')][0]`)
await sleep(300)
await key('Home', 36)
await clickElement('the Insert tab of the ribbon', ribbonTab('insert'))
await sleep(700)
await clickElement('the Document Map button', buttonByText('Document Map'))
await sleep(4000)

// Page numbers on, from the Page tab, because the fault only shows where numbers are drawn.
await clickElement('the Page tab of the ribbon', ribbonTab('page'))
await sleep(700)
await clickElement('the Page Numbers button', buttonByText('Page Numbers'))
await sleep(900)
await clickElement('the Show page numbers checkbox',
  `[...document.querySelectorAll('.pdoc-page-number-panel label, .pdoc-page-number-panel span')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim() === 'Show page numbers')`)
await sleep(1200)
// Escape closes the panel. A click aimed at the page lands inside it while it is open.
await key('Escape', 27)
await sleep(600)
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(5000)

const screen = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.pdoc-toc-item-row')]
  const numbers = [...document.querySelectorAll('.pdoc-page-content > .pdoc-page-number')]
    .map((el) => (el.textContent || '').trim())
  return {
    rows: rows.length,
    tocSpacers: document.querySelectorAll('.pdoc-node-toc .pdoc-page-spacer').length,
    spacers: document.querySelectorAll('.pdoc-page-spacer').length,
    numbers,
  }
})()`)

check(`the contents lists all ${HEADINGS} headings`, screen.rows === HEADINGS, `${screen.rows} rows`)
check('page numbers are being drawn', screen.numbers.length > 0,
  `${screen.numbers.length} numbers`)
check('the contents had to break its own page', screen.tocSpacers >= 1,
  `${screen.tocSpacers} inside the contents, ${screen.spacers} in all`)
check('a boundary inside the contents counts as a boundary like any other',
  screen.spacers === screen.numbers.length - 1,
  `${screen.spacers} spacers for ${screen.numbers.length} sheets`)

await shoot('toc-multipage-editor.png')

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: the exported PDF has the same pages, each carrying its own number')

await clickElement('the Export tab of the ribbon', ribbonTab('export'))
await sleep(700)
await clickElement('the PDF button', buttonByText('PDF'))
await sleep(5000)

const srcdoc = await evaluate(`(() => {
  const iframe = document.querySelector('.pdoc-print-iframe')
  return iframe ? iframe.getAttribute('srcdoc') || '' : ''
})()`)
assert.ok(srcdoc, 'the export document was never built')
// Close the export dialog the way the writer would.
await clickElement('the Cancel button of the export dialog',
  `[...document.querySelectorAll('.t-dialog button, [class*="dialog"] button')]` +
  `.find((el) => el.offsetParent && /cancel/i.test(el.textContent || ''))`).catch(() => {})
await sleep(600)

const printTarget = await call('Target.createTarget', { url: 'about:blank' })
const printSession = (await call('Target.attachToTarget', { targetId: printTarget.targetId, flatten: true })).sessionId
await call('Page.enable', {}, printSession)
const frameId = (await call('Page.getFrameTree', {}, printSession)).frameTree.frame.id
await call('Page.setDocumentContent', { frameId, html: srcdoc }, printSession)
await sleep(4000)
const printed = await call('Page.printToPDF', {
  printBackground: true, preferCSSPageSize: true,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
}, printSession)
await call('Target.closeTarget', { targetId: printTarget.targetId }).catch(() => {})

const pdfPath = `${tmpdir()}/pdoc-toc-multipage.pdf`
writeFileSync(pdfPath, Buffer.from(printed.data, 'base64'))
const pageCount = Number(
  execFileSync('pdfinfo', [pdfPath]).toString().match(/Pages:\s+(\d+)/)[1],
)
check('the PDF has one page per sheet on screen', pageCount === screen.numbers.length,
  `${pageCount} pages against ${screen.numbers.length} sheets`)

// The folio is the last thing on a page, which is where the closing band puts it.
const printedNumbers = []
for (let p = 1; p <= pageCount; p += 1) {
  const text = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', pdfPath, '-'])
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  printedNumbers.push(text.length ? text[text.length - 1].split(/\s+/).pop() : '')
}
const wanted = screen.numbers.slice(0, pageCount)
check('every printed page carries a number', printedNumbers.every((n) => /^[0-9ivxlcIVXLC]+$/.test(n)),
  JSON.stringify(printedNumbers))
check('the printed folios are the ones on screen, in order',
  JSON.stringify(printedNumbers) === JSON.stringify(wanted),
  `printed ${JSON.stringify(printedNumbers)} against screen ${JSON.stringify(wanted)}`)

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a contents spanning two pages leaves every page its own number.')
await finish(0)
