/**
 * A second Server API URL: every save writes to both servers, opening reads the first only.
 *
 * Asked for by the writer, so a copy of the document lives in two places. The second field sits under
 * the first in the save status popup and is empty by default; while it is empty a save goes to the
 * first server alone. Each field has its own list of the URLs used last - the same list - and a press
 * in a list fills only the field above it. The Save button and Ctrl+S both reach both servers, and the
 * toast names the two by host name, without the path. When
 * the second server cannot be reached the save is reported as an error, naming it, and the first
 * server still has the document.
 *
 * Driven by the mouse and the keyboard. What landed on each server is read from the server's own
 * API, which is what a writer opening it later would get. Both servers must be the test's own, never
 * the writer's: the test writes a document to each and deletes it at the end, and puts back the
 * localStorage keys it touches. The tab keeps its own viewport rather than resizing the window it
 * opens in, because that window is the writer's.
 *
 * Endpoints come from EDITOR_URL, CDP_URL, STORAGE_A_URL and STORAGE_B_URL - two different servers.
 * Per adr/0006 there is no built-in fallback.
 */
import http from 'node:http'

import WebSocket from 'ws'

import { serverNames } from '../../src/utils/server-names.js'

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
const STORAGE_A = required('STORAGE_A_URL').replace(/\/$/, '')
const STORAGE_B = required('STORAGE_B_URL').replace(/\/$/, '')
const U1 = `${STORAGE_A}/api/documents/save`
const U2 = `${STORAGE_B}/api/documents/save`
// Nothing listens on port 1, so a save there fails fast.
const DEAD = 'http://127.0.0.1:1/api/documents/save'
const DOC = 'pdoc-second-server-probe'
// The toast names both servers by host name, as the writer asked.
const [NAME_A, NAME_B] = serverNames(U1, U2)
const SAVED_TO_BOTH = `Document '${DOC}' saved to ${NAME_A} and ${NAME_B}.`
const ONLY_ON_B = 'pdoc-second-server-only-on-b'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// `node:http` rather than `fetch`, because fetch keeps its sockets alive and `process.exit` over a
// handle that is still closing trips a libuv assertion on Windows - exit 127 from a passing run.
const request = (method, url, body) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      agent: false,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
// The stored document as the server hands it back, or null when the server does not hold it.
const stored = async (base, id) => {
  const r = await request('GET', `${base}/api/documents/${id}`).catch(() => null)
  if (r?.status !== 200) return null
  try {
    return JSON.parse(r.body).document?.html || null
  } catch {
    return null
  }
}

const version = await request('GET', `${CDP}/json/version`).catch(() => null)
if (version?.status !== 200) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
for (const base of [STORAGE_A, STORAGE_B]) {
  const r = await request('GET', `${base}/api/documents`).catch(() => null)
  if (r?.status !== 200) {
    console.error(`FAIL: no storage server at ${base}.`)
    process.exit(1)
  }
}
const { webSocketDebuggerUrl } = JSON.parse(version.body)
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

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL, background: true })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
await call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {})
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId)

const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
  'practicaldocs:server-url',
  'practicaldocs:server-url-2',
  'practicaldocs:server-url-history',
  'practicaldocs:save-target',
  'document.content',
  'document.json',
  'document.snapshot',
]
let persistedBefore = null
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}
const removeFixtures = async () => {
  for (const base of [STORAGE_A, STORAGE_B]) {
    for (const id of [DOC, ONLY_ON_B]) {
      await request('DELETE', `${base}/api/documents/${id}`).catch(() => {})
    }
  }
}
const finish = async (code) => {
  await removeFixtures()
  if (persistedBefore) {
    // Frozen before they are put back: the page keeps running and would write them again over the
    // restore.
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
process.on('SIGINT', () => finish(130))

// The browser's leave-site prompt is answered rather than left to block a reload.
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.method === 'Page.javascriptDialogOpening') {
    call('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {})
  }
})

const waitForEditor = async () => {
  for (let i = 0; i < 300; i += 1) {
    if (await evaluate(`!!document.querySelector('.ProseMirror')`).catch(() => false)) break
    await sleep(200)
  }
  await sleep(2500)
}
await waitForEditor()
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)
await removeFixtures()
// A known starting point: two URLs in the list, the second field never filled.
await evaluate(`(() => {
  localStorage.setItem('practicaldocs:server-url-history', JSON.stringify(${JSON.stringify([U1, U2])}))
  localStorage.removeItem('practicaldocs:server-url-2')
  localStorage.setItem('practicaldocs:save-target', 'practicaldocs-server')
  return true
})()`)
await call('Page.reload', {}, sessionId)
await waitForEditor()

// ---------------------------------------------------------------------------------------------
// Input. Real events only.
// ---------------------------------------------------------------------------------------------
const mouse = (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount,
    buttons: button === 'left' && type === 'mousePressed' ? 1 : 0,
  }, sessionId)
