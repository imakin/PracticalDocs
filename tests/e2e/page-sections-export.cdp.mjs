/**
 * What a document with more than one page size actually exports as.
 *
 * **Each section prints on its own paper**, one page per on-screen sheet, at full size and in its
 * own text column - and the page numbers land where the screen puts them, because the export's page
 * boundaries are now the screen's.
 *
 * The scale is still the check that matters most. Chrome shrinks a document when an element
 * overflows the page it prints on, and the on-screen canvas is as wide as the widest sheet, so a
 * landscape section once shrank the whole export to 70 per cent - with the page count and the page
 * sizes both still looking right, which is how it went unnoticed. Every column is measured in points
 * here, against the paper it belongs to, so a document that shrinks cannot pass.
 *
 * Needs poppler-utils (pdfinfo, pdftotext). Endpoints come from EDITOR_URL and CDP_URL; per adr/0006
 * there is no built-in fallback.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import WebSocket from 'ws'

const required = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(
      `FAIL: ${name} is not set. Runtime endpoints are per-session configuration (adr/0006).`,
    )
    process.exit(1)
  }
  return value
}
const CDP = required('CDP_URL').replace(/\/$/, '')
const EDITOR_URL = required('EDITOR_URL')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Both tools have to be poppler's. `which` only says a file of that name exists, not which
// build it is, and another one can sit ahead of poppler on PATH -- measured with xpdf's
// pdftotext, which has no `-bbox` and brought the run down with a usage dump three checks in.
// The version banner is what tells them apart, and it is read rather than the exit status
// because the two builds disagree about that too.
for (const tool of ['pdfinfo', 'pdftotext']) {
  const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
  if (probe.error) {
    console.error(
      `FAIL: ${tool} is not installed. This test reads the exported PDF rather than trusting it.`,
    )
    process.exit(1)
  }
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  if (!/poppler/i.test(banner)) {
    console.error(
      `FAIL: ${tool} is not poppler's -- "${/^.*/.exec(banner.trim())[0] || 'no version banner'}". Put poppler ahead of it on PATH.`,
    )
    process.exit(1)
  }
}

