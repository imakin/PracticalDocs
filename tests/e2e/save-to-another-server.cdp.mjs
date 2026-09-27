/**
 * A document opened from one storage server and saved to another keeps its images.
 *
 * Reported by the writer: load from server A, save to server B, and "Saved, but 15 image(s) could
 * not be stored". A save decides whether an image's bytes have to travel by asking whether the image
 * already lives in the folder being written, and it compared only the **document name** in the
 * image's url. Saved under the same name, every image looked as if it were already there, so only
 * names were sent, and server B - which had never seen them - could store none.
 *
 * Driven the way the writer did it: the Server API URL typed into the save status popup, the
 * document opened through the Open dialog, the address changed, Ctrl+S. The fixture is put on
 * server A through its own API, as a document saved there earlier would be; nothing is handed to
 * the editor.
 *
 * Endpoints come from EDITOR_URL, CDP_URL, STORAGE_A_URL and STORAGE_B_URL. Per adr/0006 there is
 * no built-in fallback.
 */
import crypto from 'node:crypto'
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
// Two storage servers that are the test's own, never the writer's: the runner starts them on data
// folders of their own. The test writes one document to each and deletes it from both at the end.
const STORAGE_A = required('STORAGE_A_URL').replace(/\/$/, '')
const STORAGE_B = required('STORAGE_B_URL').replace(/\/$/, '')
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

// The window itself is made big enough for the ribbon, rather than the rendering being overridden.
// A device metrics override makes the page lay out for a viewport the window does not have, and a
// control measured at an x the window cannot show is a control no dispatched click can reach.
const { windowId } = await call('Browser.getWindowForTarget', { targetId }).catch(() => ({}))
if (windowId !== undefined) {
  await call('Browser.setWindowBounds', {
    windowId, bounds: { windowState: 'normal', left: 0, top: 0, width: 1680, height: 1050 },
  }).catch(() => {})
}