const clickAt = async (x, y, count = 1) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', count)
  await mouse('mouseReleased', x, y, 'left', count)
  await sleep(400)
}
const key = async (name, code, keyCode, modifiers = 0) => {
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }, sessionId)
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }, sessionId)
}
const typeText = async (text) => {
  for (const char of text) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char }, sessionId)
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char }, sessionId)
    await sleep(10)
  }
}
const centreOf = async (expression) => {
  await evaluate(`(() => { const el = ${expression}; if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true })()`)
  await sleep(250)
  return evaluate(`(() => {
    const el = ${expression}
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return { hidden: true }
    const x = Math.round(r.left + Math.min(r.width / 2, 40)), y = Math.round(r.top + r.height / 2)
    const at = document.elementFromPoint(x, y)
    return { x, y, covered: !(at === el || el.contains(at) || at?.contains(el)) }
  })()`)
}
const clickElement = async (label, expression) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const spot = await centreOf(expression)
    if (spot && !spot.hidden && !spot.covered) {
      await clickAt(spot.x, spot.y)
      return
    }
    await sleep(400)
  }
  throw new Error(`${label}: nothing clickable (${JSON.stringify(await centreOf(expression))})`)
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const STATUS = `[...document.querySelectorAll('button')].find((el) => el.offsetParent && /^(Unsaved|Saved)/.test((el.textContent || '').trim()))`
const fieldUnder = (label) =>
  `[...document.querySelectorAll('.pdoc-server-url-field')].find((el) => el.offsetParent && (el.querySelector('.pdoc-server-url-label')?.textContent || '').startsWith(${JSON.stringify(label)}))`
const FIRST = fieldUnder('Server API URL')
const SECOND = fieldUnder('Second Server API URL')
const TITLE = fieldUnder('File Name')
const inputOf = (field) => `(${field})?.querySelector('input')`
const listOf = (field) => `[...((${field})?.querySelectorAll('.pdoc-server-url-history-item') || [])].filter((el) => el.offsetParent)`
const valueOf = (field) => evaluate(`${inputOf(field)}?.value ?? null`)
const listTexts = (field) => evaluate(`${listOf(field)}.map((el) => el.innerText.trim())`)
const button = (text) =>
  `[...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === ${JSON.stringify(text)})`

const openPopup = async () => {
  await clickElement('the save status button', STATUS)
  // The popup fades in, and until it has, its buttons report no text.
  for (let i = 0; i < 30; i += 1) {
    await sleep(200)
    if (await evaluate(`!!(${SECOND}) && ${listOf(SECOND)}.every((el) => el.innerText.trim())`)) break
  }
}
const closePopup = async () => {
  await clickAt(1500, 600)
  await sleep(500)
}
const replaceField = async (field, text) => {
  const spot = await centreOf(inputOf(field))
  // Triple click selects what is in the field, the way anyone replaces the contents of one.
  await clickAt(spot.x, spot.y, 3)
  await typeText(text)
  await sleep(300)
}
const clearMessages = () => evaluate(`(() => { for (const el of document.querySelectorAll('[class*="message"]')) el.remove(); return true })()`)
// Whatever the editor says once the save has finished, in the words the writer sees.
const outcome = async () => {
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const text = await evaluate(`[...document.querySelectorAll('[class*="message"]')].filter((el) => el.offsetParent).map((el) => (el.textContent || '').trim()).filter(Boolean).pop() || ''`)
    if (text && !/saving/i.test(text)) return text
  }
  return ''
}
// How long ago the status button says the last successful save was, in seconds. A failed save does not
// move it, so it can only grow across one.
const savedAgo = async () => {
  const text = (await evaluate(`(${STATUS})?.textContent.trim()`)) || ''
  if (/now/i.test(text)) return 0
  const m = text.match(/(\d+)\s+(second|minute|hour)/i)
  if (!m) return null
  return Number(m[1]) * { second: 1, minute: 60, hour: 3600 }[m[2].toLowerCase()]
}
const saveByButton = async () => {
  await clearMessages()
  await clickElement('Save', button('Save'))
  return outcome()
}
const saveByKeys = async () => {
  await clearMessages()
  await key('s', 'KeyS', 83, 2)
  return outcome()
}
// Words typed at the end of the document, so each save carries something the server must now hold.
const typeIntoDocument = async (words) => {
  await evaluate(`(() => { const pm = document.querySelector('.ProseMirror'); pm.scrollTop = pm.scrollHeight; return true })()`)
  const spot = await centreOf(`[...document.querySelectorAll('.ProseMirror > *')].filter((el) => (el.textContent || '').trim()).pop() || document.querySelector('.ProseMirror')`)
  await clickAt(spot.x, spot.y)
  await key('End', 'End', 35, 2)
  await key('Enter', 'Enter', 13)
  await typeText(words)
  await sleep(500)
}

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: the second field is empty, and has a list of its own')

