/**
 * Acceptance test for paginated page view.
 *
 * The requirement, from the user's LibreOffice comparison: the editor shows discrete sheets of paper,
 * a long paragraph splits between its own text lines at the page boundary, and the band made of
 * bottom margin + sheet gap + top margin holds no text at all.
 *
 * This test measures where text actually lands. Every text line rect must lie entirely inside some
 * sheet's text column. It also guards the two defects that made the previous engine unusable: a
 * scroll container taller than its content, and a render loop that never settles.
 *
 * Requires Chrome started with --remote-debugging-port=9222 and the dev server on :9000.
 * Opens a new tab in the existing window, closes only that tab, and restores the localStorage keys
 * it shares with any other open tab.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, '..', 'screenshots')
const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '')
const EDITOR_URL = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'
const DOCUMENT = process.env.PAGINATION_DOC || 'tesis4'
const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const probe = await fetch(`${CDP}/json/version`).catch(() => null)
if (!probe || !probe.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}. Start Chrome with --remote-debugging-port=9222.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await probe.json()
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
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

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
let persistedBefore = null

const evaluate = async (expression) => {
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
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) }
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

await call('Page.enable', {}, sessionId)
await call('Runtime.enable', {}, sessionId)
for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2000)
persistedBefore = await evaluate(`(() => { const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o })()`)

await evaluate(`(() => { window.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__raf++; return o(cb) }; return 1 })()`)

// open the document under test
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
await sleep(6000)

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// ---------------------------------------------------------------------------
console.log(`\nDocument under test: ${DOCUMENT}`)
const geometry = await evaluate(`(() => {
  const pc = document.querySelector('.umo-page-content')
  const pm = document.querySelector('.ProseMirror')
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px'
  pc.appendChild(ruler)
  const measure = (v, fallback) => {
    ruler.style.height = 'var(' + v + ', ' + fallback + ')'
    return ruler.getBoundingClientRect().height
  }
  const pageH = measure('--umo-page-height', '29.7cm')
  const mTop = measure('--umo-page-margin-top', '0cm')
  const mBot = measure('--umo-page-margin-bottom', '0cm')
  const gap = measure('--umo-page-sheet-gap', '16px')
  ruler.remove()

  const origin = pc.getBoundingClientRect().top
  const lines = []
  const walk = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = walk.nextNode())) {
    if (!n.textContent || !n.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      if (r.height > 0 && r.width > 0) lines.push({ top: r.top - origin, bottom: r.bottom - origin, text: n.textContent.trim().slice(0, 30) })
    }
  }
  lines.sort((a, b) => a.top - b.top)

  const stride = pageH + gap
  const offenders = []
  for (const l of lines) {
    const sheet = Math.floor(l.top / stride)
    const colTop = sheet * stride + mTop
    const colBottom = sheet * stride + pageH - mBot
    // allow a sub-pixel tolerance for rounding in line boxes
    if (l.top < colTop - 1 || l.bottom > colBottom + 1) {
      offenders.push({ sheet: sheet + 1, top: Math.round(l.top), bottom: Math.round(l.bottom),
                       colTop: Math.round(colTop), colBottom: Math.round(colBottom), text: l.text })
    }
  }

  const sc = document.querySelector('.umo-zoomable-container')
  const zc = document.querySelector('.umo-zoomable-content')
  return {
    pageH, mTop, mBot, gap, columnHeight: pageH - mTop - mBot,
    lineCount: lines.length,
    contentHeight: pc.clientHeight,
    forcedHeight: parseFloat(zc.style.height) || zc.getBoundingClientRect().height,
    scrollHeight: sc.scrollHeight, viewport: sc.clientHeight,
    offenders: offenders.length, sample: offenders.slice(0, 8),
    sheets: Math.max(1, Math.ceil(pc.clientHeight / stride)),
  }
})()`)

const r = Math.round
console.log(`  sheet ${r(geometry.pageH)}px, margins top ${r(geometry.mTop)}px / bottom ${r(geometry.mBot)}px, gap ${r(geometry.gap)}px`)
console.log(`  text column per sheet: ${r(geometry.columnHeight)}px`)
console.log(`  ${geometry.lineCount} text lines across about ${geometry.sheets} sheets\n`)

check(
  'every text line sits inside a sheet text column',
  geometry.offenders === 0,
  `${geometry.offenders} of ${geometry.lineCount} lines fall in the bottom-margin / gap / top-margin band`,
)
for (const o of geometry.sample) {
  console.log(`          sheet ${o.sheet}: line ${o.top}-${o.bottom}px vs column ${o.colTop}-${o.colBottom}px  "${o.text}"`)
}

check(
  'the scroll container is not taller than its content',
  Math.abs(geometry.forcedHeight - geometry.contentHeight) <= 2,
  `container ${r(geometry.forcedHeight)}px vs content ${r(geometry.contentHeight)}px`,
)

const raf1 = await evaluate(`window.__raf`)
await sleep(2000)
const raf2 = await evaluate(`window.__raf`)
check('the page settles when idle', raf2 - raf1 <= 4, `${raf2 - raf1} animation frames scheduled in 2 s while idle`)

// The container animates scrolling (scroll-behavior: smooth), so read the value only once it has
// stopped moving. Sampling mid-flight would report a false failure.
const scroll = await evaluate(`(async () => {
  const sc = document.querySelector('.umo-zoomable-container')
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (sc.scrollTop === last) return sc.scrollTop
      last = sc.scrollTop
    }
    return sc.scrollTop
  }
  sc.scrollTop = sc.scrollHeight
  const bottom = await settle()
  sc.scrollTop = 0
  const backToTop = await settle()
  return { bottom, backToTop, maxScrollTop: sc.scrollHeight - sc.clientHeight }
})()`)
check('scrolling reaches the true bottom', Math.abs(scroll.bottom - scroll.maxScrollTop) <= 2, `stopped at ${scroll.bottom} of ${scroll.maxScrollTop}`)
check('scrolling returns to the top', scroll.backToTop === 0, `landed at ${scroll.backToTop} after scrolling back from ${scroll.bottom}`)

// ---------------------------------------------------------------------------
// The spacers are decorations, so they must never reach the document, the saved HTML or the JSON.
// If they ever did, every save file would carry them and reopening would compound them.
const leak = await evaluate(`(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  let inst = el && el.__vueParentComponent
  let ed = null
  while (inst) { const p = inst.provides || {}; if (p.editor?.value?.state) { window.__p = p; ed = p.editor.value; break } inst = inst.parent }
  if (!ed) return { unreachable: true }
  window.__ed = ed
  return {
    renderedSpacers: document.querySelectorAll('.ProseMirror .umo-page-spacer').length,
    inHtml: ed.getHTML().includes('umo-page-spacer'),
    inJson: JSON.stringify(ed.getJSON()).includes('umo-page-spacer'),
    inText: ed.getText().includes('umo-page-spacer'),
  }
})()`)
check('spacers are rendered as decorations', !leak.unreachable && leak.renderedSpacers > 0, `${leak.renderedSpacers} spacer(s) in the view`)
check('spacers never reach the saved content', leak.inHtml === false && leak.inJson === false && leak.inText === false,
  `html ${leak.inHtml}, json ${leak.inJson}, text ${leak.inText}`)

// ---------------------------------------------------------------------------
// Editing must repaginate, and must not disturb the document itself.
const liveStats = `(() => {
  const pc = document.querySelector('.umo-page-content')
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px'
  pc.appendChild(ruler)
  const m = (v, f) => { ruler.style.height = 'var(' + v + ', ' + f + ')'; return ruler.getBoundingClientRect().height }
  const pageH = m('--umo-page-height', '29.7cm'), mTop = m('--umo-page-margin-top', '0cm')
  const mBot = m('--umo-page-margin-bottom', '0cm'), gap = m('--umo-page-sheet-gap', '16px')
  ruler.remove()
  const stride = pageH + gap, origin = pc.getBoundingClientRect().top
  const pm = document.querySelector('.ProseMirror')
  let bad = 0
  const offenders = []
  const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = w.nextNode())) {
    if (!n.textContent || !n.textContent.trim()) continue
    const r = document.createRange(); r.selectNodeContents(n)
    for (const c of r.getClientRects()) {
      if (c.height <= 0) continue
      const top = c.top - origin, bottom = c.bottom - origin, sheet = Math.floor(top / stride)
      const colTop = sheet * stride + mTop, colBottom = sheet * stride + pageH - mBot
      if (top < colTop - 1 || bottom > colBottom + 1) {
        bad++
        if (offenders.length < 6) offenders.push({ sheet: sheet + 1, top: Math.round(top), bottom: Math.round(bottom),
          colTop: Math.round(colTop), colBottom: Math.round(colBottom), text: n.textContent.trim().slice(0, 30) })
      }
    }
  }
  return { bad, offenders, spacers: pm.querySelectorAll('.umo-page-spacer').length,
           marginBottom: Math.round(mBot), marginTop: Math.round(mTop),
           pageHeight: Math.round(pageH), stride: Math.round(stride),
           chars: window.__ed.state.doc.textContent.length }
})()`

const MARKER = 'PAGINATION PROBE MARKER. '
const baseline = await evaluate(liveStats)
await evaluate(`(() => { window.__ed.commands.focus('start'); return 1 })()`)
await sleep(400)
await call('Input.insertText', { text: MARKER }, sessionId)
await sleep(2500)
const typed = await evaluate(liveStats)
check('typing repaginates instead of dropping the page breaks', typed.bad === 0 && typed.spacers > 0,
  `${typed.bad} lines in the band, ${typed.spacers} spacers`)
check('typed text reaches the document', typed.chars === baseline.chars + MARKER.length,
  `${baseline.chars} -> ${typed.chars} characters`)

await evaluate(`(() => { window.__ed.commands.undo(); return 1 })()`)
await sleep(2500)
const undone = await evaluate(liveStats)
const markerGone = await evaluate(`!window.__ed.state.doc.textContent.includes(${JSON.stringify(MARKER.trim())})`)
check('undo restores the document exactly', undone.chars === baseline.chars && markerGone,
  `${undone.chars} characters, marker removed: ${markerGone}`)
check('undo leaves the page breaks correct', undone.bad === 0 && undone.spacers > 0,
  `${undone.bad} lines in the band, ${undone.spacers} spacers`)

// A margin change alters the geometry without touching the document, which the engine cannot see
// from document changes alone.
await evaluate(`(() => { window.__p.page.value.margin.bottom = 6; return 1 })()`)
await sleep(3000)
const remargined = await evaluate(liveStats)
check('changing the bottom margin repaginates', remargined.bad === 0 && remargined.marginBottom > baseline.marginBottom,
  `bottom margin ${baseline.marginBottom}px -> ${remargined.marginBottom}px, ${remargined.bad} lines in the band, ${remargined.spacers} spacers`)
for (const o of remargined.offenders || []) {
  console.log(`          sheet ${o.sheet}: line ${o.top}-${o.bottom} vs column ${o.colTop}-${o.colBottom}  "${o.text}"`)
}
await evaluate(`(() => { window.__p.page.value.margin.bottom = 3; return 1 })()`)
await sleep(2500)

// ---------------------------------------------------------------------------
// Export builds its own document from the live DOM. The spacers must not travel with it, or their
// blank space would stack on top of the browser's own @page breaks in the PDF.
const printHtml = await evaluate(`(async () => {
  const p = window.__p
  if (!p || !p.exportFile) return { unreachable: true }
  p.exportFile.value.pdf = true
  await new Promise(r => setTimeout(r, 1500))
  const iframe = document.querySelector('.umo-print-iframe')
  const srcdoc = iframe ? iframe.getAttribute('srcdoc') || '' : ''
  const dialog = [...document.querySelectorAll('.t-dialog')].find(d => d.offsetParent !== null)
  if (dialog) {
    const cancel = [...dialog.querySelectorAll('button')].find(b => /cancel|batal/i.test(b.textContent))
    if (cancel) cancel.click()
  }
  p.exportFile.value.pdf = false
  await new Promise(r => setTimeout(r, 500))
  // Parse rather than string-match: the stylesheet legitimately mentions --umo-page-total-height as a
  // CSS fallback, and only the inline value on the sheet element would distort the print layout.
  const parsed = new DOMParser().parseFromString(srcdoc, 'text/html')
  const sheet = parsed.querySelector('.umo-page-content')
  return {
    built: srcdoc.length > 0,
    hasSpacer: parsed.querySelectorAll('.umo-page-spacer').length > 0,
    inlinePaddedHeight: sheet ? sheet.style.getPropertyValue('--umo-page-total-height') : 'NO_SHEET',
    carriesText: srcdoc.includes('Latar Belakang'),
  }
})()`)
if (printHtml.unreachable) {
  check('the exported document excludes the screen spacers', false, 'could not reach the export state')
} else {
  check('the export document is built from the live page', printHtml.built && printHtml.carriesText, `srcdoc built: ${printHtml.built}, carries text: ${printHtml.carriesText}`)
  check('the exported document excludes the screen spacers', printHtml.hasSpacer === false && printHtml.inlinePaddedHeight === '',
    `spacer elements: ${printHtml.hasSpacer}, inline padded height: ${JSON.stringify(printHtml.inlinePaddedHeight)}`)
}

await mkdir(SHOTS, { recursive: true })
const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await writeFile(path.join(SHOTS, 'pagination-geometry-top.png'), Buffer.from(shot.data, 'base64'))
await evaluate(`(() => { document.querySelector('.umo-zoomable-container').scrollTop = ${Math.round(geometry.pageH * 0.75)}; return 1 })()`)
await sleep(800)
const shot2 = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await writeFile(path.join(SHOTS, 'pagination-geometry-boundary.png'), Buffer.from(shot2.data, 'base64'))
console.log('\nscreenshots: tests/screenshots/pagination-geometry-top.png, pagination-geometry-boundary.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- no text sits in the margin or gap band.')
await finish(0)
