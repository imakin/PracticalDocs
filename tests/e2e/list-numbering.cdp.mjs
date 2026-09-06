/**
 * Continuing a numbered list is one rule: the last number at this indent level, plus one - and
 * indenting an item asks the list it is in, not the lists above it.
 *
 * The user asked for a count they can steer without meeting conditions. A list may continue from
 * the numbers above it whatever sits in between - a paragraph, a table, a heading, a whole new
 * chapter - because none of those is a number at that indent level. The old rule looked for an
 * ordered list that was a sibling of this one under the same parent, so the common case in a thesis
 * (a list, some prose, a figure, then the list resumes) could not continue at all, and the menu item
 * that would have done it was greyed out with no reason given.
 *
 * What is measured here is the marker text a reader sees, not the attributes behind it.
 *
 * Endpoints come from EDITOR_URL and CDP_URL. Per adr/0006 there is no built-in fallback.
 */
import assert from 'node:assert/strict'

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
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
}, sessionId).catch(() => {})
await call('Page.bringToFront', {}, sessionId).catch(() => {})

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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
assert.equal(wired, 'OK', `could not reach the editor internals: ${wired}`)
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
let total = 0
const check = (label, condition, detail) => {
  total += 1
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

const mouse = async (type, x, y, button = 'none', clickCount = 0) =>
  call('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' && type === 'mousePressed' ? 1 : 0 }, sessionId)
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y)
  await sleep(120)
  await mouse('mousePressed', x, y, 'left', 1)
  await mouse('mouseReleased', x, y, 'left', 1)
  await sleep(450)
}

const setContent = async (html) => evaluate(`(async () => {
  window.__ed.commands.setContent(${JSON.stringify(html)})
  await new Promise((r) => setTimeout(r, 900))
  return true
})()`)

// The markers a reader sees, list by list. Nested lists are reported under their own entry, so a
// level 0 count and a level 1 count can be told apart.
const markers = async () => evaluate(`[...document.querySelectorAll('.ProseMirror ol')].map((ol) => ({
  level: (() => { let n = 0, el = ol.parentElement
      while (el && !el.classList.contains('ProseMirror')) { if (el.tagName === 'OL' || el.tagName === 'UL') n += 1; el = el.parentElement }
      return n })(),
  markers: [...ol.children].filter((li) => li.tagName === 'LI')
    .map((li) => (li.querySelector(':scope > .pdoc-list-item-marker .pdoc-list-item-marker-text') || {}).textContent || ''),
}))`)

// Open the marker menu for one list item by clicking the marker itself, the way the writer does.
const openMarkerMenu = async (listIndex, itemIndex) => {
  const spot = await evaluate(`(() => {
    const ol = document.querySelectorAll('.ProseMirror ol')[${listIndex}]
    if (!ol) return null
    const li = [...ol.children].filter((n) => n.tagName === 'LI')[${itemIndex}]
    const marker = li && li.querySelector(':scope > .pdoc-list-item-marker')
    if (!marker) return null
    const r = marker.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
  })()`)
  if (!spot || spot.w === 0) return null
  await clickAt(spot.x, spot.y)
  return evaluate(`(() => {
    const menu = document.querySelector('.pdoc-list-item-overlay')
    if (!menu || menu.offsetParent === null) return null
    const info = menu.querySelector('.pdoc-list-item-menu-info')
    return {
      info: info ? info.textContent.trim() : null,
      items: [...menu.querySelectorAll('.pdoc-list-item-menu-item')].filter((el) => !el.classList.contains('pdoc-list-item-menu-info')).map((el) => {
        const r = el.getBoundingClientRect()
        return {
          text: el.textContent.trim(),
          disabled: el.classList.contains('t-is-disabled') || el.classList.contains('pdoc-dropdown__item--disabled') || el.getAttribute('disabled') !== null,
          x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width),
        }
      }),
    }
  })()`)
}
const clickMenuItem = async (menu, startsWith) => {
  const item = menu.items.find((i) => i.text.startsWith(startsWith))
  if (!item || item.w === 0) return false
  await clickAt(item.x, item.y)
  await sleep(600)
  return true
}