await openPopup()
check('a second Server API URL field is shown under the first', !!(await evaluate(`!!(${SECOND})`)))
check('it is empty by default', (await valueOf(SECOND)) === '', JSON.stringify(await valueOf(SECOND)))
check('its list is the same list as the first field\'s',
  JSON.stringify(await listTexts(SECOND)) === JSON.stringify(await listTexts(FIRST)) && (await listTexts(SECOND)).length === 2,
  `${JSON.stringify(await listTexts(FIRST))} / ${JSON.stringify(await listTexts(SECOND))}`)

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: a list fills only the field above it')

await clickElement('the second list\'s entry for server B', `${listOf(SECOND)}.find((el) => el.innerText.trim() === ${JSON.stringify(U2)})`)
await sleep(300)
check('the second list filled the second field', (await valueOf(SECOND)) === U2, await valueOf(SECOND))
await clickElement('the first list\'s entry for server A', `${listOf(FIRST)}.find((el) => el.innerText.trim() === ${JSON.stringify(U1)})`)
await sleep(300)
check('the first list filled the first field', (await valueOf(FIRST)) === U1, await valueOf(FIRST))
check('and left the second alone', (await valueOf(SECOND)) === U2, await valueOf(SECOND))

// ---------------------------------------------------------------------------------------------
console.log('\nCase C: the Save button writes to both servers')

await replaceField(TITLE, DOC)
await closePopup()
await typeIntoDocument('first marker alpha')
await openPopup()
const savedC = await saveByButton()
check('the toast names both servers by host name', savedC === SAVED_TO_BOTH, savedC)
check('server A holds the document', (await stored(STORAGE_A, DOC))?.includes('first marker alpha'))
check('server B holds the document', (await stored(STORAGE_B, DOC))?.includes('first marker alpha'))

// ---------------------------------------------------------------------------------------------
console.log('\nCase D: Ctrl+S writes to both servers too')

await typeIntoDocument('second marker bravo')
const savedD = await saveByKeys()
check('the toast names both servers by host name', savedD === SAVED_TO_BOTH, savedD)
check('server A has what was typed since', (await stored(STORAGE_A, DOC))?.includes('second marker bravo'))
check('server B has what was typed since', (await stored(STORAGE_B, DOC))?.includes('second marker bravo'))

// ---------------------------------------------------------------------------------------------
console.log('\nCase E: Open Document... lists the first server only')

const seeded = await request('POST', U2, { id: ONLY_ON_B, filename: ONLY_ON_B, title: ONLY_ON_B, html: '<p>only on B</p>', profiles: [] })
check('a document exists on server B alone', seeded.status === 200 && !(await stored(STORAGE_A, ONLY_ON_B)))
await openPopup()
await clickElement('Open Document...', button('Open Document...'))
await sleep(2000)
const listed = await evaluate(`[...document.querySelectorAll('.t-list-item, [class*="list-item"]')].filter((el) => el.offsetParent).map((el) => el.textContent || '').join(' | ')`)
check('the dialog lists the document both servers hold', listed.includes(DOC), listed.slice(0, 200))
check('and not the one only server B holds', !listed.includes(ONLY_ON_B), listed.slice(0, 200))
await key('Escape', 'Escape', 27)
await sleep(700)

// ---------------------------------------------------------------------------------------------
console.log('\nCase F: a second server that cannot be reached is an error, and the first still saves')

await openPopup()
await replaceField(SECOND, DEAD)
await closePopup()
await typeIntoDocument('third marker charlie')
await sleep(3000)
const agoBeforeF = await savedAgo()
const savedF = await saveByKeys()
check('the save is reported as failed on the second server', /second server/i.test(savedF) && /first server only/i.test(savedF), savedF)
check('server A still has the change', (await stored(STORAGE_A, DOC))?.includes('third marker charlie'))
check('server B does not', !(await stored(STORAGE_B, DOC))?.includes('third marker charlie'))
const agoAfterF = await savedAgo()
check('the last save time does not move to now', agoBeforeF !== null && agoAfterF !== null && agoAfterF >= agoBeforeF && agoAfterF > 0,
  `${agoBeforeF}s before, ${agoAfterF}s after: ${await evaluate(`(${STATUS})?.textContent.trim()`)}`)

// ---------------------------------------------------------------------------------------------
console.log('\nCase G: with the second field emptied, a save goes to the first server alone')

await openPopup()
await replaceField(SECOND, U2)
const clearSpot = await centreOf(inputOf(SECOND))
await clickAt(clearSpot.x, clearSpot.y, 3)
await key('Backspace', 'Backspace', 8)
await sleep(300)
check('the second field is empty again', (await valueOf(SECOND)) === '', JSON.stringify(await valueOf(SECOND)))
await closePopup()
await typeIntoDocument('fourth marker delta')
const savedG = await saveByKeys()
check('the save succeeds without naming two servers', !savedG.includes(' and ') && !/second server|fail/i.test(savedG), savedG)
check('server A has the change', (await stored(STORAGE_A, DOC))?.includes('fourth marker delta'))
check('server B does not', !(await stored(STORAGE_B, DOC))?.includes('fourth marker delta'))

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a save reaches both servers, opening reads the first, and each list fills its own field.')
await finish(0)
