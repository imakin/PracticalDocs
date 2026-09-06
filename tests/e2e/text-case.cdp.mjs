/**
 * The three case buttons in the selection bar.
 *
 * Press one, the selected text changes case. Nothing else about it changes: bold, links, colours and
 * fonts stay exactly where they were, which is why the text is replaced run by run rather than
 * wholesale.
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
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// One bold word, so a lost mark shows up as plainly as a wrong letter.
const SOURCE = '<p>evaluating <strong>cnn</strong> model trade-off (edge)</p>'
const press = async (label) =>
  evaluate(`(async () => {
    window.__ed.commands.setContent(${JSON.stringify(SOURCE)})
    window.__ed.commands.selectAll()
    window.__ed.commands.focus()
    await new Promise((r) => setTimeout(r, 1200))
    const bar = document.querySelector('.pdoc-editor-bubble-menu')
    const button = [...bar.querySelectorAll('button, .pdoc-menu-button')]
      .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)})
    if (!button) throw new Error('no button labelled ' + ${JSON.stringify(label)})
    button.click()
    await new Promise((r) => setTimeout(r, 800))
    const html = window.__ed.getHTML()
    return { text: window.__ed.state.doc.textContent, bold: (html.match(/<(?:b|strong)>([^<]*)<\\/(?:b|strong)>/) || [])[1] ?? null }
  })()`)

console.log('\nThe three buttons are in the selection bar')
const labels = await evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(SOURCE)})
  window.__ed.commands.selectAll()
  window.__ed.commands.focus()
  await new Promise((r) => setTimeout(r, 1200))
  const bar = document.querySelector('.pdoc-editor-bubble-menu')
  return bar ? [...bar.querySelectorAll('button, .pdoc-menu-button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()) : []
})()`)
for (const label of ['UPPERCASE', 'lowercase', 'Capitalize']) {
  check(`the bar offers ${label}`, labels.includes(label), JSON.stringify(labels))
}

console.log('\nPressing one changes the case of the selection, and nothing else')
for (const [label, expected] of [
  ['UPPERCASE', 'EVALUATING CNN MODEL TRADE-OFF (EDGE)'],
  ['lowercase', 'evaluating cnn model trade-off (edge)'],
  ['Capitalize', 'Evaluating Cnn Model Trade-Off (Edge)'],
]) {
  const result = await press(label)
  check(`${label} gives the expected text`, result.text === expected, `${JSON.stringify(result.text)} vs ${JSON.stringify(expected)}`)
  check(`${label} leaves the bold word bold`, Boolean(result.bold), `bold run: ${JSON.stringify(result.bold)}`)
}

console.log('\nWith nothing selected the command does nothing')
const idle = await evaluate(`(() => {
  window.__ed.commands.setContent('<p>unchanged</p>')
  window.__ed.commands.setTextSelection(1)
  const ran = window.__ed.commands.setTextCase('upper')
  return { ran, text: window.__ed.state.doc.textContent }
})()`)
check('the command reports that it did nothing', idle.ran === false, String(idle.ran))
check('the document is untouched', idle.text === 'unchanged', JSON.stringify(idle.text))

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the case buttons change case and leave marks alone.')
await finish(0)