// CDP's HTTP endpoints are read with `node:http` rather than `fetch`. fetch keeps its sockets
// alive after the body has been read, and on Windows `process.exit` over a handle that is still
// closing trips a libuv assertion -- UV_HANDLE_CLOSING in src/win/async.c -- so a run that passed
// every check exited 127 and read as a failure to anything looking at the code. `agent: false`
// leaves nothing behind to close.
const getJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`${url} answered ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })

const version = await getJson(`${CDP}/json/version`).catch(() => null)
if (!version) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const { webSocketDebuggerUrl } = version
const ws = new WebSocket(webSocketDebuggerUrl, {
  maxPayload: 128 * 1024 * 1024,
})
const pending = new Map()
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})
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
    ws.send(
      JSON.stringify({
        id: nextId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    )
  })

const tabsAtStart = (await getJson(`${CDP}/json/list`)).filter(
  (t) => t.type === 'page',
).length
const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', {
  targetId,
  flatten: true,
})
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
await call(
  'Emulation.setDeviceMetricsOverride',
  { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
  sessionId,
)

const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
]
let persistedBefore = null
// Every tab this test opens is closed the moment it is finished with, and the count is checked.
const printTargets = new Set()
const tabCount = async () =>
  (await getJson(`${CDP}/json/list`).catch(() => [])).filter?.(
    (t) => t.type === 'page',
  ).length
// Counted before this test's own tab exists, so the check at the end is against the browser as it
// was found.
const tabsBefore = tabsAtStart

const evaluate = async (expression, session = sessionId) => {
  const r = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    session,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ||
        JSON.stringify(r.exceptionDetails),
    )
  }
  return r.result.value
}
let closed = false
const finish = async (code) => {
  if (!closed) {
    closed = true
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
    for (const id of printTargets)
      await call('Target.closeTarget', { targetId: id }).catch(() => {})
    await call('Target.closeTarget', { targetId }).catch(() => {})
    // Chrome removes a closed target a moment after being asked, so the count is taken after a beat.
    await sleep(600)
    const after = await tabCount()
    if (after !== undefined && after !== tabsBefore) {
      console.error(`WARNING: tabs before ${tabsBefore}, after ${after}`)
    }
  }
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
    if (p.editor?.value?.state) { window.__ed = p.editor.value; window.__p = p; break }
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
const check = (label, condition, detail) => {
  console.log(
    `  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`,
  )
  if (!condition) failures.push(label)
}

// Each section runs to more than one page, so the page number bands inside a section are exercised
// as well as the boundaries between sections.
const build = (numbers) => `(async () => {
  const filler = (t, n) => ({ type: 'paragraph', content: [{ type: 'text', text: (t + ' ').repeat(n) }] })
  window.__p.page.value.pageNumber = { enabled: ${numbers}, position: 'bottom-center', firstPagePosition: null, format: 'numeric', template: '{number}', startAt: 1 }
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'PORTRAIT ONE' }] }, filler('Satu.', 900),
    { type: 'pageBreak', attrs: { sectionOrientation: 'landscape' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'LANDSCAPE TWO' }] }, filler('Dua.', 800),
    { type: 'pageBreak', attrs: { sectionOrientation: 'portrait' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'PORTRAIT THREE' }] }, filler('Tiga.', 900),
  ] })
  await new Promise((r) => setTimeout(r, 9000))
  const storage = window.__ed.extensionStorage.pagination
  return {
    solve: storage.solve,
    shapes: storage.sheets.map((s) => (s.width > s.height ? 'L' : 'P')),
    sections: storage.sheets.map((s) => s.section),
    numbers: storage.pages.filter((p) => p.visible && p.text !== '').map((p) => p.text),
  }
})()`

const exportPdf = async () => {
  const captured = await evaluate(`(async () => {
    let el = document.querySelector('.ProseMirror')
    while (el && !el.__vueParentComponent) el = el.parentElement
    let inst = el.__vueParentComponent, provides = null
    while (inst) { if (inst.provides?.exportFile) { provides = inst.provides; break } inst = inst.parent }
    provides.exportFile.value.pdf = true
    await new Promise((r) => setTimeout(r, 2500))
    const iframe = document.querySelector('.pdoc-print-iframe')
    const code = iframe ? iframe.getAttribute('srcdoc') || '' : ''
    const hints = [...document.querySelectorAll('.pdoc-print-dialog-hint')].map((h) => h.textContent.trim())
    const dialog = [...document.querySelectorAll('.t-dialog')].find((d) => d.offsetParent !== null)
    if (dialog) { const cancel = [...dialog.querySelectorAll('button')].find((b) => /cancel|batal/i.test(b.textContent)); if (cancel) cancel.click() }
    provides.exportFile.value.pdf = false
    await new Promise((r) => setTimeout(r, 400))
    return { code, hints }
  })()`)
  const { code: srcdoc, hints } = captured
  if (!srcdoc) throw new Error('could not capture the export document')

  const target = await call('Target.createTarget', { url: 'about:blank' })
  printTargets.add(target.targetId)
  const session = (
    await call('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
  ).sessionId
  await call('Page.enable', {}, session)
  const frameId = (await call('Page.getFrameTree', {}, session)).frameTree.frame
    .id
  await call('Page.setDocumentContent', { frameId, html: srcdoc }, session)
  await sleep(3000)
  const pdf = await call(
    'Page.printToPDF',
    {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    },
    session,
  )
  // Closed here rather than at the end of the run: one tab, open only while it is being used.
  await call('Target.closeTarget', { targetId: target.targetId }).catch(
    () => {},
  )
  printTargets.delete(target.targetId)

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdoc-sections-'))
  const file = path.join(dir, 'export.pdf')
  await writeFile(file, Buffer.from(pdf.data, 'base64'))
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '60', file]).toString()
  const pages = Number(info.match(/Pages:\s+(\d+)/)[1])
  const shapes = [
    ...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g),
  ].map((m) => (Number(m[1]) > Number(m[2]) ? 'L' : 'P'))
  const trailing = []
  // The horizontal span the words actually occupy on each page. A column inset by a gutter meant for
  // a wider canvas shows up here and nowhere else.
  const columns = []
  for (let p = 1; p <= pages; p += 1) {
    const at = ['-f', String(p), '-l', String(p), file, '-']
    const text = execFileSync('pdftotext', at).toString().trim()
    trailing.push(text.split(/\s+/).pop() || '')
    const bbox = execFileSync('pdftotext', ['-bbox', ...at]).toString()
    const xs = [
      ...bbox.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"/g),
    ]
    if (xs.length > 0) {
      columns.push({
        left: Math.round(Math.min(...xs.map((m) => Number(m[1])))),
        right: Math.round(Math.max(...xs.map((m) => Number(m[2])))),
      })
    }
  }
  return { pages, shapes, trailing, columns, hints, file }
}

console.log('\nCase A: each section prints at full size, on its own paper')
const screenPlain = await evaluate(build(false))
check(
  'the engine paginated the whole document',
  screenPlain.solve?.stopped === 'settled',
  JSON.stringify(screenPlain.solve),
)
const shapeOfSection = (screen) => {
  const out = []
  screen.sections.forEach((section, index) => {
    out[section] = screen.shapes[index]
  })
  return out.join('')
}
check(
  'the middle section is landscape on screen and the others are not',
  shapeOfSection(screenPlain) === 'PLP',
  screenPlain.shapes.join(''),
)
check(
  'each section runs to more than one page',
  new Set(screenPlain.sections).size === 3 && screenPlain.sections.length > 4,
  JSON.stringify(screenPlain.sections),
)
const plain = await exportPdf()
check(
  'the PDF has one page per on-screen sheet',
  plain.pages === screenPlain.shapes.length,
  `${screenPlain.shapes.length} sheets vs ${plain.pages} pages`,
)
check(
  'each page is drawn on the same paper as its sheet on screen',
  plain.shapes.join('') === screenPlain.shapes.join(''),
  `screen ${screenPlain.shapes.join('')} vs PDF ${plain.shapes.join('')}`,
)
check(
  'and the dialog no longer warns that the paper cannot change',
  !plain.hints.some((hint) => hint.includes('more than one page size')),
  JSON.stringify(plain.hints),
)
// A4 with the default 3.18 cm side margins is a 14.64 cm column portrait - 415 pt - and a 23.34 cm
// column landscape, 662 pt. Both are asserted against the shape of the page they were measured on,
// which is what makes this a scale check rather than a width check: a document shrunk to fit the
// narrowest page reads 291 pt and 468 pt, and no tolerance covers that. Measured before the fix,
// with everything on one paper: 412 pt on every page, landscape section included.
const EXPECTED_COLUMN = { P: 415, L: 662 }
const columnFaults = (pdf, shapes) =>
  pdf.columns
    .map((column, index) => ({
      page: index + 1,
      shape: shapes[index],
      width: column.right - column.left,
      expected: EXPECTED_COLUMN[shapes[index]],
    }))
    .filter((row) => Math.abs(row.width - row.expected) > 14)
const plainFaults = columnFaults(plain, plain.shapes)
check(
  "every page's text column is its own section's, at full size",
  plainFaults.length === 0,
  plainFaults.length === 0
    ? `${plain.columns.map((c) => c.right - c.left).join(', ')} pt`
    : JSON.stringify(plainFaults),
)

console.log('\nCase B: and the same holds once it draws page numbers')
const screenNumbered = await evaluate(build(true))
check(
  'the engine paginated the whole document',
  screenNumbered.solve?.stopped === 'settled',
  JSON.stringify(screenNumbered.solve),
)
const numbered = await exportPdf()
check(
  'the PDF has one page per on-screen sheet',
  numbered.pages === screenNumbered.shapes.length,
  `${screenNumbered.shapes.length} sheets vs ${numbered.pages} pages`,
)
check(
  'each page is drawn on the same paper as its sheet on screen',
  numbered.shapes.join('') === screenNumbered.shapes.join(''),
  `screen ${screenNumbered.shapes.join('')} vs PDF ${numbered.shapes.join('')}`,
)
const numberedFaults = columnFaults(numbered, numbered.shapes)
check(
  "every page's text column is its own section's here too",
  numberedFaults.length === 0,
  numberedFaults.length === 0
    ? `${numbered.columns.map((c) => c.right - c.left).join(', ')} pt`
    : JSON.stringify(numberedFaults),
)
// Asserted now, and it could not be before. While a mixed document was laid out at one paper the
// screen's page boundaries were not the export's, so the bands carrying the numbers landed on the
// wrong pages - measured then, four of six right. Each sheet is its own paper now, so the two agree
// again and the number a page ends with is the number the screen draws on it.
check(
  'and every page ends with the number the screen draws on it',
  numbered.trailing.join('|') === screenNumbered.numbers.join('|'),
  `screen ${JSON.stringify(screenNumbered.numbers)} vs PDF ${JSON.stringify(numbered.trailing)}`,
)

// A page break on a page with only a line or two to spare. The first line that overflows is then the
// one the break itself pushes down, so the overflow sits at or above the break and the solver's
// overflow branch takes it rather than the forced-break branch - and only the forced branch records
// the section a break opens. Measured before the fix: `storage.sheets` reported its three sheets as
// sections `0,0,2`, section 1 owning none, and the export named a band for a section that was not
// there. The page name then ran s0 -> s1 -> s0 -> s2, and since a change of page name is a forced
// break, three sheets printed as five pages.
//
// The fixture looks for the condition rather than hardcoding a line count, because how many lines
// fill a page depends on the profile in effect. If it cannot find one it says so and fails, instead
// of passing while testing nothing.
console.log(
  '\nCase C: a page break with a line or two of room left still opens its section',
)
let tightFill = null
for (let lines = 24; lines <= 44 && tightFill === null; lines += 1) {
  const attempt = await evaluate(`(async () => {
    const line = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
    window.__p.page.value.pageNumber = { enabled: true, position: 'bottom-center', firstPagePosition: null, format: 'numeric', template: '{number}', startAt: 1 }
    const body = []
    for (let i = 1; i <= ${lines}; i += 1) body.push(line('Baris ' + i))
    body.push({ type: 'pageBreak' })
    body.push(line('SESUDAH PAGE BREAK'))
    body.push({ type: 'pageBreak', attrs: { sectionOrientation: 'landscape' } })
    body.push(line('BAGIAN LANDSCAPE'))
    window.__ed.commands.setContent({ type: 'doc', content: body })
    await new Promise((r) => setTimeout(r, 7000))
    const storage = window.__ed.extensionStorage.pagination
    const spacer = document.querySelector('.pdoc-page-spacer')
    return {
      lines: ${lines},
      sheets: storage.sheets.length,
      sections: storage.sheets.map((s) => s.section).join(','),
      shapes: storage.sheets.map((s) => (s.width > s.height ? 'L' : 'P')).join(''),
      solve: storage.solve,
      leftover: spacer ? Math.round(Number.parseFloat(spacer.style.height)) : null,
    }
  })()`)
  // Three sheets, and the break sitting close enough to the foot of the first one. The spacer holds
  // the leftover column space plus the bottom margin plus the sheet gap, so a small spacer is a
  // nearly full page. 240px was measured as the far side of the fault and 130px as the near side.
  if (attempt.sheets === 3 && attempt.leftover !== null && attempt.leftover <= 240) {
    tightFill = attempt
  }
}
check(
  'a page break can be placed with only a line or two of room left',
  tightFill !== null,
  tightFill === null
    ? 'no line count filled the page closely enough - the case tested nothing'
    : `${tightFill.lines} lines, ${tightFill.leftover}px left below the break`,
)
if (tightFill !== null) {
  check(
    'every section owns the sheet it opens',
    tightFill.sections === '0,1,2',
    `sheet sections ${tightFill.sections}, shapes ${tightFill.shapes}`,
  )
  const tight = await exportPdf()
  check(
    'and the PDF still has one page per sheet',
    tight.pages === tightFill.sheets,
    `${tightFill.sheets} sheets vs ${tight.pages} pages`,
  )
  check(
    'each on the paper its sheet is drawn on',
    tight.shapes.join('') === tightFill.shapes,
    `screen ${tightFill.shapes} vs PDF ${tight.shapes.join('')}`,
  )
}

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- each section prints on its own paper, one page per sheet, at full size.',
)
await finish(0)
