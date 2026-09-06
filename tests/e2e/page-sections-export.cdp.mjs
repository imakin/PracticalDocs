/**
 * What a document with more than one page size actually exports as.
 *
 * The paper does not change in the PDF yet, and the point of this test is that it says so honestly:
 * one page per on-screen sheet, the first section's paper throughout, **at full size and in the
 * document's own text column**. The scale is the check that matters. Chrome shrinks a document to
 * fit its narrowest page, and the on-screen canvas is as wide as the widest sheet, so a landscape
 * section used to shrink the whole export to 70 per cent - with the page count and the page sizes
 * both still looking right, which is how it went unnoticed.
 *
 * Needs poppler-utils (pdfinfo, pdftotext). Endpoints come from EDITOR_URL and CDP_URL; per adr/0006
 * there is no built-in fallback.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import WebSocket from 'ws'

const required = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(
      `FAIL: ${name} is not set. Runtime endpoints are per-session configuration (adr/0006).`,
    )
    process.exit(1)
  }
  return value
}
const CDP = required('CDP_URL').replace(/\/$/, '')
const EDITOR_URL = required('EDITOR_URL')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const tool of ['pdfinfo', 'pdftotext']) {
  try {
    execFileSync('which', [tool])
  } catch {
    console.error(
      `FAIL: ${tool} is not installed. This test reads the exported PDF rather than trusting it.`,
    )
    process.exit(1)
  }
}

const version = await fetch(`${CDP}/json/version`).catch(() => null)
if (!version?.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await version.json()
const ws = new WebSocket(webSocketDebuggerUrl, {
  maxPayload: 128 * 1024 * 1024,
})
const pending = new Map()
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})
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
    ws.send(
      JSON.stringify({
        id: nextId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    )
  })

const tabsAtStart = (await (await fetch(`${CDP}/json/list`)).json()).filter(
  (t) => t.type === 'page',
).length
const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', {
  targetId,
  flatten: true,
})
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
await call(
  'Emulation.setDeviceMetricsOverride',
  { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
  sessionId,
)

const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
]
let persistedBefore = null
// Every tab this test opens is closed the moment it is finished with, and the count is checked.
const printTargets = new Set()
const tabCount = async () =>
  (await (await fetch(`${CDP}/json/list`)).json().catch(() => [])).filter?.(
    (t) => t.type === 'page',
  ).length
// Counted before this test's own tab exists, so the check at the end is against the browser as it
// was found.
const tabsBefore = tabsAtStart

const evaluate = async (expression, session = sessionId) => {
  const r = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    session,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ||
        JSON.stringify(r.exceptionDetails),
    )
  }
  return r.result.value
}
let closed = false
const finish = async (code) => {
  if (!closed) {
    closed = true
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
    for (const id of printTargets)
      await call('Target.closeTarget', { targetId: id }).catch(() => {})
    await call('Target.closeTarget', { targetId }).catch(() => {})
    // Chrome removes a closed target a moment after being asked, so the count is taken after a beat.
    await sleep(600)
    const after = await tabCount()
    if (after !== undefined && after !== tabsBefore) {
      console.error(`WARNING: tabs before ${tabsBefore}, after ${after}`)
    }
  }
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

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
if (wired !== 'OK') {
  console.error(`FAIL: could not reach the editor internals: ${wired}`)
  await finish(1)
}
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
const check = (label, condition, detail) => {
  console.log(
    `  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`,
  )
  if (!condition) failures.push(label)
}

// Each section runs to more than one page, so the page number bands inside a section are exercised
// as well as the boundaries between sections.
const build = (numbers) => `(async () => {
  const filler = (t, n) => ({ type: 'paragraph', content: [{ type: 'text', text: (t + ' ').repeat(n) }] })
  window.__p.page.value.pageNumber = { enabled: ${numbers}, position: 'bottom-center', firstPagePosition: null, format: 'numeric', template: '{number}', startAt: 1 }
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'PORTRAIT ONE' }] }, filler('Satu.', 900),
    { type: 'pageBreak', attrs: { sectionOrientation: 'landscape' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'LANDSCAPE TWO' }] }, filler('Dua.', 800),
    { type: 'pageBreak', attrs: { sectionOrientation: 'portrait' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'PORTRAIT THREE' }] }, filler('Tiga.', 900),
  ] })
  await new Promise((r) => setTimeout(r, 9000))
  const storage = window.__ed.extensionStorage.pagination
  return {
    solve: storage.solve,
    shapes: storage.sheets.map((s) => (s.width > s.height ? 'L' : 'P')),
    sections: storage.sheets.map((s) => s.section),
    numbers: storage.pages.filter((p) => p.visible && p.text !== '').map((p) => p.text),
  }
})()`

const exportPdf = async () => {
  const captured = await evaluate(`(async () => {
    let el = document.querySelector('.ProseMirror')
    while (el && !el.__vueParentComponent) el = el.parentElement
    let inst = el.__vueParentComponent, provides = null
    while (inst) { if (inst.provides?.exportFile) { provides = inst.provides; break } inst = inst.parent }
    provides.exportFile.value.pdf = true
    await new Promise((r) => setTimeout(r, 2500))
    const iframe = document.querySelector('.pdoc-print-iframe')
    const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
    const hints = [...document.querySelectorAll('.pdoc-print-dialog-hint')].map((h) => h.textContent.trim())
    const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
    if (dialog) { const cancel = [...dialog.querySelectorAll('button')].find((b) => /cancel|batal/i.test(b.textContent)); if (cancel) cancel.click() }
    provides.exportFile.value.pdf = false
    await new Promise((r) => setTimeout(r, 400))
    return { code, hints }
  })()`)
  const { code: srcdoc, hints } = captured
  if (!srcdoc) throw new Error('could not capture the export document')

  const target = await call('Target.createTarget', { url: 'about:blank' })
  printTargets.add(target.targetId)
  const session = (
    await call('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
  ).sessionId
  await call('Page.enable', {}, session)
  const frameId = (await call('Page.getFrameTree', {}, session)).frameTree.frame
    .id
  await call('Page.setDocumentContent', { frameId, html: srcdoc }, session)
  await sleep(3000)
  const pdf = await call(
    'Page.printToPDF',
    {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    },
    session,
  )
  // Closed here rather than at the end of the run: one tab, open only while it is being used.
  await call('Target.closeTarget', { targetId: target.targetId }).catch(
    () => {},
  )
  printTargets.delete(target.targetId)

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdoc-sections-'))
  const file = path.join(dir, 'export.pdf')
  await writeFile(file, Buffer.from(pdf.data, 'base64'))
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '60', file]).toString()
  const pages = Number(info.match(/Pages:\s+(\d+)/)[1])
  const shapes = [
    ...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g),
  ].map((m) => (Number(m[1]) > Number(m[2]) ? 'L' : 'P'))
  const trailing = []
  // The horizontal span the words actually occupy on each page. A column inset by a gutter meant for
  // a wider canvas shows up here and nowhere else.
  const columns = []
  for (let p = 1; p <= pages; p += 1) {
    const at = ['-f', String(p), '-l', String(p), file, '-']
    const text = execFileSync('pdftotext', at).toString().trim()
    trailing.push(text.split(/\s+/).pop() || '')
    const bbox = execFileSync('pdftotext', ['-bbox', ...at]).toString()
    const xs = [
      ...bbox.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"/g),
    ]
    if (xs.length > 0) {
      columns.push({
        left: Math.round(Math.min(...xs.map((m) => Number(m[1])))),
        right: Math.round(Math.max(...xs.map((m) => Number(m[2])))),
      })
    }
  }
  return { pages, shapes, trailing, columns, hints, file }
}

console.log('\nCase A: a mixed document prints at full size, on one paper')
const screenPlain = await evaluate(build(false))
check(
  'the engine paginated the whole document',
  screenPlain.solve?.stopped === 'settled',
  JSON.stringify(screenPlain.solve),
)
const shapeOfSection = (screen) => {
  const out = []
  screen.sections.forEach((section, index) => {
    out[section] = screen.shapes[index]
  })
  return out.join('')
}
check(
  'the middle section is landscape on screen and the others are not',
  shapeOfSection(screenPlain) === 'PLP',
  screenPlain.shapes.join(''),
)
check(
  'each section runs to more than one page',
  new Set(screenPlain.sections).size === 3 && screenPlain.sections.length > 4,
  JSON.stringify(screenPlain.sections),
)
const plain = await exportPdf()
check(
  'the PDF has one page per on-screen sheet',
  plain.pages === screenPlain.shapes.length,
  `${screenPlain.shapes.length} sheets vs ${plain.pages} pages`,
)
// The paper does not change yet. What must not happen is the whole document being shrunk to fit a
// canvas wider than the page, which is what a landscape section used to do to a portrait one.
check(
  "every page is the first section's paper",
  new Set(plain.shapes).size === 1 && plain.shapes[0] === 'P',
  plain.shapes.join(''),
)
check(
  'and the dialog said so before printing',
  plain.hints.some((hint) => hint.includes('more than one page size')),
  JSON.stringify(plain.hints),
)
// A4 portrait with the default 3.18 cm side margins is a 14.64 cm column, which is 415 pt. Measured
// before this was fixed: 291 pt, because the canvas was as wide as the landscape sheet and Chrome
// scaled the document by 21/29.7 to fit.
const columnOf = (pdf) => {
  const widths = pdf.columns.map((c) => c.right - c.left)
  return { widths, spread: Math.max(...widths) - Math.min(...widths) }
}
const plainColumn = columnOf(plain)
check(
  "the text column is the document's own, not a scaled-down one",
  Math.max(...plainColumn.widths) > 380,
  `widest column ${Math.max(...plainColumn.widths)} pt, expected about 415`,
)
check(
  'and every page uses that same column',
  plainColumn.spread <= 24,
  JSON.stringify(plain.columns),
)

console.log('\nCase B: and the same holds once it draws page numbers')
const screenNumbered = await evaluate(build(true))
check(
  'the engine paginated the whole document',
  screenNumbered.solve?.stopped === 'settled',
  JSON.stringify(screenNumbered.solve),
)
const numbered = await exportPdf()
check(
  'the PDF has one page per on-screen sheet',
  numbered.pages === screenNumbered.shapes.length,
  `${screenNumbered.shapes.length} sheets vs ${numbered.pages} pages`,
)
check(
  "every page is the first section's paper",
  new Set(numbered.shapes).size === 1,
  numbered.shapes.join(''),
)
const numberedColumn = columnOf(numbered)
check(
  "the text column is the document's own here too",
  Math.max(...numberedColumn.widths) > 380,
  `widest column ${Math.max(...numberedColumn.widths)} pt`,
)
check(
  'and every page uses that same column',
  numberedColumn.spread <= 24,
  JSON.stringify(numbered.columns),
)
// Deliberately not asserted: which number lands on which page. The export lays a mixed document out
// at one paper and one column, so the screen's page boundaries are not the export's, and the bands
// that carry the numbers are placed from the screen's. Measured: pages 1, 2, 5 and 6 carry the right
// number and the two that came from landscape sheets do not. It cannot be fixed from this end - the
// paper has to change first - and pretending otherwise in a test would only hide it.
console.log(
  `  NOTE  numbers on screen ${JSON.stringify(screenNumbered.numbers)}, in the PDF ${JSON.stringify(numbered.trailing)}`,
)

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- a mixed document prints at full size, one page per sheet, and says which paper it used.',
)
await finish(0)
