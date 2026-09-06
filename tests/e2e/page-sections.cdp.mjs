/**
 * Page size, margins and orientation belong to a section, not to the whole document.
 *
 * A section runs from one page break to the next. The first is opened by the document itself and
 * keeps its geometry in the document settings, exactly where it always was; every later one keeps it
 * on the page break that opened it, so it travels with the content. Each break carries a short name
 * that is drawn on its own line and quoted by the menus, so a writer can see which run of pages a
 * change covers before making it.
 *
 * This test builds its own document and drives the real menu with real clicks.
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

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', {
  targetId,
  flatten: true,
})
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
// A verdict must not depend on how wide the user left their window.
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
const evaluate = async (expression) => {
  const r = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ||
        JSON.stringify(r.exceptionDetails),
    )
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
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
process.on('uncaughtException', async (e) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
})
process.on('unhandledRejection', async (e) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
})

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
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
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

const clickAt = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await call(
      'Input.dispatchMouseEvent',
      { type, x, y, button: 'left', clickCount: 1 },
      sessionId,
    )
  }
}
const clickText = async (selector, text) => {
  const at = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0) return null
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!at) return null
  await clickAt(at.x, at.y)
  return at
}

// Three sections: two page breaks, nothing set on either, so this is what every document written
// before sections existed looks like.
const build = `(async () => {
  const filler = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: (t + ' ').repeat(60) }] })
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'FIRST SECTION' }] }, filler('One.'),
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'SECOND SECTION' }] }, filler('Two.'),
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'THIRD SECTION' }] }, filler('Three.'),
  ] })
  window.__p.page.value.zoomLevel = 50
  await new Promise((r) => setTimeout(r, 3000))
  return true
})()`

console.log('\nCase A: every page break carries a name, and wears it')
await evaluate(build)
const named = await evaluate(`(() => {
  const ids = []
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') ids.push(n.attrs.id) })
  return {
    ids,
    labels: [...document.querySelectorAll('.pdoc-page-break')].map((e) => e.getAttribute('data-content')),
  }
})()`)
check(
  'both breaks were given a name',
  named.ids.length === 2 &&
    named.ids.every((id) => typeof id === 'string' && id.length > 0),
  JSON.stringify(named.ids),
)
check(
  'the names are short enough to read off the line',
  named.ids.every((id) => id.length <= 6),
  JSON.stringify(named.ids),
)
check(
  'the names differ',
  new Set(named.ids).size === 2,
  JSON.stringify(named.ids),
)
check(
  'each name is drawn on its own break',
  named.labels.join(' | ') ===
    named.ids.map((id) => `Page Break ${id}`).join(' | '),
  JSON.stringify(named.labels),
)

console.log('\nCase B: a duplicated break is renamed rather than left a twin')
const twins = await evaluate(`(async () => {
  const html = window.__ed.getHTML()
  const brk = html.match(/<div class="pdoc-page-break"[^>]*><\\/div>/)[0]
  window.__ed.commands.setContent(html + brk + '<p>after the copy</p>')
  await new Promise((r) => setTimeout(r, 1200))
  const ids = []
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') ids.push(n.attrs.id) })
  return ids
})()`)
check(
  'the copy did not keep the original name',
  new Set(twins).size === twins.length,
  JSON.stringify(twins),
)

console.log('\nCase C: the menu says which pages a change would cover')
await evaluate(build)
await evaluate(`(() => {
  let pos = null
  window.__ed.state.doc.descendants((n, p) => { if (n.isText && n.text.includes('SECOND SECTION')) pos = p + 3 })
  window.__ed.commands.focus(pos)
  return true
})()`)
await clickText('.pdoc-ribbon-tabs-item', 'Page')
await sleep(700)
await clickText(
  '.pdoc-toolbar .pdoc-button, .pdoc-toolbar button',
  'Orientation',
)
await sleep(700)
const middle = await evaluate(`(() => {
  const ids = []
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') ids.push(n.attrs.id) })
  const note = document.querySelector('.pdoc-page-section-note .note')
  return { ids, note: note ? note.textContent.trim() : null }
})()`)
check(
  'the menu carries a line saying what a change covers',
  Boolean(middle.note),
  JSON.stringify(middle.note),
)
check(
  'and it names the break each end of this run',
  middle.note ===
    `Applied from page break ${middle.ids[0]} to page break ${middle.ids[1]}`,
  JSON.stringify(middle.note),
)
const shotMenu = await call(
  'Page.captureScreenshot',
  { format: 'png' },
  sessionId,
)
await mkdir(SHOTS, { recursive: true })
await writeFile(
  path.join(SHOTS, 'page-sections-menu.png'),
  Buffer.from(shotMenu.data, 'base64'),
)

console.log('\nCase D: turning the paper turns that run of pages and no other')
const before = await evaluate(`(() => {
  const s = window.__ed.extensionStorage.pagination.sheets
  return { widths: s.map((x) => Math.round(x.width)), sections: s.map((x) => x.section) }
})()`)
await clickText(
  '.pdoc-page-orientation-dropdown .pdoc-dropdown__item',
  'Landscape',
)
await sleep(4000)
const after = await evaluate(`(() => {
  const storage = window.__ed.extensionStorage.pagination
  const s = storage.sheets
  const attrs = []
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') attrs.push(n.attrs.sectionOrientation) })
  // Every rendered line against the column of the sheet it is on. This is the rendered result, which
  // is what the reader sees, rather than the settings that were stored.
  const host = document.querySelector('.pdoc-page-content')
  const origin = host.getBoundingClientRect().top
  const sheetAt = (y) => { let i = 0; while (i + 1 < s.length && y >= s[i + 1].top) i += 1; return i }
  let escapes = 0
  const walker = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue
    const range = document.createRange(); range.selectNodeContents(node)
    for (const r of range.getClientRects()) {
      if (r.height <= 0 || r.width <= 0) continue
      const box = s[sheetAt(r.top - origin)]
      if (!box) continue
      if (r.bottom - origin > box.top + box.height - box.marginBottom + 2) escapes += 1
      if (r.top - origin < box.top + box.marginTop - 2) escapes += 1
    }
  }
  return {
    widths: s.map((x) => Math.round(x.width)),
    heights: s.map((x) => Math.round(x.height)),
    sections: s.map((x) => x.section),
    attrs,
    escapes,
    solve: storage.solve,
    documentOrientation: window.__p.page.value.orientation,
  }
})()`)
const shotApplied = await call(
  'Page.captureScreenshot',
  { format: 'png' },
  sessionId,
)
await writeFile(
  path.join(SHOTS, 'page-sections-landscape.png'),
  Buffer.from(shotApplied.data, 'base64'),
)

check(
  'the change was written on the break that opens the run',
  after.attrs[0] === 'landscape',
  JSON.stringify(after.attrs),
)
check(
  'and not on the document, which the first section still uses',
  after.documentOrientation === 'portrait',
  after.documentOrientation,
)
check(
  // The change must stop where the menu said it stops. A break with nothing set carries the section
  // before it on, so without pinning it the whole rest of the document turned with this one.
  'the next break was pinned to what it was already drawn at',
  after.attrs[1] === 'portrait',
  JSON.stringify(after.attrs),
)
// The sheets are the rendered result, which is what a reader sees. A landscape A4 is wider than tall.
const bySection = (list, section) =>
  list.widths.filter((_, i) => list.sections[i] === section)
check(
  'the first section is still drawn portrait',
  bySection(after, 0).length > 0 &&
    bySection(after, 0).every((w) => w === bySection(before, 0)[0]),
  `${JSON.stringify(bySection(before, 0))} -> ${JSON.stringify(bySection(after, 0))}`,
)
check(
  'the second section is drawn wider than it is tall',
  after.sections.some((s, i) => s === 1 && after.widths[i] > after.heights[i]),
  JSON.stringify(
    after.widths.map((w, i) => [after.sections[i], w, after.heights[i]]),
  ),
)
check(
  'and the section after it is left portrait, as the menu said it would be',
  after.sections.includes(2) &&
    after.sections.every(
      (s, i) => s !== 2 || after.widths[i] < after.heights[i],
    ),
  JSON.stringify(
    after.widths.map((w, i) => [after.sections[i], w, after.heights[i]]),
  ),
)
// A solve that gives up leaves the rest of the document sitting in the margin band, and from the
// outside that looks exactly like a solve that finished.
check(
  'the engine paginated the whole document rather than giving up',
  after.solve?.stopped === 'settled',
  JSON.stringify(after.solve),
)
check(
  'and no line ended up outside the column of its sheet',
  after.escapes === 0,
  `${after.escapes} line(s) outside a column`,
)
check(
  'a sheet is drawn for every page, at its own size',
  (await evaluate(`document.querySelectorAll('.pdoc-page-sheet').length`)) ===
    after.widths.length,
  `${after.widths.length} sheet(s)`,
)

console.log('\nCase E: the geometry survives being written out and read back')
const roundTrip = await evaluate(`(async () => {
  const html = window.__ed.getHTML()
  window.__ed.commands.setContent(html)
  await new Promise((r) => setTimeout(r, 1500))
  const attrs = []
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') attrs.push({ o: n.attrs.sectionOrientation, id: n.attrs.id }) })
  const s = window.__ed.extensionStorage.pagination.sheets
  return { attrs, wide: s.some((x) => x.width > x.height), carriedInHtml: html.includes('data-section-orientation="landscape"') }
})()`)
check('the saved HTML carries the section', roundTrip.carriedInHtml === true)
check(
  'reading it back restores the orientation',
  roundTrip.attrs[0]?.o === 'landscape',
  JSON.stringify(roundTrip.attrs),
)
check('and the pages are drawn turned again', roundTrip.wide === true)

console.log(
  '\nCase F: a document that sets no section is laid out exactly as before',
)
const plain = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'PLAIN' }] },
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'STILL PLAIN' }] },
  ] })
  await new Promise((r) => setTimeout(r, 2500))
  const s = window.__ed.extensionStorage.pagination.sheets
  return {
    widths: [...new Set(s.map((x) => Math.round(x.width)))],
    marked: document.querySelectorAll('.ProseMirror > [data-pdoc-section]').length,
    inset: document.querySelector('.ProseMirror > p')?.style.marginLeft || '',
    html: window.__ed.getHTML().includes('data-section-'),
  }
})()`)
check(
  'every sheet is the same width',
  plain.widths.length === 1,
  JSON.stringify(plain.widths),
)
check(
  'no block was given a section inset',
  plain.marked === 0,
  `${plain.marked} marked block(s)`,
)
check(
  'and no block carries a margin of its own',
  plain.inset === '',
  JSON.stringify(plain.inset),
)
check('nothing about sections reaches the saved document', plain.html === false)

console.log(
  `\nscreenshots: ${path.join(SHOTS, 'page-sections-menu.png')}, ${path.join(SHOTS, 'page-sections-landscape.png')}`,
)
if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- page geometry belongs to the run of pages between two breaks.',
)
await finish(0)
