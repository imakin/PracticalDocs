/**
 * A table carries no text the user did not write.
 *
 * The table used to render a `<caption>` holding `label: caption`, composed by the editor from the
 * numbering profile. It was not editable in place and it could not survive a save: the table schema
 * is `tableRow+` and nothing parses `<caption>`, so reopening a saved file made ProseMirror fit that
 * text somewhere, and it wrapped it into a row. Every save and load grew the table by one row.
 *
 * This test drives the real editor. It asserts on what is rendered and on what a round trip through
 * the save format produces, not on the attribute the caption used to be stored in.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
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
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
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

const PERSISTED_KEYS = ['practicaldocs:default:document', 'practicaldocs:profiles']
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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; break }
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
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// The fixture. Two rows, four cells, and a heading so the table profile has an {h1} to number under.
// Nothing here is a caption; every word in it was typed.
const FIXTURE = [
  '<h1>Chapter</h1>',
  '<table><tbody>',
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>',
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>',
  '</tbody></table>',
].join('')

// A document written before captions were removed. This is what the old renderHTML produced, and
// opening it is what grew a row. Kept verbatim as the migration case.
const LEGACY = [
  '<h1>Chapter</h1>',
  '<table data-caption="Ringkasan" data-reference-id="ref-legacy-table">',
  '<caption class="pdoc-node-table-caption" contenteditable="false">Tabel 1: Ringkasan</caption>',
  '<tbody>',
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>',
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>',
  '</tbody></table>',
].join('')

const load = (html) => `(async () => {
  window.__ed.commands.setContent(${JSON.stringify(html)})
  await new Promise((r) => setTimeout(r, 1500))
  return true
})()`

// Rows, cell text, and any text the table renders that is not inside a cell. The last one is the
// point of the whole exercise: it is what the user saw and could not remove.
const inspect = `(() => {
  const table = document.querySelector('.ProseMirror table')
  if (!table) return { missing: true }
  const rows = [...table.querySelectorAll('tr')]
  const cellText = rows.map((tr) => [...tr.children].map((c) => (c.textContent || '').trim()).join('|'))
  const inCells = new Set()
  for (const cell of table.querySelectorAll('td, th')) {
    const inner = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null)
    let text
    while ((text = inner.nextNode())) inCells.add(text)
  }
  const stray = []
  const walk = document.createTreeWalker(table, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walk.nextNode())) {
    if (inCells.has(node)) continue
    const value = (node.textContent || '').trim()
    if (value) stray.push(value)
  }
  return {
    rows: rows.length,
    cellText,
    stray,
    captions: table.querySelectorAll('caption').length,
    html: window.__ed.getHTML(),
  }
})()`

console.log('\nA freshly built table renders nothing but its cells')
await evaluate(load(FIXTURE))
const fresh = await evaluate(inspect)
if (fresh.missing) {
  console.error('FAIL: the fixture produced no table')
  await finish(1)
}
check('the table has exactly the two rows it was given', fresh.rows === 2,
  `${fresh.rows} rows: ${JSON.stringify(fresh.cellText)}`)
check('the table renders no caption element', fresh.captions === 0, `${fresh.captions} caption element(s)`)
check('the table renders no text outside its cells', fresh.stray.length === 0, JSON.stringify(fresh.stray))
check('the saved html carries no caption', !fresh.html.includes('<caption'), fresh.html.slice(0, 200))
check('the saved html carries no composed label', !/Tabel\s*\d|Table\s*\d/.test(fresh.html), fresh.html.slice(0, 200))

console.log('\nSaving and reopening does not grow the table')
let previous = fresh
for (let cycle = 1; cycle <= 3; cycle += 1) {
  await evaluate(load(previous.html))
  const again = await evaluate(inspect)
  check(`round trip ${cycle} keeps two rows`, again.rows === 2,
    `${again.rows} rows: ${JSON.stringify(again.cellText)}`)
  check(`round trip ${cycle} keeps the cells unchanged`,
    JSON.stringify(again.cellText) === JSON.stringify(fresh.cellText),
    `${JSON.stringify(again.cellText)} vs ${JSON.stringify(fresh.cellText)}`)
  check(`round trip ${cycle} adds no text outside the cells`, again.stray.length === 0, JSON.stringify(again.stray))
  previous = again
}

console.log('\nA document written before the removal loses the caption instead of gaining a row')
await evaluate(load(LEGACY))
const migrated = await evaluate(inspect)
check('the legacy caption does not become a row', migrated.rows === 2,
  `${migrated.rows} rows: ${JSON.stringify(migrated.cellText)}`)
check('the legacy caption text is gone from the table', migrated.stray.length === 0, JSON.stringify(migrated.stray))
check('the legacy caption is not written back', !migrated.html.includes('Ringkasan'), migrated.html.slice(0, 300))
check('the legacy table keeps its reference id', migrated.html.includes('ref-legacy-table'), migrated.html.slice(0, 300))

await evaluate(load(migrated.html))
const migratedAgain = await evaluate(inspect)
check('reopening the migrated document still gives two rows', migratedAgain.rows === 2,
  `${migratedAgain.rows} rows: ${JSON.stringify(migratedAgain.cellText)}`)

console.log('\nThe caption dialog no longer applies to a table')
const attempted = await evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(FIXTURE)})
  await new Promise((r) => setTimeout(r, 1200))
  const cell = document.querySelector('.ProseMirror table td')
  const pos = window.__ed.view.posAtDOM(cell, 0)
  window.__ed.commands.setTextSelection(pos + 1)
  window.__ed.commands.focus()
  await new Promise((r) => setTimeout(r, 600))
  const applied = window.__ed.commands.setReferenceCaption('Ringkasan')
  await new Promise((r) => setTimeout(r, 600))
  return { applied, html: window.__ed.getHTML() }
})()`)
check('setting a caption inside a table is refused', attempted.applied === false, String(attempted.applied))
check('nothing was written into the document', !attempted.html.includes('Ringkasan'), attempted.html.slice(0, 300))

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a table renders only its cells, and a save and load cycle adds nothing.')
await finish(0)
