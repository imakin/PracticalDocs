/**
 * A markdown block keeps its source, renders into real content, and can be paged through.
 *
 * ADR 0012. The claim this test exists for is case D: **pagination must break inside a markdown
 * block**. If the rendered result were drawn by the node view instead of being real content,
 * `posAtDOM` would map every line inside it to the node's own position, the solve would stop, and
 * the rest of the document would go unpaginated. That failure is invisible to a test that only
 * checks the markdown renders.
 *
 * Its own fixture throughout. It never opens a stored document.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

// A viewport this test decides, not the one the writer's window happens to have.
//
// Measured the hard way: with the browser window at 978px, a toolbar card reported by
// `getBoundingClientRect` at x=1089 is **outside the viewport**, `document.elementFromPoint` there
// returns nothing, and every dispatched click and wheel silently does nothing while every
// command-driven check still passes. A test whose verdict depends on how wide someone left their
// window is not a verdict.
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})

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

// Real mouse input, not synthetic DOM events. The block handle is driven by Tiptap's DragHandle,
// which listens for the pointer moving over the editor, so a dispatched `mouseover` does not reach it.
const mouse = async (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' && type === 'mousePressed' ? 1 : 0 }, sessionId)
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', 1)
  await mouse('mouseReleased', x, y, 'left', 1)
  await sleep(250)
}

// Real key presses. A synthetic `input` event would prove nothing here: the fault being guarded
// against was an input that renders a prop and discards what is typed, and only a real keystroke
// travelling through the component shows it.
const typeText = async (text) => {
  for (const char of text) {
    // `keyDown` carrying `text` already inserts the character. Sending `char` as well types it
    // twice - measured, "19pt" arrived as "1199pptt".
    await call('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char }, sessionId)
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char }, sessionId)
    await sleep(15)
  }
}

const failures = []
const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// ---------------------------------------------------------------------------------------------
// Case A: a block renders into real content, and the source is kept
// ---------------------------------------------------------------------------------------------
console.log('\nCase A: the source is kept and the render is real content')

const SOURCE_A = '# Metodologi\n\nParagraf pertama.\n\n- satu\n- dua'
const caseA = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(${JSON.stringify(SOURCE_A)})
  await new Promise((r) => setTimeout(r, 1200))
  const json = window.__ed.getJSON()
  const block = JSON.stringify(json).includes('markdownBlock')
    ? json.content.find((n) => n.type === 'markdownBlock')
    : null
  if (!block) return { found: false }
  return {
    found: true,
    source: block.attrs.source,
    childTypes: (block.content || []).map((n) => n.type),
    headingText: (block.content || []).find((n) => n.type === 'heading')?.content?.[0]?.text ?? null,
    // Real nodes, not markup drawn by a view: the heading has to exist in the document tree.
    headingInDom: !!document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered h1'),
    renderedEditable: document
      .querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')
      ?.getAttribute('contenteditable'),
  }
})()`)

check('the block exists in the document', caseA.found === true)
check('the source is stored exactly as written', caseA.source === SOURCE_A,
  caseA.source === SOURCE_A ? null : `got ${JSON.stringify(caseA.source)}`)
check('the render produced real nodes, not one opaque box',
  Array.isArray(caseA.childTypes) && caseA.childTypes.includes('heading') && caseA.childTypes.includes('bulletList'),
  `child types: ${JSON.stringify(caseA.childTypes)}`)
check('the heading is a heading node, carrying its text', caseA.headingText === 'Metodologi',
  `got ${JSON.stringify(caseA.headingText)}`)
check('the heading is in the editor DOM as an h1', caseA.headingInDom === true)
check('the rendered half is not typeable', caseA.renderedEditable === 'false',
  `contenteditable=${JSON.stringify(caseA.renderedEditable)}`)

// ---------------------------------------------------------------------------------------------
// Case B: math becomes the same node the rest of the document uses
// ---------------------------------------------------------------------------------------------
console.log('\nCase B: math is a real math node, drawn by the editor own renderer')

const SOURCE_B = 'Persamaannya $E = mc^2$ dan\n\n$$\n\\int_0^1 x\\,dx\n$$'
const caseB = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(${JSON.stringify(SOURCE_B)})
  await new Promise((r) => setTimeout(r, 1500))
  const types = []
  window.__ed.state.doc.descendants((node) => { types.push(node.type.name); return true })
  const inline = document.querySelector('.pdoc-node-markdown-block [data-type="inline-math"]')
  return {
    types: [...new Set(types)],
    latex: window.__ed.getJSON().content.find((n) => n.type === 'markdownBlock')
      ?.content?.flatMap((n) => n.content || [])
      .filter((n) => n.type === 'inlineMath')
      .map((n) => n.attrs.latex) ?? [],
    // KaTeX leaves its own markup behind; if the formula were still plain text there would be none.
    katexRendered: !!document.querySelector('.pdoc-node-markdown-block .katex'),
    inlineWidth: inline ? Math.round(inline.getBoundingClientRect().width) : 0,
  }
})()`)

check('inline math became an inlineMath node', caseB.types.includes('inlineMath'),
  `node types: ${JSON.stringify(caseB.types.filter((t) => t.toLowerCase().includes('math')))}`)
check('display math became a blockMath node', caseB.types.includes('blockMath'))
check('the latex survived into the node', caseB.latex.includes('E = mc^2'),
  `latex: ${JSON.stringify(caseB.latex)}`)
check('KaTeX actually drew it', caseB.katexRendered === true)
check('the formula occupies real width on screen', caseB.inlineWidth > 0, `${caseB.inlineWidth}px`)

// ---------------------------------------------------------------------------------------------
// Case C: the source survives a serialise and parse round trip
// ---------------------------------------------------------------------------------------------
console.log('\nCase C: the stored file keeps the markdown, and reading it back restores it')

const SOURCE_C = '## Bab\n\nBaris satu.\n\n    kode empat spasi\n\nBaris akhir.'
const caseC = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(${JSON.stringify(SOURCE_C)})
  await new Promise((r) => setTimeout(r, 1200))
  const html = window.__ed.getHTML()
  window.__ed.commands.setContent(html)
  await new Promise((r) => setTimeout(r, 1200))
  const back = window.__ed.getJSON().content.find((n) => n.type === 'markdownBlock')
  return {
    html,
    hasSourceElement: /<pre[^>]*data-markdown-source/.test(html),
    hasRenderedWrapper: /<div[^>]*data-markdown-rendered/.test(html),
    sourceAfterRoundTrip: back?.attrs?.source ?? null,
    childTypesAfter: (back?.content || []).map((n) => n.type),
  }
})()`)

check('the file carries the source in a pre element', caseC.hasSourceElement === true)
check('the file carries the rendered half in its own wrapper', caseC.hasRenderedWrapper === true)
check('the source came back byte for byte, newlines included',
  caseC.sourceAfterRoundTrip === SOURCE_C,
  caseC.sourceAfterRoundTrip === SOURCE_C ? null : `got ${JSON.stringify(caseC.sourceAfterRoundTrip)}`)
check('the rendered half came back as content, not as one code block',
  caseC.childTypesAfter.includes('heading'),
  `child types: ${JSON.stringify(caseC.childTypesAfter)}`)

// ---------------------------------------------------------------------------------------------
// Case D: pagination breaks inside a markdown block - the reason for the whole design
// ---------------------------------------------------------------------------------------------
console.log('\nCase D: a markdown block taller than a page is paged through, and the document after it survives')

const TAIL = 'Paragraf sesudah blok markdown.'
const caseD = await evaluate(`(async () => {
  // Long enough to span several sheets on any page size the editor offers.
  const body = []
  for (let i = 1; i <= 120; i += 1) {
    body.push('Baris ' + i + ' dari blok markdown yang sengaja dibuat panjang supaya melewati batas halaman.')
    body.push('')
  }
  const source = '# Bab Panjang\\n\\n' + body.join('\\n')
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(source)
  window.__ed.commands.insertContentAt(
    window.__ed.state.doc.content.size,
    { type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(TAIL)} }] },
  )
  await new Promise((r) => setTimeout(r, 4000))

  const root = document.querySelector('.pdoc-page-content')
  const origin = root.getBoundingClientRect().top
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;width:1px;top:0;left:0'
  root.appendChild(ruler)
  const measure = (name, fallback) => { ruler.style.height = 'var(' + name + ', ' + fallback + ')'; return ruler.getBoundingClientRect().height }
  const pageHeight = measure('--pdoc-page-height', '29.7cm')
  const marginTop = measure('--pdoc-page-margin-top', '0cm')
  const marginBottom = measure('--pdoc-page-margin-bottom', '0cm')
  const gap = measure('--pdoc-page-sheet-gap', '16px')
  ruler.remove()
  const stride = pageHeight + gap

  const blockEl = document.querySelector('.pdoc-node-markdown-block')
  const spacers = [...document.querySelectorAll('.pdoc-page-spacer')]
  const spacersInsideBlock = spacers.filter((s) => blockEl && blockEl.contains(s)).length

  // Text-node rects, not element boxes. A break spacer is a widget that can be anchored inside the
  // block that follows it (real bug 3), so a paragraph's box can span the page boundary while every
  // line of its text sits properly inside a column. Measuring boxes reports those as offenders. The
  // engine walks text nodes for exactly this reason, and so does the contents.
  const rendered = blockEl.querySelector('.pdoc-markdown-rendered')
  const lines = []
  const walker = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT, null)
  let textNode
  while ((textNode = walker.nextNode())) {
    if (!textNode.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(textNode)
    for (const rect of range.getClientRects()) {
      if (rect.height <= 0 || rect.width <= 0) continue
      lines.push({ top: rect.top - origin, bottom: rect.bottom - origin, text: textNode.textContent.slice(0, 40) })
    }
  }
  lines.sort((a, b) => a.top - b.top)
  const firstSheet = lines.length ? Math.floor(lines[0].top / stride) : -1
  const lastSheet = lines.length ? Math.floor(lines[lines.length - 1].top / stride) : -1

  let tail = null
  for (const p of document.querySelectorAll('.ProseMirror p')) {
    if (p.textContent.includes(${JSON.stringify(TAIL)}) && !blockEl.contains(p)) { tail = p; break }
  }
  // The tail is one short paragraph, so its box is its line. Measured through a text-node range all
  // the same, so the tail and the block are judged by the same ruler.
  const tailRect = tail ? (() => {
    const range = document.createRange()
    range.selectNodeContents(tail.firstChild || tail)
    const rects = [...range.getClientRects()]
    return rects.length ? rects[0] : tail.getBoundingClientRect()
  })() : null
  const tailTop = tailRect ? tailRect.top - origin : null
  const tailBottom = tailRect ? tailRect.bottom - origin : null
  const tailSheet = tail ? Math.floor(tailTop / stride) : -1
  const tailColumnTop = tailSheet * stride + marginTop
  const tailColumnBottom = tailSheet * stride + pageHeight - marginBottom

  // Every line of the block, checked against the column of the sheet it lands on. A line sitting in
  // a margin is the visible form of a solve that gave up.
  let outside = 0
  let firstOffender = null
  for (const line of lines) {
    const sheet = Math.floor(line.top / stride)
    const colTop = sheet * stride + marginTop
    const colBottom = sheet * stride + pageHeight - marginBottom
    // One pixel of tolerance at each edge: the engine measures the glyph box and grows it by the
    // half leading its block declares, so a line can land a fraction outside without being wrong.
    if (line.top < colTop - 1 || line.bottom > colBottom + 1) {
      outside += 1
      if (!firstOffender) firstOffender = { text: line.text, top: Math.round(line.top), bottom: Math.round(line.bottom), colTop: Math.round(colTop), colBottom: Math.round(colBottom) }
    }
  }

  return {
    lineCount: lines.length,
    spacerCount: spacers.length,
    spacersInsideBlock,
    firstSheet,
    lastSheet,
    tailFound: !!tail,
    tailSheet,
    tailInsideColumn: tail ? (tailTop >= tailColumnTop - 1 && tailBottom <= tailColumnBottom + 1) : false,
    outside,
    firstOffender,
  }
})()`)

check('the block really is taller than one sheet', caseD.lastSheet > caseD.firstSheet,
  `first sheet ${caseD.firstSheet}, last sheet ${caseD.lastSheet}`)
check('pagination inserted breaks inside the block', caseD.spacersInsideBlock > 0,
  `${caseD.spacersInsideBlock} of ${caseD.spacerCount} spacers are inside it`)
check('no line of the block sits in a margin', caseD.outside === 0,
  caseD.outside === 0 ? `${caseD.lineCount} lines checked` : `${caseD.outside} outside, first: ${JSON.stringify(caseD.firstOffender)}`)
check('the paragraph after the block is still there', caseD.tailFound === true)
// Measured against the rejected design on 2026-09-01, this pair is a control rather than a detector:
// both stayed green when the block was built as an atom, because the one spacer the solve managed to
// place happened to leave the tail inside a column. The two checks above are what caught it - no
// spacer inside the block, and 45 lines running through a page boundary. Kept because a tail that
// moves would still mean something is badly wrong, but do not read it as the case for the design.
check('the paragraph after the block is on a later sheet than the block started on',
  caseD.tailSheet > caseD.firstSheet,
  `tail on sheet ${caseD.tailSheet}, block started on ${caseD.firstSheet}`)
check('the paragraph after the block sits inside its column', caseD.tailInsideColumn === true)

// ---------------------------------------------------------------------------------------------
// Case E: the source wins - a file whose rendered half is stale is repaired on load
// ---------------------------------------------------------------------------------------------
console.log('\nCase E: a hand-edited file has its rendering rebuilt from the source')

const caseE = await evaluate(`(async () => {
  // What a person would leave behind after editing the markdown in the folder and not the HTML.
  const handEdited =
    '<div data-markdown-block class="pdoc-markdown-block">' +
    '<pre data-markdown-source hidden># Judul Baru</pre>' +
    '<div data-markdown-rendered><h1>Judul Lama</h1></div>' +
    '</div>'
  window.__ed.commands.setContent(handEdited)
  await new Promise((r) => setTimeout(r, 800))
  const before = window.__ed.getJSON().content.find((n) => n.type === 'markdownBlock')
  const staleText = before?.content?.[0]?.content?.[0]?.text ?? null
  window.__ed.commands.rebuildMarkdownBlocks()
  await new Promise((r) => setTimeout(r, 800))
  const after = window.__ed.getJSON().content.find((n) => n.type === 'markdownBlock')
  // A document that already agrees with itself must not be rewritten, or opening any file marks it
  // as changed and the unload guard starts claiming unsaved work that does not exist.
  const secondRun = window.__ed.commands.rebuildMarkdownBlocks()
  return {
    staleText,
    repairedText: after?.content?.[0]?.content?.[0]?.text ?? null,
    source: after?.attrs?.source ?? null,
    rebuildReportedNothingToDo: secondRun === false,
  }
})()`)

check('the stale rendering was read from the file as written', caseE.staleText === 'Judul Lama',
  `got ${JSON.stringify(caseE.staleText)}`)
check('the rendering was rebuilt from the source', caseE.repairedText === 'Judul Baru',
  `got ${JSON.stringify(caseE.repairedText)}`)
check('the source itself was left alone', caseE.source === '# Judul Baru',
  `got ${JSON.stringify(caseE.source)}`)
check('a document that agrees with itself is not rewritten',
  caseE.rebuildReportedNothingToDo === true)

// ---------------------------------------------------------------------------------------------
// Case F: no chrome, and the source appears because the cursor is there
// ---------------------------------------------------------------------------------------------
console.log('\nCase F: the block carries no panel, and shows its source only while it holds the cursor')

const caseF = await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf lain.' }] },
  ] })
  window.__ed.commands.insertMarkdownBlock('# Sebelum')
  await new Promise((r) => setTimeout(r, 1200))
  const block = document.querySelector('.pdoc-node-markdown-block')
  const atRest = {
    // The product's first principle: nothing in the page that the writer did not write.
    panels: document.querySelectorAll('.pdoc-markdown-panel, .pdoc-markdown-panel-button').length,
    sourceVisible: (() => { const t = block.querySelector('.pdoc-markdown-source'); return !!t && t.offsetParent !== null })(),
    renderedVisible: !!block.querySelector('.pdoc-markdown-rendered h1')?.offsetParent,
  }
  let pos = null
  window.__ed.state.doc.descendants((node, at) => { if (node.type.name === 'markdownBlock' && pos === null) pos = at; return false })
  window.__ed.commands.setNodeSelection(pos)
  await new Promise((r) => setTimeout(r, 500))
  const textarea = block.querySelector('.pdoc-markdown-source')
  const whenSelected = {
    sourceVisible: !!textarea && textarea.offsetParent !== null,
    sourceText: textarea?.value ?? null,
    renderedHidden: block.querySelector('.pdoc-markdown-rendered')?.offsetParent === null,
    focused: document.activeElement === textarea,
  }
  // Type as a person would, then leave the block the way leaving it happens: focus goes elsewhere.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '# Sesudah\\n\\nBaris tambahan.')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  textarea.blur()
  await new Promise((r) => setTimeout(r, 900))
  const block2 = document.querySelector('.pdoc-node-markdown-block')
  const after = window.__ed.getJSON().content.find((n) => n.type === 'markdownBlock')
  return {
    atRest,
    whenSelected,
    afterLeaving: {
      sourceVisible: (() => { const t = block2.querySelector('.pdoc-markdown-source'); return !!t && t.offsetParent !== null })(),
      renderedVisible: !!block2.querySelector('.pdoc-markdown-rendered h1')?.offsetParent,
    },
    headingAfter: after?.content?.find((n) => n.type === 'heading')?.content?.[0]?.text ?? null,
    sourceAfter: after?.attrs?.source ?? null,
  }
})()`)

check('the block carries no panel at all', caseF.atRest.panels === 0,
  `${caseF.atRest.panels} panel element(s) found`)
check('at rest it shows the render, not the source',
  caseF.atRest.renderedVisible === true && caseF.atRest.sourceVisible === false)
check('holding the cursor shows the source', caseF.whenSelected.sourceVisible === true)
check('and hides the render while it does', caseF.whenSelected.renderedHidden === true)
check('the source is the markdown, and it has the cursor',
  caseF.whenSelected.sourceText === '# Sebelum' && caseF.whenSelected.focused === true,
  `text ${JSON.stringify(caseF.whenSelected.sourceText)}, focused ${caseF.whenSelected.focused}`)
check('leaving the block puts the render back',
  caseF.afterLeaving.renderedVisible === true && caseF.afterLeaving.sourceVisible === false)
check('what was typed became the block', caseF.headingAfter === 'Sesudah',
  `got ${JSON.stringify(caseF.headingAfter)}`)
check('and was stored as the source', caseF.sourceAfter === '# Sesudah\n\nBaris tambahan.',
  `got ${JSON.stringify(caseF.sourceAfter)}`)

// ---------------------------------------------------------------------------------------------
// Case F2: a real click opens the source and it stays open
// ---------------------------------------------------------------------------------------------
console.log('\nCase F2: clicking the block opens its source at full width, and it stays open')

await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock('Penelitian ini mengevaluasi dua skenario model yang berbeda satu sama lain.')
  await new Promise((r) => setTimeout(r, 1500))
  return true
})()`)

const target = await evaluate(`(() => {
  const rendered = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')
  if (!rendered) return null
  const r = rendered.getBoundingClientRect()
  return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2), width: Math.round(r.width) }
})()`)
check('the rendered block is on screen to be clicked', !!target, JSON.stringify(target))

await clickAt(target.x, target.y)
await sleep(700)
const sourceOpened = await evaluate(`(() => {
  const block = document.querySelector('.pdoc-node-markdown-block')
  const textarea = block?.querySelector('.pdoc-markdown-source')
  return {
    visible: !!textarea && textarea.offsetParent !== null,
    width: textarea ? Math.round(textarea.getBoundingClientRect().width) : 0,
    blockWidth: block ? Math.round(block.getBoundingClientRect().width) : 0,
  }
})()`)
check('one click opens the source', sourceOpened.visible === true)
// The bug: the source came out one narrow column, because a textarea's intrinsic width is its `cols`
// attribute - 20 characters - and the flex parent let it shrink to that.
//
// Compared against the width the block had **before** it was clicked, not against its width now.
// Measured against the rejected fix: the block shrinks together with the textarea inside it, so
// comparing the two to each other passes at 160px against 160px while the bug is fully present.
// A comparison between two values that are wrong the same way can only tell you they agree.
check('the source is as wide as the block was before it was clicked, not one narrow column',
  sourceOpened.width > 0 && Math.abs(sourceOpened.width - target.width) <= 2,
  `source ${sourceOpened.width}px against ${target.width}px before the click`)

// It stayed open at the first look. The reported symptom was that it flickered back, so look again
// after long enough for a second cycle to have happened.
await sleep(1500)
const stillOpen = await evaluate(`(() => {
  const textarea = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-source')
  return {
    visible: !!textarea && textarea.offsetParent !== null,
    focused: document.activeElement === textarea,
  }
})()`)
check('it is still open a second later, not flickering back to the render', stillOpen.visible === true)
check('and it still holds the cursor', stillOpen.focused === true)

// ---------------------------------------------------------------------------------------------
// Case F3: the handle button opens the source, and the hold lapses on its own
// ---------------------------------------------------------------------------------------------
console.log('\nCase F3: pressing the Markdown icon on the handle opens the source and puts the cursor in it')

await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock('Blok markdown untuk diuji lewat tombol pada pegangan.')
  await new Promise((r) => setTimeout(r, 1500))
  document.activeElement?.blur?.()
  return true
})()`)

const blockSpot = await evaluate(`(() => {
  const rendered = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-rendered')
  if (!rendered) return null
  const r = rendered.getBoundingClientRect()
  return { x: Math.round(r.left + r.width - 30), y: Math.round(r.top + r.height / 2) }
})()`)

// Point at the block, the way a person raises its handle.
await mouse('mouseMoved', blockSpot.x, blockSpot.y)
await sleep(700)
const modeButton = await evaluate(`(() => {
  const button = document.querySelector('.pdoc-block-menu-hander .pdoc-block-menu-mode')
  if (!button) return null
  const r = button.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('the handle shows a Markdown button for a markdown block', !!modeButton,
  modeButton ? JSON.stringify(modeButton) : 'not found or not visible')

if (modeButton) {
  await clickAt(modeButton.x, modeButton.y)
  await sleep(600)
}
const byButton = await evaluate(`(() => {
  const textarea = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-source')
  return {
    visible: !!textarea && textarea.offsetParent !== null,
    focused: document.activeElement === textarea,
  }
})()`)
check('pressing it opens the source', byButton.visible === true)
// The whole reason the button exists: the click route left the source open without the cursor in it.
check('and puts the cursor in the source', byButton.focused === true)

// With the cursor in, the hold is cancelled - the block stays open past the timeout because someone
// is working in it, not because a timer says so.
await sleep(6000)
const afterTimeout = await evaluate(`(() => {
  const textarea = document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-source')
  return {
    visible: !!textarea && textarea.offsetParent !== null,
    focused: document.activeElement === textarea,
  }
})()`)
check('it is still open after the hold would have lapsed, because the cursor is in it',
  afterTimeout.visible === true && afterTimeout.focused === true,
  `visible ${afterTimeout.visible}, focused ${afterTimeout.focused}`)

// And leaving still closes it, whichever way it was opened.
await evaluate(`(() => { document.querySelector('.pdoc-node-markdown-block .pdoc-markdown-source')?.blur(); return true })()`)
await sleep(900)
const afterLeaving = await evaluate(`(() => {
  const block = document.querySelector('.pdoc-node-markdown-block')
  const textarea = block?.querySelector('.pdoc-markdown-source')
  return {
    sourceVisible: !!textarea && textarea.offsetParent !== null,
    renderedVisible: !!block?.querySelector('.pdoc-markdown-rendered')?.offsetParent,
  }
})()`)
check('leaving still returns it to the render, however it was opened',
  afterLeaving.sourceVisible === false && afterLeaving.renderedVisible === true)

// ---------------------------------------------------------------------------------------------
// Case G: the route in and the route out, driven through the block handle
// ---------------------------------------------------------------------------------------------
console.log('\nCase G: an ordinary block becomes markdown, and comes back, through the real menu')

const PARAGRAPH = '## Judul dari paragraf'
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(PARAGRAPH)} }] },
  ] })
  await new Promise((r) => setTimeout(r, 1500))
  return true
})()`)

const spot = await evaluate(`(() => {
  const p = [...document.querySelectorAll('.ProseMirror p')].find((el) => el.textContent.includes(${JSON.stringify(PARAGRAPH)}))
  if (!p) return null
  const r = p.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('the paragraph is on screen to be pointed at', !!spot, JSON.stringify(spot))

// Point at the block, which is what makes its handle appear.
await mouse('mouseMoved', spot.x, spot.y)
await sleep(600)
const handle = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.pdoc-block-menu-hander .pdoc-block-menu-button')]
  const visible = buttons.filter((b) => b.getBoundingClientRect().width > 0)
  return visible.map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
})()`)
check('pointing at a block reveals its handle', handle.length > 0, `${handle.length} button(s) visible`)

let opened = null
for (const point of handle) {
  await clickAt(point.x, point.y)
  opened = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.pdoc-block-menu-dropdown .pdoc-button-text, .pdoc-block-menu-dropdown .pdoc-menu-button')]
      .map((el) => el.textContent.trim()).filter(Boolean)
    const target = [...document.querySelectorAll('.pdoc-block-menu-dropdown *')]
      .find((el) => el.children.length === 0 && el.textContent.trim() === 'Change to Markdown')
    if (!target) return { items, found: false }
    const r = target.getBoundingClientRect()
    return { items, found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (opened?.found) break
}
check('the block menu offers Change to Markdown', opened?.found === true,
  `menu items seen: ${JSON.stringify(opened?.items ?? [])}`)

if (opened?.found) {
  await clickAt(opened.x, opened.y)
  await sleep(900)
}
const converted = await evaluate(`(() => {
  const doc = window.__ed.getJSON()
  const block = doc.content.find((n) => n.type === 'markdownBlock')
  return {
    isMarkdown: !!block,
    source: block?.attrs?.source ?? null,
    headingText: block?.content?.find((n) => n.type === 'heading')?.content?.[0]?.text ?? null,
    headingLevel: block?.content?.find((n) => n.type === 'heading')?.attrs?.level ?? null,
  }
})()`)
check('the paragraph became a markdown block', converted.isMarkdown === true)
check('its text became the source, unchanged', converted.source === PARAGRAPH,
  `got ${JSON.stringify(converted.source)}`)
check('the source rendered, so the markdown the writer typed by hand now means something',
  converted.headingText === 'Judul dari paragraf' && converted.headingLevel === 2,
  `h${converted.headingLevel} ${JSON.stringify(converted.headingText)}`)

// And back out again. The rendered content is kept; the source has nowhere left to live.
const unwrapped = await evaluate(`(() => {
  let pos = null
  window.__ed.state.doc.descendants((node, at) => { if (node.type.name === 'markdownBlock' && pos === null) pos = at; return false })
  const ok = window.__ed.commands.unwrapMarkdownBlock({ pos })
  const doc = window.__ed.getJSON()
  return {
    ok,
    stillMarkdown: doc.content.some((n) => n.type === 'markdownBlock'),
    topLevel: doc.content.map((n) => n.type),
    headingText: doc.content.find((n) => n.type === 'heading')?.content?.[0]?.text ?? null,
  }
})()`)
check('converting back reported success', unwrapped.ok === true)
check('no markdown block is left', unwrapped.stillMarkdown === false,
  `top level: ${JSON.stringify(unwrapped.topLevel)}`)
check('the rendered content survived as ordinary blocks', unwrapped.headingText === 'Judul dari paragraf',
  `got ${JSON.stringify(unwrapped.headingText)}`)

// A block carrying no text must be refused rather than quietly emptied.
const refused = await evaluate(`(() => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.addTableOfContents({})
  let pos = null
  window.__ed.state.doc.descendants((node, at) => { if (node.type.name === 'toc' && pos === null) pos = at; return false })
  if (pos === null) return { skipped: true }
  const before = JSON.stringify(window.__ed.getJSON())
  const ok = window.__ed.commands.convertToMarkdownBlock({ pos })
  return { skipped: false, ok, unchanged: JSON.stringify(window.__ed.getJSON()) === before }
})()`)
check('converting a block with no text is refused',
  refused.skipped === true || (refused.ok === false && refused.unchanged === true),
  refused.skipped ? 'no atom available to try' : `returned ${refused.ok}, document unchanged: ${refused.unchanged}`)

// ---------------------------------------------------------------------------------------------
// Case H: markdown styling is its own group, with a section per kind of thing
// ---------------------------------------------------------------------------------------------
console.log('\nCase H: markdown styles reach the render, section by section, and nothing else')

const caseH = await evaluate(`(async () => {
  const set = (styles) => window.__ed.commands.setNumberingConfig({ markdownStyles: styles })

  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Pendahuluan' }] },
  ] })
  window.__ed.commands.insertMarkdownBlock(
    '# Bab\\n\\n## Sub\\n\\nParagraf biasa dengan $x = 1$ di dalamnya.\\n\\n$$\\ny = 2\\n$$\\n\\n- satu\\n  - dalam',
  )
  window.__ed.commands.insertContentAt(window.__ed.state.doc.content.size,
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hasil' }] })
  await new Promise((r) => setTimeout(r, 1800))

  const px = (el, prop) => (el ? Math.round(Number.parseFloat(getComputedStyle(el)[prop])) : 0)
  const measure = () => {
    const md = document.querySelector('.pdoc-markdown-rendered')
    const outer = document.querySelector('.ProseMirror > h1')
    return {
      h1: px(md?.querySelector('h1'), 'fontSize'),
      h2: px(md?.querySelector('h2'), 'fontSize'),
      p: px(md?.querySelector('p'), 'fontSize'),
      pTop: px(md?.querySelector('p'), 'marginTop'),
      pAlign: md?.querySelector('p') ? getComputedStyle(md.querySelector('p')).textAlign : '',
      pIndent: px(md?.querySelector('p'), 'textIndent'),
      inlineMath: px(md?.querySelector('[data-type="inline-math"]'), 'fontSize'),
      blockMath: px(md?.querySelector('[data-type="block-math"]'), 'marginTop'),
      outerList: px(md?.querySelector('ul'), 'paddingLeft'),
      nestedList: px(md?.querySelector('ul ul'), 'paddingLeft'),
      outsideH1: px(outer, 'fontSize'),
      hasBlockMath: !!md?.querySelector('[data-type="block-math"]'),
      hasNested: !!md?.querySelector('ul ul'),
    }
  }

  const before = measure()
  set({
    h1: { fontSize: '40pt' },
    h2: { fontSize: '20pt' },
    paragraph: { fontSize: '11pt', marginTop: '3em', textAlign: 'justify', textIndent: '2em' },
    inlineMath: { fontSize: '30pt' },
    blockMath: { marginTop: '4em' },
    bulletList: { nestedIndent: '5em' },
  })
  await new Promise((r) => setTimeout(r, 1200))
  const after = measure()
  set({})
  await new Promise((r) => setTimeout(r, 400))
  const cleared = measure()
  return { before, after, cleared }
})()`)

check('the fixture actually contains block math and a nested list',
  caseH.before.hasBlockMath === true && caseH.before.hasNested === true,
  `blockMath ${caseH.before.hasBlockMath}, nested ${caseH.before.hasNested}`)
check('each heading level has its own setting',
  caseH.after.h1 >= 50 && caseH.after.h2 >= 24 && caseH.after.h1 > caseH.after.h2,
  `h1 ${caseH.after.h1}px, h2 ${caseH.after.h2}px`)
check('a paragraph takes its own size, not a heading one',
  caseH.after.p !== caseH.after.h1 && caseH.after.p >= 13 && caseH.after.p <= 16,
  `paragraph ${caseH.after.p}px`)
check('top margin, alignment and first line indent all reach the render',
  caseH.after.pTop >= 40 && caseH.after.pAlign === 'justify' && caseH.after.pIndent >= 20,
  `margin-top ${caseH.after.pTop}px, align ${caseH.after.pAlign}, indent ${caseH.after.pIndent}px`)
check('inline math has a setting of its own',
  caseH.after.inlineMath > caseH.after.p,
  `inline math ${caseH.after.inlineMath}px against paragraph ${caseH.after.p}px`)
check('block math has a setting of its own',
  caseH.after.blockMath >= 40, `block math margin-top ${caseH.after.blockMath}px`)
// Level 0 at the text margin, one step per level, which is what was asked for.
check('a top level list sits at the text margin', caseH.after.outerList === 0,
  `${caseH.after.outerList}px`)
check('each nesting level adds the step', caseH.after.nestedList >= 60,
  `nested padding-left ${caseH.after.nestedList}px`)
// The independent claim. Everything above measures inside a markdown block, where a wrong selector
// and a wrong measurement could agree with each other. A heading outside owes nothing to either.
check('an ordinary heading outside the block never moves',
  caseH.after.outsideH1 === caseH.before.outsideH1 && caseH.before.outsideH1 > 0,
  `outside ${caseH.before.outsideH1}px -> ${caseH.after.outsideH1}px`)
check('clearing the settings puts the render back where it started',
  caseH.cleared.h1 === caseH.before.h1 && caseH.cleared.pTop === caseH.before.pTop,
  `h1 ${caseH.cleared.h1}px against ${caseH.before.h1}px, margin ${caseH.cleared.pTop}px against ${caseH.before.pTop}px`)

// ---------------------------------------------------------------------------------------------
// Case I: the settings dialog, filled in by typing
// ---------------------------------------------------------------------------------------------
console.log('\nCase I: a value typed into the dialog stays in the field and reaches the page')

await evaluate(`(async () => {
  window.__ed.commands.setNumberingConfig({ markdownStyles: {} })
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock('# Judul\\n\\nParagraf.')
  await new Promise((r) => setTimeout(r, 1200))
  document.activeElement?.blur?.()
  return true
})()`)

const openButton = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.pdoc-toolbar button, .pdoc-toolbar .pdoc-button')]
    .find((el) => el.textContent.trim() === 'Markdown Styles')
  if (!button) return null
  const r = button.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('Home offers Markdown Styles', !!openButton, openButton ? JSON.stringify(openButton) : 'not found')

if (openButton) {
  await clickAt(openButton.x, openButton.y)
  await sleep(800)
}
const dialog = await evaluate(`(() => {
  const sections = [...document.querySelectorAll('.pdoc-markdown-styles-section')].map((el) => el.textContent.trim())
  // By placeholder, not by framework class. TDesign is configured here with its own class prefix, so
  // a test hardcoding the library's internal class names breaks on a theme change rather than on a
  // real fault. (No backticks in this comment: it sits inside a template literal.)
  const labels = [...document.querySelectorAll('.pdoc-markdown-styles-form input')].map((el) => el.placeholder)
  return { open: sections.length > 0, sections, labels }
})()`)
check('the dialog lists a section for each kind of thing', dialog.sections.length >= 12,
  `${dialog.sections.length} sections: ${JSON.stringify(dialog.sections.slice(0, 4))}...`)
check('and a field for each setting', dialog.labels.length >= 8,
  `${dialog.labels.length} fields: ${JSON.stringify(dialog.labels)}`)

// Click into the Font Size field and type, the way a person would.
const fontSizeBox = await evaluate(`(() => {
  const input = [...document.querySelectorAll('.pdoc-markdown-styles-form input')]
    .find((el) => el.placeholder === 'e.g. 12pt')
  if (!input) return null
  const r = input.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
check('the Font Size field is on screen', !!fontSizeBox, JSON.stringify(fontSizeBox))

if (fontSizeBox) {
  await clickAt(fontSizeBox.x, fontSizeBox.y)
  await sleep(200)
  await typeText('19pt')
  await sleep(400)
}
const typed = await evaluate(`(() => {
  const input = [...document.querySelectorAll('.pdoc-markdown-styles-form input')]
    .find((el) => el.placeholder === 'e.g. 12pt')
  return { value: input?.value ?? null, focused: document.activeElement === input }
})()`)
// The fault: an input given a `value` prop renders that prop and discards what is typed, so every
// keystroke was overwritten as it was made and the field could not be filled in at all.
check('what was typed is taken as the value', typed.value === '19pt',
  `field holds ${JSON.stringify(typed.value)}`)

// Commit the way a person does, by leaving the field, then close and measure the page.
await evaluate(`(() => { document.activeElement?.blur?.(); return true })()`)
await sleep(900)
const applied = await evaluate(`(() => {
  const stored = window.__ed.extensionStorage.documentReferences.markdownStyles
  const para = document.querySelector('.pdoc-markdown-rendered p')
  const outside = document.querySelector('.ProseMirror > p, .ProseMirror > h1')
  return {
    storedFontSize: stored?.paragraph?.fontSize ?? null,
    renderedFontSize: para ? Math.round(Number.parseFloat(getComputedStyle(para).fontSize)) : 0,
    outsideFontSize: outside ? Math.round(Number.parseFloat(getComputedStyle(outside).fontSize)) : 0,
  }
})()`)
check('leaving the field stores it', applied.storedFontSize === '19pt',
  `stored ${JSON.stringify(applied.storedFontSize)}`)
// Assert on the element that uses the setting, not on the setting.
check('and the paragraph in the markdown block actually renders at that size',
  applied.renderedFontSize >= 24 && applied.renderedFontSize <= 27,
  `${applied.renderedFontSize}px`)
check('while text outside a markdown block is untouched',
  applied.outsideFontSize > 0 && applied.outsideFontSize < 24,
  `${applied.outsideFontSize}px`)

await evaluate(`(() => {
  window.__ed.commands.setNumberingConfig({ markdownStyles: {} })
  return true
})()`)

// ---------------------------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'RESULT: PASSED' : `RESULT: FAILED -- ${failures.length} check(s)`}`)
for (const f of failures) console.log(`  - ${f}`)
await finish(failures.length === 0 ? 0 : 1)
