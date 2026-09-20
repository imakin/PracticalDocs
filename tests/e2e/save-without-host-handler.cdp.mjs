/**
 * The editor saves on its own, with no handler written by the host application.
 *
 * The toolbar draws the Save Destination, the file name and the Server API URL, and the Open dialog
 * reads documents back from that server - but saving used to be left to whoever embedded the editor.
 * An application that did not write an `onSave` could open a document and then be told
 * `Key "onSave": Please set the save method` when the writer pressed Ctrl+S. Reported from a build
 * served on another host, where opening worked and saving did not.
 *
 * Nothing here writes to a document server. One case saves to Local Storage, the other points the
 * server field at an address nothing answers on and reads the failure - which is what proves the
 * editor itself is doing the saving, because only it knows that address.
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
const finish = async (code) => {
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
  await shoot('save-without-host-handler-failure.png').catch(() => {})
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

// ---------------------------------------------------------------------------------------------
console.log('\nCase A: Ctrl+S saves, with no onSave written by the host')

const bodyBox = await centreOf(`document.querySelector('.ProseMirror')`)
assert.ok(bodyBox && !bodyBox.hidden, 'the editor body was not on screen')
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(300)
await typeText('Naskah percobaan')
await sleep(1200)

await openStatusPopup()
await clickElement('the Local Storage destination',
  `[...document.querySelectorAll('label')]` +
  `.find((el) => el.offsetParent && (el.textContent || '').trim() === 'Local Storage')`)
await sleep(600)
// Back to the page, so the shortcut reaches the editor rather than the popup.
await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(600)

const localMessage = await save()
check('saving does not ask the host for a save method',
  !/Please set the save method/i.test(localMessage), JSON.stringify(localMessage))
check('the editor reports the document saved', /saved/i.test(localMessage),
  JSON.stringify(localMessage))

// ---------------------------------------------------------------------------------------------
console.log('\nCase B: the server destination is the editor own work, and it says where it failed')

const DEAD = 'http://127.0.0.1:9/api/documents/save'
await openStatusPopup()
await clickElement('the practicaldocs-server destination',
  `[...document.querySelectorAll('label')]` +
  `.find((el) => el.offsetParent && /practicaldocs-server/.test((el.textContent || '').trim()))`)
await sleep(600)

const field = await centreOf(
  `[...document.querySelectorAll('input')]` +
  `.find((el) => el.offsetParent && /documents\\/save/.test(el.value || el.placeholder || ''))`)
assert.ok(field && !field.hidden, 'the Server API URL field was not on screen')
// Triple click selects what is in the field, the way anyone replaces the contents of one.
await mouse('mouseMoved', field.x, field.y)
await mouse('mousePressed', field.x, field.y, 'left', 3)
await mouse('mouseReleased', field.x, field.y, 'left', 3)
await sleep(300)
await typeText(DEAD)
await sleep(600)

const urlNow = await evaluate(`(() => {
  const el = [...document.querySelectorAll('input')].find((e) => e.offsetParent && /documents\\/save/.test(e.value || ''))
  return el ? el.value : null
})()`)
check('the server address is the one that was typed', urlNow === DEAD, JSON.stringify(urlNow))

await clickAt(bodyBox.x, bodyBox.y - 200)
await sleep(600)

const serverMessage = await save()
check('saving to the server does not ask the host for a save method',
  !/Please set the save method/i.test(serverMessage), JSON.stringify(serverMessage))
check('the editor tried the address the writer gave it, and said so',
  serverMessage.includes(DEAD), JSON.stringify(serverMessage))

await shoot('save-without-host-handler.png')

console.log('')
if (failures.length) {
  console.log(`RESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`)
  await finish(1)
}
console.log('RESULT: PASSED -- the editor saves by itself, and names the address when it cannot.')
await finish(0)
