/**
 * The on-screen page breaks must be the ones Export to PDF produces.
 *
 * This is the check the geometry test cannot make. That one proves text never lands in the margin or
 * gap band, which is a necessary condition and not a sufficient one: the engine can satisfy it while
 * still breaking pages one line away from where the export does, and the difference accumulates down
 * the document. That is exactly the bug this test was written for.
 *
 * It renders the export document through the same path the application uses, converts it to PDF, and
 * compares the first line of every PDF page against the first line of the corresponding on-screen
 * sheet.
 *
 * Requires Chrome with --remote-debugging-port=9222, the dev server on :9000, and poppler-utils
 * (pdfinfo, pdftotext).
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import WebSocket from 'ws'

const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '')
const EDITOR_URL = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'
const DOCUMENT = process.env.PAGINATION_DOC || 'tesis4'
const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const normalise = (text) => String(text).replace(/[^a-z0-9]/gi, '').toLowerCase()

for (const tool of ['pdfinfo', 'pdftotext']) {
  try {
    execFileSync(tool, ['-v'], { stdio: 'ignore' })
  } catch {
    console.error(`FAIL: ${tool} not found. Install poppler-utils to run this test.`)
    process.exit(1)
  }
}

const probe = await fetch(`${CDP}/json/version`).catch(() => null)
if (!probe || !probe.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}. Start Chrome with --remote-debugging-port=9222.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await probe.json()
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 })
const pending = new Map()
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (!msg.id || !pending.has(msg.id)) return
  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) reject(new Error(JSON.stringify(msg.error)))
  else resolve(msg.result)
})
let nextId = 0
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    ws.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const workDir = await mkdtemp(path.join(tmpdir(), 'umo-pagination-parity-'))
const editorTarget = await call('Target.createTarget', { url: EDITOR_URL })
const editorSession = (await call('Target.attachToTarget', { targetId: editorTarget.targetId, flatten: true })).sessionId
let persistedBefore = null
let printTargetId = null

const evaluate = async (expression, sessionId = editorSession) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
  return r.result.value
}
const finish = async (code) => {
  if (persistedBefore) {
    await evaluate(`(() => {
      const frozen = ${JSON.stringify(PERSISTED_KEYS)}
      const setItem = localStorage.setItem.bind(localStorage)
      const removeItem = localStorage.removeItem.bind(localStorage)
      localStorage.setItem = (k, v) => { if (!frozen.includes(k)) setItem(k, v) }
      localStorage.removeItem = (k) => { if (!frozen.includes(k)) removeItem(k) }
      const saved = ${JSON.stringify(persistedBefore)}
      for (const [k, v] of Object.entries(saved)) { if (v === null) removeItem(k); else setItem(k, v) }
      return true
    })()`).catch(() => {})
  }
  if (printTargetId) await call('Target.closeTarget', { targetId: printTargetId }).catch(() => {})
  await call('Target.closeTarget', { targetId: editorTarget.targetId }).catch(() => {})
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
process.on('uncaughtException', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })
process.on('unhandledRejection', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })

await call('Page.enable', {}, editorSession)
await call('Runtime.enable', {}, editorSession)
for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2000)
persistedBefore = await evaluate(`(() => { const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o })()`)

await evaluate(`document.querySelector('[data-testid="open-json"]').click()`)
await sleep(2000)
const opened = await evaluate(`(() => {
  const modal = [...document.querySelectorAll('.t-dialog')].find(d => d.textContent.includes('Open & Load Document'))
  if (!modal) return 'MODAL_NOT_OPEN'
  const btns = [...modal.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Open Document')
  const labels = btns.map(b => { let n = b; for (let i = 0; i < 6 && n; i++) { const m = (n.textContent || '').match(/File:\\s*(\\S+?)\\.enc/); if (m) return m[1]; n = n.parentElement } return '?' })
  const i = labels.indexOf(${JSON.stringify(DOCUMENT)})
  if (i < 0) return 'DOCUMENT_NOT_ON_SERVER'
  btns[i].click(); return 'OPENED'
})()`)
if (opened !== 'OPENED') { console.error(`FAIL: could not open ${DOCUMENT}: ${opened}`); await finish(1) }
await sleep(1500)
await evaluate(`(() => { const d = [...document.querySelectorAll('.t-dialog')].find(x => x.offsetParent !== null && x.textContent.includes('Replace the current document')); if (d) { const ok = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open Document'); if (ok) ok.click() } return 1 })()`)
await sleep(7000)

// first line of each on-screen sheet
const screen = await evaluate(`(() => {
  const pc = document.querySelector('.umo-page-content')
  const pm = document.querySelector('.ProseMirror')
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px'
  pc.appendChild(ruler)
  const m = (v, f) => { ruler.style.height = 'var(' + v + ', ' + f + ')'; return ruler.getBoundingClientRect().height }
  const pageH = m('--umo-page-height', '29.7cm'), gap = m('--umo-page-sheet-gap', '16px')
  ruler.remove()
  const stride = pageH + gap, origin = pc.getBoundingClientRect().top

  const boxes = []
  const walk = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = walk.nextNode())) {
    if (!n.textContent || !n.textContent.trim()) continue
    const r = document.createRange(); r.selectNodeContents(n)
    for (const c of r.getClientRects()) if (c.height > 0 && c.width > 0) boxes.push({ top: c.top - origin, clientTop: c.top, node: n })
  }
  boxes.sort((a, b) => a.top - b.top)
  const charTop = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getClientRects(); return q.length ? q[0].top : null }
  const textFrom = (node, offset) => {
    let out = node.textContent.slice(offset)
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, null)
    let seen = false, cur
    while ((cur = w.nextNode())) { if (cur === node) { seen = true; continue } if (seen) { out += cur.textContent; if (out.length > 120) break } }
    return out.replace(/\\s+/g, ' ').trim().slice(0, 100)
  }
  const sheets = []
  let current = -1
  for (const b of boxes) {
    const idx = Math.floor(b.top / stride)
    if (idx === current) continue
    current = idx
    let lo = 0, hi = b.node.length - 1, ans = 0
    while (lo <= hi) { const mid = (lo + hi) >> 1; const t = charTop(b.node, mid)
      if (t === null) { lo = mid + 1; continue }
      if (t >= b.clientTop - 0.5) { ans = mid; hi = mid - 1 } else lo = mid + 1 }
    sheets[idx] = textFrom(b.node, ans)
  }
  return sheets.map((x) => x || '')
})()`)

// the export document, rendered exactly the way the application builds it
const srcdoc = await evaluate(`(async () => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  let inst = el.__vueParentComponent, provides = null
  while (inst) { const p = inst.provides || {}; if (p.editor?.value?.state) { provides = p; break } inst = inst.parent }
  if (!provides || !provides.exportFile) return ''
  provides.exportFile.value.pdf = true
  await new Promise(r => setTimeout(r, 2500))
  const iframe = document.querySelector('.umo-print-iframe')
  const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
  const dialog = [...document.querySelectorAll('.t-dialog')].find(d => d.offsetParent !== null)
  if (dialog) { const cancel = [...dialog.querySelectorAll('button')].find(b => /cancel|batal/i.test(b.textContent)); if (cancel) cancel.click() }
  provides.exportFile.value.pdf = false
  await new Promise(r => setTimeout(r, 400))
  return code
})()`)
if (!srcdoc) { console.error('FAIL: could not capture the export document'); await finish(1) }

const printTarget = await call('Target.createTarget', { url: 'about:blank' })
printTargetId = printTarget.targetId
const printSession = (await call('Target.attachToTarget', { targetId: printTargetId, flatten: true })).sessionId
await call('Page.enable', {}, printSession)
const frameId = (await call('Page.getFrameTree', {}, printSession)).frameTree.frame.id
await call('Page.setDocumentContent', { frameId, html: srcdoc }, printSession)
await sleep(3000)
const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, printSession)
const pdfPath = path.join(workDir, 'export.pdf')
await writeFile(pdfPath, Buffer.from(pdf.data, 'base64'))

const pageCount = Number(execFileSync('pdfinfo', [pdfPath]).toString().match(/Pages:\s+(\d+)/)[1])
const pdfPageStarts = []
for (let p = 1; p <= pageCount; p += 1) {
  const lines = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', pdfPath, '-'])
    .toString().split('\n').map((l) => l.trim()).filter(Boolean)
  // Join lines until there is enough text to compare: a page can open with a very short line.
  let joined = ''
  for (const line of lines) { joined += line + ' '; if (normalise(joined).length >= 60) break }
  pdfPageStarts.push({ first: lines[0] || '', compare: joined.trim() })
}

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log(`\nDocument under test: ${DOCUMENT}`)
console.log(`  on-screen sheets: ${screen.length}, exported PDF pages: ${pageCount}\n`)
check('the sheet count matches the exported page count', screen.length === pageCount, `${screen.length} sheets vs ${pageCount} pages`)

for (let i = 0; i < Math.max(screen.length, pageCount); i += 1) {
  const onScreen = normalise(screen[i] || '')
  const inPdf = normalise(pdfPageStarts[i]?.compare || '')
  const width = Math.min(onScreen.length, inPdf.length, 45)
  const ok = width >= 10 && onScreen.slice(0, width) === inPdf.slice(0, width)
  check(`page ${i + 1} starts at the same line on screen and in the PDF`, ok)
  if (!ok) {
    console.log(`          screen: ${(screen[i] || '(missing)').slice(0, 72)}`)
    console.log(`          pdf   : ${(pdfPageStarts[i]?.first || '(missing)').slice(0, 72)}`)
  }
}

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- every on-screen sheet begins where the exported PDF page begins.')
await finish(0)