const LISTS_ACROSS_EVERYTHING = `
<p>Pendahuluan.</p>
<ol><li><p>Satu</p></li><li><p>Dua</p></li></ol>
<p>Paragraf biasa yang memutus daftar.</p>
<h1>Bab Berikutnya</h1>
<table><tbody><tr><td><p>Sel tabel</p></td></tr></tbody></table>
<ol><li><p>Tiga</p></li><li><p>Empat</p></li></ol>
`

console.log('\nCase A: a list continues across a paragraph, a heading and a table')
await setContent(LISTS_ACROSS_EVERYTHING)
let before = await markers()
check('the fixture has two lists at level 0',
  before.filter((l) => l.level === 0).length === 2, JSON.stringify(before))
check('the second list starts over before anything is asked of it',
  before[1]?.markers.join(',') === '1.,2.', JSON.stringify(before[1]?.markers))

let menu = await openMarkerMenu(1, 0)
check('clicking the marker opens the menu', !!menu, menu ? 'opened' : 'no menu')
check('the menu says which indent level this is',
  (menu?.info || '').includes('Indent level: 0'), JSON.stringify(menu?.info))
check('Continue says the number it will give', /Continue Numbering \(3\)/.test((menu?.items || []).map((i) => i.text).join(' | ')),
  JSON.stringify((menu?.items || []).map((i) => i.text)))
check('neither action is greyed out',
  (menu?.items || []).slice(0, 2).every((i) => !i.disabled),
  JSON.stringify((menu?.items || []).slice(0, 2).map((i) => [i.text, i.disabled])))

check('Continue was clickable', await clickMenuItem(menu, 'Continue Numbering'))
let after = await markers()
check('the second list continues at 3',
  after[1]?.markers.join(',') === '3.,4.', JSON.stringify(after[1]?.markers))
check('the first list is untouched',
  after[0]?.markers.join(',') === '1.,2.', JSON.stringify(after[0]?.markers))

console.log('\nCase B: and it can be reset again')
menu = await openMarkerMenu(1, 0)
check('the menu opens on a list that is already continuing', !!menu)
check('Reset is offered and not greyed out',
  !!(menu?.items || []).find((i) => i.text.startsWith('Reset Counter') && !i.disabled),
  JSON.stringify((menu?.items || []).map((i) => [i.text, i.disabled])))
check('Reset was clickable', await clickMenuItem(menu, 'Reset Counter'))
after = await markers()
check('the second list starts at 1 again',
  after[1]?.markers.join(',') === '1.,2.', JSON.stringify(after[1]?.markers))

console.log('\nCase C: the writer\'s own case - sub-bullets, a paragraph, then carry on')
await setContent(`
<ol><li><p>Satu</p></li><li><p>Dua</p><ul><li><p>anak</p></li></ul></li></ol>
<p>Paragraf tanpa nomor.</p>
<ol><li><p>Lanjutan</p></li></ol>
`)
menu = await openMarkerMenu(1, 0)
check('the menu opens on the list after the paragraph', !!menu)
check('Continue offers 3', /Continue Numbering \(3\)/.test((menu?.items || []).map((i) => i.text).join(' | ')),
  JSON.stringify((menu?.items || []).map((i) => i.text)))
check('Continue was clickable', await clickMenuItem(menu, 'Continue Numbering'))
after = await markers()
check('the writer gets their number 3',
  after.find((l) => l.level === 0 && l.markers.join(',') === '3.'), JSON.stringify(after))

