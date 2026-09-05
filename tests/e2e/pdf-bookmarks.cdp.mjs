/**
 * The writer exports a PDF, hands it back, and gets bookmarks in it.
 *
 * The editor never holds the bytes of its own export - `print.vue` gives the document to Chrome's
 * print dialog - so this feature works by the writer returning the saved file. What is asserted here
 * is the whole of that: the real export document, printed by Chrome, handed to the editor, and the
 * bytes that come back read for a real `/Outlines` and `/PageLabels`.
 *
 * The file picker itself is browser UI and is stubbed. Everything on this side of it is not.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'

import { PDFDocument, PDFName } from 'pdf-lib'
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
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
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

// Every page open before this run belongs to the writer and is never touched.
const tabsBefore = new Set(
  ((await call('Target.getTargets').catch(() => ({}))).targetInfos || [])
    .filter((info) => info.type === 'page')
    .map((info) => info.targetId),
)
const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})
await call('Page.bringToFront', {}, sessionId).catch(() => {})

const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']
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
  const now = ((await call('Target.getTargets').catch(() => ({}))).targetInfos || [])
  for (const info of now) {
    if (info.type === 'page' && !tabsBefore.has(info.targetId)) {
      await call('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
    }
  }
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
    if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
let total = 0
const check = (label, condition, detail) => {
  total += 1
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// Three chapters with sections, long enough to run over several sheets.
let html = ''
for (const [chapter, title] of [[1, 'Pendahuluan'], [2, 'Tinjauan Pustaka'], [3, 'Metodologi']]) {
  html += `<h1>${title}</h1>`
  for (let s = 1; s <= 3; s += 1) {
    html += `<h2>Subbab ${chapter}.${s}</h2>`
    for (let p = 1; p <= 4; p += 1) {
      html += `<p>Paragraf ${chapter}.${s}.${p} berisi kalimat yang cukup panjang supaya mengisi beberapa baris pada lebar halaman normal.</p>`
    }
  }
}
await evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(html)})
  await new Promise((r) => setTimeout(r, 4500))
  return true
})()`)

console.log('\nCase A: the editor knows its own structure')
const structure = await evaluate(`(async () => {
  const mod = await import('/umo-editor/src/utils/document-outline.js')
  const entries = mod.collectOutlineEntries(window.__ed)
  return { entries, pages: mod.documentPageCount(window.__ed) }
})()`)
check('every heading is collected', structure.entries.length === 12, `${structure.entries.length} entries`)
check('the document has more than one page', structure.pages > 1, `${structure.pages} pages`)
check('a chapter carries the number its profile gives it',
  structure.entries[0]?.number === 'BAB I', JSON.stringify(structure.entries[0]))
check('a heading is on a real physical page',
  structure.entries.every((e) => e.page >= 1 && e.page <= structure.pages),
  JSON.stringify(structure.entries.map((e) => e.page)))

console.log('\nCase B: the exported PDF, handed back, comes out with bookmarks in it')
// The real export document, printed by Chrome exactly as Save as PDF would.
const srcdoc = await evaluate(`(async () => {
  window.__p.exportFile.value.pdf = true
  await new Promise((r) => setTimeout(r, 3000))
  const iframe = document.querySelector('.umo-print-iframe')
  const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
  const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
  if (dialog) {
    const cancel = [...dialog.querySelectorAll('button')].find((b) => /cancel|batal/i.test(b.textContent))
    if (cancel) cancel.click()
  }
  window.__p.exportFile.value.pdf = false
  await new Promise((r) => setTimeout(r, 500))
  return code
})()`)
check('the export document was captured', Boolean(srcdoc), `${String(srcdoc).length} characters`)

// The language the exported file declares. It was hardcoded `zh-CN` for every document this editor
// ever exported, which is what a screen reader believes and an accessibility checker reports.
const declaredLanguage = (html) => (String(html).match(/<html lang="([^"]*)"/) || [])[1]
check('the exported document declares English by default',
  declaredLanguage(srcdoc) === 'en-US', JSON.stringify(declaredLanguage(srcdoc)))

const changedLanguage = await evaluate(`(async () => {
  window.__p.page.value.language = 'id-ID'
  await new Promise((r) => setTimeout(r, 300))
  window.__p.exportFile.value.pdf = true
  await new Promise((r) => setTimeout(r, 2200))
  const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
  const input = dialog && dialog.querySelector('input')
  const prefilled = input ? input.value : null
  // Never press confirm here: it calls print(), which opens Chrome's print preview and blocks.
  const cancel = dialog && [...dialog.querySelectorAll('button')].find((b) => /cancel|batal|取消/i.test(b.textContent))
  if (cancel) cancel.click()
  await new Promise((r) => setTimeout(r, 700))
  const iframe = document.querySelector('.umo-print-iframe')
  return { prefilled, html: iframe ? iframe.getAttribute('srcdoc') || '' : '' }
})()`)
check('the writer\'s language reaches the exported document',
  declaredLanguage(changedLanguage.html) === 'id-ID',
  JSON.stringify(declaredLanguage(changedLanguage.html)))
check('and the dialog offers it back rather than asking again from scratch',
  changedLanguage.prefilled === 'id-ID', JSON.stringify(changedLanguage.prefilled))

await evaluate(`(() => { window.__p.page.value.language = 'en-US'; return true })()`)
await sleep(400)

const printTarget = await call('Target.createTarget', { url: 'about:blank' })
const printSession = (await call('Target.attachToTarget', { targetId: printTarget.targetId, flatten: true })).sessionId
await call('Page.enable', {}, printSession)
const frameId = (await call('Page.getFrameTree', {}, printSession)).frameTree.frame.id
await call('Page.setDocumentContent', { frameId, html: srcdoc }, printSession)
await sleep(3500)
const printed = await call('Page.printToPDF', {
  printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
}, printSession)
await call('Target.closeTarget', { targetId: printTarget.targetId }).catch(() => {})

const exported = await PDFDocument.load(Buffer.from(printed.data, 'base64'))
check('the printed PDF has as many pages as the document says',
  exported.getPageCount() === structure.pages,
  `${exported.getPageCount()} in the PDF, ${structure.pages} in the document`)
check('Chrome writes no outline of its own',
  exported.catalog.lookup(PDFName.of('Outlines')) === undefined)

/**
 * Stand in for the file picker, which is browser UI rather than this editor's code.
 *
 * The handle behaves the way the File System Access API's does - `getFile` gives the PDF back and
 * `createWritable` takes the new bytes - so the component's own path through both is exercised.
 */
