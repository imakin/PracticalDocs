/**
 * A cross-reference wears the styling the writer gives it.
 *
 * It used to wear the primary colour and an underline no matter what, because the rule painted them
 * on the anchor itself while a mark renders as a span wrapping that anchor. Bold came through and
 * colour never did. Print copies every stylesheet on the page, so the exported PDF was blue too.
 *
 * This test uses its own synthetic document, so it does not depend on whatever the user is working on.
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
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const insert = async (paragraphText) => {
  const out = await evaluate(`(async () => {
    const ed = window.__ed
    ed.commands.setContent({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Pendahuluan' }] },
      { type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(paragraphText)} }] },
    ] })
    await new Promise((r) => setTimeout(r, 2500))
    let targets = []
    ed.commands.getReferenceTargets((items) => { targets = items })
    const targetId = targets.find((t) => t.targetType === 'heading')?.targetId
    if (!targetId) return { error: 'no heading target was offered' }
    let end = null
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('Lihat')) {
        end = pos + node.nodeSize - 1
      }
    })
    if (end === null) return { error: 'the paragraph was not found' }
    ed.commands.setTextSelection(end)
    ed.commands.insertCrossReference({ targetId, displayMode: 'label' })
    await new Promise((r) => setTimeout(r, 800))
    let pos = null
    ed.state.doc.descendants((node, p) => { if (node.type.name === 'crossReference') pos = p })
    return { pos, targetId }
  })()`)
  assert.equal(out.error, undefined, out.error)
  return out
}

// What the reader sees, which is the only thing this test is about. `getComputedStyle` resolves the
// cascade, so a rule that repaints a mark shows up here and nowhere in the document's own state.
const painted = () => evaluate(`(() => {
  const el = document.querySelector('.pdoc-cross-reference')
  if (!el) return null
  const style = getComputedStyle(el)
  const around = getComputedStyle(el.closest('p'))
  return {
    color: style.color,
    fontWeight: style.fontWeight,
    decoration: style.textDecorationLine,
    text: el.textContent,
    aroundColor: around.color,
  }
})()`)

console.log('\nCase A: with nothing applied, a reference is the colour of the text around it')
await insert('Lihat di sini: ')
const plain = await painted()
check('the reference is drawn', Boolean(plain), JSON.stringify(plain))
check(
  'it takes the colour of its paragraph',
  plain?.color === plain?.aroundColor,
  `reference ${plain?.color} vs paragraph ${plain?.aroundColor}`,
)
check('and it carries no underline of its own', plain?.decoration === 'none', `${plain?.decoration}`)
check('while still reading as the target it points at', plain?.text === 'BAB I', JSON.stringify(plain?.text))

console.log('\nCase B: a colour and a weight the writer applies both reach the page')
const styled = await evaluate(`(async () => {
  const ed = window.__ed
  let pos = null
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'crossReference') pos = p })
  ed.chain().setTextSelection({ from: pos, to: pos + 1 }).toggleBold().run()
  ed.chain().setTextSelection({ from: pos, to: pos + 1 }).setColor('#c00000').run()
  await new Promise((r) => setTimeout(r, 800))
  let marks = []
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'crossReference') marks = node.marks.map((m) => m.type.name)
  })
  return marks
})()`)
check(
  'the marks reach the node',
  styled.includes('bold') && styled.includes('textStyle'),
  JSON.stringify(styled),
)
const marked = await painted()
check('the colour is the one that was applied', marked?.color === 'rgb(192, 0, 0)', `${marked?.color}`)
check('and so is the weight', marked?.fontWeight === '700', `${marked?.fontWeight}`)

console.log('\nCase C: a reference whose target is gone stays visible whatever is applied to it')
const missing = await evaluate(`(async () => {
  const ed = window.__ed
  let range = null
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') range = { from: pos, to: pos + node.nodeSize }
  })
  ed.commands.deleteRange(range)
  await new Promise((r) => setTimeout(r, 1200))
  const el = document.querySelector('.pdoc-cross-reference')
  return {
    flagged: el?.getAttribute('data-missing'),
    color: el ? getComputedStyle(el).color : null,
    decoration: el ? getComputedStyle(el).textDecorationLine : null,
  }
})()`)
check('it is flagged missing', missing.flagged === 'true', JSON.stringify(missing.flagged))
check(
  'and it is not left wearing the colour the writer chose',
  missing.color !== 'rgb(192, 0, 0)',
  `${missing.color}`,
)
check('it is underlined to say so', missing.decoration === 'underline', `${missing.decoration}`)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'cross-reference-styling.png'), Buffer.from(shot.data, 'base64'))
console.log('\nscreenshot written to tests/screenshots/cross-reference-styling.png')

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a cross-reference wears the styling the writer gives it.')
await finish(0)