console.log('\nCase D: a nested list counts at its own level, not the one above it')
await setContent(`
<ol><li><p>Satu</p><ol><li><p>Anak A</p></li><li><p>Anak B</p></li></ol></li></ol>
<p>Antara.</p>
<ol><li><p>Lain</p><ol><li><p>Anak C</p></li></ol></li></ol>
`)
const nested = (await markers()).map((l, i) => ({ i, ...l }))
const secondNested = nested.filter((l) => l.level === 1)[1]
check('the fixture has two nested lists', !!secondNested, JSON.stringify(nested))
menu = await openMarkerMenu(secondNested.i, 0)
check('the menu opens on the nested list', !!menu)
check('it reports indent level 1', (menu?.info || '').includes('Indent level: 1'), JSON.stringify(menu?.info))
// Level 1 has seen 1 and 2, so it continues at 3. Level 0 has seen only 1, and must not be consulted.
check('Continue at level 1 offers 3, not 2',
  /Continue Numbering \(3\)/.test((menu?.items || []).map((i) => i.text).join(' | ')),
  JSON.stringify((menu?.items || []).map((i) => i.text)))
check('Continue was clickable', await clickMenuItem(menu, 'Continue Numbering'))
after = await markers()
const lastSegment = (marker) => marker.split('.').filter(Boolean).slice(-1)[0]
check('the nested list continues at 3',
  lastSegment(after.filter((l) => l.level === 1)[1]?.markers[0] || '') === '3',
  JSON.stringify(after))
check('the outer list is left alone',
  after.filter((l) => l.level === 0)[1]?.markers.join(',') === '1.',
  JSON.stringify(after.filter((l) => l.level === 0).map((l) => l.markers)))


const key = async (k, code, vk) => {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, sessionId)
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, sessionId)
  await sleep(400)
}
// The shape a reader sees: markers and nesting, nothing about attributes.
const shape = async () => evaluate(`(() => {
  const walk = (el) => [...el.children].map((c) => {
    if (c.tagName === 'OL' || c.tagName === 'UL') return c.tagName + '[' + walk(c).join(' ') + ']'
    if (c.tagName === 'LI') {
      const t = (c.querySelector(':scope > .pdoc-list-item-content > p') || {}).textContent || ''
      const m = (c.querySelector(':scope > .pdoc-list-item-marker .pdoc-list-item-marker-text') || {}).textContent || ''
      const nested = [...c.querySelectorAll(':scope > .pdoc-list-item-content > ol, :scope > .pdoc-list-item-content > ul')]
      return m + t + (nested.length ? '{' + nested.map(walk).map((a) => a.join(' ')).join('') + '}' : '')
    }
    return null
  }).filter(Boolean)
  return walk(document.querySelector('.ProseMirror')).join(' ')
})()`)
const putCursorIn = async (text) => evaluate(`(() => {
  let found = null
  window.__ed.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && n.textContent === ${'`'}${'$'}{${JSON.stringify(text)}}${'`'} && found === null) found = p + 1 })
  if (found === null) return false
  window.__ed.commands.setTextSelection(found + 1)
  window.__ed.commands.focus()
  return true
})()`)

console.log('\nCase E: indenting asks the list the item is in')
// The reported fault: a bullet list nested inside a numbered one. `isActive('orderedList')` is true
// because an ordered list is above it, so the ordered-list command ran, refused a bullet parent,
// and Tab did nothing at all - even though the item has a sibling right above it to nest under.
await setContent('<ol><li><p>Satu</p><ul><li><p>anak</p></li><li><p>anak dua</p></li></ul></li></ol>')
check('the cursor reached the nested bullet', await putCursorIn('anak dua'))
const beforeIndent = await shape()
await key('Tab', 'Tab', 9)
const afterIndent = await shape()
check('a bullet nested in a numbered list can still be indented',
  afterIndent !== beforeIndent, `${beforeIndent} -> ${afterIndent}`)
check('and it nests under the sibling above it',
  afterIndent.includes('anak{'), afterIndent)
await key('Tab', 'Tab', 9)  // no sibling now, so nothing to nest under
await key('Escape', 'Escape', 27)

