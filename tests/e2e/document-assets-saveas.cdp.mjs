/**
 * An image must survive being saved under a second name.
 *
 * Reported by the user: create a document with an image, save it as A, reload the page, open A,
 * save it as B, reload, open B - and the image is gone. The existing asset test crosses one session
 * boundary and saves once, so it never reaches the second save, which is where the bytes are lost.
 *
 * The bytes of an upload are held in a module-level Map in `src/utils/document-assets.js`, which is
 * per-page-load. After a reload the document's images are URLs pointing at A's folder on the storage
 * server, and nothing in the page holds their bytes any more - so a save to B sends the asset names
 * with no `data`, and the server can only look for them in B's own folder, where they are not.
 *
 * Both halves are asserted: that B's folder holds the bytes, and that a save which cannot store an
 * image says so rather than reporting success.
 *
 * Endpoints come from EDITOR_URL, CDP_URL and STORAGE_URL; per adr/0006 there is no fallback.
 */
import crypto from 'node:crypto'
import http from 'node:http'

import WebSocket from 'ws'

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
const STORAGE = required('STORAGE_URL').replace(/\/$/, '')

const DOC_A = 'saveas-probe-a'
const DOC_B = 'saveas-probe-b'
const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The same 16x16 RGBA PNG the round-trip test uses: a real image the browser can decode, with
// non-ASCII bytes so a lossy path would show up.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAB7ElEQVR4nBXS0RRAIQAE0YcQQgghhBBCCCEsQgghhBBCCCFksG/6vufM13zfJ4dPjp+cPjl/cvnk+sntk4V3fOATX/jGD37x7wtyCHIMcgpyDnIJcg1yC7Lwjg984gvf+MFveIEohyjHKKco5yiXKNcotygL7/jAJ77wjR/8xhdIckhyTHJKck5ySXJNckuy8I4PfOIL3/jBb3qBLIcsxyynLOcslyzXLLcsC+/4wCe+8I0f/OYXKHIocixyKnIucilyLXIrsvCOD3ziC9/4wW95gSqHKscqpyrnKpcq1yq3Kgvv+MAnvvCNH/zWF2hyaHJscmpybnJpcm1ya7Lwjg984gvf+MFvewHxgfhAfCA+EB+ID8QH4gO84wOf+MI3fvCrF+h80Pmg80Hng84HnQ86H3Q+wDs+8IkvfOMHv/0FBh8MPhh8MPhg8MHgg8EHgw/wjg984gvf+MHveIHJB5MPJh9MPph8MPlg8sHkA7zjA5/4wjd+8DtfYPHB4oPFB4sPFh8sPlh8sPgA7/jAJ77wjR/8rhfYfLD5YPPB5oPNB5sPNh9sPsA7PvCJL3zjB7/7BQ4fHD44fHD44PDB4YPDB4cP8I4PfOIL3/jB73mByweXDy4fXD64fHD54PLB5QO84wOf+MI3fvCL/05Lbx/BFbi+AAAAAElFTkSuQmCC',
  'base64',
)
const PNG_SHA = crypto.createHash('sha256').update(PNG).digest('hex')

// `node:http` rather than `fetch`, because fetch keeps its sockets alive and `process.exit` over a
// handle that is still closing trips a libuv assertion on Windows. The body is collected as buffers
// rather than a string: an image read through a text encoding comes back a different length, and a
// checksum taken on that proves nothing.
const request = (method, url) =>
  new Promise((resolve, reject) => {
    http
      .request(url, { method, agent: false }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
        )
      })
      .on('error', reject)
      .end()
  })
const getJson = async (url) => {
  const { status, body } = await request('GET', url)
  if (status !== 200) {
    throw new Error(`${url} answered ${status}`)
  }
  return JSON.parse(body.toString('utf8'))
}

