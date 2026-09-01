/**
 * The Profiles dialog offers a choice, not a setting.
 *
 * Its list is where a profile is found and opened. It used to carry a numbering switch on every row,
 * so a profile's numbering could be turned on or off from a list that exists for choosing which
 * profile to look at - a setting changed without the thing it belongs to ever being opened. The
 * switch is in the edit dialog now, where every other decision about the profile is made, and the
 * list states the numbering state as text instead.
 *
 * Driven through real clicks, so the selectors the dialog depends on are covered.
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

// The dialog edits profiles, so restoring them is not optional.
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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; break }
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

// One heading, so there is a block for the dialog to talk about. The profiles come from the editor's
// own defaults; the fixture is the state the dialog is opened in.
await evaluate(`(async () => {
  window.__ed.commands.setContent('<h1>Chapter</h1><p>a paragraph</p>')
  await new Promise((r) => setTimeout(r, 1200))
  return true
})()`)

// Turn numbering off on one profile, so the list has a state to state. Set through the command, not
// through the interface, because the interface for it is exactly what is under test.
await evaluate(`(async () => {
  window.__ed.commands.updateNumberingProfile('profile-h2', { enabled: false })
  await new Promise((r) => setTimeout(r, 1000))
  return true
})()`)

const openDialog = `(async () => {
  const arrow = document.querySelector('.umo-toolbar-headding .arrow')
  if (!arrow) return 'NO_GALLERY_ARROW'
  arrow.click()
  await new Promise((r) => setTimeout(r, 800))
  const bar = document.querySelector('.profile-action-bar')
  if (!bar) return 'NO_MANAGE_BUTTON'
  bar.click()
  await new Promise((r) => setTimeout(r, 1200))
  const manager = document.querySelector('.umo-profiles-manager')
  if (!manager) return 'DIALOG_DID_NOT_OPEN'
  const rows = [...manager.querySelectorAll('.profile-card')]
  return {
    rows: rows.length,
    switches: manager.querySelectorAll('.t-switch, .umo-switch').length,
    names: rows.map((r) => r.querySelector('.profile-name')?.textContent?.trim() ?? ''),
    details: rows.map((r) => (r.querySelector('.profile-details')?.textContent || '').replace(/\\s+/g, ' ').trim()),
    editButtons: rows.filter((r) => r.querySelector('.profile-actions button')).length,
  }
})()`

console.log('\nThe profile list offers no numbering switch')
const list = await evaluate(openDialog)
if (typeof list === 'string') {
  check('the Profiles dialog opens', false, list)
  console.log(`\nRESULT: FAILED -- ${list}`)
  await finish(1)
}
console.log(`  ${list.rows} profiles listed`)
check('the dialog lists the profiles', list.rows > 0, `${list.rows} rows`)
check('no row carries a switch', list.switches === 0, `${list.switches} switch(es)`)
check('every row still offers its actions', list.editButtons === list.rows,
  `${list.editButtons} of ${list.rows}`)

console.log('\nThe numbering state is still visible, as text')
const h2Index = list.names.findIndex((name) => name === 'Title 2 (H2)')
const h1Index = list.names.findIndex((name) => name === 'Title 1 (H1)')
check('the profile with numbering off says so',
  h2Index >= 0 && /numbering off/i.test(list.details[h2Index]),
  `${JSON.stringify(list.details[h2Index] ?? null)}`)
check('a profile with numbering on does not',
  h1Index >= 0 && !/numbering off/i.test(list.details[h1Index]),
  `${JSON.stringify(list.details[h1Index] ?? null)}`)

console.log('\nThe switch is in the edit dialog, where the profile is')
const edit = await evaluate(`(async () => {
  const manager = document.querySelector('.umo-profiles-manager')
  const rows = [...manager.querySelectorAll('.profile-card')]
  const row = rows.find((r) => r.querySelector('.profile-name')?.textContent?.trim() === 'Title 2 (H2)')
  if (!row) return 'NO_H2_ROW'
  const buttons = [...row.querySelectorAll('.profile-actions button')]
  // The edit button is the icon one, last in the row.
  buttons[buttons.length - 1].click()
  await new Promise((r) => setTimeout(r, 1200))
  const dialogs = [...document.querySelectorAll('.t-dialog')].filter((d) => d.offsetParent !== null)
  const form = dialogs.map((d) => d.querySelector('form, .t-form')).find(Boolean)
  if (!form) return 'NO_EDIT_FORM'
  const switches = [...form.querySelectorAll('.t-switch, .umo-switch')]
  // Tied to the data rather than to a label string: the profile was set to numbering off before the
  // dialog was opened, so the switch has to be showing off. A switch that reflects nothing would
  // pass a label check and fail a reader.
  const checked = switches.map((el) => el.className.includes('is-checked'))
  return { switches: switches.length, checked }
})()`)
if (typeof edit === 'string') {
  check('the edit dialog opens', false, edit)
} else {
  check('the edit dialog has exactly one switch', edit.switches === 1, `${edit.switches} switch(es)`)
  check('and it shows the numbering state the profile actually has',
    edit.checked.length === 1 && edit.checked[0] === false,
    `checked: ${JSON.stringify(edit.checked)}, profile-h2 was set to numbering off`)
}

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the profile list chooses, and the edit dialog sets.')
await finish(0)
