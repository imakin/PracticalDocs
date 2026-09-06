/**
 * A per-block override set from the toolbar must survive the sync.
 *
 * Before ADR 0007 the profile was written into node attributes on every sync, which are the same
 * attributes the toolbar writes, so profile-set and hand-set values were indistinguishable and the
 * next sync erased the user's choice. Now the profile is a CSS rule, a block carries only its class,
 * and an inline style means exactly one thing: an override, which beats the class by specificity.
 *
 * The toolbar components call these commands with nothing in between - `line-height.vue` runs
 * `setLineHeight(value)` and `margin.vue` runs `setMargin({...})` - so exercising the commands
 * exercises the toolbar path.
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
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}
const state = () => `(() => {
  const p = document.querySelector('.ProseMirror p')
  const cs = getComputedStyle(p)
  let attrs = null
  window.__ed.state.doc.descendants((n) => { if (!attrs && n.type.name === 'paragraph') attrs = { lineHeight: n.attrs.lineHeight, marginBottom: n.attrs.margin && n.attrs.margin.bottom } })
  return { lineHeight: cs.lineHeight, marginBottom: cs.marginBottom, inline: p.getAttribute('style'), cls: p.className, attrs }
})()`
const reset = () => evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', attrs: { numberingProfileId: 'profile-paragraph' }, content: [{ type: 'text', text: 'Paragraf uji override.' }] } ] })
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1200))
  return true
})()`)

console.log('\nCase A: with no override, the block follows its profile through the class alone')
await reset()
const base = await evaluate(state())
check('the block carries its profile class', /pdoc-profile-paragraph/.test(base.cls || ''), base.cls)
check('it has no inline style', base.inline === null, JSON.stringify(base.inline))
check('the class supplies the profile line height', base.lineHeight === '24px', base.lineHeight)
check('the class supplies the profile bottom margin', base.marginBottom === '4px', base.marginBottom)

console.log('\nCase B: a toolbar override lands, and survives a sync and further typing')
await evaluate(`(() => { window.__ed.commands.selectAll(); window.__ed.commands.setLineHeight('3'); window.__ed.commands.setMargin({ bottom: '2.5em' }); return true })()`)
await sleep(800)
const applied = await evaluate(state())
check('the override renders as an inline style', /line-height: 3/.test(applied.inline || '') && /margin-bottom: 2\.5em/.test(applied.inline || ''), applied.inline)
check('the inline style beats the class', applied.lineHeight === '48px' && applied.marginBottom === '40px', `${applied.lineHeight} / ${applied.marginBottom}`)

await evaluate(`window.__ed.commands.syncDocumentReferences()`)
await sleep(1000)
const afterSync = await evaluate(state())
// This is the regression that mattered: the sync used to rewrite these attributes from the profile.
check('a sync does not erase the override', afterSync.lineHeight === '48px' && afterSync.marginBottom === '40px', `${afterSync.lineHeight} / ${afterSync.marginBottom}`)

await evaluate(`(() => { window.__ed.commands.focus('end'); window.__ed.commands.insertContent(' Tambahan.'); return true })()`)
await sleep(1200)
const afterTyping = await evaluate(state())
check('typing does not erase the override', afterTyping.lineHeight === '48px' && afterTyping.marginBottom === '40px', `${afterTyping.lineHeight} / ${afterTyping.marginBottom}`)

const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'block-overrides.png'), Buffer.from(shot.data, 'base64'))

console.log('\nCase C: the override survives being stored and loaded again')
const roundTrip = await evaluate(`(async () => {
  const p = location.pathname
  const base = location.origin + (p.endsWith('/') ? p : p + '/')
  const mod = await import(base + 'src/utils/profile-stylesheet.js')
  const stored = mod.composeDocumentHtml(window.__ed.getHTML(), [])
  window.__ed.commands.setContent(mod.extractDocumentHtml(stored))
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1500))
  return { stored }
})()`)
const afterLoad = await evaluate(state())
check('the stored html carries the override', /line-height: ?3/.test(roundTrip.stored) && /margin-bottom: ?2\.5em/.test(roundTrip.stored))
check('the override is still applied after loading', afterLoad.lineHeight === '48px' && afterLoad.marginBottom === '40px', `${afterLoad.lineHeight} / ${afterLoad.marginBottom}`)

console.log('\nCase D: applying a profile to the block clears the override again')
await evaluate(`(() => { window.__ed.commands.focus('start'); window.__ed.commands.applyNumberingProfile('profile-paragraph'); return true })()`)
await sleep(1200)
const reapplied = await evaluate(state())
check('the inline override is gone', !/line-height|margin-bottom/.test(reapplied.inline || ''), JSON.stringify(reapplied.inline))
check('the block is back on its profile values', reapplied.lineHeight === '24px' && reapplied.marginBottom === '4px', `${reapplied.lineHeight} / ${reapplied.marginBottom}`)

console.log('\nscreenshot written to tests/screenshots/block-overrides.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a per-block override survives the sync, storage and typing.')
await finish(0)
