/**
 * The page number settings must survive being saved and opened again.
 *
 * `validatePage` in `utils/document-file.js` is a whitelist, and `pageNumber` was not on it, so the
 * settings never reached the stored file in either direction: a document saved with numbering on
 * came back with numbering off, and the user's format, position, template and start value were gone.
 * The per-section changes are not tested here - they live on the page break nodes and travel with
 * the content.
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
if (!version || !version.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await version.json()

const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
const pending = new Map()
const listeners = []
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

// new tab in the existing window; never a new window, never the user's tab
const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })

// Profiles live in localStorage, shared with every other tab on this origin. Snapshot the shared keys
// and put them back before leaving, so a test run never disturbs the user's own editor tab.
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
    // Unmounting the editor flushes state back into localStorage, which would undo the restore below.
    // Freeze the shared keys in this dying tab first, then put the originals back.
    await evaluate(`(() => {
      const frozen = ${JSON.stringify(PERSISTED_KEYS)}
      const setItem = localStorage.setItem.bind(localStorage)
      const removeItem = localStorage.removeItem.bind(localStorage)
      localStorage.setItem = (key, value) => { if (!frozen.includes(key)) setItem(key, value) }
      localStorage.removeItem = (key) => { if (!frozen.includes(key)) removeItem(key) }
      const saved = ${JSON.stringify(persistedBefore)}
      for (const [key, value] of Object.entries(saved)) {
        if (value === null) removeItem(key)
        else setItem(key, value)
      }
      return true
    })()`).catch(() => {})
  }
  await call('Target.closeTarget', { targetId }).catch(() => {})
  ws.close()
  process.exit(code)
}

let bailingOut = false
const bailOut = async (error) => {
  if (bailingOut) return
  bailingOut = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(error?.stack || String(error))
  await finish(1)
}
process.on('uncaughtException', bailOut)
process.on('unhandledRejection', bailOut)

await call('Page.enable', {}, sessionId)
await call('Runtime.enable', {}, sessionId)

// Intercept every save request. OPTIONS and POST are both answered here, so nothing reaches the
// storage server and no stored document can be touched by this test.
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
    try {
      body = JSON.parse(request.postData)
    } catch {}
    savePosts.push({ at: Date.now(), body })
  }
  const payload = JSON.stringify({ success: true, message: 'intercepted by page-number-persistence test' })
  await call(
    'Fetch.fulfillRequest',
    {
      requestId,
      responseCode: request.method === 'OPTIONS' ? 204 : 200,
      responseHeaders: corsHeaders,
      body: Buffer.from(payload).toString('base64'),
    },
    sessionId,
  ).catch(() => {})
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
    if (p.editor && p.editor.value && p.editor.value.state) { window.__p = p; window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  if (!window.__ed) return 'NO_EDITOR'
  if (typeof window.__p.saveContent !== 'function') return 'NO_SAVE_CONTENT'
  return 'OK'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)

persistedBefore = await evaluate(`(() => {
  const out = {}
  for (const k of ${JSON.stringify(PERSISTED_KEYS)}) out[k] = localStorage.getItem(k)
  return out
})()`)

const shoot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, `page-number-persistence-${name}.png`), Buffer.from(shot.data, 'base64'))
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const SETTINGS = {
  enabled: true,
  position: 'top-right',
  firstPagePosition: 'bottom-center',
  format: 'roman-lower',
  template: '- {number} -',
  startAt: 3,
}

const saveAndCapture = async () => {
  savePosts.length = 0
  await evaluate(`window.__p.saveContent(false)`)
  for (let i = 0; i < 40; i += 1) {
    if (savePosts.some((p) => p.body)) break
    await sleep(200)
  }
  return savePosts.filter((p) => p.body)
}

const readSettings = () => evaluate(`JSON.parse(JSON.stringify(window.__p.page.value.pageNumber))`)
const renderedNumbers = () => evaluate(`(() => [...document.querySelectorAll('.pdoc-page-number')].map((el) => el.textContent.trim()))()`)

console.log('\nCase A: a save carries the page number settings')
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Halaman pertama.' }] },
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Halaman kedua.' }] } ] })
  window.__p.page.value.pageNumber = ${JSON.stringify(SETTINGS)}
  await new Promise((r) => setTimeout(r, 2500))
  return true
})()`)
const drawn = await renderedNumbers()
check('numbers are drawn on screen', drawn.length > 0, JSON.stringify(drawn))

const posts = await saveAndCapture()
check('the save was sent', posts.length > 0)
const savedPage = posts.at(-1)?.body?.snapshot?.page
check('the saved file carries the settings', JSON.stringify(savedPage?.pageNumber) === JSON.stringify(SETTINGS), JSON.stringify(savedPage?.pageNumber))
await shoot('saved')

console.log('\nCase B: opening that file brings them back')
await evaluate(`(async () => {
  window.__p.page.value.pageNumber = { enabled: false, position: 'bottom-center', firstPagePosition: null, format: 'numeric', template: '{number}', startAt: 1 }
  await new Promise((r) => setTimeout(r, 1500))
  return true
})()`)
check('numbering is off before the file is opened', (await renderedNumbers()).length === 0)

const snapshotJson = JSON.stringify(posts.at(-1).body.snapshot)
await evaluate(`(async () => {
  await window.__p.openDocumentFile(${JSON.stringify(snapshotJson)}, { skipConfirmation: true })
  await new Promise((r) => setTimeout(r, 3000))
  return true
})()`)
const restored = await readSettings()
check('every setting is restored', JSON.stringify(restored) === JSON.stringify(SETTINGS), JSON.stringify(restored))
const back = await renderedNumbers()
check('numbers are drawn again', back.length > 0, JSON.stringify(back))
check('they use the restored format and template', back.some((t) => /^- [ivxlcdm]+ -$/.test(t)), JSON.stringify(back))
await shoot('reopened')

if (failures.length > 0) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join(', ')}`)
  await finish(1)
}
console.log('\nRESULT: PASSED -- page number settings survive a save and reopen.')
await finish(0)
