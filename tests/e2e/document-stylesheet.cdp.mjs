/**
 * A saved document must carry its own stylesheet, and loading it back must not import that CSS as
 * document text.
 *
 * Profiles are no longer written into every block as an inline style; a block carries the profile's
 * class and the stored file carries the generated rules. That makes the file small and hand-editable,
 * and it renders on its own from the folder. The risk this guards is the mirror image: a stylesheet
 * that reaches the parser becomes a paragraph of CSS at the top of the user's document.
 *
 * Every save request is intercepted and answered locally, so the storage server is never written to.
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
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
const pending = new Map()
const listeners = []
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  listeners.forEach((fn) => fn(msg))
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
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}
let bailing = false
const bailOut = async (error) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(error?.stack || String(error))
  await finish(1)
}
process.on('uncaughtException', bailOut)
process.on('unhandledRejection', bailOut)

await call('Page.enable', {}, sessionId)
await call('Runtime.enable', {}, sessionId)

const savePosts = []
await call('Fetch.enable', { patterns: [{ urlPattern: '*api/documents/save*', requestStage: 'Request' }] }, sessionId)
const corsHeaders = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS, PUT, DELETE' },
  { name: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
  { name: 'Content-Type', value: 'application/json; charset=utf-8' },
]
listeners.push(async (msg) => {
  if (msg.method !== 'Fetch.requestPaused' || msg.sessionId !== sessionId) return
  const { requestId, request } = msg.params
  if (request.method === 'POST') {
    let body = null
    try { body = JSON.parse(request.postData) } catch {}
    savePosts.push(body)
  }
  await call('Fetch.fulfillRequest', {
    requestId,
    responseCode: request.method === 'OPTIONS' ? 204 : 200,
    responseHeaders: corsHeaders,
    body: Buffer.from(JSON.stringify({ success: true, message: 'intercepted' })).toString('base64'),
  }, sessionId).catch(() => {})
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
    if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  if (!window.__ed) return 'NO_EDITOR'
  return typeof window.__p.saveContent === 'function' ? 'OK' : 'NO_SAVE_CONTENT'
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
const shoot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, `document-stylesheet-${name}.png`), Buffer.from(shot.data, 'base64'))
}

console.log('\nCase A: a saved document carries its stylesheet and its blocks carry classes')
await evaluate(`(() => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, numberingProfileId: 'profile-h1' }, content: [{ type: 'text', text: 'PENDAHULUAN' }] },
    { type: 'heading', attrs: { level: 2, numberingProfileId: 'profile-h2' }, content: [{ type: 'text', text: 'Latar Belakang' }] },
    { type: 'paragraph', attrs: { numberingProfileId: 'profile-paragraph' }, content: [{ type: 'text', text: 'Kalimat isi dokumen.' }] } ] })
  window.__ed.commands.syncDocumentReferences()
  return true
})()`)
await sleep(1200)
savePosts.length = 0
await evaluate(`window.__p.saveContent(false)`)
for (let i = 0; i < 40; i += 1) { if (savePosts.some(Boolean)) break; await sleep(200) }
await shoot('case-a-saved')

const saved = savePosts.find(Boolean)
check('a save POST was issued', Boolean(saved), `${savePosts.length} POST(s)`)
const storedHtml = String(saved?.html || '')
check('the stored document opens with the generated stylesheet', /^<style data-umo-profiles>/.test(storedHtml), storedHtml.slice(0, 40))
check('the stylesheet defines the counters', storedHtml.includes('counter-reset'), 'counter-reset present')
check('the blocks are wrapped in the scope element', storedHtml.includes('<div class="umo-document">'))
check('blocks carry their profile class', /<h1[^>]*class="[^"]*umo-profile-h1/.test(storedHtml))
check('no block carries an inline profile style', !/<(h1|h2|p)[^>]*\sstyle="/.test(storedHtml), 'no style= on blocks')
check('the derived numbering attributes are gone', !/data-reference-number|data-number-style|data-number-template|data-numbering-profile-id/.test(storedHtml))
check('the stable reference id survives', /data-reference-id="/.test(storedHtml))

console.log('\nCase B: loading it back restores the document without importing the CSS')
const reloaded = await evaluate(`(async () => {
  // The dev server's base path is not fixed, so resolve the module against the page itself rather
  // than guessing a root-relative path.
  // location.pathname has no trailing slash, so a relative URL would drop the base segment.
  const p = location.pathname
  const base = location.origin + (p.endsWith('/') ? p : p + '/')
  const bases = [base + 'src/utils/profile-stylesheet.js',
                 location.origin + '/src/utils/profile-stylesheet.js']
  let mod = null
  for (const url of bases) {
    try { mod = await import(url); break } catch {}
  }
  if (!mod) throw new Error('could not load profile-stylesheet.js from ' + JSON.stringify(bases))
  const body = mod.extractDocumentHtml(${JSON.stringify(storedHtml)})
  window.__ed.commands.setContent(body)
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1200))
  const out = []
  window.__ed.state.doc.descendants((n) => {
    if (['heading', 'paragraph'].includes(n.type.name)) {
      out.push({ type: n.type.name, profile: n.attrs.numberingProfileId, label: n.attrs.referenceLabel })
    }
  })
  return {
    text: window.__ed.state.doc.textContent,
    nodes: out,
    numbers: [...document.querySelectorAll('.umo-heading-number')].map((n) => n.innerText),
  }
})()`)
await shoot('case-b-reloaded')

check('the document text survives the round trip', reloaded.text.includes('Kalimat isi dokumen.'), JSON.stringify(reloaded.text.slice(0, 60)))
check('no CSS was imported as document text', !/counter-reset|umo-count-|font-variant-numeric/.test(reloaded.text), JSON.stringify(reloaded.text.slice(0, 60)))
check('the profile is recovered from the class alone', reloaded.nodes.find((n) => n.type === 'heading')?.profile === 'profile-h1', JSON.stringify(reloaded.nodes.map((n) => n.profile)))
check('the numbering is recomputed after the load', JSON.stringify(reloaded.numbers) === JSON.stringify(['BAB I\n', '1.1']), JSON.stringify(reloaded.numbers))

console.log('\nscreenshots written to tests/screenshots/document-stylesheet-*.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the stored document carries its own stylesheet and loads back cleanly.')
await finish(0)