const version = await getJson(`${CDP}/json/version`).catch(() => null)
if (!version) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const ws = new WebSocket(version.webSocketDebuggerUrl, {
  maxPayload: 256 * 1024 * 1024,
})
const pending = new Map()
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (!msg.id || !pending.has(msg.id)) {
    return
  }
  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) {
    reject(new Error(JSON.stringify(msg.error)))
  } else {
    resolve(msg.result)
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

const openTabs = []
const failures = []
const check = (label, ok, detail) => {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`,
  )
  if (!ok) {
    failures.push(label)
  }
}
let closed = false
const finish = async (code) => {
  if (!closed) {
    closed = true
    for (const id of openTabs) {
      await call('Target.closeTarget', { targetId: id }).catch(() => {})
    }
    // This test carries its own fixture, so it takes both of them away again.
    for (const name of [DOC_A, DOC_B]) {
      await request('DELETE', `${STORAGE}/api/documents/${name}`).catch(
        () => {},
      )
    }
  }
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => {
  if (bailing) {
    return
  }
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

// A tab of its own, with the editor's own provide() handles reachable, and the save response
// captured so a silent failure cannot pass as success.
const newTab = async () => {
  const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
  openTabs.push(targetId)
  const { sessionId } = await call('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  )
  const run = async (expression) => {
    const r = await call(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    )
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || 'evaluate failed',
      )
    }
    return r.result.value
  }
  for (let i = 0; i < 150; i += 1) {
    if (await run(`!!document.querySelector('.ProseMirror')`)) {
      break
    }
    await sleep(200)
  }
  await sleep(2000)
  await run(`(() => {
    let el = document.querySelector('.ProseMirror')
    while (el && !el.__vueParentComponent) el = el.parentElement
    let inst = el.__vueParentComponent
    while (inst) { const p = inst.provides || {}; if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break } inst = inst.parent }
    window.__saves = []
    window.__assetFetches = 0
    const realFetch = window.fetch
    window.fetch = async (...args) => {
      const res = await realFetch(...args)
      const target = String(args[0] && args[0].url ? args[0].url : args[0])
      const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET'
      if (target.includes('/assets/')) window.__assetFetches += 1
      if (target.includes('/api/documents/save') || (method === 'POST' && target.includes('/api/documents'))) {
        try { window.__saves.push(await res.clone().json()) } catch (e) { window.__saves.push({ parseError: String(e) }) }
      }
      return res
    }
    return !!window.__ed })()`)
  const freeze = async () => {
    await run(`(() => {
      const frozen = ${JSON.stringify(PERSISTED_KEYS)}
      const setItem = localStorage.setItem.bind(localStorage)
      const removeItem = localStorage.removeItem.bind(localStorage)
      const saved = {}
      for (const k of frozen) saved[k] = localStorage.getItem(k)
      window.__restore = () => {
        localStorage.setItem = (k, v) => { if (!frozen.includes(k)) setItem(k, v) }
        localStorage.removeItem = (k) => { if (!frozen.includes(k)) removeItem(k) }
        for (const [k, v] of Object.entries(saved)) { if (v === null) removeItem(k); else setItem(k, v) }
      }
      return true })()`)
  }
  await freeze()
  const close = async () => {
    await run(`window.__restore && window.__restore()`).catch(() => {})
    await call('Target.closeTarget', { targetId }).catch(() => {})
    const at = openTabs.indexOf(targetId)
    if (at >= 0) {
      openTabs.splice(at, 1)
    }
  }
  return { targetId, run, close }
}

// Opening a stored document through the real Open dialog, the way a writer does.
const openStored = async (tab, name) => {
  await tab.run(`document.querySelector('[data-testid="open-json"]').click()`)
  await sleep(2000)
  const opened = await tab.run(`(() => {
    const modal = [...document.querySelectorAll('.t-dialog')].find(d => d.textContent.includes('Open & Load Document'))
    if (!modal) return 'MODAL_NOT_OPEN'
    const btns = [...modal.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Open Document')
    const labels = btns.map(b => { let n = b; for (let i = 0; i < 6 && n; i++) { const m = (n.textContent || '').match(/File:\\s*(\\S+?)(\\.enc)?\\s/); if (m) return m[1]; n = n.parentElement } return '?' })
    const i = labels.indexOf(${JSON.stringify(name)})
    if (i < 0) return 'NOT_LISTED:' + labels.join(',')
    btns[i].click(); return 'OPENED' })()`)
  await sleep(1500)
  await tab.run(`(() => {
    const d = [...document.querySelectorAll('.t-dialog')].find(x => x.offsetParent !== null && x.textContent.includes('Replace the current document'))
    if (d) { const ok = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open Document'); if (ok) ok.click() }
    return 1 })()`)
  await sleep(4000)
  return opened
}

const saveAs = async (tab, name) =>
  tab.run(`(async () => {
    const p = window.__p
    window.__saves.length = 0
    p.options.value.document.title = ${JSON.stringify(name)}
    await new Promise((r) => setTimeout(r, 400))
    const back = await p.saveContent(false)
    await new Promise((r) => setTimeout(r, 3000))
    return { back: back || null, responses: window.__saves }
  })()`)

// ---------------------------------------------------------------------------
console.log('\nStep 1: a document with an image, saved as A')
const first = await newTab()
const inserted = await first.run(`(async () => {
  const p = window.__p, ed = window.__ed
  const bytes = Uint8Array.from(atob(${JSON.stringify(PNG.toString('base64'))}), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'uji.png', { type: 'image/png' })
  const uploaded = await p.options.value.onFileUpload(file)
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gambar harus ikut' }] }] })
  await new Promise((r) => setTimeout(r, 400))
  ed.commands.focus('end')
  ed.commands.setImage({ src: uploaded.url, width: 120 })
  await new Promise((r) => setTimeout(r, 1200))
  return uploaded.url
})()`)
check(
  'the upload path hands back a source',
  !!inserted,
  String(inserted).slice(0, 24),
)
const savedA = await saveAs(first, DOC_A)
check(
  'saving A reported no missing image',
  (savedA.responses || []).every((r) => !(r.missingAssets || []).length),
  JSON.stringify((savedA.responses || []).map((r) => r.missingAssets)),
)
await first.close()

const a = await getJson(`${STORAGE}/api/documents/load?id=${DOC_A}`)
check(
  'A holds the image bytes',
  Array.isArray(a.assets) && a.assets.some((x) => x.sha256 === PNG_SHA),
  JSON.stringify(
    (a.assets || []).map((x) => ({ name: x.name, length: x.length })),
  ),
)

// ---------------------------------------------------------------------------
console.log('\nStep 2: a new page load opens A and saves it as B')
const second = await newTab()
const openedA = await openStored(second, DOC_A)
check('A can be reopened', openedA === 'OPENED', openedA)
const srcInA = await second.run(`(() => {
  let src = null
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'image' && !src) src = n.attrs.src })
  return src })()`)
check(
  'the reopened document has an image',
  !!srcInA,
  String(srcInA).slice(0, 70),
)

const savedB = await saveAs(second, DOC_B)
// The bug this test exists for: the page no longer holds the bytes, so the save must either carry
// them anyway or say plainly that it could not.
check(
  'saving B did not quietly drop the image',
  (savedB.responses || []).every((r) => !(r.missingAssets || []).length),
  JSON.stringify((savedB.responses || []).map((r) => r.missingAssets)),
)
await second.close()

// ---------------------------------------------------------------------------
console.log('\nStep 3: B is its own document, bytes and all')
const b = await getJson(`${STORAGE}/api/documents/load?id=${DOC_B}`)
check('B was stored', b.success === true)
check(
  'B holds the image bytes, not a reference to A',
  Array.isArray(b.assets) && b.assets.some((x) => x.sha256 === PNG_SHA),
  JSON.stringify(
    (b.assets || []).map((x) => ({ name: x.name, length: x.length })),
  ),
)
const bytesFromB = await request(
  'GET',
  `${STORAGE}/api/documents/${DOC_B}/assets/uji.png`,
)
check(
  "B's folder serves the bytes",
  bytesFromB.status === 200,
  `status ${bytesFromB.status}`,
)
const sentBack = crypto
  .createHash('sha256')
  .update(bytesFromB.body)
  .digest('hex')
check(
  'and they are byte for byte the image that went in',
  sentBack === PNG_SHA,
  `${bytesFromB.body.length} bytes, sha ${sentBack.slice(0, 12)} against ${PNG_SHA.slice(0, 12)}`,
)

console.log('\nStep 4: and a third page load still sees the image')
const third = await newTab()
const openedB = await openStored(third, DOC_B)
check('B can be reopened', openedB === 'OPENED', openedB)
const inB = await third.run(`(async () => {
  let src = null
  window.__ed.state.doc.descendants((n) => { if (n.type.name === 'image' && !src) src = n.attrs.src })
  if (!src) return { src: null, status: 0 }
  try {
    const res = await fetch(src)
    return { src, status: res.status }
  } catch (e) {
    return { src, status: 0, error: String(e) }
  }
})()`)
check(
  'the document opened from B still has an image',
  !!inB.src,
  String(inB.src).slice(0, 70),
)
check(
  'and its bytes come back',
  inB.status === 200,
  `status ${inB.status}${inB.error ? `, ${inB.error}` : ''}, src ${inB.src}`,
)

// The other half of the fix: an image already in this folder must not be fetched and resent on
// every save, or a thesis full of photographs would carry all of them on each autosave tick.
console.log('\nStep 5: saving B again, under its own name, carries nothing')
const beforeAgain = await third.run(`window.__assetFetches`)
await saveAs(third, DOC_B)
const afterAgain = await third.run(`window.__assetFetches`)
check(
  'a save to the same folder re-reads no image',
  afterAgain === beforeAgain,
  `${beforeAgain} fetches before, ${afterAgain} after`,
)
const bAgain = await getJson(`${STORAGE}/api/documents/load?id=${DOC_B}`)
check(
  'and the image is still there afterwards',
  Array.isArray(bAgain.assets) &&
    bAgain.assets.some((x) => x.sha256 === PNG_SHA),
  JSON.stringify((bAgain.assets || []).map((x) => x.name)),
)
await third.close()

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- an image survives being saved under a second name.',
)
await finish(0)