console.log('\nCase F: the panel carries the same two actions')
await setContent('<ol><li><p>Satu</p></li><li><p>Dua</p></li></ol>')
menu = await openMarkerMenu(0, 1)
check('the menu opens on the second item', !!menu)
const buttons = await evaluate(`(() => {
  const els = [...document.querySelectorAll('.pdoc-list-item-overlay .pdoc-list-item-menu-indent-button')]
  return els.map((el) => { const r = el.getBoundingClientRect()
    return { title: el.getAttribute('title'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) } })
})()`)
check('the panel has an indent and an outdent button beside the level',
  buttons.length === 2 && buttons.some((b) => /Increase/i.test(b.title || '')),
  JSON.stringify(buttons.map((b) => b.title)))
const increase = buttons.find((b) => /Increase/i.test(b.title || ''))
if (increase && increase.w > 0) {
  await clickAt(increase.x, increase.y)
  const indented = await shape()
  check('pressing it in the panel indents the item', indented.includes('Satu{'), indented)
  const stillOpen = await evaluate(`(() => {
    const o = document.querySelector('.pdoc-list-item-overlay')
    if (!o || o.offsetParent === null) return null
    const i = o.querySelector('.pdoc-list-item-menu-info')
    return i ? i.textContent.trim() : null
  })()`)
  check('the panel stays open and reports the new level',
    (stillOpen || '').includes('Indent level: 1'), JSON.stringify(stillOpen))
} else {
  check('the indent button is reachable', false, JSON.stringify(buttons))
}
await key('Escape', 'Escape', 27)


console.log('\nCase G: any item can be indented, including the first')
// The reported case: `a.` and `b.` wanted under a `3.` that begins its own list. There is no item
// above them to nest under, and inventing an empty numbered parent would put a number on the page
// that nobody typed - so a list holds the list instead (adr/0014).
await setContent('<ol><li><p>Satu</p></li><li><p>Dua</p></li><li><p>Tiga</p></li></ol>')
check('the cursor is in the first item', await putCursorIn('Satu'))
const flatShape = await shape()
await key('Tab', 'Tab', 9)
const firstIndented = await shape()
check('the first item of a list can be indented',
  firstIndented !== flatShape, `${flatShape} -> ${firstIndented}`)
check('it becomes a list inside the list',
  firstIndented.startsWith('OL[OL['), firstIndented)
check('and the items after it renumber from 1',
  /OL\[1\.Dua 2\.Tiga\]|1\.Dua 2\.Tiga/.test(firstIndented), firstIndented)

// A second one joins the first rather than starting its own count - the writer's a. and b.
check('the cursor is in the next item', await putCursorIn('Dua'))
await key('Tab', 'Tab', 9)
const twoIndented = await shape()
check('a second indented item joins the same list',
  /OL\[1\.Satu 2\.Dua\]/.test(twoIndented), twoIndented)

console.log('\nCase H: the levels line up, and indenting is reversible')
// The two shapes must sit at the same indentation or the levels look broken side by side. A list
// inside a list has no marker column above it to push it right, so the step is drawn in CSS, and
// this is what says the drawn step still matches the measured one.
const stepOf = async () => evaluate(`(() => {
  const marks = [...document.querySelectorAll('.ProseMirror li')].map((li) => {
    const m = li.querySelector(':scope > .pdoc-list-item-marker')
    const p = li.querySelector(':scope > .pdoc-list-item-content > p')
    return { text: (p || {}).textContent, left: m ? Math.round(m.getBoundingClientRect().left) : null }
  })
  return marks
})()`)
await setContent('<ol><li><p>Satu</p></li><li><p>Dua</p></li></ol>')
await putCursorIn('Dua')
await key('Tab', 'Tab', 9)
const classic = await stepOf()
await setContent('<ol><li><p>Satu</p></li><li><p>Dua</p></li></ol>')
await putCursorIn('Satu')
await key('Tab', 'Tab', 9)
const emptyLevel = await stepOf()
const classicStep = classic.find((m) => m.text === 'Dua').left - classic.find((m) => m.text === 'Satu').left
const emptyStep = emptyLevel.find((m) => m.text === 'Satu').left - emptyLevel.find((m) => m.text === 'Dua').left
check('a level under an empty level sits where a level under an item sits',
  Math.abs(classicStep - emptyStep) <= 1, `${classicStep}px against ${emptyStep}px`)

