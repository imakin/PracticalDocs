/**
 * A row of columns is never cut by a page, on screen or in the PDF.
 *
 * A columns block is a flex row. A page break the engine anchored inside it became one more flex
 * item - no height, nothing moved - so on screen the row stayed whole and the solver broke again
 * further down. The export was not so forgiving: every spacer becomes a band with `break-after`,
 * and a band inside the row cut it in two, the formula column on one page and the equation number
 * beside it on the next, with everything after shifted by a page. Measured on the writer's thesis:
 * 54 pages for 53 sheets, two bands inside `.pdoc-node-column`.
 *
 * The engine now anchors such a break before the whole row. This test builds rows of columns with
 * prose between them across several sheets, turns page numbers on, and checks that no spacer ever
 * sits inside a row and that the export prints one page per sheet, each ending with its own number.
 *
 * Everything is done through the toolbar. Endpoints come from EDITOR_URL and CDP_URL (adr/0006).
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
  await shoot('columns-never-split-export-failure.png').catch(() => {})
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
const ribbonTab = (name) =>
  `[...document.querySelectorAll('.pdoc-ribbon-tabs-item')]` +
  `.find((el) => (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(name)})`

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: rows of columns among prose, over several sheets')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(300)

const ROWS = 8
for (let row = 1; row <= ROWS; row += 1) {
  // A different run of prose before each row, so the rows creep down the column and one of them
  // meets the foot of a sheet.
  const lines = []
  for (let i = 1; i <= 9 + (row % 4) * 3; i += 1) lines.push(`Prosa ${row}.${i}`)
  await typeText(lines.join('\n') + '\n')
  await sleep(300)
  await clickElement('the Insert tab of the ribbon', ribbonTab('insert'))
  await sleep(500)
  await clickElement('the Columns button', buttonByText('Columns'))
  await sleep(700)
  await clickElement('two columns',
    `[...document.querySelectorAll('.pdoc-columns-item')].find((el) => el.offsetParent && (el.textContent || '').trim() === '2')`)
  await sleep(900)
  // Into the first column of the row just inserted, and enough lines to make the row tall.
  await clickElement(`the first column of row ${row}`,
    `[...document.querySelectorAll('.pdoc-node-column-container')].pop()?.querySelector('.pdoc-node-column p')`)
  await sleep(300)
  await typeText(`Kolom kiri ${row}\nbaris dua\nbaris tiga\nbaris empat`)
  await sleep(300)
  await clickElement(`the second column of row ${row}`,
    `[...document.querySelectorAll('.pdoc-node-column-container')].pop()?.querySelectorAll('.pdoc-node-column')[1]?.querySelector('p')`)
  await sleep(300)
  await typeText(`(${row}.1)`)
  await sleep(300)
  // Back out of the row: click below it, on the paragraph the editor keeps after a columns block.
  await clickElement('the paragraph after the row',
    `(() => { const c = [...document.querySelectorAll('.pdoc-node-column-container')].pop(); let el = c?.parentElement?.closest('[data-node-view-wrapper]') || c; let n = el?.nextElementSibling; while (n && !/^(P|H[1-6])$/.test(n.tagName)) n = n.nextElementSibling; return n })()`)
    .catch(async () => {
      await key('End', 35)
      await key('ArrowDown', 40)
      await key('ArrowDown', 40)
      await key('ArrowDown', 40)
    })
  await sleep(300)
}
await sleep(1500)

await clickElement('the Page tab of the ribbon', ribbonTab('page'))
await sleep(600)
await clickElement('the Page Numbers button', buttonByText('Page Numbers'))
await sleep(900)
await clickElement('the Show page numbers checkbox',
  `[...document.querySelectorAll('.pdoc-page-number-panel label, .pdoc-page-number-panel span')].find((el) => el.offsetParent && (el.textContent || '').trim() === 'Show page numbers')`)
await sleep(1200)
await key('Escape', 27)
await sleep(600)
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(6000)

const screen = await evaluate(`(() => {
  const host = document.querySelector('.pdoc-page-content')
  const sheets = [...host.querySelectorAll(':scope > .pdoc-page-sheet')]
  const numbers = [...host.querySelectorAll(':scope > .pdoc-page-number')].map((el) => el.textContent.trim())
  const rows = [...document.querySelectorAll('.pdoc-node-column-container')]
  const hostTop = host.getBoundingClientRect().top
  // A row cut by a sheet: its box crosses a sheet's foot.
  const bounds = sheets.map((s) => { const b = s.getBoundingClientRect(); return { top: b.top - hostTop, bottom: b.bottom - hostTop } })
  const cut = rows.filter((r) => { const b = r.getBoundingClientRect(); const top = b.top - hostTop, bottom = b.bottom - hostTop; return bounds.some((s) => top < s.bottom - 1 && bottom > s.bottom + 1) }).length
  const st = (() => { let el = document.querySelector('.ProseMirror'); while (el && !el.__vueParentComponent) el = el.parentElement; let i = el?.__vueParentComponent; while (i) { const p = i.provides || {}; if (p.editor?.value?.state) return p.editor.value.extensionStorage?.pagination || p.editor.value.storage?.pagination; i = i.parent } return null })()
  return { sheets: sheets.length, numbers, rows: rows.length, spacersInsideRows: document.querySelectorAll('.pdoc-node-column-container .pdoc-page-spacer').length, cut, solve: st?.solve }
})()`)
check(`all ${ROWS} rows of columns exist`, screen.rows === ROWS, `${screen.rows} rows`)
check('the document runs over several sheets', screen.sheets >= 3, `${screen.sheets} sheets`)
check('the solve settled', screen.solve?.stopped === 'settled', JSON.stringify(screen.solve))
check('no page break sits inside a row of columns', screen.spacersInsideRows === 0, `${screen.spacersInsideRows} inside rows`)
check('no row is cut by the foot of a sheet', screen.cut === 0, `${screen.cut} cut`)

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: the export prints one page per sheet, each with its own number')

await clickElement('the Export tab of the ribbon', ribbonTab('export'))
await sleep(700)
await clickElement('the PDF button', buttonByText('PDF'))
await sleep(6000)
const srcdoc = await evaluate(`document.querySelector('.pdoc-print-iframe')?.getAttribute('srcdoc') || ''`)
assert.ok(srcdoc, 'the export document was never built')
await clickElement('the Cancel button of the export dialog',
  `[...document.querySelectorAll('.pdoc-dialog__cancel, [class*="dialog__cancel"]')].find((el) => el.getBoundingClientRect().width > 0)`).catch(() => {})
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
const pdfPath = `${tmpdir()}/pdoc-columns-never-split.pdf`
writeFileSync(pdfPath, Buffer.from(printed.data, 'base64'))
const pageCount = Number(execFileSync('pdfinfo', [pdfPath]).toString().match(/Pages:\s+(\d+)/)[1])
const pages = []
for (let p = 1; p <= pageCount; p += 1) {
  const text = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', pdfPath, '-'])
    .toString().split('\n').map((l) => l.trim()).filter(Boolean)
  pages.push({ lines: text.length, last: (text[text.length - 1] || '').split(/\s+/).pop() || '' })
}
check('the PDF has one page per sheet', pageCount === screen.sheets, `${pageCount} pages against ${screen.sheets} sheets`)
check('no page is blank', pages.every((p) => p.lines > 0), JSON.stringify(pages.map((p) => p.lines)))
check('every page ends with its own folio',
  JSON.stringify(pages.map((p) => p.last)) === JSON.stringify(screen.numbers.slice(0, pageCount)),
  `printed ${JSON.stringify(pages.map((p) => p.last))} against screen ${JSON.stringify(screen.numbers)}`)

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a row of columns is moved whole, never cut, on screen and in the PDF.')
await finish(0)
