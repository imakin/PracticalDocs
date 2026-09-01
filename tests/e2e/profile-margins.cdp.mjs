/**
 * A profile's Top Margin reaches the block, and the toolbar panel shows what the profile set.
 *
 * Two faults, one cause each.
 *
 * The gap between blocks was `.umo-editor-content .umo-editor > * + *:not(.umo-floating-node)`,
 * three classes, against a profile rule's two. It won every time and set `margin-top` to a variable
 * that resolves to zero, so a profile's Top Margin did nothing at any value while its Bottom Margin,
 * which nothing competes for, worked. The rule is a default and now says so with `:where()`.
 *
 * The margin panel read `node.attrs.margin` alone. Since a profile became a CSS class a block styled
 * only by its profile carries no margin attribute, so the panel came up empty for a block that
 * plainly had spacing. It now shows the profile's values as the placeholder - not as the value,
 * which would turn styling the profile owns into a per-block override on the next keystroke.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import WebSocket from 'ws'

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
const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
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

// The profile list is one of these. The test edits a profile, so restoring them is not optional.
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
const bail = async (e) => {
  if (bailing) return
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

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
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
if (wired !== 'OK') {
  console.error(`FAIL: could not reach the editor internals: ${wired}`)
  await finish(1)
}
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// Two paragraphs after a heading, so the block under test is an `* + *` and the default gap rule
// applies to it. That rule is the one that used to win.
const FIXTURE = '<h1>Chapter</h1><p>first paragraph</p><p>second paragraph</p>'

const PROFILE = 'profile-paragraph'

const setup = async (marginTop, marginBottom) =>
  evaluate(`(async () => {
    const ed = window.__ed
    ed.commands.setContent(${JSON.stringify(FIXTURE)})
    await new Promise((r) => setTimeout(r, 900))
    ed.commands.updateNumberingProfile(${JSON.stringify(PROFILE)}, {
      marginTop: ${JSON.stringify(marginTop)},
      marginBottom: ${JSON.stringify(marginBottom)},
    })
    await new Promise((r) => setTimeout(r, 1200))
    return true
  })()`)

// Measured on the block, in pixels, with the expectation computed from its own font size so the
// test does not depend on what the profile sets the size to.
const measure = `(() => {
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')]
  const block = paragraphs[paragraphs.length - 1]
  if (!block) return { missing: true }
  const cs = getComputedStyle(block)
  const pm = document.querySelector('.ProseMirror')
  return {
    className: block.className,
    fontSize: Number.parseFloat(cs.fontSize),
    marginTop: Number.parseFloat(cs.marginTop),
    marginBottom: Number.parseFloat(cs.marginBottom),
    inlineStyle: block.getAttribute('style') || '',
    defaultGap: getComputedStyle(pm).getPropertyValue('--umo-content-node-bottom').trim(),
  }
})()`

console.log('\nA profile top margin reaches the block, at more than one value')
for (const em of [5, 2]) {
  await setup(`${em}em`, '3em')
  const m = await evaluate(measure)
  if (m.missing) { console.error('FAIL: the fixture produced no paragraph'); await finish(1) }
  const expected = em * m.fontSize
  check(`a profile top margin of ${em}em renders as ${expected}px`,
    Math.abs(m.marginTop - expected) <= 1,
    `computed ${m.marginTop}px, font size ${m.fontSize}px, class ${m.className}`)
  check(`the bottom margin still works alongside it (${em}em case)`,
    Math.abs(m.marginBottom - 3 * m.fontSize) <= 1,
    `computed ${m.marginBottom}px`)
}

console.log('\nA block whose profile states no top margin still takes the editor default')
await setup('', '3em')
const bare = await evaluate(measure)
const gap = Number.parseFloat(bare.defaultGap) || 0
check('the default gap is unchanged for a block with no profile top margin',
  Math.abs(bare.marginTop - gap) <= 1,
  `computed ${bare.marginTop}px against --umo-content-node-bottom of ${JSON.stringify(bare.defaultGap)}`)

console.log('\nA per-block override still beats the profile')
await setup('5em', '3em')
await evaluate(`(async () => {
  const ed = window.__ed
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')]
  const pos = ed.view.posAtDOM(paragraphs[paragraphs.length - 1], 0)
  ed.commands.setTextSelection(pos)
  ed.commands.setMargin({ top: '10px', bottom: '11px' })
  await new Promise((r) => setTimeout(r, 900))
  return true
})()`)
const overridden = await evaluate(measure)
check('an override of 10px wins over the profile top margin', Math.abs(overridden.marginTop - 10) <= 1,
  `computed ${overridden.marginTop}px, inline style ${JSON.stringify(overridden.inlineStyle)}`)
check('an override of 11px wins over the profile bottom margin', Math.abs(overridden.marginBottom - 11) <= 1,
  `computed ${overridden.marginBottom}px`)

// The panel is opened by pressing its own arrow handle, so the selectors it depends on are covered.
const openMarginPanel = `(async () => {
  const uses = [...document.querySelectorAll('use')]
  const icon = uses.find((u) => (u.getAttribute('xlink:href') || u.getAttribute('href')) === '#umo-icon-margin')
  if (!icon) return 'NO_MARGIN_BUTTON'
  const button = icon.closest('button, .umo-menu-button')
  if (!button) return 'NO_BUTTON_WRAPPER'
  const handle = button.querySelector('.umo-button-handle') || button
  handle.click()
  await new Promise((r) => setTimeout(r, 900))
  const box = document.querySelector('.umo-node-margin-input')
  if (!box) return 'PANEL_DID_NOT_OPEN'
  const inputs = [...box.querySelectorAll('input')]
  return {
    top: { value: inputs[0]?.value ?? null, placeholder: inputs[0]?.placeholder ?? null },
    bottom: { value: inputs[1]?.value ?? null, placeholder: inputs[1]?.placeholder ?? null },
  }
})()`

const selectParagraph = `(async () => {
  const ed = window.__ed
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')]
  const pos = ed.view.posAtDOM(paragraphs[paragraphs.length - 1], 0)
  ed.commands.setTextSelection(pos + 1)
  ed.commands.focus()
  await new Promise((r) => setTimeout(r, 600))
  return true
})()`

console.log('\nThe margin panel shows what the profile set')
await setup('5em', '3em')
await evaluate(selectParagraph)
const panel = await evaluate(openMarginPanel)
if (typeof panel === 'string') {
  check('the margin panel opens', false, panel)
} else {
  // Compared whole, not with includes: the old placeholder was "e.g. 0.25em, 12px", which contains
  // "5em" inside "0.25em" and let a substring check pass on the unfixed build.
  check('the panel names the profile top margin', panel.top.placeholder === 'profile: 5em',
    `placeholder ${JSON.stringify(panel.top.placeholder)}`)
  check('the panel names the profile bottom margin', panel.bottom.placeholder === 'profile: 3em',
    `placeholder ${JSON.stringify(panel.bottom.placeholder)}`)
  check('the fields stay empty, because the block carries no override',
    panel.top.value === '' && panel.bottom.value === '',
    `top ${JSON.stringify(panel.top.value)}, bottom ${JSON.stringify(panel.bottom.value)}`)
}

console.log('\nAn override is shown as the value, not as the profile')
await evaluate(`(async () => {
  const box = document.querySelector('.umo-node-margin-input')
  if (box) document.body.click()
  await new Promise((r) => setTimeout(r, 500))
  const ed = window.__ed
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')]
  const pos = ed.view.posAtDOM(paragraphs[paragraphs.length - 1], 0)
  ed.commands.setTextSelection(pos + 1)
  ed.commands.setMargin({ top: '10px', bottom: '11px' })
  await new Promise((r) => setTimeout(r, 900))
  return true
})()`)
await evaluate(selectParagraph)
const panelOverridden = await evaluate(openMarginPanel)
if (typeof panelOverridden === 'string') {
  check('the margin panel opens with an override set', false, panelOverridden)
} else {
  check('the override is in the top field', panelOverridden.top.value === '10px',
    JSON.stringify(panelOverridden.top))
  check('the override is in the bottom field', panelOverridden.bottom.value === '11px',
    JSON.stringify(panelOverridden.bottom))
  check('the profile is still named in the placeholder underneath',
    panelOverridden.top.placeholder === 'profile: 5em',
    `placeholder ${JSON.stringify(panelOverridden.top.placeholder)}`)
}

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- a profile top margin renders, and the panel shows what the profile set.')
await finish(0)
