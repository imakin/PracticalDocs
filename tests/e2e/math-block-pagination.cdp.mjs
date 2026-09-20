/**
 * A display formula is one line, and the engine moves it whole.
 *
 * KaTeX draws a formula as dozens of boxes - numerator, rule, denominator, every operator - and each
 * one produces text rects. The solver read those as a block of a dozen breakable lines and tried to
 * break between the parts of a fraction. It cannot: every rect inside a math node maps back through
 * `posAtDOM` to the node's own position, so the break it asked for was one it had already placed.
 * Measured on the writer's thesis before the fix: an overflow at position 78141 against a last break
 * at 78145, the solve ending `no-anchor-below-the-last-break`, and **the last six pages left
 * unpaginated** - text running through the foot of the sheet with the page number printed over it.
 *
 * This test builds its own document: filler paragraphs with formulas scattered through them, enough
 * to run over several sheets, so at least one formula meets the foot of a column. It then asks the
 * page what the reader would ask - is any line cut by the edge of a sheet, and is any formula.
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
  await shoot('math-block-pagination-failure.png').catch(() => {})
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


const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: a document of paragraphs and formulas, typed into a markdown block')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(300)

// One paragraph, turned into a markdown block, and the whole fixture typed into its source. The
// markdown block is the writer's own route to display mathematics, and it is real content, so the
// engine paginates it like any other.
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

const FORMULAS = 12
const source = ['']
for (let i = 1; i <= FORMULAS; i += 1) {
  // The run of filler changes length by one line at a time, so the formulas creep down the column
  // rather than landing at the same offset on every page.
  for (let line = 0; line < 2 + (i % 3); line += 1) {
    source.push(`Isi ${i}.${line}`)
    source.push('')
  }
  source.push(`$$ S_{${i}} = \\frac{a_{${i}} - b_{${i}}}{c_{${i}}} \\times 100 $$`)
  source.push('')
}

// One formula taller than a whole page. Nothing can make it fit, and that is the point: the engine
// has to leave it at the top of a fresh column and carry on down the document. Reading it as a block
// of breakable lines is what used to end the solve - it tried to anchor a break between two rows of
// the matrix, every one of which resolves to the node's own position, so the break it asked for was
// one it had already placed, and it gave up with the rest of the document still in the margin bands.
const ROWS = 70
const rows = []
for (let r = 1; r <= ROWS; r += 1) rows.push(`x_{${r}}`)
source.push(`$$ \\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix} $$`)
source.push('')
const TAIL = 30
for (let i = 1; i <= TAIL; i += 1) {
  source.push(`Sesudah rumus ${i}`)
  source.push('')
}
await typeText(source.join('\n'))
await sleep(1000)
// Leaving the source is what commits it, and the block renders.
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(8000)

const measured = await evaluate(`(() => {
  const host = document.querySelector('.pdoc-page-content')
  const hostTop = host.getBoundingClientRect().top
  const sheets = [...host.querySelectorAll(':scope > .pdoc-page-sheet')].map((sheet) => {
    const box = sheet.getBoundingClientRect()
    const style = getComputedStyle(sheet)
    return {
      top: box.top - hostTop,
      bottom: box.bottom - hostTop,
      marginTop: Number.parseFloat(style.paddingTop) || 0,
      marginBottom: Number.parseFloat(style.paddingBottom) || 0,
    }
  })
  const editorDom = document.querySelector('.ProseMirror')

  // A line of text crossing the foot of a drawn sheet, or sitting in the gap between two of them, is
  // the fault as the reader meets it.
  const cuts = []
  const straddles = (top, bottom) => {
    for (let i = 0; i < sheets.length; i += 1) {
      const sheet = sheets[i]
      const next = sheets[i + 1]
      if (top < sheet.bottom - 1 && bottom > sheet.bottom + 1) return { sheet: i, where: 'cut by the foot' }
      if (next && top > sheet.bottom + 1 && top < next.top - 1) return { sheet: i, where: 'in the gap' }
    }
    return null
  }
  const walker = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) continue
    // The oversized formula is taller than any column, so its own glyphs have to cross a boundary.
    // Nothing else may.
    if (node.parentElement?.closest('[data-type="block-math"]')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (rect.height <= 0) continue
      const hit = straddles(rect.top - hostTop, rect.bottom - hostTop)
      if (hit) {
        cuts.push({ ...hit, text: node.textContent.trim().slice(0, 24) })
        break
      }
    }
  }

  // Each formula measured as one box, which is how the reader sees it.
  const formulas = [...editorDom.querySelectorAll('[data-type="block-math"]')].map((el) => {
    const box = el.getBoundingClientRect()
    const top = box.top - hostTop
    const bottom = box.bottom - hostTop
    const hit = straddles(top, bottom)
    // How close it came to the foot of its column, so the test can say whether it was ever tested.
    let nearest = Number.POSITIVE_INFINITY
    for (const sheet of sheets) {
      const columnBottom = sheet.bottom - sheet.marginBottom
      if (bottom <= columnBottom + 1 && bottom > sheet.top) {
        nearest = Math.min(nearest, columnBottom - bottom)
      }
    }
    return { top: Math.round(top), height: Math.round(box.height), cut: hit, room: Math.round(nearest) }
  })

  // The paragraphs after the oversized formula, which is where the damage showed: they used to sit
  // in the margin bands, unpaginated, because the solve had given up above them.
  const tail = [...editorDom.querySelectorAll('p')]
    .filter((p) => /^Sesudah rumus /.test((p.textContent || '').trim()))
    .map((p) => {
      const box = p.getBoundingClientRect()
      return { text: p.textContent.trim(), cut: straddles(box.top - hostTop, box.bottom - hostTop) }
    })
  const column = sheets[0] ? sheets[0].bottom - sheets[0].top - sheets[0].marginTop - sheets[0].marginBottom : 0
  return { sheets: sheets.length, cuts, formulas, tail, column: Math.round(column) }
})()`)

check('the document runs over several sheets', measured.sheets >= 3, `${measured.sheets} sheets`)
check(`all ${FORMULAS + 1} formulas rendered`, measured.formulas.length === FORMULAS + 1,
  `${measured.formulas.length} formulas`)
// Without this the test would be proving nothing: the case only arises when a formula cannot be made
// to fit, and this is the one that cannot.
const oversized = measured.formulas.filter((f) => f.height > measured.column)
check('the tall formula really is taller than a column', oversized.length === 1,
  `column ${measured.column}px against formula heights ${JSON.stringify(measured.formulas.map((f) => f.height))}`)

await shoot('math-block-pagination.png')

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: nothing is cut by the edge of a sheet')

check('no formula that fits a column is cut by one',
  measured.formulas.filter((f) => f.height <= measured.column).every((f) => !f.cut),
  JSON.stringify(measured.formulas.filter((f) => f.cut && f.height <= measured.column)))
// Everything the ordinary formulas live in. What happens below the oversized one is bounded
// separately, because no engine can fit a block taller than the page it is on.
const cutsAbove = measured.cuts.filter((c) => !/^Sesudah rumus /.test(c.text))
check('no line of text among the ordinary formulas is cut by a sheet or left in the gap',
  cutsAbove.length === 0,
  `${cutsAbove.length} cut(s): ${JSON.stringify(cutsAbove.slice(0, 4))}`)
check(`all ${TAIL} paragraphs after the tall formula are there`,
  measured.tail.length === TAIL, `${measured.tail.length} paragraphs`)
// A block taller than a page cannot be laid out cleanly by anything - it overflows its column by
// definition, and the line under it inherits that overflow. What matters is that the damage stops
// there instead of taking the rest of the document with it: before the fix the solve gave up above
// these paragraphs, and this fixture left two of them cut; on the writer's own thesis it left the
// last six pages unpaginated. So this bounds the damage rather than denying it.
const cutTail = measured.tail.filter((p) => p.cut)
check('the damage from it stops at the line below it',
  cutTail.length <= 1, JSON.stringify(cutTail.slice(0, 4)))

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a formula is one line, and no sheet cuts through one.')
await finish(0)
