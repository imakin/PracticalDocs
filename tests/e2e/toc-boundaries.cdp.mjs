/**
 * What belongs in the contents, and what a contents longer than a page does to the document.
 *
 * Two faults reported by the user, on the same block:
 *
 * 1. **Table cells reached the contents.** They write a literature review as a table and style its
 *    cells with their own profile. A profile that carries a heading level turns the block into a
 *    `heading` node - that is how profiles work (adr/0007, adr/0013) - and the contents is built
 *    from `editor.storage.tableOfContents`, which collects every heading in the document. So every
 *    cell of the table appeared as an entry: the row numbers, the citations, the summary sentences.
 *    A heading inside a table is a styled cell, not a section of the document.
 *
 * 2. **A contents longer than one page broke the pagination of the whole document.** The contents is
 *    an atom node, so a page break cannot be anchored inside it; once it is taller than a sheet the
 *    solver cannot place a break in it.
 *
 * Endpoints come from EDITOR_URL and CDP_URL; per adr/0006 there is no fallback.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
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
const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })

const version = await getJson(`${CDP}/json/version`).catch(() => null)
if (!version) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const ws = new WebSocket(version.webSocketDebuggerUrl, {
  maxPayload: 128 * 1024 * 1024,
})
const pending = new Map()
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (!msg.id || !pending.has(msg.id)) {
    return
  }
  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) {
    reject(new Error(JSON.stringify(msg.error)))
  } else {
    resolve(msg.result)
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

const tabCount = async () =>
  (await getJson(`${CDP}/json/list`).catch(() => [])).filter?.(
    (t) => t.type === 'page',
  ).length
const tabsBefore = await tabCount()

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

const evaluate = async (expression) => {
  const r = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description || 'evaluate failed',
    )
  }
  return r.result.value
}

let persistedBefore = null
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
    for (const id of printTargets) {
      await call('Target.closeTarget', { targetId: id }).catch(() => {})
    }
    await call('Target.closeTarget', { targetId }).catch(() => {})
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
  if (bailing) {
    return
  }
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) {
    break
  }
  await sleep(200)
}
const wired = await evaluate(`(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  if (!el) return 'NO_VUE_COMPONENT'
  let inst = el.__vueParentComponent
  while (inst) {
    const p = inst.provides || {}
    if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break }
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

// A tab opened only to print, closed the moment the bytes are captured - and again on every way out
// of this file, because a harness that sweeps up at the end once closed the writer's browser.
const printTargets = new Set()
const failures = []
const check = (label, ok, detail) => {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`,
  )
  if (!ok) {
    failures.push(label)
  }
}

const text = (value) => [{ type: 'text', text: value }]
const heading = (level, value) => ({
  type: 'heading',
  attrs: { level },
  content: text(value),
})
const cell = (level, value) => ({
  type: 'tableCell',
  content: [heading(level, value)],
})
const row = (cells) => ({ type: 'tableRow', content: cells })
const filler = (mark, count = 26) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'paragraph',
    content: text(`${mark} line ${i + 1}`),
  }))

const load = async (doc) =>
  evaluate(`(async () => {
    window.__ed.commands.setContent(${JSON.stringify(doc)})
    await new Promise((r) => setTimeout(r, 4500))
    return true
  })()`)

// Every consumer of the heading store at once, so a fix that reaches only the visible one fails.
const readContents = async () =>
  evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.pdoc-node-toc-body .pdoc-toc-item-row')]
      .map((r) => (r.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 0)
    const outlineModule = await import('/practicaldocs/src/utils/document-outline.js')
    // The editor's own getTableOfContents() is a one-line delegation to this, so the shared
    // function is what is worth asserting on.
    const scopeModule = await import('/practicaldocs/src/utils/heading-scope.js')
    return {
      rows,
      stored: (window.__ed.storage.tableOfContents?.content || []).map((i) => i.textContent),
      api: scopeModule.sectionHeadings(window.__ed).map((i) => i.textContent),
      outline: outlineModule.collectOutlineEntries(window.__ed).map((e) => e.title),
    }
  })()`)

// ---------------------------------------------------------------------------
console.log(
  '\nCase A: a heading inside a table is a styled cell, not a section',
)
await load({
  type: 'doc',
  content: [
    { type: 'toc' },
    heading(1, 'Pendahuluan'),
    ...filler('a', 4),
    heading(1, 'Tinjauan Pustaka'),
    {
      type: 'table',
      content: [
        row([cell(3, 'No'), cell(3, 'Penulis'), cell(3, 'Kontribusi')]),
        row([
          cell(3, '1'),
          cell(3, 'Duarte et al. (2018)'),
          cell(3, 'Menciptakan pustaka hls4ml'),
        ]),
        row([
          cell(3, '2'),
          cell(3, 'Jariri et al. (2025)'),
          cell(3, 'Konversi model CNN hls4ml'),
        ]),
      ],
    },
    ...filler('b', 4),
    heading(1, 'Metodologi Penelitian'),
  ],
})

const a = await readContents()
// Distinctive cell text only. An earlier version of this check also looked for the row numbers
// "1" and "2", which appear inside every row as its page number, so it reported the real chapters
// as leaked cells and could not have told the fix from the fault.
const cellTexts = [
  'Penulis',
  'Kontribusi',
  'Duarte et al. (2018)',
  'Jariri et al. (2025)',
  'Menciptakan pustaka hls4ml',
  'Konversi model CNN hls4ml',
]
const leaked = a.rows.filter((t) => cellTexts.some((c) => t.includes(c)))
check(
  'the three real chapters are listed',
  ['Pendahuluan', 'Tinjauan Pustaka', 'Metodologi Penelitian'].every((h) =>
    a.rows.some((t) => t.includes(h)),
  ),
  JSON.stringify(a.rows.slice(0, 6)),
)
check(
  'and nothing else is',
  a.rows.length === 3,
  `${a.rows.length} rows: ${JSON.stringify(a.rows)}`,
)
check(
  'no table cell reached the contents',
  leaked.length === 0,
  leaked.length > 0
    ? `${leaked.length} leaked: ${JSON.stringify(leaked.slice(0, 4))}`
    : 'none',
)
// The cells were taking section numbers as well as contents entries, so the chapter after the table
// was numbered as though the table had opened sections inside it.
check(
  'the chapter after the table is still the third',
  a.rows[2]?.includes('BAB III'),
  JSON.stringify(a.rows[2]),
)
// Four things read the heading store, and fixing only the visible one would leave the rest wrong:
// the document map panel, the PDF outline, and the editor's own getTableOfContents().
check(
  'the public getTableOfContents lists sections only',
  a.api.length === 3 &&
    !a.api.some((t) => cellTexts.some((c) => t.includes(c))),
  JSON.stringify(a.api),
)
check(
  'and so does the outline the PDF bookmarks are written from',
  a.outline.length === 3 &&
    !a.outline.some((t) => cellTexts.some((c) => t.includes(c))),
  JSON.stringify(a.outline),
)

// ---------------------------------------------------------------------------
console.log(
  '\nCase B: a contents longer than one page still paginates the document',
)
await load({
  type: 'doc',
  content: [
    { type: 'toc' },
    // Enough chapters that the contents itself runs past the bottom of its own sheet.
    ...Array.from({ length: 60 }, (_, i) => [
      heading(
        1,
        `Bagian ${i + 1} yang cukup panjang untuk satu baris daftar isi`,
      ),
      { type: 'paragraph', content: text(`isi bagian ${i + 1}`) },
    ]).flat(),
  ],
})

const b = await evaluate(`(async () => {
  await new Promise((r) => setTimeout(r, 2000))
  const toc = document.querySelector('.pdoc-node-toc-body')
  const store = window.__ed.storage.pagination || {}
  const sheets = document.querySelectorAll('.pdoc-page-sheet').length
  const editorEl = document.querySelector('.ProseMirror')
  const scale = editorEl.getBoundingClientRect().height / editorEl.offsetHeight || 1
  return {
    tocHeight: toc ? toc.getBoundingClientRect().height / scale : 0,
    pageHeight: store.stride || null,
    pages: store.pages || null,
    solve: store.solve || null,
    sheets,
  }
})()`)

check(
  'the contents really is taller than one page',
  b.pageHeight ? b.tocHeight > b.pageHeight : b.tocHeight > 1000,
  `contents ${Math.round(b.tocHeight)}px, page ${b.pageHeight ?? 'unknown'}px`,
)
check(
  'the solver settled rather than giving up',
  b.solve?.stopped === 'settled',
  JSON.stringify(b.solve),
)
check(
  'it stepped over nothing',
  (b.solve?.skipped ?? 0) === 0,
  `skipped ${b.solve?.skipped}`,
)

const bands = await evaluate(`(() => {
  const editorEl = document.querySelector('.ProseMirror')
  const scale = editorEl.getBoundingClientRect().height / editorEl.offsetHeight || 1
  const base = editorEl.getBoundingClientRect().top
  const store = window.__ed.storage.pagination || {}
  const stride = store.stride
  if (!stride) return { stride: null, inBand: -1, lines: 0 }
  // A text line whose top falls in the gap between two sheets is sitting in the margin band, which
  // is what the user sees as the pagination going wrong.
  let inBand = 0
  let lines = 0
  for (const p of editorEl.querySelectorAll('p, h1, h2, h3')) {
    const r = p.getBoundingClientRect()
    if (r.height === 0) continue
    lines += 1
    // base is the top of the first column, so a whole number of strides below it is another column
    // top - the right place for a line to be. A line landing exactly there computes an offset a
    // fraction of a pixel short of a full stride rather than zero, and reading that as "near the
    // foot of the page" flagged nine lines that were sitting exactly where they belong.
    const raw = ((r.top - base) / scale) % stride
    const offset = raw > stride - 1 ? 0 : raw
    if (offset > stride - 120) inBand += 1
  }
  return { stride, inBand, lines }
})()`)
check(
  'no line is left sitting in a margin band',
  bands.inBand === 0,
  `${bands.inBand} of ${bands.lines} lines, stride ${bands.stride}`,
)

// The check above walks paragraphs and headings, which are not the contents. A row of the contents
// straddling the foot of a column is the fault this case exists for, so it is measured directly,
// against the columns the engine actually solved rather than against a pitch.
const tocRows = await evaluate(`(() => {
  const host = document.querySelector('.pdoc-page-content')
  const storage = window.__ed.extensionStorage?.pagination || window.__ed.storage.pagination
  const sheets = storage?.sheets || []
  if (sheets.length === 0) return { rows: 0, straddling: -1, sheetsUsed: 0 }
  const hostTop = host.getBoundingClientRect().top
  const pitch = storage.stride
  const boxAt = (i) => {
    if (i < sheets.length) return sheets[i]
    const last = sheets[sheets.length - 1]
    return { ...last, top: last.top + (i - (sheets.length - 1)) * pitch }
  }
  const used = new Set()
  let straddling = 0
  let rows = 0
  for (const row of document.querySelectorAll('.pdoc-node-toc-body .pdoc-toc-item-row')) {
    const rect = row.getBoundingClientRect()
    if (rect.height === 0) continue
    rows += 1
    const top = rect.top - hostTop
    let sheet = 0
    while (sheet + 1 < 200 && top >= boxAt(sheet + 1).top) sheet += 1
    used.add(sheet)
    const box = boxAt(sheet)
    const columnTop = box.top + box.marginTop
    const columnBottom = box.top + box.height - box.marginBottom
    if (top < columnTop - 2 || top + rect.height > columnBottom + 2) straddling += 1
  }
  return { rows, straddling, sheetsUsed: used.size }
})()`)
check(
  'every contents row sits inside a sheet text column',
  tocRows.straddling === 0,
  `${tocRows.straddling} of ${tocRows.rows} rows straddle a boundary`,
)
check(
  'and the contents really does run across more than one sheet',
  tocRows.sheetsUsed > 1,
  `${tocRows.sheetsUsed} sheets`,
)

// ---------------------------------------------------------------------------
console.log('\nCase C: and it is still right when the canvas is zoomed')
// The canvas is scaled by a CSS transform. Everything measured comes back in the zoomed space and
// every length written is inside that same transform, so it is not. Getting this backwards is what
// made every page spacer half its height at 50 per cent, and the same arithmetic is being done here.
const zoomed = await evaluate(`(async () => {
  window.__p.page.value.zoomLevel = 50
  await new Promise((r) => setTimeout(r, 6000))
  const host = document.querySelector('.pdoc-page-content')
  const storage = window.__ed.extensionStorage?.pagination || window.__ed.storage.pagination
  const sheets = storage?.sheets || []
  const hostRect = host.getBoundingClientRect()
  const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1
  const pitch = storage.stride
  const boxAt = (i) => {
    if (i < sheets.length) return sheets[i]
    const last = sheets[sheets.length - 1]
    return { ...last, top: last.top + (i - (sheets.length - 1)) * pitch }
  }
  let straddling = 0
  let rows = 0
  for (const row of document.querySelectorAll('.pdoc-node-toc-body .pdoc-toc-item-row')) {
    const rect = row.getBoundingClientRect()
    if (rect.height === 0) continue
    rows += 1
    const top = rect.top - hostRect.top
    let sheet = 0
    while (sheet + 1 < 200 && top >= boxAt(sheet + 1).top) sheet += 1
    const box = boxAt(sheet)
    if (top < box.top + box.marginTop - 2 || top + rect.height > box.top + box.height - box.marginBottom + 2) straddling += 1
  }
  return { scale: Number(scale.toFixed(3)), rows, straddling, solve: storage.solve }
})()`)
check(
  'the canvas really is zoomed',
  zoomed.scale < 0.9,
  `scale ${zoomed.scale}`,
)
check(
  'every contents row still sits inside a text column',
  zoomed.straddling === 0,
  `${zoomed.straddling} of ${zoomed.rows} rows straddle a boundary`,
)
check(
  'and the solver still settles',
  zoomed.solve?.stopped === 'settled',
  JSON.stringify(zoomed.solve),
)

// ---------------------------------------------------------------------------
// The gap that carries a row onto the next sheet is a screen measure, and print honours a margin on
// top of its own page break: the first version of this fix printed 13 pages for 12 sheets, the last
// one empty. Only the PDF shows that, so only the PDF can guard it.
console.log('\nCase D: and the exported PDF has the same pages as the screen')
const poppler = ['pdfinfo'].every((tool) => {
  const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
  return (
    !probe.error &&
    /poppler/i.test(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)
  )
})
if (!poppler) {
  console.log(
    '  NOTE  not run: poppler is not on PATH, so the PDF cannot be read',
  )
} else {
  await evaluate(
    `(async () => { window.__p.page.value.zoomLevel = 100; await new Promise((r) => setTimeout(r, 4000)); return true })()`,
  )
  const sheetsOnScreen = await evaluate(
    `(window.__ed.extensionStorage?.pagination || window.__ed.storage.pagination).sheets.length`,
  )
  const srcdoc = await evaluate(`(async () => {
    let el = document.querySelector('.ProseMirror')
    while (el && !el.__vueParentComponent) el = el.parentElement
    let inst = el.__vueParentComponent, provides = null
    while (inst) { if (inst.provides?.exportFile) { provides = inst.provides; break } inst = inst.parent }
    provides.exportFile.value.pdf = true
    await new Promise((r) => setTimeout(r, 3500))
    const iframe = document.querySelector('.pdoc-print-iframe')
    const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
    const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
    if (dialog) { const cancel = [...dialog.querySelectorAll('button')].find((b) => /cancel|batal/i.test(b.textContent)); if (cancel) cancel.click() }
    provides.exportFile.value.pdf = false
    await new Promise((r) => setTimeout(r, 400))
    return code
  })()`)
  if (!srcdoc) {
    check('the export document could be captured', false, 'empty srcdoc')
  } else {
    // Its own tab, closed the moment the bytes are captured.
    const printTarget = await call('Target.createTarget', {
      url: 'about:blank',
    })
    printTargets.add(printTarget.targetId)
    const printSession = (
      await call('Target.attachToTarget', {
        targetId: printTarget.targetId,
        flatten: true,
      })
    ).sessionId
    await call('Page.enable', {}, printSession)
    const frameId = (await call('Page.getFrameTree', {}, printSession))
      .frameTree.frame.id
    await call(
      'Page.setDocumentContent',
      { frameId, html: srcdoc },
      printSession,
    )
    await sleep(4000)
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
      printSession,
    )
    await call('Target.closeTarget', { targetId: printTarget.targetId }).catch(
      () => {},
    )
    printTargets.delete(printTarget.targetId)

    const dir = await mkdtemp(path.join(os.tmpdir(), 'pdoc-toc-'))
    const file = path.join(dir, 'export.pdf')
    await writeFile(file, Buffer.from(pdf.data, 'base64'))
    const pages = Number(
      execFileSync('pdfinfo', [file])
        .toString()
        .match(/Pages:\s+(\d+)/)[1],
    )
    const lastPage = execFileSync('pdftotext', [
      '-f',
      String(pages),
      '-l',
      String(pages),
      file,
      '-',
    ])
      .toString()
      .trim()
    check(
      'the PDF has one page per on-screen sheet',
      pages === sheetsOnScreen,
      `${sheetsOnScreen} sheets vs ${pages} pages`,
    )
    check(
      'and the last page is not blank',
      lastPage.length > 0,
      `${lastPage.length} characters`,
    )
  }
}

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- the contents lists sections only, and survives being longer than a page.',
)
await finish(0)
