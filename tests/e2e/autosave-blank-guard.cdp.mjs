/**
 * Autosave must never overwrite a stored document with a blank one.
 *
 * The hazard this guards: `contentUpdated` is armed by page-setting changes alone, so an editor that
 * holds nothing but an empty paragraph can still schedule an autosave, and that autosave writes to
 * practical-umodoc-server under whatever document title is currently loaded. A blank editor carrying a
 * previously loaded title therefore erases that file on the server.
 *
 * This test measures the real behaviour: it records whether a POST to /api/documents/save is actually
 * issued, and what content that POST carries. Every save request is intercepted and answered locally,
 * so the storage server is never written to.
 *
 * Requires Chrome started with --remote-debugging-port=9222 and the dev server on :9000.
 * It opens a new tab in the existing window, and closes only that tab. The browser is left running.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, '..', 'screenshots')
const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '')
const EDITOR_URL = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'
const AUTOSAVE_MS = 1200
const SAMPLE = 'Autosave guard sample paragraph with real text content.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const version = await fetch(`${CDP}/json/version`).catch(() => null)
if (!version || !version.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}. Start Chrome with --remote-debugging-port=9222.`)
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

// The editor persists document title, content and profiles into localStorage, which is shared with
// any other tab on this origin. Snapshot those keys up front and put them back before leaving, so a
// test run never disturbs the document the user has open.
const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']
let persistedBefore = null

const finish = async (code) => {
  if (persistedBefore) {
    // Unmounting the editor flushes the document back into localStorage, which would undo the
    // restore below. Freeze the shared keys in this dying tab first, then put the originals back.
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

// Any throw after this point must still restore localStorage and close the probe tab.
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

const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}

await call('Page.enable', {}, sessionId)
await call('Runtime.enable', {}, sessionId)

// Intercept every save request. OPTIONS and POST are both answered here, so no request reaches
// practical-umodoc-server and no stored document can be touched by this test.
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
  const payload = JSON.stringify({ success: true, message: 'intercepted by autosave-blank-guard test' })
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

// reach the editor, the options and the page state through the component's provides
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
  if (!window.__p.options || !window.__p.page || typeof window.__p.openDocumentFile !== 'function') return 'MISSING_PROVIDES'
  window.__p.options.value.document.autoSave.enabled = true
  window.__p.options.value.document.autoSave.interval = ${AUTOSAVE_MS}
  return 'OK'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)

persistedBefore = await evaluate(`(() => {
  const out = {}
  for (const k of ${JSON.stringify(PERSISTED_KEYS)}) out[k] = localStorage.getItem(k)
  return out
})()`)

const buildSnapshot = (title, contentNodes) => `(() => {
  const page = JSON.parse(JSON.stringify(window.__p.page.value))
  const content = { type: 'doc', content: ${JSON.stringify(contentNodes)} }
  return { format: 'umodoc', formatVersion: 1, editorVersion: '11.0.4', savedAt: new Date().toISOString(),
           document: { title: ${JSON.stringify(title)} }, content, page, profiles: [] }
})()`

const emptyParagraph = [{ type: 'paragraph' }]
const paragraphWith = (text) => [{ type: 'paragraph', content: [{ type: 'text', text }] }]

// Opening a document resets contentUpdated to false, which makes the arming below deterministic.
const applySnapshot = async (title, contentNodes) => {
  const r = await evaluate(`(async () => {
    const snap = ${buildSnapshot(title, contentNodes)}
    await window.__p.openDocumentFile(snap, { skipConfirmation: true })
    await new Promise((res) => setTimeout(res, 400))
    return { textLen: window.__ed.state.doc.textContent.trim().length }
  })()`)
  return r
}

const shoot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, `autosave-blank-guard-${name}.png`), Buffer.from(shot.data, 'base64'))
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// ---------------------------------------------------------------------------
// Case A: blank document, autosave armed by a page-setting change only.
// ---------------------------------------------------------------------------
console.log('\nCase A: blank document, autosave armed by changing a page margin')
const a0 = await applySnapshot('autosave-guard-blank', emptyParagraph)
check('editor is blank before arming', a0.textLen === 0, `textContent length ${a0.textLen}`)

savePosts.length = 0
await evaluate(`(() => {
  const m = window.__p.page.value.margin
  m.bottom = Number((m.bottom + 0.1).toFixed(2))
  return m.bottom
})()`)
await sleep(AUTOSAVE_MS * 3)
await shoot('case-a-blank')

const blankPosts = savePosts.filter((p) => p.body)
const blankTextLens = blankPosts.map((p) => {
  const t = (n) => { let o = ''; if (n && typeof n === 'object') { if (n.type === 'text') o += n.text || ''; for (const c of n.content || []) o += t(c) } return o }
  return t(p.body.json || {}).trim().length
})
check(
  'no autosave POST is issued for a blank document',
  blankPosts.length === 0,
  `${blankPosts.length} POST(s) issued, content lengths ${JSON.stringify(blankTextLens)}`,
)

// ---------------------------------------------------------------------------
// Case B: real content must still autosave, otherwise the guard is too broad.
// ---------------------------------------------------------------------------
console.log('\nCase B: document with real text, autosave armed by typing')
const b0 = await applySnapshot('autosave-guard-content', paragraphWith(SAMPLE))
check('editor holds text before arming', b0.textLen > 0, `textContent length ${b0.textLen}`)

savePosts.length = 0
await evaluate(`document.querySelector('.ProseMirror').focus()`)
await sleep(300)
await call('Input.insertText', { text: ' tail.' }, sessionId)
await sleep(AUTOSAVE_MS * 3)
await shoot('case-b-content')

const contentPosts = savePosts.filter((p) => p.body)
check('an autosave POST is issued for a document with content', contentPosts.length > 0, `${contentPosts.length} POST(s)`)
if (contentPosts.length > 0) {
  const carried = String(contentPosts[0].body.html || '')
  check('the autosave POST carries the document text', carried.includes(SAMPLE), `html length ${carried.length}`)
}

// ---------------------------------------------------------------------------
// Case C: a document emptied by the user must not be autosaved over either.
// ---------------------------------------------------------------------------
console.log('\nCase C: document emptied by the user, then autosave armed by typing')
await applySnapshot('autosave-guard-emptied', paragraphWith(SAMPLE))
savePosts.length = 0
await evaluate(`document.querySelector('.ProseMirror').focus()`)
await sleep(300)
for (const key of [
  { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
  { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
  { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
]) {
  await call('Input.dispatchKeyEvent', key, sessionId)
  await sleep(200)
}
await sleep(AUTOSAVE_MS * 3)
await shoot('case-c-emptied')

const emptiedLen = await evaluate(`window.__ed.state.doc.textContent.trim().length`)
const emptiedPosts = savePosts.filter((p) => p.body)
check('editor is blank after the user cleared it', emptiedLen === 0, `textContent length ${emptiedLen}`)
check('no autosave POST is issued after the user empties the document', emptiedPosts.length === 0, `${emptiedPosts.length} POST(s)`)

// ---------------------------------------------------------------------------
// Case D: after a skipped blank autosave, typing again must arm autosave once more.
// ---------------------------------------------------------------------------
console.log('\nCase D: autosave re-arms after a blank save was skipped')
savePosts.length = 0
await evaluate(`document.querySelector('.ProseMirror').focus()`)
await sleep(300)
await call('Input.insertText', { text: 'Text typed after the skipped blank autosave.' }, sessionId)
await sleep(AUTOSAVE_MS * 3)
await shoot('case-d-rearm')

const rearmPosts = savePosts.filter((p) => p.body)
check('autosave fires again once real text is typed', rearmPosts.length > 0, `${rearmPosts.length} POST(s)`)
if (rearmPosts.length > 0) {
  check(
    'the re-armed autosave carries the typed text',
    String(rearmPosts[0].body.html || '').includes('Text typed after the skipped blank autosave.'),
    `html length ${String(rearmPosts[0].body.html || '').length}`,
  )
}

// ---------------------------------------------------------------------------
// Case E: a document with no text but real non-text content must still autosave.
// ---------------------------------------------------------------------------
console.log('\nCase E: document with no text but a horizontal rule still autosaves')
const e0 = await applySnapshot('autosave-guard-media', [{ type: 'paragraph' }, { type: 'horizontalRule' }])
check('editor has no text in this case', e0.textLen === 0, `textContent length ${e0.textLen}`)

savePosts.length = 0
await evaluate(`(() => {
  const m = window.__p.page.value.margin
  m.bottom = Number((m.bottom + 0.1).toFixed(2))
  return m.bottom
})()`)
await sleep(AUTOSAVE_MS * 3)
await shoot('case-e-media')

const mediaPosts = savePosts.filter((p) => p.body)
check('non-text content is not mistaken for a blank document', mediaPosts.length > 0, `${mediaPosts.length} POST(s)`)

console.log('\nscreenshots written to tests/screenshots/autosave-blank-guard-*.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- autosave never wrote a blank document, and still saved a real one.')
await finish(0)
