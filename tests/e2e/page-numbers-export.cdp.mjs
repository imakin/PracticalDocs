/**
 * Page numbers must reach the exported PDF, on the right pages, with the sections the user set.
 *
 * The number a reader sees is not the page's identity. The PDF's own page count stays 1..N so
 * bookmarks and navigation keep working; the footer number restarts, changes numeral system and can
 * be hidden. This checks the footer number, page by page, in a real PDF.
 *
 * The export cannot place a number in the margin with `@page { padding }`: that padding is outside the
 * container's coordinate space, and content pushed into it spills onto the next page instead. So for a
 * numbered document the margins become real blocks in the flow - see ADR 0008. This test guards that
 * machinery, which is fiddly and was got wrong several times.
 *
 * Uses its own synthetic document, so it cannot be broken by whatever the user is writing.
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 * Needs poppler-utils for pdfinfo and pdftotext.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

// Both tools have to be poppler's. `which` only says a file of that name exists, not which
// build it is, and another one can sit ahead of poppler on PATH -- measured with xpdf's
// pdftotext, which has no `-bbox` and brought the run down with a usage dump three checks in.
// The version banner is what tells them apart, and it is read rather than the exit status
// because the two builds disagree about that too.
for (const tool of ['pdfinfo', 'pdftotext']) {
  const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
  if (probe.error) {
    console.error(`FAIL: ${tool} is not available. Install poppler-utils.`)
    process.exit(1)
  }
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  if (!/poppler/i.test(banner)) {
    console.error(
      `FAIL: ${tool} is not poppler's -- "${/^.*/.exec(banner.trim())[0] || 'no version banner'}". Put poppler ahead of it on PATH.`,
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

const workDir = await mkdtemp(path.join(tmpdir(), 'pdoc-page-numbers-'))
const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
await call('Runtime.enable', {}, sessionId)
let printTargetId = null

const PERSISTED_KEYS = ['practicaldocs:default:document', 'practicaldocs:profiles']
let persistedBefore = null
const evaluate = async (expression, sid) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid || sessionId)
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
  if (printTargetId) await call('Target.closeTarget', { targetId: printTargetId }).catch(() => {})
  await call('Target.closeTarget', { targetId }).catch(() => {})
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) }
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
  return window.__ed && window.__p.exportFile ? 'OK' : 'NOT_READY'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

// Front matter in lower roman, then a page break that restarts the count in decimal - the shape of a
// thesis, and the case CSS `@page` cannot express at all.
const filler = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: (t + ' ').repeat(420) }] })
const doc = {
  type: 'doc',
  content: [
    filler('Kata pengantar.'),
    { type: 'pageBreak', attrs: { sectionStartAt: 1, sectionFormat: 'numeric' } },
    filler('Isi bab satu.'),
  ],
}
// Chapter openings carry the number at the foot, every other page at the head - the thesis
// convention, and the case that exposed the export printing everything at the bottom right.
const screen = await evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(doc)})
  window.__p.page.value.pageNumber = { enabled: true, position: 'top-right', firstPagePosition: 'bottom-center', format: 'roman-lower', template: '{number}', startAt: 1 }
  await new Promise((r) => setTimeout(r, 4000))
  return [...document.querySelectorAll('.pdoc-page-content > .pdoc-page-number')]
    .sort((a, b) => Number(a.dataset.sheet) - Number(b.dataset.sheet))
    .map((e) => ({ text: e.textContent, edge: e.dataset.edge, align: e.dataset.align }))
})()`)
const screenText = screen.map((e) => e.text)

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log('\nOn screen')
check('the front matter is lower roman', screenText.slice(0, 3).join(',') === 'i,ii,iii', JSON.stringify(screenText))
check('the section restarts the count in decimal', screenText.slice(3).join(',') === '1,2', JSON.stringify(screenText))
check(
  'a chapter opening carries its number at the foot, the pages after it at the head',
  screen.map((e) => e.edge).join(',') === 'bottom,top,top,bottom,top',
  JSON.stringify(screen.map((e) => e.edge + '-' + e.align)),
)

const srcdoc = await evaluate(`(async () => {
  window.__p.exportFile.value.pdf = true
  await new Promise((r) => setTimeout(r, 2500))
  const iframe = document.querySelector('.pdoc-print-iframe')
  const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
  const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
  if (dialog) { const cancel = [...dialog.querySelectorAll('button')].find((b) => /cancel|batal/i.test(b.textContent)); if (cancel) cancel.click() }
  window.__p.exportFile.value.pdf = false
  await new Promise((r) => setTimeout(r, 400))
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
// Read each number with its box, so the position can be checked and not just the digits. A page is
// 841.89pt tall; anything in the first or last tenth is in a margin strip rather than in the text.
const pageNumbers = []
for (let p = 1; p <= pageCount; p += 1) {
  const bbox = execFileSync('pdftotext', ['-bbox', '-f', String(p), '-l', String(p), pdfPath, '-']).toString()
  let found = null
  for (const line of bbox.split('\n')) {
    const m = line.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]+)<\/word>/)
    if (!m) continue
    const [, xMin, yMin, xMax, word] = m
    if (!/^(?:[ivxlcdm]+|\d+)$/i.test(word)) continue
    const y = Number(yMin)
    if (y > 90 && y < 750) continue
    const x = (Number(xMin) + Number(xMax)) / 2
    found = {
      text: word,
      edge: y < 400 ? 'top' : 'bottom',
      align: x < 200 ? 'left' : x < 400 ? 'center' : 'right',
    }
    break
  }
  pageNumbers.push(found)
}

console.log('\nIn the exported PDF')
check('the PDF has one page per on-screen sheet', pageCount === screen.length, `${screen.length} sheets vs ${pageCount} pages`)
check('every page carries a number', pageNumbers.every(Boolean), JSON.stringify(pageNumbers))
check(
  'the numbers match the screen exactly',
  JSON.stringify(pageNumbers.map((n) => n?.text ?? null)) === JSON.stringify(screenText),
  `${JSON.stringify(pageNumbers.map((n) => n?.text ?? null))} vs ${JSON.stringify(screenText)}`,
)
check(
  'each number is printed on the same edge as on screen',
  JSON.stringify(pageNumbers.map((n) => n?.edge ?? null)) === JSON.stringify(screen.map((e) => e.edge)),
  `${JSON.stringify(pageNumbers.map((n) => n?.edge ?? null))} vs ${JSON.stringify(screen.map((e) => e.edge))}`,
)
check(
  'and with the same alignment across the page',
  JSON.stringify(pageNumbers.map((n) => n?.align ?? null)) === JSON.stringify(screen.map((e) => e.align)),
  `${JSON.stringify(pageNumbers.map((n) => n?.align ?? null))} vs ${JSON.stringify(screen.map((e) => e.align))}`,
)
check('the physical page count is untouched by the restart', pageCount === 5, `${pageCount} pages`)

console.log('\nRESULT check')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the exported PDF carries the same page numbers as the screen.')
await finish(0)
