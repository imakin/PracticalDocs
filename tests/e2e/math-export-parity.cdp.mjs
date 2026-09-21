/**
 * A document with formulas exports to exactly the pages it shows.
 *
 * The engine treats a display formula as one line and breaks before it (`adr/0022` and the formula
 * fix that came with it), and on screen that is right. The export was not: it gained a page, and the
 * page it gained carried nothing but a page number.
 *
 * KaTeX builds a formula from boxes taller than the box holding them, and the wrapper clips them.
 * Chrome's own pagination counts the clipped innards, so the printed flow runs taller than the
 * screen's, the band that closes a page no longer fits, and - being unbreakable - it moves whole to
 * the next page, where its `page-break-after` ends that page at once. Measured on this fixture
 * before the fix: four pages for three sheets, the third holding only the number 2. The export now
 * pins each formula to the height the engine measured, and the counts agree again.
 *
 * Page numbers are switched on deliberately: without them the export strips the engine's spacers and
 * lets Chrome paginate freely, which is a different path entirely and not the one a thesis takes.
 *
 * Its own fixture throughout. Endpoints come from EDITOR_URL and CDP_URL (adr/0006).
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
  await shoot('math-export-parity-failure.png').catch(() => {})
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
      // Carrying the text, not only the key. A bare Enter reaches ProseMirror's own keydown handler
      // and starts a new block, but inside a plain textarea - which is what a markdown block's source
      // is - the browser inserts nothing without it, and the whole fixture arrived as one line.
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      }, sessionId)
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      }, sessionId)
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


// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a document of paragraphs and formulas, typed into a markdown block')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(300)

// One paragraph, turned into a markdown block, and the whole fixture typed into its source. The
// markdown block is the writer's own route to display mathematics, and it is real content, so the
// engine paginates it like any other.
const FORMULAS = 16
const TAIL = 30
const source = ['']
for (let i = 1; i <= FORMULAS; i += 1) {
  for (let line = 0; line < 2 + (i % 3); line += 1) {
    source.push(`Isi ${i}.${line}`)
    source.push('')
  }
  source.push(`$$ S_{${i}} = \\frac{a_{${i}} - b_{${i}}}{c_{${i}}} \\times 100 $$`)
  source.push('')
}
for (let i = 1; i <= TAIL; i += 1) {
  source.push(`Sesudah rumus ${i}`)
  source.push('')
}

await typeText('Awal')
await sleep(600)
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
assert.ok(sourceBox, 'the markdown source panel did not open')
await clickAt(sourceBox.x, sourceBox.y)
await sleep(400)

await typeText(source.join('\n'))
await sleep(1000)

// The fixture is two thousand characters typed into a textarea, and anything that re-renders the
// node view while that is happening - a stylesheet saved in another window, say - closes the source
// panel and the rest of the typing lands somewhere else. Say so here rather than letting it surface
// three checks later as "no formulas rendered".
const typed = await evaluate(`document.querySelector('.pdoc-node-markdown-block textarea')?.value ?? ''`)
assert.ok(
  typed.includes(`Sesudah rumus ${TAIL}`),
  `the fixture did not all reach the source panel: it ends ${JSON.stringify(typed.slice(-60))}`,
)
// Leaving the source is what commits it, and the block renders.
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(8000)


// Page numbers on, because the export only builds bands for a document that has them - without
// them it strips every spacer and lets Chrome paginate freely, which is a different code path from
// the writer's thesis.
await clickElement('the Page tab of the ribbon',
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')].find((el) => (el.textContent || '').trim().toLowerCase() === 'page')`)
await sleep(700)
await clickElement('the Page Numbers button', buttonByText('Page Numbers'))
await sleep(900)
await clickElement('the Show page numbers checkbox',
  `[...document.querySelectorAll('.pdoc-page-number-panel label, .pdoc-page-number-panel span')].find((el) => el.offsetParent && (el.textContent || '').trim() === 'Show page numbers')`)
await sleep(1200)
await key('Escape', 27)
await sleep(5000)


const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

console.log('\nCase B: the screen settles, and the export matches it page for page')

const onScreen = await evaluate(`(() => {
  const host = document.querySelector('.pdoc-page-content')
  const hostTop = host.getBoundingClientRect().top
  const sheets = [...host.querySelectorAll(':scope > .pdoc-page-sheet')].map((s) => {
    const b = s.getBoundingClientRect()
    return { top: b.top - hostTop, bottom: b.bottom - hostTop }
  })
  const firstOn = sheets.map(() => '')
  const walker = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue
    const r = document.createRange(); r.selectNodeContents(n)
    const rect = [...r.getClientRects()][0]
    if (!rect) continue
    const top = rect.top - hostTop
    for (let i = 0; i < sheets.length; i += 1) {
      if (top >= sheets[i].top - 2 && top <= sheets[i].bottom + 2) {
        if (!firstOn[i]) firstOn[i] = n.textContent.trim().slice(0, 24)
        break
      }
    }
  }
  return {
    count: sheets.length,
    first: firstOn,
    formulas: document.querySelectorAll('[data-type="block-math"]').length,
    numbers: [...document.querySelectorAll('.pdoc-page-content > .pdoc-page-number')].map((el) => el.textContent.trim()),
  }
})()`)

check(`all ${FORMULAS} formulas rendered`, onScreen.formulas === FORMULAS, `${onScreen.formulas} formulas`)
check('the document runs over several sheets', onScreen.count >= 3, `${onScreen.count} sheets`)
check('page numbers are being drawn', onScreen.numbers.length === onScreen.count,
  `${onScreen.numbers.length} numbers for ${onScreen.count} sheets`)

await clickElement('the Export tab of the ribbon',
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')].find((el) => (el.textContent || '').trim().toLowerCase() === 'export')`)
await sleep(700)
await clickElement('the PDF button', buttonByText('PDF'))
await sleep(6000)
const srcdoc = await evaluate(`document.querySelector('.pdoc-print-iframe')?.getAttribute('srcdoc') || ''`)
assert.ok(srcdoc, 'the export document was never built')
await clickElement('the Cancel button of the export dialog',
  `[...document.querySelectorAll('[class*="dialog"] button')].find((el) => el.offsetParent && /cancel/i.test(el.textContent || ''))`).catch(() => {})
await sleep(500)

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

const pdfPath = `${tmpdir()}/pdoc-math-export-parity.pdf`
writeFileSync(pdfPath, Buffer.from(printed.data, 'base64'))
const pageCount = Number(execFileSync('pdfinfo', [pdfPath]).toString().match(/Pages:\s+(\d+)/)[1])
const pages = []
for (let p = 1; p <= pageCount; p += 1) {
  const lines = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', pdfPath, '-'])
    .toString().split('\n').map((l) => l.trim()).filter(Boolean)
  pages.push({ first: (lines[0] || '').slice(0, 24), last: (lines[lines.length - 1] || '').split(/\s+/).pop() || '', lines: lines.length })
}

check('the PDF has one page per sheet', pageCount === onScreen.count,
  `${pageCount} pages against ${onScreen.count} sheets`)
// The page that used to be gained carried a number and nothing else, so this is the shape of the
// fault rather than only its count.
check('no page carries nothing but its number',
  pages.every((p) => p.lines > 1), JSON.stringify(pages.map((p) => p.lines)))
check('every page ends with its own folio',
  JSON.stringify(pages.map((p) => p.last)) === JSON.stringify(onScreen.numbers.slice(0, pageCount)),
  `printed ${JSON.stringify(pages.map((p) => p.last))} against screen ${JSON.stringify(onScreen.numbers)}`)
// Only where a sheet opens with prose. A sheet that opens with a formula cannot be compared this
// way: the DOM's first text node inside KaTeX is a single letter, while pdftotext reads the glyphs
// it actually drew - "S" against "a - b" for the same formula. The folio check above covers those
// pages, and it is the stricter test anyway.
const comparable = pages
  .map((p, i) => ({ p, want: onScreen.first[i] }))
  .filter((row) => row.want && row.want.length >= 6 && row.want.includes(' '))
check('each page that opens with prose opens where its sheet does',
  comparable.length > 0 && comparable.every((row) => row.p.first.startsWith(row.want.slice(0, 8))),
  JSON.stringify({ compared: comparable.length, pdf: pages.map((p) => p.first), screen: onScreen.first }))

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a document of formulas prints the pages it shows, each with its own number.')
await finish(0)
