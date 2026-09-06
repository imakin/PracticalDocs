/**
 * The table of contents points at the page the reader will actually turn to.
 *
 * It used to count `.pdoc-page-node` elements and take the heading's index among them. Since
 * pagination became decorations there is one such element for the whole canvas, so every entry came
 * out as page 1 - which is what the contents showed on a nine-page thesis. It now asks the pagination
 * engine, which has already solved the geometry and already computed what each sheet is numbered, so
 * a contents entry agrees with the folio printed on the page. It also shows the heading's own number,
 * read from the rendered decoration so the two cannot disagree.
 *
 * Every check reads the rendered contents, not the data behind it.
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

// A table of contents, then enough filler to push each chapter onto a sheet of its own, with a
// forced break before the second chapter so the section boundary is exercised too. Built as a
// document rather than as html, so the node types are named rather than guessed from parse rules.
const text = (value) => [{ type: 'text', text: value }]
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: text(value) })
const filler = (mark) =>
  Array.from({ length: 26 }, (_, i) => ({ type: 'paragraph', content: text(`${mark} line ${i + 1}`) }))
const FIXTURE = {
  type: 'doc',
  content: [
    { type: 'toc' },
    heading(1, 'Pendahuluan'),
    ...filler('a'),
    heading(2, 'Latar Belakang'),
    ...filler('b'),
    { type: 'pageBreak' },
    heading(1, 'Tinjauan Pustaka'),
    ...filler('c'),
  ],
}

const load = async (doc) =>
  evaluate(`(async () => {
    window.__ed.commands.setContent(${JSON.stringify(doc)})
    await new Promise((r) => setTimeout(r, 4500))
    return true
  })()`)

// What the contents renders, row by row, plus where each heading really is, measured independently
// of the contents by dividing the heading's offset by the sheet pitch.
const readContents = `(() => {
  const rows = [...document.querySelectorAll('.pdoc-node-toc .pdoc-toc-item-row')]
  if (rows.length === 0) return { missing: true }
  const storage = window.__ed.extensionStorage?.pagination || window.__ed.storage?.pagination
  const host = window.__ed.view.dom.closest('.pdoc-page-content')
  const originTop = host.getBoundingClientRect().top
  const stride = storage?.stride || 0
  // The first rendered line, not the box. A heading opening a sheet after a forced break has a box
  // beginning in the previous sheet's bottom margin, because the break's spacer is anchored inside
  // the heading rather than before it. Text nodes only, or the spacer's own full-width rect comes
  // back first and reports the box again under a different name.
  const lineTop = (el) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let node
    while ((node = walk.nextNode())) {
      if (!node.textContent || !node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.height > 0 && rect.width > 0) return rect.top
      }
    }
    return el.getBoundingClientRect().top
  }
  const headings = [...window.__ed.view.dom.querySelectorAll('[data-toc-id]')].map((el) => ({
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
    sheet: stride > 0 ? Math.floor((lineTop(el) - originTop) / stride) : null,
  }))
  return {
    rows: rows.map((row) => {
      const page = row.querySelector('.pdoc-toc-item-page')
      const text = row.querySelector('.pdoc-toc-item-text')
      return {
        label: row.querySelector('.pdoc-toc-item-label')?.textContent?.trim() ?? '',
        text: text?.textContent?.trim() ?? '',
        page: page?.textContent?.trim() ?? '',
        // Measured, not read back from the style attribute: what matters is where the text starts
        // and where the number's right edge lands.
        textLeft: text ? Math.round(text.getBoundingClientRect().left) : null,
        pageRight: page ? Math.round(page.getBoundingClientRect().right) : null,
        paddingLeft: Math.round(Number.parseFloat(getComputedStyle(row).paddingLeft) || 0),
      }
    }),
    treeLines: document.querySelectorAll('.pdoc-node-toc .pdoc-tree__line, .pdoc-node-toc .t-tree__line').length,
    treeIcons: document.querySelectorAll('.pdoc-node-toc .pdoc-tree__icon, .pdoc-node-toc .t-tree__icon').length,
    headings,
    stride,
    sheetCount: storage?.pages?.length ?? 0,
    pageTexts: (storage?.pages ?? []).map((p) => (p.visible && p.text !== '' ? p.text : String(p.index))),
  }
})()`

console.log('\nThe contents points at the page each heading is really on')
await load(FIXTURE)
const contents = await evaluate(readContents)
if (contents.missing) { console.error('FAIL: the fixture produced no table of contents'); await finish(1) }
console.log(`  ${contents.rows.length} entries across ${contents.sheetCount} sheets, pitch ${Math.round(contents.stride)}px`)
for (const row of contents.rows) {
  console.log(`          ${JSON.stringify(row.label)} ${JSON.stringify(row.text)} -> page ${JSON.stringify(row.page)}`)
}

check('the contents lists every heading', contents.rows.length === contents.headings.length,
  `${contents.rows.length} entries against ${contents.headings.length} headings`)
check('the document really spans more than one sheet', contents.sheetCount > 1,
  `${contents.sheetCount} sheets`)
check('not every entry says page 1',
  new Set(contents.rows.map((r) => r.page)).size > 1,
  JSON.stringify(contents.rows.map((r) => r.page)))
check('no entry is blank', contents.rows.every((r) => r.page !== ''),
  JSON.stringify(contents.rows.map((r) => r.page)))

// The strong check: each entry against the sheet its own heading was measured on.
const expected = contents.headings.map((h) => contents.pageTexts[h.sheet])
const actual = contents.rows.map((r) => r.page)
check('every entry matches the sheet its heading is measured on',
  JSON.stringify(actual) === JSON.stringify(expected),
  `${JSON.stringify(actual)} against ${JSON.stringify(expected)}`)

// An absolute claim, not derived from the same measurement: a forced page break puts the chapter
// after it on a later sheet than the heading before it.
check('the chapter after a forced break is listed on a later page',
  Number(contents.rows[2].page) > Number(contents.rows[1].page),
  JSON.stringify(contents.rows.map((r) => r.page)))

console.log('\nThe contents carries the heading number, not bare text')
const labels = contents.rows.map((r) => r.label)
check('the first chapter shows its number', labels[0] !== '', JSON.stringify(labels))
check('a nested heading shows its own number', labels[1] !== '' && labels[1] !== labels[0],
  JSON.stringify(labels))
check('the second chapter shows a different number from the first',
  labels[2] !== '' && labels[2] !== labels[0], JSON.stringify(labels))
check('every label matches the number rendered on the heading itself',
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.pdoc-node-toc .pdoc-toc-item-row')]
    const headings = [...window.__ed.view.dom.querySelectorAll('[data-toc-id]')]
    return rows.every((row, i) => {
      const shown = row.querySelector('.pdoc-toc-item-label')?.textContent?.trim() ?? ''
      const drawn = (headings[i]?.querySelector('.pdoc-heading-number')?.textContent || '')
        .replace(/\\s+/g, ' ').trim()
      return shown === drawn
    })
  })()`),
  JSON.stringify(labels))

console.log('\nThe contents follows the page numbering, including a restart')
// Restart the count at 1 on the sheet the forced break opens, in roman. A contents that ignored the
// numbering would keep counting sheets and disagree.
await evaluate(`(async () => {
  const ed = window.__ed
  // Numbering is off by default, and a restart is a numbering feature. Turned on through the same
  // command the Page Numbers panel uses.
  ed.commands.setPageNumberSettings({ enabled: true, position: 'bottom-center', format: 'numeric', template: '{number}' })
  await new Promise((r) => setTimeout(r, 3000))
  let pos = null
  ed.state.doc.descendants((node, at) => { if (node.type.name === 'pageBreak' && pos === null) pos = at })
  if (pos === null) throw new Error('no page break in the fixture')
  const attrs = { ...ed.state.doc.nodeAt(pos).attrs, sectionStartAt: 1, sectionFormat: 'roman-lower' }
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, attrs))
  await new Promise((r) => setTimeout(r, 4000))
  return true
})()`)
const restarted = await evaluate(readContents)
for (const row of restarted.rows) {
  console.log(`          ${JSON.stringify(row.label)} ${JSON.stringify(row.text)} -> page ${JSON.stringify(row.page)}`)
}
const restartedExpected = restarted.headings.map((h) => restarted.pageTexts[h.sheet])
check('the restart reaches the contents',
  JSON.stringify(restarted.rows.map((r) => r.page)) === JSON.stringify(restartedExpected),
  `${JSON.stringify(restarted.rows.map((r) => r.page))} against ${JSON.stringify(restartedExpected)}`)
check('an entry after the restart is roman',
  restarted.rows.some((r) => /^[ivxl]+$/.test(r.page)),
  JSON.stringify(restarted.rows.map((r) => r.page)))
check('the entries before the restart are unchanged',
  restarted.rows[0].page === contents.rows[0].page,
  `${JSON.stringify(restarted.rows[0].page)} against ${JSON.stringify(contents.rows[0].page)}`)

console.log('\nThe contents draws nothing the user did not ask for')
check('no tree connector lines are rendered', contents.treeLines === 0, String(contents.treeLines))
check('no expand or collapse icons are rendered', contents.treeIcons === 0, String(contents.treeIcons))

console.log('\nIndentation is a setting, and the page numbers stay in line')
const setIndent = async (from, step) =>
  evaluate(`(async () => {
    window.__ed.commands.updateNumberingProfile('profile-toc', {
      tocIndentFrom: ${JSON.stringify(from)},
      tocIndent: ${JSON.stringify(step)},
    })
    await new Promise((r) => setTimeout(r, 1200))
    return true
  })()`)

const readIndents = async (label) => {
  const state = await evaluate(readContents)
  console.log(`  ${label}: padding ${JSON.stringify(state.rows.map((r) => r.paddingLeft))}, ` +
    `text left ${JSON.stringify(state.rows.map((r) => r.textLeft))}, ` +
    `number right ${JSON.stringify(state.rows.map((r) => r.pageRight))}`)
  return state
}

await setIndent(2, '2em')
const indented = await readIndents('from level 2, step 2em')
check('a level 1 entry is not indented', indented.rows[0].paddingLeft === 0,
  `${indented.rows[0].paddingLeft}px`)
check('a level 2 entry is indented', indented.rows[1].paddingLeft > 0,
  `${indented.rows[1].paddingLeft}px`)
check('the indent moves the text, not the number',
  indented.rows[1].textLeft > indented.rows[0].textLeft,
  `${indented.rows[0].textLeft} then ${indented.rows[1].textLeft}`)
check('every page number ends on the same right edge',
  new Set(indented.rows.map((r) => r.pageRight)).size === 1,
  JSON.stringify(indented.rows.map((r) => r.pageRight)))

await setIndent(2, '4em')
const wider = await readIndents('from level 2, step 4em')
check('a bigger step indents further', wider.rows[1].paddingLeft > indented.rows[1].paddingLeft,
  `${indented.rows[1].paddingLeft}px then ${wider.rows[1].paddingLeft}px`)
check('the page numbers are still in line after the step changes',
  new Set(wider.rows.map((r) => r.pageRight)).size === 1,
  JSON.stringify(wider.rows.map((r) => r.pageRight)))

await setIndent(3, '4em')
const deeper = await readIndents('from level 3, step 4em')
check('raising the starting level un-indents the level below it', deeper.rows[1].paddingLeft === 0,
  `${deeper.rows[1].paddingLeft}px`)

await setIndent(2, '0')
const flat = await readIndents('step 0')
check('a step of zero gives a flat list', flat.rows.every((r) => r.paddingLeft === 0),
  JSON.stringify(flat.rows.map((r) => r.paddingLeft)))
check('the page numbers are still in line when flat',
  new Set(flat.rows.map((r) => r.pageRight)).size === 1,
  JSON.stringify(flat.rows.map((r) => r.pageRight)))

console.log('\nThe built-in contents profile survives opening a document')
const profileState = await evaluate(`(async () => {
  const ed = window.__ed
  // Exactly what opening a stored document does: hand the editor the profiles that document was
  // saved with. A document written before the contents profile existed does not mention it.
  const before = []
  ed.commands.getNumberingProfiles((list) => { before.push(...list) })
  const withoutToc = before.filter((p) => p.targetType !== 'toc').map((p) => ({ ...p }))
  ed.commands.setNumberingConfig({ profiles: withoutToc })
  await new Promise((r) => setTimeout(r, 1500))
  const after = []
  ed.commands.getNumberingProfiles((list) => { after.push(...list) })
  return {
    handedIn: withoutToc.length,
    contentsProfiles: after.filter((p) => p.targetType === 'toc').map((p) => ({ id: p.id, name: p.name })),
    keptTheUsersOwn: after.length >= withoutToc.length,
  }
})()`)
check('a document saved without it gets the contents profile back',
  profileState.contentsProfiles.some((p) => p.id === 'profile-toc'),
  JSON.stringify(profileState.contentsProfiles))
check('it comes back under a name the user can look for',
  profileState.contentsProfiles.some((p) => p.name === 'Table of Contents'),
  JSON.stringify(profileState.contentsProfiles))
check('nothing the document did carry was dropped', profileState.keptTheUsersOwn,
  `${profileState.handedIn} handed in`)

console.log('\nA map picks its own contents profile when there is more than one')
const picked = await evaluate(`(async () => {
  const ed = window.__ed
  ed.commands.addNumberingProfile({
    id: 'profile-toc-flat',
    name: 'List of Figures',
    targetType: 'toc',
    enabled: false,
    template: '',
    tocIndentFrom: 2,
    tocIndent: '0',
  })
  await new Promise((r) => setTimeout(r, 1200))
  ed.commands.updateNumberingProfile('profile-toc', { tocIndentFrom: 2, tocIndent: '3em' })
  await new Promise((r) => setTimeout(r, 1200))
  const body = document.querySelector('.pdoc-node-toc-body')
  const rowPadding = () => [...document.querySelectorAll('.pdoc-node-toc .pdoc-toc-item-row')]
    .map((r) => Math.round(Number.parseFloat(getComputedStyle(r).paddingLeft) || 0))
  const asDefault = { className: body.className, padding: rowPadding() }

  // Select the map and choose the other profile, through the command the picker calls. The node's
  // own position, not a position derived from its DOM - the map is the first node in the document,
  // where there is nothing before it to resolve.
  let tocPos = null
  ed.state.doc.descendants((n, at) => { if (n.type.name === 'toc' && tocPos === null) tocPos = at })
  if (tocPos === null) throw new Error('no toc node in the fixture')
  ed.commands.setNodeSelection(tocPos)
  await new Promise((r) => setTimeout(r, 400))
  const applied = ed.commands.setTableOfContentsProfile('profile-toc-flat')
  await new Promise((r) => setTimeout(r, 1500))
  const b2 = document.querySelector('.pdoc-node-toc-body')
  const asFlat = { className: b2.className, padding: rowPadding(),
                   attr: ed.getAttributes('toc').profileId }

  // A named profile that no longer exists must fall back rather than leave the map unstyled.
  ed.commands.deleteNumberingProfile('profile-toc-flat')
  await new Promise((r) => setTimeout(r, 1500))
  const b3 = document.querySelector('.pdoc-node-toc-body')
  const afterDelete = { className: b3.className, padding: rowPadding(),
                        attr: ed.getAttributes('toc').profileId }
  return { applied, asDefault, asFlat, afterDelete }
})()`)
console.log(`  default: ${picked.asDefault.className} padding ${JSON.stringify(picked.asDefault.padding)}`)
console.log(`  chosen:  ${picked.asFlat.className} padding ${JSON.stringify(picked.asFlat.padding)}`)
console.log(`  deleted: ${picked.afterDelete.className} padding ${JSON.stringify(picked.afterDelete.padding)}`)
check('naming no profile uses the built-in',
  picked.asDefault.className.includes('pdoc-profile-toc') &&
    !picked.asDefault.className.includes('pdoc-profile-toc-flat'),
  picked.asDefault.className)
check('the map takes the profile it is given', picked.applied === true && picked.asFlat.attr === 'profile-toc-flat',
  `${picked.applied}, attr ${JSON.stringify(picked.asFlat.attr)}`)
check('the chosen profile carries its own class', picked.asFlat.className.includes('pdoc-profile-toc-flat'),
  picked.asFlat.className)
check('the two profiles indent differently',
  JSON.stringify(picked.asFlat.padding) !== JSON.stringify(picked.asDefault.padding),
  `${JSON.stringify(picked.asDefault.padding)} against ${JSON.stringify(picked.asFlat.padding)}`)
check('deleting the named profile falls back to the built-in',
  picked.afterDelete.className.includes('pdoc-profile-toc') &&
    !picked.afterDelete.className.includes('pdoc-profile-toc-flat'),
  picked.afterDelete.className)
check('the map keeps the name, so restoring the profile restores the map',
  picked.afterDelete.attr === 'profile-toc-flat',
  JSON.stringify(picked.afterDelete.attr))

console.log('\nReading the profiles does not write to the document')
const quiet = await evaluate(`(async () => {
  const ed = window.__ed
  let count = 0
  const bump = () => { count += 1 }
  ed.on('transaction', bump)

  // A pure read. Every command dispatches its transaction unless it says otherwise, and a reader
  // that dispatches is a loop as soon as anything reactive calls it.
  await new Promise((r) => setTimeout(r, 600))
  const before = count
  for (let i = 0; i < 5; i += 1) ed.commands.getNumberingProfiles(() => {})
  await new Promise((r) => setTimeout(r, 600))
  const afterReads = count - before

  // Select the map, which mounts the profile picker, then sit still. A picker that reads through a
  // command from a computed never stops dispatching, and the editor stops answering.
  let tocPos = null
  ed.state.doc.descendants((n, at) => { if (n.type.name === 'toc' && tocPos === null) tocPos = at })
  ed.commands.setNodeSelection(tocPos)
  await new Promise((r) => setTimeout(r, 1500))
  const settled = count
  await new Promise((r) => setTimeout(r, 2500))
  const whileIdle = count - settled

  ed.off('transaction', bump)
  return { afterReads, whileIdle, responsive: ed.state.doc.childCount > 0 }
})()`)
check('five reads of the profile list dispatch nothing', quiet.afterReads === 0,
  `${quiet.afterReads} transaction(s)`)
check('the editor is idle while the picker is on screen', quiet.whileIdle <= 2,
  `${quiet.whileIdle} transaction(s) in 2.5 s`)
check('the editor still answers afterwards', quiet.responsive === true, String(quiet.responsive))

console.log('\nThe contents profile is listed in the block gallery, and refuses to be applied')
const gallery = await evaluate(`(async () => {
  const ed = window.__ed
  // Stand in an ordinary paragraph. This is the block a stray click would have damaged.
  // Found by walking the document, not by DOM position: without the guard the click changes the block
  // under the cursor, and a position taken from the old DOM then resolves to nothing at all.
  const marked = (text) => {
    let found = null
    ed.state.doc.descendants((n) => {
      if (found === null && n.isTextblock && n.textContent === text) found = n
    })
    return found
  }
  const MARK = 'c line 26'
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')]
  const target = paragraphs.find((el) => el.textContent.trim() === MARK) || paragraphs[paragraphs.length - 1]
  ed.commands.setTextSelection(ed.view.posAtDOM(target, 0) + 1)
  ed.commands.focus()
  await new Promise((r) => setTimeout(r, 600))
  const node = marked(MARK)
  const before = { type: node?.type?.name ?? null, profile: node?.attrs?.numberingProfileId ?? null }

  // Open the block gallery the way a user does.
  const arrow = document.querySelector('.pdoc-toolbar-headding .arrow')
  if (!arrow) return { missing: 'NO_GALLERY_ARROW' }
  arrow.click()
  await new Promise((r) => setTimeout(r, 900))
  const cards = [...document.querySelectorAll('.pdoc-heading-container-popup .card, .pdoc-toolbar-headding .card')]
  const named = (title) => cards.find((c) => (c.querySelector('.title')?.textContent || '').trim() === title)
  const toc = named('Table of Contents')
  const pageNumber = named('Page Number')
  const normal = named('Normal (Text)')
  const seen = {
    listed: !!toc,
    hint: toc?.getAttribute('title') ?? null,
    greyed: toc ? toc.className.includes('not-applicable') : false,
    ordinaryIsNot: normal ? !normal.className.includes('not-applicable') : false,
    pageNumberHint: pageNumber?.getAttribute('title') ?? null,
    names: cards.map((c) => (c.querySelector('.title')?.textContent || '').trim()),
  }

  // Click it. Nothing must happen to the paragraph the cursor is in.
  toc?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const nodeAfter = marked(MARK)
  const after = { type: nodeAfter?.type?.name ?? null, profile: nodeAfter?.attrs?.numberingProfileId ?? null }
  document.body.click()
  return { ...seen, before, after }
})()`)
if (gallery.missing) {
  check('the block gallery opens', false, gallery.missing)
} else {
  console.log(`  cards: ${JSON.stringify(gallery.names)}`)
  check('the contents profile is listed in the gallery', gallery.listed === true,
    JSON.stringify(gallery.names))
  check('it is shown as not applicable', gallery.greyed === true, String(gallery.greyed))
  check('it carries the hint that says why',
    gallery.hint === 'Only for Table of Content / Document Map',
    JSON.stringify(gallery.hint))
  check('the page number profile carries its own hint',
    gallery.pageNumberHint === 'Only for page numbers',
    JSON.stringify(gallery.pageNumberHint))
  check('an ordinary block profile is still applicable', gallery.ordinaryIsNot === true,
    String(gallery.ordinaryIsNot))
  check('clicking it does not touch the block the cursor is in',
    JSON.stringify(gallery.after) === JSON.stringify(gallery.before),
    `${JSON.stringify(gallery.before)} then ${JSON.stringify(gallery.after)}`)
  check('and it certainly does not become the contents profile',
    gallery.after?.profile !== 'profile-toc',
    JSON.stringify(gallery.after))
}

if (failures.length) {
  console.log(`\nRESULT: FAILED -- ${failures.length} check(s) failed:`)
  failures.forEach((f) => console.log(`  - ${f}`))
  await finish(1)
}
console.log('\nRESULT: PASSED -- the contents shows each heading number and the page it is really on.')
await finish(0)
