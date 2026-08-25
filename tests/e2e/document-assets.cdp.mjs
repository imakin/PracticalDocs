/**
 * Images must survive the browser session.
 *
 * This is the failure that shipped unnoticed: media was stored as `blob:` URLs, which are handles to
 * one tab's memory. The document recorded a name and a size and not one byte of the image, and
 * everything looked fine until the tab closed.
 *
 * So the check has to cross a session boundary. The document is saved in one tab, that tab is closed,
 * and a second tab loads it and fetches the bytes back. Asserting inside the tab that uploaded the
 * image would pass on a blob URL and prove nothing.
 *
 * Requires Chrome with --remote-debugging-port=9222, the dev server on :9000 and the storage server
 * on :3001.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import WebSocket from 'ws'

const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '')
const EDITOR_URL = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'
const STORAGE_URL = process.env.STORAGE_URL || 'http://localhost:3001'
const DOCUMENT = 'asset-roundtrip-probe'
const PERSISTED_KEYS = ['umo-editor:default:document', 'umo-editor:profiles']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A real PNG the editor will render, plus bytes that are not ASCII so a lossy path would show up.
const PNG = Buffer.from(
  // a real 16x16 RGBA PNG, generated with correct chunk lengths and CRCs so the browser can decode it
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAB7ElEQVR4nBXS0RRAIQAE0YcQQgghhBBCCCEsQgghhBBCCCFksG/6vufM13zfJ4dPjp+cPjl/cvnk+sntk4V3fOATX/jGD37x7wtyCHIMcgpyDnIJcg1yC7Lwjg984gvf+MFveIEohyjHKKco5yiXKNcotygL7/jAJ77wjR/8xhdIckhyTHJKck5ySXJNckuy8I4PfOIL3/jBb3qBLIcsxyynLOcslyzXLLcsC+/4wCe+8I0f/OYXKHIocixyKnIucilyLXIrsvCOD3ziC9/4wW95gSqHKscqpyrnKpcq1yq3Kgvv+MAnvvCNH/zWF2hyaHJscmpybnJpcm1ya7Lwjg984gvf+MFvewHxgfhAfCA+EB+ID8QH4gO84wOf+MI3fvCrF+h80Pmg80Hng84HnQ86H3Q+wDs+8IkvfOMHv/0FBh8MPhh8MPhg8MHgg8EHgw/wjg984gvf+MHveIHJB5MPJh9MPph8MPlg8sHkA7zjA5/4wjd+8DtfYPHB4oPFB4sPFh8sPlh8sPgA7/jAJ77wjR/8rhfYfLD5YPPB5oPNB5sPNh9sPsA7PvCJL3zjB7/7BQ4fHD44fHD44PDB4YPDB4cP8I4PfOIL3/jB73mByweXDy4fXD64fHD54PLB5QO84wOf+MI3fvCL/05Lbx/BFbi+AAAAAElFTkSuQmCC',
  'base64',
)
const PNG_SHA = crypto.createHash('sha256').update(PNG).digest('hex')

const probe = await fetch(`${CDP}/json/version`).catch(() => null)
if (!probe || !probe.ok) {
  console.error(`FAIL: no CDP endpoint at ${CDP}. Start Chrome with --remote-debugging-port=9222.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = await probe.json()
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
const pending = new Map()
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (!msg.id || !pending.has(msg.id)) return
  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) reject(new Error(JSON.stringify(msg.error)))
  else resolve(msg.result)
})
let nextId = 0
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    ws.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const openTabs = []
const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const finish = async (code) => {
  for (const id of openTabs) await call('Target.closeTarget', { targetId: id }).catch(() => {})
  await fetch(`${STORAGE_URL}/api/documents/${DOCUMENT}`, { method: 'DELETE' }).catch(() => {})
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

const newTab = async () => {
  const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
  openTabs.push(targetId)
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  const run = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result.value
  }
  for (let i = 0; i < 150; i += 1) {
    if (await run(`!!document.querySelector('.ProseMirror')`)) break
    await sleep(200)
  }
  await sleep(2000)
  await run(`(() => {
    let el = document.querySelector('.ProseMirror')
    while (el && !el.__vueParentComponent) el = el.parentElement
    let inst = el.__vueParentComponent
    while (inst) { const p = inst.provides || {}; if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break } inst = inst.parent }
    return !!window.__ed })()`)
  return { targetId, run }
}

// ---------------------------------------------------------------------------
console.log('\nStep 1: insert an image through the upload path and save it')
const first = await newTab()
const before = await first.run(`(() => { const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o })()`)

const saved = await first.run(`(async () => {
  const p = window.__p, ed = window.__ed
  const bytes = Uint8Array.from(atob(${JSON.stringify(PNG.toString('base64'))}), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'uji.png', { type: 'image/png' })
  const uploaded = await p.options.value.onFileUpload(file)
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dokumen uji aset' }] }] })
  await new Promise((r) => setTimeout(r, 400))
  ed.commands.focus('end')
  ed.commands.setImage({ src: uploaded.url, width: 120 })
  await new Promise((r) => setTimeout(r, 1200))
  p.options.value.document.title = ${JSON.stringify(DOCUMENT)}
  await new Promise((r) => setTimeout(r, 300))
  await p.saveContent(false)
  await new Promise((r) => setTimeout(r, 2500))
  let src = null
  ed.state.doc.descendants((n) => { if (n.type.name === 'image' && !src) src = n.attrs.src })
  return { uploadedUrl: uploaded.url, srcInDocument: src }
})()`)
check('the upload path hands back a usable source', !!saved.uploadedUrl, saved.uploadedUrl?.slice(0, 24))

await first.run(`(() => {
  const frozen = ${JSON.stringify(PERSISTED_KEYS)}
  const setItem = localStorage.setItem.bind(localStorage)
  const removeItem = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = (k, v) => { if (!frozen.includes(k)) setItem(k, v) }
  localStorage.removeItem = (k) => { if (!frozen.includes(k)) removeItem(k) }
  const saved = ${JSON.stringify(before)}
  for (const [k, v] of Object.entries(saved)) { if (v === null) removeItem(k); else setItem(k, v) }
  return true })()`)
await call('Target.closeTarget', { targetId: first.targetId })
openTabs.splice(openTabs.indexOf(first.targetId), 1)

// ---------------------------------------------------------------------------
console.log('\nStep 2: what actually reached the server')
const stored = await (await fetch(`${STORAGE_URL}/api/documents/load?id=${DOCUMENT}`)).json()
check('the document was stored', stored.success === true)
check(
  'the stored document carries the image in its asset table',
  Array.isArray(stored.assets) && stored.assets.some((a) => a.sha256 === PNG_SHA),
  `assets: ${JSON.stringify((stored.assets || []).map((a) => ({ name: a.name, length: a.length })))}`,
)
const storedJson = JSON.stringify(stored.document)
check('no blob url was written to storage', storedJson.includes('blob:') === false)
check('the media source is stored as a relative path', storedJson.includes('./assets/uji.png'))

// ---------------------------------------------------------------------------
console.log('\nStep 3: a different browser session loads it and fetches the bytes back')
const second = await newTab()
const beforeSecond = await second.run(`(() => { const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o })()`)
await second.run(`document.querySelector('[data-testid="open-json"]').click()`)
await sleep(2000)
const opened = await second.run(`(() => {
  const modal = [...document.querySelectorAll('.t-dialog')].find(d => d.textContent.includes('Open & Load Document'))
  if (!modal) return 'MODAL_NOT_OPEN'
  const btns = [...modal.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Open Document')
  const labels = btns.map(b => { let n = b; for (let i = 0; i < 6 && n; i++) { const m = (n.textContent || '').match(/File:\\s*(\\S+?)\\.enc/); if (m) return m[1]; n = n.parentElement } return '?' })
  const i = labels.indexOf(${JSON.stringify(DOCUMENT)})
  if (i < 0) return 'NOT_LISTED'
  btns[i].click(); return 'OPENED' })()`)
check('the saved document can be reopened', opened === 'OPENED', opened)
await sleep(1500)
await second.run(`(() => { const d = [...document.querySelectorAll('.t-dialog')].find(x => x.offsetParent !== null && x.textContent.includes('Replace the current document')); if (d) { const ok = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open Document'); if (ok) ok.click() } return 1 })()`)
await sleep(4000)

const reloaded = await second.run(`(async () => {
  let src = null
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'image' && !src) src = n.attrs.src })
  if (!src) return { src: null }
  const img = document.querySelector('.ProseMirror img')
  const shape = {
    src,
    resolvedAgainstPage: new URL(src, location.href).href,
    renderedWidth: img ? img.naturalWidth : 0,
    renderedHeight: img ? img.naturalHeight : 0,
  }
  try {
    const response = await fetch(src)
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return { ...shape, status: response.status, contentType: response.headers.get('content-type'), base64: btoa(binary) }
  } catch (error) {
    return { ...shape, status: 0, fetchError: String(error) }
  }
})()`)

check('the reopened document still has an image node', !!reloaded.src, String(reloaded.src).slice(0, 60))
check('its source is no longer a blob url', !String(reloaded.src || '').startsWith('blob:'))
check('the bytes are served back', reloaded.status === 200,
  `status ${reloaded.status}${reloaded.fetchError ? `, ${reloaded.fetchError}` : ''}, src ${reloaded.src}`)
check(
  'the bytes are byte-identical to what was uploaded',
  reloaded.base64 === PNG.toString('base64'),
  `${Buffer.from(reloaded.base64 || '', 'base64').length} bytes back, ${PNG.length} in`,
)
check(
  'the browser can actually decode the image',
  reloaded.renderedWidth > 0 && reloaded.renderedHeight > 0,
  `${reloaded.renderedWidth}x${reloaded.renderedHeight}`,
)

await second.run(`(() => {
  const frozen = ${JSON.stringify(PERSISTED_KEYS)}
  const setItem = localStorage.setItem.bind(localStorage)
  const removeItem = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = (k, v) => { if (!frozen.includes(k)) setItem(k, v) }
  localStorage.removeItem = (k) => { if (!frozen.includes(k)) removeItem(k) }
  const saved = ${JSON.stringify(beforeSecond)}
  for (const [k, v] of Object.entries(saved)) { if (v === null) removeItem(k); else setItem(k, v) }
  return true })()`)

// ---------------------------------------------------------------------------
// Documents written before media was stored carry blob URLs from an older session. While that tab is
// still open the bytes are still readable, so a save should rescue them rather than write another
// dead reference.
console.log('\nStep 4: an image that predates the asset pipeline is rescued on save')
const RESCUE_DOC = `${DOCUMENT}-rescue`
const third = await newTab()
const beforeThird = await third.run(`(() => { const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o })()`)
const rescued = await third.run(`(async () => {
  const p = window.__p, ed = window.__ed
  const bytes = Uint8Array.from(atob(${JSON.stringify(PNG.toString('base64'))}), (c) => c.charCodeAt(0))
  // deliberately not through onFileUpload: this is what an older session left behind
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dokumen lama' }] }] })
  await new Promise((r) => setTimeout(r, 400))
  ed.commands.focus('end')
  ed.commands.setImage({ src: url, width: 120 })
  await new Promise((r) => setTimeout(r, 1200))
  p.options.value.document.title = ${JSON.stringify(RESCUE_DOC)}
  await new Promise((r) => setTimeout(r, 300))
  await p.saveContent(false)
  await new Promise((r) => setTimeout(r, 2500))
  return { url }
})()`)
check('a legacy blob source was present before saving', rescued.url.startsWith('blob:'))

const rescuedDoc = await (await fetch(`${STORAGE_URL}/api/documents/load?id=${RESCUE_DOC}`)).json()
check(
  'its bytes were rescued into the folder',
  Array.isArray(rescuedDoc.assets) && rescuedDoc.assets.some((a) => a.sha256 === PNG_SHA),
  `assets: ${JSON.stringify((rescuedDoc.assets || []).map((a) => a.length))}`,
)
check('no blob url survived the rescue', JSON.stringify(rescuedDoc.document).includes('blob:') === false)

await third.run(`(() => {
  const frozen = ${JSON.stringify(PERSISTED_KEYS)}
  const setItem = localStorage.setItem.bind(localStorage)
  const removeItem = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = (k, v) => { if (!frozen.includes(k)) setItem(k, v) }
  localStorage.removeItem = (k) => { if (!frozen.includes(k)) removeItem(k) }
  const saved = ${JSON.stringify(beforeThird)}
  for (const [k, v] of Object.entries(saved)) { if (v === null) removeItem(k); else setItem(k, v) }
  return true })()`)
await fetch(`${STORAGE_URL}/api/documents/${RESCUE_DOC}`, { method: 'DELETE' }).catch(() => {})

// ---------------------------------------------------------------------------
// The point of storing a document as a folder of plain files: it is readable without this editor.
console.log('\nStep 5: the stored document opens on its own, straight from disk')
const folder = process.env.DATA_DIR || new URL('../../storage-server/data', import.meta.url).pathname
const documentFile = `file://${folder}/${DOCUMENT}/document.html`
const direct = await call('Target.createTarget', { url: documentFile })
openTabs.push(direct.targetId)
const directSession = (await call('Target.attachToTarget', { targetId: direct.targetId, flatten: true })).sessionId
await call('Runtime.enable', {}, directSession)
await sleep(2500)
const onDisk = await call('Runtime.evaluate', {
  expression: `(() => {
    const img = document.querySelector('img')
    return {
      src: img ? img.getAttribute('src') : null,
      loaded: img ? img.complete && img.naturalWidth > 0 : false,
      size: img ? img.naturalWidth + 'x' + img.naturalHeight : null,
      hasText: document.body.textContent.trim().length > 0,
    }
  })()`,
  returnByValue: true,
}, directSession).then((r) => r.result.value)
check('the document file carries its text', onDisk.hasText === true)
check('it references media by a real relative path', onDisk.src === './assets/uji.png', String(onDisk.src))
check('a browser renders the image with no server involved', onDisk.loaded === true, onDisk.size)

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the image survived the browser session byte for byte.')
await finish(0)