// The document is left at OL[OL[1.Satu] 1.Dua] by the measurement above.
await putCursorIn('Satu')
await evaluate(`(() => { window.__ed.commands.setOutdent(); return true })()`)
await sleep(400)
check('outdenting puts it back where it started',
  (await shape()) === 'OL[1.Satu 2.Dua]', await shape())


console.log('\nCase I: resetting a count does not touch a nested list\'s numerals')
// The reported fault: choosing Reset Counter on item 4 turned `2.a` and `2.b` into `2.1` and `2.2`.
// Every start-value command walked the list and rewrote the listType of each list nested inside it,
// which nobody asked for - the writer was pointing at a level the change never mentioned.
await setContent(`
<ol>
  <li><p>baris 1</p></li>
  <li><p>baris 2</p><ol data-type="lower-latin" style="list-style-type: lower-latin"><li><p>baris a</p></li><li><p>baris b</p></li></ol></li>
  <li><p>baris 3</p></li>
  <li><p>baris 4</p></li>
</ol>
`)
const nestedBefore = (await markers()).find((l) => l.level === 1)
check('the fixture has a lettered sub-list',
  nestedBefore?.markers.join(',') === '2.a.,2.b.', JSON.stringify(nestedBefore?.markers))

menu = await openMarkerMenu(0, 3)
check('the menu opens on the fourth item', !!menu)
check('Reset was clickable', await clickMenuItem(menu, 'Reset Counter'))
const nestedAfter = (await markers()).find((l) => l.level === 1)
check('the sub-list keeps its letters',
  nestedAfter?.markers.join(',') === '2.a.,2.b.', JSON.stringify(nestedAfter?.markers))

console.log('\nCase J: the writer owns what a marker says')
// `2.a.` could not be made to read `a.`, which is an element of the page nobody could control.
await setContent(`
<ol><li><p>baris 1</p></li><li><p>baris 2</p><ol data-type="lower-latin" style="list-style-type: lower-latin"><li><p>baris a</p></li></ol></li></ol>
`)
const setTemplate = async (template) => evaluate(`(async () => {
  let target = null
  window.__ed.state.doc.descendants((n, p) => {
    if (n.type.name === 'orderedList' && n.attrs.listType === 'lower-latin' && target === null) target = p
  })
  if (target === null) return 'NO LIST'
  const node = window.__ed.state.doc.nodeAt(target)
  window.__ed.view.dispatch(window.__ed.state.tr.setNodeMarkup(target, undefined, { ...node.attrs, template: ${JSON.stringify(template)} }))
  await new Promise((r) => setTimeout(r, 500))
  return true
})()`)
const nestedMarker = async () => ((await markers()).find((l) => l.level === 1) || {}).markers?.join(',')

check('by default it still reads as it did', (await nestedMarker()) === '2.a.', await nestedMarker())
await setTemplate('{number}.')
check('it can be made to read just the letter', (await nestedMarker()) === 'a.', await nestedMarker())
await setTemplate('{parent} {number}')
check('or to compose the level above with its own',
  (await nestedMarker()) === '2. a', await nestedMarker())
await setTemplate('')
check('and an empty template shows nothing at all',
  (await nestedMarker()) === '', JSON.stringify(await nestedMarker()))

console.log(`\nRESULT: ${failures.length === 0 ? 'PASSED' : 'FAILED'} -- ${total} checks, ${failures.length} failed`)
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`))
await finish(failures.length === 0 ? 0 : 1)