const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
  'practicaldocs:save-target',
  'practicaldocs:server-url',
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
const shoot = async (name) => {
  const { data } = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, name), Buffer.from(data, 'base64'))
}
const DOC = 'pdoc-cross-server-probe'
const removeFixtures = async () => {
  for (const base of [STORAGE_A, STORAGE_B]) {
    await fetch(`${base}/api/documents/${DOC}`, { method: 'DELETE' }).catch(() => {})
  }
}
const finish = async (code) => {
  await removeFixtures()
  if (persistedBefore) {
    await evaluate(`(() => {
      const saved = ${JSON.stringify(persistedBefore)}
      for (const [k, v] of Object.entries(saved)) {
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v)
      }
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
  await shoot('save-to-another-server-failure.png').catch(() => {})
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2500)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

// The browser's leave-site prompt is answered rather than left to block anything this test does.
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.method === 'Page.javascriptDialogOpening') {
    call('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {})
  }
})

// ---------------------------------------------------------------------------------------------
// Input. Real events only: the DragHandle, the ribbon and TDesign's dropdown all listen for the
// pointer, and a dispatched click on an element reference would prove nothing about any of them.
// ---------------------------------------------------------------------------------------------
const mouse = (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount,
    buttons: button === 'left' && type === 'mousePressed' ? 1 : 0,
  }, sessionId)
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', 1)
  await mouse('mouseReleased', x, y, 'left', 1)
  await sleep(300)
}
const key = async (name, keyCode) =>
  call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  }, sessionId).then(() =>
    call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    }, sessionId))
const typeText = async (text) => {
  for (const char of text) {
    if (char === '\n') {
      await key('Enter', 13)
    } else {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char }, sessionId)
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char }, sessionId)
    }
    await sleep(25)
  }
}

/**
 * The centre of an element, once it is on screen, with a check that the click will actually land on
 * it. Without the check a control scrolled under the ribbon takes every click silently and the test
 * reports a feature working that nobody can reach.
 */
const centreOf = async (expression) => {
  // Two steps, and a wait between them. The editor scrolls smoothly, so a rect read in the same
  // call as the scroll request is the position the element is leaving, not the one it arrives at -
  // measured at y=144, under the ribbon, for a paragraph that ended up in the middle of the page.
  await evaluate(`(() => {
    const el = ${expression}
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
    return true
  })()`)
  await sleep(300)
  return evaluate(`(() => {
    const el = ${expression}
    if (!el) return null
    const box = el.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return { hidden: true }
    // On the words, not on the middle of the box. A paragraph's box spans the whole column, so its
    // centre can sit past the end of the text, over a widget or an empty stretch that belongs to
    // some other element - and a click there lands somewhere the writer would never click.
    let r = box
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let textNode
    while ((textNode = walker.nextNode())) {
      if (!textNode.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const rect = [...range.getClientRects()].find((c) => c.width > 0 && c.height > 0)
      if (rect) { r = rect; break }
    }
    const x = Math.round(r.left + Math.min(r.width / 2, 40))
    const y = Math.round(r.top + r.height / 2)
    const at = document.elementFromPoint(x, y)
    return {
      x, y,
      covered: !(at === el || el.contains(at) || at?.contains(el)),
      at: at ? at.tagName + '.' + String(at.className).slice(0, 40) : null,
    }
  })()`)
}

const clickElement = async (label, expression) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const spot = await centreOf(expression)
    if (spot && !spot.hidden && !spot.covered) {
      await clickAt(spot.x, spot.y)
      return spot
    }
    await sleep(400)
  }
  const spot = await centreOf(expression)
  throw new Error(`${label}: nothing clickable (${JSON.stringify(spot)}) for ${expression}`)
}

// A control named by the words on it, the way the writer finds it.
const buttonByText = (text) =>
  `[...document.querySelectorAll('.pdoc-menu-button, .pdoc-ribbon button, button')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})`


const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// Whatever the editor last said, in the words the writer sees.
const lastMessage = () => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('[class*="message"]')].filter((el) => el.offsetParent)
  const text = nodes.map((el) => (el.textContent || '').trim()).filter(Boolean)
  return text.length ? text[text.length - 1] : ''
})()`)

const clearMessages = () => evaluate(`(() => {
  for (const el of document.querySelectorAll('[class*="message"]')) el.remove()
  return true
})()`)

const save = async () => {
  await clearMessages()
  await call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', modifiers: 2, key: 's', code: 'KeyS',
    windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83,
  }, sessionId)
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS',
    windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83,
  }, sessionId)
  // Long enough for a fetch to a dead address to give up.
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const text = await lastMessage()
    if (text && !/saving/i.test(text)) return text
  }
  return await lastMessage()
}

const openStatusPopup = async () => {
  await clickElement('the save status button in the toolbar',
    `[...document.querySelectorAll('button')]` +
    `.find((el) => el.offsetParent && /^(Unsaved|Saved)/.test((el.textContent || '').trim()))`)
  await sleep(800)
}

// A one pixel PNG: small, and a real image the editor draws.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const IMAGES = ['gambar1.png', 'gambar2.png']
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

const setServerUrl = async (url) => {
  await openStatusPopup()
  await clickElement('the practicaldocs-server destination',
    `[...document.querySelectorAll('label')]` +
    `.find((el) => el.offsetParent && /practicaldocs-server/.test((el.textContent || '').trim()))`)
  await sleep(500)
  const field = await centreOf(
    `[...document.querySelectorAll('input')]` +
    `.find((el) => el.offsetParent && /documents\\/save/.test(el.value || el.placeholder || ''))`)
  assert.ok(field && !field.hidden, 'the Server API URL field was not on screen')
  // Triple click selects what is in the field, the way anyone replaces the contents of one.
  await mouse('mouseMoved', field.x, field.y)
  await mouse('mousePressed', field.x, field.y, 'left', 3)
  await mouse('mouseReleased', field.x, field.y, 'left', 3)
  await sleep(300)
  await typeText(`${url}/api/documents/save`)
  await sleep(500)
  const now = await evaluate(`(() => {
    const el = [...document.querySelectorAll('input')].find((e) => e.offsetParent && /documents\\/save/.test(e.value || ''))
    return el ? el.value : null
  })()`)
  assert.equal(now, `${url}/api/documents/save`, 'the Server API URL did not take what was typed')
  // Back to the page, which closes the popup; the status button toggles it, so it must not be left open.
  const page = await centreOf(`document.querySelector('.ProseMirror')`)
  await clickAt(page.x, page.y - 200)
  await sleep(500)
}

