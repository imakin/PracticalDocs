/**
 * A saved document must carry its own stylesheet, and loading it back must not import that CSS as
 * document text.
 *
 * Profiles are no longer written into every block as an inline style; a block carries the profile's
 * class and the stored file carries the generated rules. That makes the file small and hand-editable,
 * and it renders on its own from the folder. The risk this guards is the mirror image: a stylesheet
 * that reaches the parser becomes a paragraph of CSS at the top of the user's document.
 *
 * Every save request is intercepted and answered locally, so the storage server is never written to.
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
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
const pending = new Map()
const listeners = []
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
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

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })

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
const bailOut = async (error) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(error?.stack || String(error))
  await finish(1)
}
process.on('uncaughtException', bailOut)
process.on('unhandledRejection', bailOut)

await call('Page.enable', {}, sessionId)
await call('Runtime.enable', {}, sessionId)

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
    try { body = JSON.parse(request.postData) } catch {}
    savePosts.push(body)
  }
  await call('Fetch.fulfillRequest', {
    requestId,
    responseCode: request.method === 'OPTIONS' ? 204 : 200,
    responseHeaders: corsHeaders,
    body: Buffer.from(JSON.stringify({ success: true, message: 'intercepted' })).toString('base64'),
  }, sessionId).catch(() => {})
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
    if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  if (!window.__ed) return 'NO_EDITOR'
  return typeof window.__p.saveContent === 'function' ? 'OK' : 'NO_SAVE_CONTENT'
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
const shoot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  await mkdir(SHOTS, { recursive: true })
  await writeFile(path.join(SHOTS, `document-stylesheet-${name}.png`), Buffer.from(shot.data, 'base64'))
}

console.log('\nCase A: a saved document carries its stylesheet and its blocks carry classes')
await evaluate(`(() => {
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, numberingProfileId: 'profile-h1' }, content: [{ type: 'text', text: 'PENDAHULUAN' }] },
    { type: 'heading', attrs: { level: 2, numberingProfileId: 'profile-h2' }, content: [{ type: 'text', text: 'Latar Belakang' }] },
    { type: 'paragraph', attrs: { numberingProfileId: 'profile-paragraph' }, content: [{ type: 'text', text: 'Kalimat isi dokumen.' }] } ] })
  window.__ed.commands.syncDocumentReferences()
  return true
})()`)
await sleep(1200)
savePosts.length = 0
await evaluate(`window.__p.saveContent(false)`)
for (let i = 0; i < 40; i += 1) { if (savePosts.some(Boolean)) break; await sleep(200) }
await shoot('case-a-saved')

const saved = savePosts.find(Boolean)
check('a save POST was issued', Boolean(saved), `${savePosts.length} POST(s)`)
const storedHtml = String(saved?.html || '')
check('the stored document opens with the generated stylesheet', /^<style data-umo-profiles>/.test(storedHtml), storedHtml.slice(0, 40))
check('the stylesheet defines the counters', storedHtml.includes('counter-reset'), 'counter-reset present')
check('the blocks are wrapped in the scope element', storedHtml.includes('<div class="umo-document">'))
check('blocks carry their profile class', /<h1[^>]*class="[^"]*umo-profile-h1/.test(storedHtml))
check('no block carries an inline profile style', !/<(h1|h2|p)[^>]*\sstyle="/.test(storedHtml), 'no style= on blocks')
check('the derived numbering attributes are gone', !/data-reference-number|data-number-style|data-number-template|data-numbering-profile-id/.test(storedHtml))
check('the stable reference id survives', /data-reference-id="/.test(storedHtml))

console.log('\nCase B: loading it back restores the document without importing the CSS')
const reloaded = await evaluate(`(async () => {
  // The dev server's base path is not fixed, so resolve the module against the page itself rather
  // than guessing a root-relative path.
  // location.pathname has no trailing slash, so a relative URL would drop the base segment.
  const p = location.pathname
  const base = location.origin + (p.endsWith('/') ? p : p + '/')
  const bases = [base + 'src/utils/profile-stylesheet.js',
                 location.origin + '/src/utils/profile-stylesheet.js']
  let mod = null
  for (const url of bases) {
    try { mod = await import(url); break } catch {}
  }
  if (!mod) throw new Error('could not load profile-stylesheet.js from ' + JSON.stringify(bases))
  const body = mod.extractDocumentHtml(${JSON.stringify(storedHtml)})
  window.__ed.commands.setContent(body)
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1200))
  const out = []
  window.__ed.state.doc.descendants((n) => {
    if (['heading', 'paragraph'].includes(n.type.name)) {
      out.push({ type: n.type.name, profile: n.attrs.numberingProfileId, label: n.attrs.referenceLabel })
    }
  })
  return {
    text: window.__ed.state.doc.textContent,
    nodes: out,
    numbers: [...document.querySelectorAll('.umo-heading-number')].map((n) => n.innerText),
  }
})()`)
await shoot('case-b-reloaded')

check('the document text survives the round trip', reloaded.text.includes('Kalimat isi dokumen.'), JSON.stringify(reloaded.text.slice(0, 60)))
check('no CSS was imported as document text', !/counter-reset|umo-count-|font-variant-numeric/.test(reloaded.text), JSON.stringify(reloaded.text.slice(0, 60)))
check('the profile is recovered from the class alone', reloaded.nodes.find((n) => n.type === 'heading')?.profile === 'profile-h1', JSON.stringify(reloaded.nodes.map((n) => n.profile)))
check('the numbering is recomputed after the load', JSON.stringify(reloaded.numbers) === JSON.stringify(['BAB I\n', '1.1']), JSON.stringify(reloaded.numbers))

console.log('\nCase C: a document written by the old format is migrated on sync')
// Every block carries an inline style repeating its profile, an inner span repeating the font, and
// the derived numbering attributes. None of that should survive contact with the editor: an inline
// style beats the class, so a leftover would pin the document to its old look forever.
const LEGACY = [
  '<h1 data-reference-id="heading-legacy1" data-reference-number="I" data-reference-label="BAB I"',
  ' data-numbering-profile-id="profile-h1" data-number-style="roman-upper" data-number-template="BAB {number}"',
  ' style="margin-bottom: 4em; font-size: 14pt; font-weight: bold; line-height: 1.5; text-align: center;">',
  '<span style="font-size: 14pt;">PENDAHULUAN</span></h1>',
  '<p data-reference-id="paragraph-legacy1" data-numbering-profile-id="profile-paragraph"',
  ' style="text-indent: 2em; margin-bottom: 0.25em; font-family: &quot;Times New Roman&quot;; font-size: 12pt; text-align: justify;">',
  '<span style="font-family: &quot;Times New Roman&quot;; font-size: 12pt;">Kalimat lama.</span></p>',
].join('')

const migrated = await evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(LEGACY)})
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1500))
  window.__ed.commands.syncDocumentReferences()
  await new Promise((r) => setTimeout(r, 1000))
  const html = window.__ed.getHTML()
  const p = document.querySelector('.ProseMirror p')
  const cs = p ? getComputedStyle(p) : null
  return {
    html,
    text: window.__ed.state.doc.textContent,
    rendered: cs ? { fontSize: cs.fontSize, fontFamily: cs.fontFamily, textIndent: cs.textIndent, textAlign: cs.textAlign } : null,
    numbers: [...document.querySelectorAll('.umo-heading-number')].map((n) => n.innerText),
  }
})()`)
await shoot('case-c-migrated')

check('the block inline styles are gone', !/<(h1|p)[^>]*\sstyle="/.test(migrated.html), migrated.html.slice(0, 80))
check('the font is no longer repeated on an inner span', !/<span[^>]*style="[^"]*font/.test(migrated.html))
check('the derived numbering attributes are gone', !/data-reference-number|data-reference-label|data-number-style|data-number-template|data-numbering-profile-id/.test(migrated.html))
check('the profile class replaced them', /class="umo-profile-h1"/.test(migrated.html) && /class="umo-profile-paragraph"/.test(migrated.html))
check('the stable reference ids survive', (migrated.html.match(/data-reference-id="/g) || []).length === 2)
check('the text is untouched', migrated.text.includes('Kalimat lama.'), JSON.stringify(migrated.text))
check('the paragraph still renders with its profile font and indent',
  migrated.rendered?.fontSize === '16px' &&
  /Times New Roman/.test(migrated.rendered?.fontFamily || '') &&
  migrated.rendered?.textIndent === '32px' &&
  migrated.rendered?.textAlign === 'justify',
  JSON.stringify(migrated.rendered))
// The label comes from the profile, whose template ends in a newline, not from the legacy
// data-number-template the fixture carried. That the newline is back is the point.
check('the numbering still renders, recomputed from the profile', JSON.stringify(migrated.numbers) === JSON.stringify(['BAB I\n']), JSON.stringify(migrated.numbers))

console.log('\nCase D: a document brings its own profiles, and they reach the stylesheet')
// Opening a document used to write its profiles straight into the extension's storage, which left the
// generated stylesheet holding the defaults from when the editor was created. A profile the document
// defined then had no CSS rule at all, and its blocks fell back to the browser's own sizes: a heading
// on a 14pt profile rendered at 35px. Only editing that profile afterwards brought the rule into
// existence, which is why the size appeared to change in the wrong direction.
const CUSTOM = {
  id: 'profile-custom-heading', name: 'Chapter Title', enabled: false, style: 'numeric',
  template: '', targetType: 'heading', level: 1, fontSize: '14pt', fontWeight: 'bold',
  lineHeight: '1.5', textAlign: 'center', indent: 0,
}
const loaded = await evaluate(`(async () => {
  localStorage.removeItem('umo-editor:profiles')
  const snapshot = {
    format: 'umodoc', formatVersion: 1, editorVersion: '11.0.4',
    savedAt: new Date().toISOString(),
    document: { title: 'profil-dokumen' },
    content: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, numberingProfileId: ${JSON.stringify(CUSTOM.id)} },
        content: [{ type: 'text', text: 'JUDUL BAB' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Isi.' }] },
    ] },
    page: JSON.parse(JSON.stringify(window.__p.page.value)),
    profiles: [${JSON.stringify(CUSTOM)}],
  }
  await window.__p.openDocumentFile(snapshot, { skipConfirmation: true })
  await new Promise((r) => setTimeout(r, 3000))
  const sheet = document.querySelector('style[data-umo-profile-styles]')
  const rules = ((sheet ? sheet.textContent : '').match(/umo-profile-[a-z0-9-]+(?= \{)/g) || [])
  const used = new Set()
  document.querySelectorAll('.ProseMirror [class*=umo-profile-]').forEach((n) => {
    const c = [...n.classList].find((x) => x.startsWith('umo-profile-'))
    if (c) used.add(c)
  })
  const heading = document.querySelector('.ProseMirror h1')
  return {
    rules,
    withoutRule: [...used].filter((c) => !rules.includes(c)),
    headingClass: heading ? [...heading.classList].find((c) => c.startsWith('umo-profile-')) : null,
    headingSize: heading ? getComputedStyle(heading).fontSize : null,
  }
})()`)
await shoot('case-d-document-profiles')

check("the document's own profile has a rule", loaded.rules.includes('umo-profile-custom-heading'), JSON.stringify(loaded.rules))
check('no block is left without a rule for its class', loaded.withoutRule.length === 0, JSON.stringify(loaded.withoutRule))
check('the heading carries that profile class', loaded.headingClass === 'umo-profile-custom-heading', String(loaded.headingClass))
// 14pt is 18.667px. The browser's own h1 is 2em, which is where the 35px came from.
check('the heading renders at the size the profile asks for', loaded.headingSize === '18.6667px', String(loaded.headingSize))

// The block gallery in the toolbar reads the profile list once when it mounts. Opening a document
// replaces that list, and nothing told the gallery, so it went on offering the built-in profiles: the
// document's own profile was missing from the picker until the Profiles dialog was opened and closed.
const gallery = await evaluate(`(() => {
  const container = document.querySelector('.umo-toolbar-headding')
  if (!container) return { found: false }
  return {
    found: true,
    names: [...container.querySelectorAll('.umo-heading-container .card .title')]
      .map((n) => (n.textContent || '').trim()),
  }
})()`)
check('the toolbar block gallery is present', gallery.found === true)
check(
  "the document's own profile is offered in the gallery without opening the dialog",
  (gallery.names || []).includes('Chapter Title'),
  JSON.stringify(gallery.names),
)

console.log('\nscreenshots written to tests/screenshots/document-stylesheet-*.png')
if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the stored document carries its own stylesheet and loads back cleanly.')
await finish(0)
