/**
 * A save must carry the document's style profiles.
 *
 * The hazard this guards: profiles define every block's font, line height, margins, indent and
 * numbering template. If a save writes `profiles: []`, the stored document keeps working only because
 * its styling is also inlined into the HTML. The profile definitions themselves are gone, so reopening
 * the document elsewhere cannot restyle it and the Profiles dialog has nothing to edit.
 *
 * This test measures the real payload: it records the POST body sent to /api/documents/save and
 * asserts the profiles travel with it. Every save request is intercepted and answered locally, so the
 * storage server is never written to and no stored document can be touched.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback: a
 * conventional port may belong to another clone running at the same time.
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
  const payload = JSON.stringify({ success: true, message: 'intercepted by profile-save test' })
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
  await writeFile(path.join(SHOTS, `profile-save-${name}.png`), Buffer.from(shot.data, 'base64'))
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
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

// ---------------------------------------------------------------------------
// Case A: the editor's live profiles must reach the save payload.
// ---------------------------------------------------------------------------
console.log('\nCase A: a save carries the profiles the editor is actually using')

const live = await evaluate(`(() => {
  const s = window.__ed.storage && (window.__ed.storage.documentReferences || window.__ed.storage['document-references'])
  if (!s) return { reachable: false }
  return { reachable: true, count: (s.profiles || []).length, ids: (s.profiles || []).map((p) => p.id) }
})()`)
check('the editor exposes its profile storage', live.reachable === true, JSON.stringify(live))
check('the editor is holding profiles to save', live.count > 0, `${live.count} profile(s)`)

const postsA = await saveAndCapture()
await shoot('case-a-default-profiles')
check('a save POST was issued', postsA.length > 0, `${postsA.length} POST(s)`)

if (postsA.length > 0) {
  const sent = postsA[0].body.profiles
  check('the save payload has a profiles array', Array.isArray(sent), `type ${typeof sent}`)
  check(
    'the save payload carries every profile the editor holds',
    Array.isArray(sent) && sent.length === live.count,
    `payload ${Array.isArray(sent) ? sent.length : 'n/a'} vs editor ${live.count}`,
  )
  check(
    'the payload profile ids match the editor profile ids',
    Array.isArray(sent) && JSON.stringify(sent.map((p) => p.id)) === JSON.stringify(live.ids),
    `payload ${JSON.stringify(Array.isArray(sent) ? sent.map((p) => p.id) : null)}`,
  )
}

// ---------------------------------------------------------------------------
// Case B: an edited profile must travel, proving the live store is read and not a stale copy.
// ---------------------------------------------------------------------------
console.log('\nCase B: an edited profile value reaches the save payload')

const MARKER = '2.75em'
const edited = await evaluate(`(() => {
  const s = window.__ed.storage.documentReferences || window.__ed.storage['document-references']
  const target = (s.profiles || []).find((p) => p.id === 'profile-h1') || (s.profiles || [])[0]
  if (!target) return { ok: false }
  const before = target.marginBottom
  target.marginBottom = ${JSON.stringify(MARKER)}
  return { ok: true, id: target.id, before, after: target.marginBottom }
})()`)
check('a profile could be edited in the live store', edited.ok === true, JSON.stringify(edited))

const postsB = await saveAndCapture()
await shoot('case-b-edited-profile')
check('a save POST was issued after the edit', postsB.length > 0, `${postsB.length} POST(s)`)

if (postsB.length > 0 && edited.ok) {
  const sent = postsB[0].body.profiles
  const carried = Array.isArray(sent) ? sent.find((p) => p.id === edited.id) : null
  check(
    'the edited profile is present in the payload',
    Boolean(carried),
    `payload ids ${JSON.stringify(Array.isArray(sent) ? sent.map((p) => p.id) : null)}`,
  )
  check(
    'the payload carries the edited value, not a stale one',
    carried?.marginBottom === MARKER,
    `got ${JSON.stringify(carried?.marginBottom)}, expected ${JSON.stringify(MARKER)}`,
  )
}

console.log('\nscreenshots written to tests/screenshots/profile-save-*.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- saves carry the editor profiles, including edited values.')
await finish(0)
