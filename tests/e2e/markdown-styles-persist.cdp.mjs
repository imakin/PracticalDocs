/**
 * Markdown styling is kept when the document is saved, and applied when it is opened.
 *
 * The Markdown Styles dialog changed the page and lost the change on the next save: the settings were
 * in the editor's snapshot, but the save never sent them, the storage server never wrote them - its
 * `settings.json` held page settings and profiles and nothing else - and the Open dialog never read
 * them back. Three places, none of them talking to the next.
 *
 * The dialog is driven with the mouse. The saving is exercised through the server rather than by
 * pressing Save, because Save writes under the document's own name and a test must not write over
 * one of the writer's documents; this one makes its own on the server and deletes it at the end.
 *
 * Needs the storage server. Endpoints come from EDITOR_URL, CDP_URL and STORAGE_URL.
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
process.on('uncaughtException', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })
process.on('unhandledRejection', async (e) => { if (bailing) return; bailing = true; console.error('\nRESULT: FAILED -- unexpected error'); console.error(e?.stack || String(e)); await finish(1) })

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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; window.__p = p; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
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
const STORAGE = (process.env.STORAGE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
const DOCUMENT = 'pdoc-markdown-styles-test'
const SIZE = '21pt'
const EXPECTED_PX = 28 // 21pt

const storageAlive = await fetch(`${STORAGE}/api/documents`).catch(() => null)
if (!storageAlive?.ok) {
  console.error(`FAIL: no storage server at ${STORAGE}.`)
  await finish(1)
}

const pointer = (type, x, y, extra = {}) =>
  call('Input.dispatchMouseEvent', { type, x, y, ...extra }, sessionId)
const clickAt = async (x, y) => {
  await pointer('mouseMoved', x, y, { button: 'none', buttons: 0 })
  await sleep(100)
  await pointer('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  await pointer('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(450)
}
const locate = (expression) => evaluate(`(() => {
  const found = (${expression})
  if (!found) return null
  const box = found.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
})()`)
const clickWhenReady = async (label, expression, tries = 30) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const at = await locate(expression)
    if (at) {
      await clickAt(at.x, at.y)
      return at
    }
    await sleep(400)
  }
  throw new Error(`could not find ${label} to click`)
}
const typeText = async (text) => {
  for (const letter of text) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', text: letter }, sessionId)
    await call('Input.dispatchKeyEvent', { type: 'keyUp' }, sessionId)
    await sleep(40)
  }
}
const headingSize = () => evaluate(`(() => {
  const heading = document.querySelector('.ProseMirror .pdoc-node-markdown h1, .ProseMirror h1')
  return heading ? Math.round(Number.parseFloat(getComputedStyle(heading).fontSize)) : null
})()`)

// ---- a markdown block with a heading in it ----------------------------------------------------
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'markdownBlock', attrs: { source: '# Judul Uji' }, content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Judul Uji' }] },
    ] },
  ] })
  await new Promise((r) => setTimeout(r, 2500))
  return true
})()`)

console.log('\nCase A: the dialog changes the page')
const before = await headingSize()
check('the markdown heading is on the page', before !== null, `${before}px`)

await clickWhenReady('the Markdown Styles control', `
  [...document.querySelectorAll('button, .pdoc-button')]
    .filter((el) => el.textContent.includes('Markdown Styles'))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]
`)
await clickWhenReady('the Heading 1 entry', `
  [...document.querySelectorAll('button, div, li, span')]
    .filter((el) => el.textContent.trim() === 'Heading 1' && el.children.length === 0)[0]
`)
await clickWhenReady('the Font Size field', `
  [...document.querySelectorAll('input')].find((el) => (el.placeholder || '').includes('12pt'))
`)
await typeText(SIZE)
// The field commits on Enter or on losing focus, so a value typed and left sitting there is not a
// setting yet. A writer presses Enter or clicks away; this presses Enter.
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
await sleep(1200)

const afterDialog = await headingSize()
check(
  'the heading takes the size that was typed',
  afterDialog === EXPECTED_PX,
  `${before}px before, ${afterDialog}px after, ${EXPECTED_PX}px expected`,
)

// Escape closes it, the way it closes any dialog.
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(800)

console.log('\nCase B: the setting is in what the editor would save')
const snapshot = await evaluate(`(() => {
  let el = document.querySelector('.pdoc-editor-container')
  let instance = el ? el.__vueParentComponent : null
  while (instance && !instance.exposed?.getDocumentSnapshot) instance = instance.parent
  const api = instance ? instance.exposed : null
  const taken = api && api.getDocumentSnapshot ? api.getDocumentSnapshot() : null
  return taken ? { markdownStyles: taken.markdownStyles, html: null } : null
})()`)
check(
  'the snapshot carries the markdown styling',
  snapshot?.markdownStyles?.h1?.fontSize === SIZE,
  JSON.stringify(snapshot?.markdownStyles?.h1 || null),
)

console.log('\nCase C: a document that carries it opens with it applied')
const stored = await evaluate(`(() => window.__ed.getHTML())()`)
const saved = await fetch(`${STORAGE}/api/documents/save`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: DOCUMENT,
    filename: DOCUMENT,
    title: DOCUMENT,
    html: stored,
    profiles: [],
    pageSettings: null,
    markdownStyles: snapshot.markdownStyles,
  }),
})
check('the document was stored', saved.ok, `HTTP ${saved.status}`)

const readBack = await (await fetch(`${STORAGE}/api/documents/load?id=${DOCUMENT}`)).json()
check(
  'the store kept the markdown styling',
  readBack?.document?.markdownStyles?.h1?.fontSize === SIZE,
  JSON.stringify(readBack?.document?.markdownStyles?.h1 || null),
)

// Reloading a document the editor still thinks is unsaved raises the browser's own "leave site?"
// dialog, and that dialog blocks every command sent over the wire - the run simply stopped there.
// Answer it the way a person does.
ws.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  if (message.method === 'Page.javascriptDialogOpening') {
    call('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {})
  }
})

// The page is reloaded, not just emptied. Clearing the content leaves the styling of this session
// in place, and the document then opens looking right for a reason that has nothing to do with what
// was saved - run against the unfixed editor, that check passed while the store held nothing at all.
await call('Page.reload', {}, sessionId)
await sleep(3000)
for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) break
  await sleep(200)
}
await sleep(2500)
const rewired = await evaluate(`(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  if (!el) return false
  let instance = el.__vueParentComponent
  while (instance) {
    const provided = instance.provides || {}
    if (provided.editor?.value?.state) { window.__ed = provided.editor.value; return true }
    instance = instance.parent
  }
  return false
})()`)
check('the page came back after reloading', rewired, rewired ? 'yes' : 'the editor never reappeared')
check('and nothing of this session is left on it', (await headingSize()) === null, 'nothing')

await clickWhenReady('the status control', `
  [...document.querySelectorAll('button')].find((b) => /^(Saved|Unsaved)/.test(b.textContent.trim()))
`)
await clickWhenReady('the Open Document menu entry', `
  [...document.querySelectorAll('li, button, div')]
    .filter((el) => el.textContent.trim().startsWith('Open Document') && el.textContent.trim().length < 26)
    .sort((a, b) => a.textContent.trim().length - b.textContent.trim().length)[0]
`)
await clickWhenReady('the row for this document', `
  (() => {
    const row = [...document.querySelectorAll('li.pdoc-list-item')]
      .filter((item) => item.getBoundingClientRect().width > 0)
      .find((item) => (item.textContent || '').includes(${JSON.stringify(DOCUMENT)}))
    if (!row) return null
    return [...row.querySelectorAll('button')]
      .find((button) => button.textContent.trim().startsWith('Open Document')) || null
  })()
`)
const confirm = await locate(`
  [...document.querySelectorAll('[class*=dialog]')]
    .filter((d) => d.getBoundingClientRect().width > 0)
    .reverse()
    .map((d) => [...d.querySelectorAll('button')].find((b) => /^(Confirm|OK|Open|Yes|Replace|Continue)/.test(b.textContent.trim())))
    .find(Boolean)
`)
if (confirm) {
  await clickAt(confirm.x, confirm.y)
}
await sleep(4000)

const opened = await headingSize()
check(
  'the heading comes back at the size that was saved',
  opened === EXPECTED_PX,
  `${opened}px, ${EXPECTED_PX}px expected`,
)

console.log('\nCase D: a paragraph indent does not reach into a list')
// What the writer reported: First Line Indent on Normal Paragraph indented every bullet too, and
// setting the list's own indent to 0 did nothing about it.
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'markdownBlock', attrs: { source: 'Paragraf biasa.\\n\\n- satu\\n- dua' }, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf biasa.' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'satu' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dua' }] }] },
      ] },
    ] },
  ] })
  await new Promise((r) => setTimeout(r, 2500))
  return true
})()`)

const indents = () => evaluate(`(() => {
  const root = document.querySelector('.ProseMirror')
  const plain = [...root.querySelectorAll('p')].find((p) => !p.closest('li'))
  const inList = root.querySelector('li p')
  const px = (el) => (el ? Math.round(Number.parseFloat(getComputedStyle(el).textIndent)) : null)
  return { plain: px(plain), inList: px(inList), listFound: Boolean(inList) }
})()`)

const beforeIndent = await indents()
check('the fixture has a paragraph and a list', beforeIndent.listFound, JSON.stringify(beforeIndent))

await clickWhenReady('the Markdown Styles control', `
  [...document.querySelectorAll('button, .pdoc-button')]
    .filter((el) => el.textContent.includes('Markdown Styles'))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]
`)
await clickWhenReady('the Normal Paragraph entry', `
  [...document.querySelectorAll('button, div, li, span')]
    .filter((el) => el.textContent.trim() === 'Normal Paragraph' && el.children.length === 0)[0]
`)
await clickWhenReady('the First Line Indent field', `
  [...document.querySelectorAll('input')].find((el) => (el.placeholder || '').includes('2em'))
`)
await typeText('2em')
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
await sleep(1200)
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(800)

const afterIndent = await indents()
check(
  'the ordinary paragraph is indented',
  afterIndent.plain > 0,
  `${afterIndent.plain}px`,
)
check(
  'and the text of a bullet is not',
  afterIndent.inList === 0,
  `${afterIndent.inList}px`,
)

// The test's own document, removed.
await fetch(`${STORAGE}/api/documents/${DOCUMENT}`, { method: 'DELETE' }).catch(() => {})

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- markdown styling is kept when saved and applied when opened.')
await finish(0)
