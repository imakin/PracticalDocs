/**
 * A word in a list item is not cut in half.
 *
 * The user reported that paragraphs under bullets and numbering were breaking mid-word - `latensi`
 * coming out as `la` at one line end and `tensi` at the next start - while ordinary paragraphs of
 * the same prose were fine.
 *
 * The cause is one declaration: `.umo-list-item` carried `word-break: break-all`, which breaks
 * between any two characters rather than only when a word cannot fit a line by itself. It also made
 * the user's own Word Wrap setting unreachable for list text: the `wordWrap` extension emits nothing
 * for its `normal` default, so an inherited `break-all` could not be turned off from the toolbar at
 * all. Overflow was never the reason it was needed - `.umo-editor` already sets
 * `overflow-wrap: anywhere`, which breaks a genuinely over-long token and nothing else.
 *
 * This measures the invariant rather than the declaration: for every word in the fixture, the
 * rectangles of a Range over that word must sit on one line. It runs over all five alignments,
 * because the report said the fix has to hold for every one of them, and over a plain paragraph
 * carrying the same prose as the control that says the measurement can tell the difference.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'

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
// A viewport this test decides, not the one the writer's window happens to have. Line breaking is
// a function of the measure, so a test about line breaking that inherits an unknown width is not
// measuring anything repeatable.
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
    // Freeze the keys before restoring. A page that is still running will write over a plain
    // restore between the write and the tab closing - that is how a previous session destroyed the
    // user's profile list.
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
  await call('Target.closeTarget', { targetId }).catch(() => {})
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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// Ordinary prose, every word short enough to fit a line on its own, so any word found split is a
// break the layout chose rather than one it was forced into. The wording is the user's own subject
// matter, and long enough to wrap over several lines at this measure.
const PROSE = 'Menyajikan wawasan tentang pengaruh dan porsi overhead latensi terhadap latensi total dalam pengembangan dan kompresi model dengan keterbatasan sumber daya yang tersedia pada perangkat.'
const ALIGNMENTS = ['left', 'center', 'right', 'justify', 'distributed']

// A word is broken when the rectangles of a Range over it sit on more than one line. Only the text
// inside a list item's content is walked, so the markers - which are their own elements and are
// allowed to do as they like - cannot be mistaken for prose.
const MEASURE = `(() => {
  const brokenIn = (root) => {
    const out = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || ''
      const re = /[^\\s]+/g
      let m
      while ((m = re.exec(text))) {
        const range = document.createRange()
        range.setStart(node, m.index)
        range.setEnd(node, m.index + m[0].length)
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5)
        const tops = new Set(rects.map((r) => Math.round(r.top)))
        if (tops.size > 1) out.push(m[0])
      }
    }
    return out
  }
  const listRoots = [...document.querySelectorAll('.ProseMirror li')]
  // Only paragraphs carrying text. The editor keeps a trailing empty one, which has no lines and
  // would fail a wraps-over-several-lines check for a reason that has nothing to do with breaking.
  const paraRoots = [...document.querySelectorAll('.ProseMirror > p')].filter((p) => (p.textContent || '').trim().length > 0)
  const lines = (el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    return new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top))).size
  }
  return {
    listBroken: listRoots.flatMap(brokenIn),
    paraBroken: paraRoots.flatMap(brokenIn),
    listItems: listRoots.length,
    listLines: listRoots.map(lines),
    paraLines: paraRoots.map(lines),
    listWordBreak: listRoots.length ? getComputedStyle(listRoots[0].querySelector('p') || listRoots[0]).wordBreak : null,
  }
})()`

const build = async (align) => evaluate(`(async () => {
  const prose = ${JSON.stringify(PROSE)}
  const para = (text) => ({ type: 'paragraph', attrs: { textAlign: ${JSON.stringify(align)} }, content: [{ type: 'text', text }] })
  const item = () => ({ type: 'listItem', content: [para(prose)] })
  window.__ed.commands.setContent({ type: 'doc', content: [
    para(prose),
    { type: 'orderedList', content: [item(), item()] },
    { type: 'bulletList', content: [item()] },
  ] })
  await new Promise((r) => setTimeout(r, 900))
  return true
})()`)

let firstReport = null
for (const align of ALIGNMENTS) {
  console.log(`\nAlignment: ${align}`)
  await build(align)
  const report = await evaluate(MEASURE)
  if (!firstReport) firstReport = report

  check('the fixture built three list items', report.listItems === 3, `${report.listItems}`)
  // If the prose did not wrap there is no line end for a word to be cut at, and a green result
  // would mean nothing at all.
  check('the list prose wraps over several lines',
    report.listLines.every((n) => n >= 2), `lines per item ${JSON.stringify(report.listLines)}`)
  check('the control paragraph wraps too',
    report.paraLines.every((n) => n >= 2), `lines ${JSON.stringify(report.paraLines)}`)

  check('no word in a list item is cut across two lines',
    report.listBroken.length === 0,
    report.listBroken.length ? `cut: ${JSON.stringify(report.listBroken.slice(0, 6))}` : 'none')
  check('no word in the plain paragraph is cut either',
    report.paraBroken.length === 0,
    report.paraBroken.length ? `cut: ${JSON.stringify(report.paraBroken.slice(0, 6))}` : 'none')
}

console.log('\nWhat the list text resolves to')
// The declaration itself, once, so a future regression says which rule came back rather than only
// that something is cut. `break-all` is the value that was there; anything that breaks between two
// letters of a fitting word fails the checks above regardless of its name.
check('list text does not resolve to break-all',
  firstReport.listWordBreak !== 'break-all', `word-break: ${firstReport.listWordBreak}`)

console.log(`\nRESULT: ${failures.length === 0 ? 'PASSED' : 'FAILED'} -- ${ALIGNMENTS.length * 5 + 1} checks, ${failures.length} failed`)
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`))
await finish(failures.length === 0 ? 0 : 1)