const installPicker = async (base64) => evaluate(`(() => {
  const binary = atob(${JSON.stringify(base64)})
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  window.__written = null
  window.showOpenFilePicker = async () => [{
    getFile: async () => new File([bytes], 'export.pdf', { type: 'application/pdf' }),
    createWritable: async () => {
      const chunks = []
      return {
        write: async (chunk) => { chunks.push(chunk) },
        close: async () => {
          const blob = new Blob(chunks, { type: 'application/pdf' })
          const buffer = new Uint8Array(await blob.arrayBuffer())
          let out = ''
          for (let i = 0; i < buffer.length; i += 1) out += String.fromCharCode(buffer[i])
          window.__written = btoa(out)
        },
      }
    },
  }]
  return true
})()`)

const clickBookmarks = async () => evaluate(`(async () => {
  const tab = [...document.querySelectorAll('.umo-ribbon-tabs-item,[role=tab]')].find((e) => /export/i.test(e.textContent))
  if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 800)) }
  const label = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /PDF Bookmarks/.test(e.textContent))
  if (!label) return 'NO_BUTTON'
  const button = label.closest('button') || label.closest('[class*="menus-button"]') || label.parentElement
  button.click()
  await new Promise((r) => setTimeout(r, 2500))
  return 'CLICKED'
})()`)

await installPicker(printed.data)
check('the button is on the Export tab', (await clickBookmarks()) === 'CLICKED')

const writtenBase64 = await evaluate(`window.__written`)
check('the editor wrote the file back', Boolean(writtenBase64),
  writtenBase64 ? `${writtenBase64.length} base64 characters` : 'nothing was written')

if (writtenBase64) {
  const result = await PDFDocument.load(Buffer.from(writtenBase64, 'base64'))
  check('the page count is untouched', result.getPageCount() === exported.getPageCount(),
    `${result.getPageCount()} pages`)

  const outlines = result.catalog.lookup(PDFName.of('Outlines'))
  check('the PDF now has an outline', Boolean(outlines))
  if (outlines) {
    check('it has one item per heading',
      outlines.lookup(PDFName.of('Count')).asNumber() === structure.entries.length,
      `${outlines.lookup(PDFName.of('Count')).asNumber()} items`)

    const titles = []
    const walk = (ref) => {
      let current = ref
      while (current) {
        const dict = result.context.lookup(current)
        titles.push(dict.lookup(PDFName.of('Title')).decodeText())
        const first = dict.get(PDFName.of('First'))
        if (first) walk(first)
        current = dict.get(PDFName.of('Next'))
      }
    }
    walk(outlines.get(PDFName.of('First')))
    // The number belongs in the bookmark: the writer set that template themselves, and a bookmark
    // reading "Pendahuluan" beside a page headed "BAB I Pendahuluan" names a different thing.
    check('a bookmark carries the number and the title',
      titles[0] === 'BAB I Pendahuluan', JSON.stringify(titles.slice(0, 3)))
    check('the outline is nested, not flat',
      titles.length === structure.entries.length && titles[1] === '1.1 Subbab 1.1',
      JSON.stringify(titles))
  }
  check('the PDF now has page labels', Boolean(result.catalog.lookup(PDFName.of('PageLabels'))))
  check('the structure tree Chrome wrote is still there',
    Boolean(result.catalog.lookup(PDFName.of('StructTreeRoot'))))
}

// Clear the dialog case B left open, so what case C reads is case C's own.
await evaluate(`(() => {
  for (const d of document.querySelectorAll('.t-dialog')) {
    const ok = [...d.querySelectorAll('button')].find((b) => b.textContent.trim().length > 0)
    if (ok) ok.click()
  }
  return true
})()`)
await sleep(600)

console.log('\nCase C: a PDF that does not match the document is refused')
// A one-page PDF against a document of several. The writer can cause this by changing scale or paper
// in the print dialog, and bookmarks written against it would point at the wrong pages - quietly.
const wrong = await PDFDocument.create()
wrong.addPage([595, 842])
await installPicker(Buffer.from(await wrong.save()).toString('base64'))
await clickBookmarks()
const refused = await evaluate(`(() => {
  const dialogs = [...document.querySelectorAll('.t-dialog')].filter((d) => d.offsetParent !== null)
  const text = dialogs.map((d) => d.textContent).join(' ')
  return { written: window.__written, sawPageCount: /1 pages|has 1 page/.test(text), text: text.slice(0, 160) }
})()`)
check('nothing was written', !refused.written)
check('and the writer is told the page counts differ',
  /Page counts do not match/i.test(refused.text), JSON.stringify(refused.text))

console.log(`\nRESULT: ${failures.length === 0 ? 'PASSED' : 'FAILED'} -- ${total} checks, ${failures.length} failed`)
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`))
await finish(failures.length === 0 ? 0 : 1)