// ---------------------------------------------------------------------------------------------
console.log('\nSetup: a document with two images, saved on server A')

await removeFixtures()
const seeded = await fetch(`${STORAGE_A}/api/documents/save`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: DOC,
    filename: DOC,
    title: DOC,
    html: `<p>gambar harus ikut</p>${IMAGES.map((name) => `<p><img src="./assets/${name}" width="40"></p>`).join('')}`,
    profiles: [],
    assets: IMAGES.map((name) => ({ name, type: 'image/png', data: PNG.toString('base64') })),
  }),
}).then((r) => r.json())
assert.ok(seeded.success !== false && !(seeded.missingAssets?.length), `seeding server A failed: ${JSON.stringify(seeded)}`)
const onB = await fetch(`${STORAGE_B}/api/documents/${DOC}/assets/${IMAGES[0]}`)
assert.ok(!onB.ok, 'server B already holds the image, so the test could not tell a copy from a leftover')

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: opened from server A through the Open dialog')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await setServerUrl(STORAGE_A)

await openStatusPopup()
await clickElement('Open Document... in the status popup', buttonByText('Open Document...'))
await sleep(1500)
await clickElement(`the Open Document button on the ${DOC} row`,
  `[...document.querySelectorAll('.t-list-item, [class*="list-item"]')]` +
  `.filter((el) => el.offsetParent && (el.textContent || '').includes(${JSON.stringify(DOC)}))` +
  `.map((row) => [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open Document'))` +
  `.find(Boolean)`)
await sleep(1200)
// The page holds unsaved work of its own, so the editor asks before replacing it. The writer answers.
const asked = await evaluate(`[...document.querySelectorAll('.t-dialog, [class*="dialog"]')]
  .some((el) => el.offsetParent && /Replace the current document/.test(el.textContent || ''))`)
if (asked) {
  await clickElement('Open Document in the replace confirmation',
    `[...document.querySelectorAll('.t-dialog, [class*="dialog__body"], [class*="dialog"]')]` +
    `.filter((el) => el.offsetParent && /Replace the current document/.test(el.textContent || ''))` +
    `.flatMap((el) => [...el.querySelectorAll('button')])` +
    `.find((b) => b.offsetParent && b.textContent.trim() === 'Open Document')`)
}
await sleep(3000)

const opened = await evaluate(`[...document.querySelectorAll('.pdoc-page-content img')]
  .map((img) => img.getAttribute('src') || '').filter((src) => !src.startsWith('data:'))`)
check('both images are on the page', opened.length === IMAGES.length, JSON.stringify(opened))
check('and they are drawn from server A', opened.every((src) => src.startsWith(`${STORAGE_A}/`)),
  JSON.stringify(opened))

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: saved to server B under the same name, the images go with it')

await setServerUrl(STORAGE_B)
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(600)
const message = await save()
check('the save reports no image left behind', !/could not be stored/i.test(message), JSON.stringify(message))
check('the save reports success', /saved .*successfully/i.test(message), JSON.stringify(message))

for (const name of IMAGES) {
  const response = await fetch(`${STORAGE_B}/api/documents/${DOC}/assets/${name}`)
  const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null
  check(`server B holds ${name}, byte for byte`, !!bytes && sha(bytes) === sha(PNG),
    bytes ? `${bytes.length} bytes` : `HTTP ${response.status}`)
}
const stored = await fetch(`${STORAGE_B}/api/documents/load?id=${DOC}`).then((r) => r.json()).catch(() => null)
const html = stored?.document?.html || ''
check('the document on server B points at its own folder', IMAGES.every((name) => html.includes(`./assets/${name}`)) &&
  !html.includes(STORAGE_A), `${IMAGES.filter((name) => html.includes(`./assets/${name}`)).length} relative, mentions A: ${html.includes(STORAGE_A)}`)

await shoot('save-to-another-server.png')

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- a document saved to another server takes its images with it.')
await finish(0)
