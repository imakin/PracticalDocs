/**
 * The Server API URLs used last are offered under the field, and every button in the popup is large.
 *
 * Asked for by the writer, who moves between storage servers: each press of Save or Open Document...
 * in the save status popup puts the Server API URL in use at the top of a list of buttons under the
 * field - five at most, never one twice, kept in localStorage - and a press on one fills the field
 * with the URL it shows. In a short window the popup scrolls rather than running off the bottom.
 * Every button in the popup has 1em of padding above and below its text, and
 * the URL buttons a grey ground of their own, so they do not read as a second input field.
 *
 * Driven by the mouse through the popup. Save writes the current document under a file name of the
 * test's own to the server in the field, so both servers must be the test's own, never the writer's;
 * the document is deleted from both at the end, and the localStorage keys the test touches are put
 * back. The tab is left at its own viewport rather than resizing the window it opens in, because that
 * window is the writer's.
 *
 * Endpoints come from EDITOR_URL, CDP_URL, STORAGE_A_URL and STORAGE_B_URL. Per adr/0006 there is
 * no built-in fallback. Two different URLs for one server work as well as two servers.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
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
const STORAGE_A = required('STORAGE_A_URL').replace(/\/$/, '')
const STORAGE_B = required('STORAGE_B_URL').replace(/\/$/, '')
const U1 = `${STORAGE_A}/api/documents/save`
const U2 = `${STORAGE_B}/api/documents/save`
const DOC = 'pdoc-server-url-history-probe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// `node:http` rather than `fetch`, because fetch keeps its sockets alive and `process.exit` over a
// handle that is still closing trips a libuv assertion on Windows - exit 127 from a passing run.
const request = (method, url) =>
  new Promise((resolve, reject) => {
    http
      .request(url, { method, agent: false }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      })
      .on('error', reject)
      .end()
  })

const version = await request('GET', `${CDP}/json/version`).catch(() => null)
if (version?.status !== 200) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
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
  'practicaldocs:server-url',
  'practicaldocs:server-url-history',
  'practicaldocs:save-target',
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
    await request('DELETE', `${base}/api/documents/${DOC}`).catch(() => {})
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
// The test reads only the list it builds itself.
await evaluate(`localStorage.removeItem('practicaldocs:server-url-history')`)
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
const key = async (name, keyCode) => {
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: keyCode }, sessionId)
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: keyCode }, sessionId)
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
const URL_FIELD = `[...document.querySelectorAll('input')].find((el) => el.offsetParent && /documents\\/save/.test(el.value || el.placeholder || ''))`
const TITLE_FIELD = `[...document.querySelectorAll('.pdoc-server-url-field')].find((el) => el.offsetParent && /File Name/.test(el.textContent))?.querySelector('input')`
const button = (text) =>
  `[...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === ${JSON.stringify(text)})`
// The list under the first field. The second field has a list of its own with the same entries
// (`second-server-save.cdp.mjs`).
const FIRST_FIELD = `[...document.querySelectorAll('.pdoc-server-url-field')].find((el) => el.offsetParent && (el.querySelector('.pdoc-server-url-label')?.textContent || '').startsWith('Server API URL'))`
const ITEMS = `[...((${FIRST_FIELD})?.querySelectorAll('.pdoc-server-url-history-item') || [])].filter((el) => el.offsetParent)`
const history = () => evaluate(`${ITEMS}.map((el) => el.innerText.trim())`)

const openPopup = async () => {
  await clickElement('the save status button', STATUS)
  // The popup fades in, and until it has, its buttons report no text.
  for (let i = 0; i < 30; i += 1) {
    await sleep(200)
    if (await evaluate(`${ITEMS}.every((el) => el.innerText.trim()) && !!(${URL_FIELD})`)) break
  }
}
const closePopup = async () => {
  await clickAt(800, 600)
  await sleep(500)
}
const replaceField = async (expression, text) => {
  const spot = await centreOf(expression)
  // Triple click selects what is in the field, the way anyone replaces the contents of one.
  await clickAt(spot.x, spot.y, 3)
  await typeText(text)
  await sleep(300)
}
const save = async () => {
  await clickElement('Save', button('Save'))
  await sleep(2500)
}

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: Open Document... remembers the Server API URL in use')

await openPopup()
check('there is no list before anything was used', (await history()).length === 0, JSON.stringify(await history()))
await clickElement('the practicaldocs-server destination',
  `[...document.querySelectorAll('label')].find((el) => el.offsetParent && /practicaldocs-server/.test(el.textContent || ''))`)
await sleep(300)
await replaceField(TITLE_FIELD, DOC)
await replaceField(URL_FIELD, U1)
await clickElement('Open Document...', button('Open Document...'))
await sleep(1500)
await key('Escape', 27)
await sleep(700)
await closePopup()
await openPopup()
check('the list holds that URL', JSON.stringify(await history()) === JSON.stringify([U1]), JSON.stringify(await history()))

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: Save remembers the Server API URL in use, at the top')

await replaceField(URL_FIELD, U2)
await save()
await closePopup()
await openPopup()
check('the URL saved to is first', JSON.stringify(await history()) === JSON.stringify([U2, U1]), JSON.stringify(await history()))

// ---------------------------------------------------------------------------------------------
console.log('\nCase C: a button in the list fills the field with its URL')

await clickElement('the list entry for the first server',
  `${ITEMS}.find((el) => el.innerText.trim() === ${JSON.stringify(U1)})`)
await sleep(300)
check('the field reads the URL on the button', (await evaluate(`(${URL_FIELD})?.value`)) === U1,
  await evaluate(`(${URL_FIELD})?.value`))
check('the popup stays open', (await history()).length === 2)
check('choosing an entry does not reorder the list', JSON.stringify(await history()) === JSON.stringify([U2, U1]))

// ---------------------------------------------------------------------------------------------
console.log('\nCase D: a URL already listed moves to the top when used, and is never listed twice')

await save()
await closePopup()
await openPopup()
check('moved to the top, no duplicate', JSON.stringify(await history()) === JSON.stringify([U1, U2]), JSON.stringify(await history()))

// ---------------------------------------------------------------------------------------------
console.log('\nCase E: every button in the popup has 1em above and below its text')

const sizes = await evaluate(`(() => {
  const top = ['Save', 'Open Document...', 'New Document'].map((t) =>
    [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === t))
  return [...top, ...${ITEMS}].filter(Boolean).map((el) => {
    const cs = getComputedStyle(el)
    return { text: el.innerText.trim().slice(0, 24), height: Math.round(el.getBoundingClientRect().height),
      top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom), font: parseFloat(cs.fontSize) }
  })
})()`)
check('five buttons measured', sizes.length === 5, JSON.stringify(sizes.map((b) => b.text)))
check('each has 1em of padding above and below',
  sizes.every((b) => Math.abs(b.top - b.font) < 0.5 && Math.abs(b.bottom - b.font) < 0.5),
  JSON.stringify(sizes))
const grounds = await evaluate(`(() => {
  const field = (${URL_FIELD}).closest('.pdoc-input') || (${URL_FIELD})
  return { field: getComputedStyle(field).backgroundColor, items: ${ITEMS}.map((el) => getComputedStyle(el).backgroundColor) }
})()`)
check('the URL buttons are grey, unlike the field above them',
  grounds.items.length === 2 && grounds.items.every((c) => c === grounds.items[0] && c !== grounds.field && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)),
  JSON.stringify(grounds))
const box = await evaluate(`(() => {
  const r = document.querySelector('.pdoc-document-status-container').getBoundingClientRect()
  return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 }
})()`)
const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } }, sessionId)
await mkdir(SHOTS, { recursive: true })
await writeFile(path.join(SHOTS, 'server-url-history.png'), Buffer.from(shot.data, 'base64'))

// ---------------------------------------------------------------------------------------------
console.log('\nCase F: the list is kept in localStorage, and is there after a reload')

await closePopup()
await call('Page.reload', {}, sessionId)
await waitForEditor()
await openPopup()
check('the same list after a reload', JSON.stringify(await history()) === JSON.stringify([U1, U2]), JSON.stringify(await history()))
check('stored under practicaldocs:server-url-history',
  (await evaluate(`localStorage.getItem('practicaldocs:server-url-history')`)) === JSON.stringify([U1, U2]))

// ---------------------------------------------------------------------------------------------
console.log('\nCase G: in a short window the popup scrolls instead of running off the bottom')

await closePopup()
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 600, deviceScaleFactor: 1, mobile: false,
}, sessionId)
await sleep(800)
await openPopup()
const fit = await evaluate(`(() => {
  const box = document.querySelector('.pdoc-document-status-container')
  const r = box.getBoundingClientRect()
  return {
    viewport: innerHeight,
    bottom: Math.round(r.bottom),
    height: Math.round(r.height),
    maxHeight: getComputedStyle(box).maxHeight,
    overflowY: getComputedStyle(box).overflowY,
    scrolls: box.scrollHeight > box.clientHeight + 1,
  }
})()`)
check('the popup ends inside the window', fit.bottom <= fit.viewport, JSON.stringify(fit))
check('no taller than the window less 49px', fit.maxHeight === `${fit.viewport - 49}px` && fit.height <= fit.viewport - 49, JSON.stringify(fit))
check('its content scrolls', fit.overflowY === 'auto' && fit.scrolls, JSON.stringify(fit))
// Scrolled by the wheel over the popup, the way anyone reaches the bottom of it.
const over = await evaluate(`(() => { const r = document.querySelector('.pdoc-document-status-container').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
// The pointer is brought over the popup first, as a hand on a mouse would; a wheel event with no
// pointer move before it, while the popup was still fading in, scrolled nothing.
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: over.x, y: over.y }, sessionId)
await sleep(300)
const target = await evaluate(`(() => { const at = document.elementFromPoint(${over.x}, ${over.y}); return at ? at.tagName + '.' + String(at.className).slice(0, 50) : null })()`)
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: over.x, y: over.y, deltaX: 0, deltaY: 2000 }, sessionId)
await sleep(1500)
const reach = await evaluate(`(() => {
  const box = document.querySelector('.pdoc-document-status-container').getBoundingClientRect()
  // The bottom-most button in the whole popup: the last entry of the second field's list.
  const last = [...document.querySelectorAll('.pdoc-document-status-container .pdoc-server-url-history-item')].filter((el) => el.offsetParent).pop()
  const r = last?.getBoundingClientRect()
  return { scrolled: document.querySelector('.pdoc-document-status-container').scrollTop, last: r && Math.round(r.bottom), box: Math.round(box.bottom), under: ${JSON.stringify(target)} }
})()`)
check('the wheel brings the bottom-most button into view', reach.scrolled > 0 && reach.last !== undefined && reach.last <= reach.box, JSON.stringify(reach))
await closePopup()
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId)

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- the Server API URLs used last are one press away, and every button is easy to hit.')
await finish(0)
